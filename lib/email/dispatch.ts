import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { getOrder, type Order } from "@/lib/orders";
import { resolvePhotoUrl } from "@/lib/storage";
import { getDeliveryConfig } from "@/lib/delivery-db";
import type { DeliveryConfig } from "@/lib/delivery";
import { brand } from "@/lib/config";
import { sendEmail, isValidEmail } from "./provider";
import { customerEmail, opsEmail } from "./templates";

/**
 * Disparo dos e-mails de um pedido.
 *
 * Três garantias, nesta ordem:
 *
 *   1. **Nunca lança.** Quem chama está logo depois de gravar (ou cobrar) um
 *      pedido. Uma exceção aqui viraria erro 500 numa compra já paga, e o
 *      cliente tentaria de novo — cobrança dupla por causa de um e-mail.
 *   2. **Nunca duplica.** A UNIQUE (order_code, kind) em `email_log` é a trava.
 *      Reservar a linha antes de enviar é o que fecha a janela de corrida.
 *   3. **Sempre deixa rastro.** Sucesso, falha e motivo ficam gravados, com a
 *      contagem de tentativas, para o painel poder reenviar.
 */

export type EmailKind = "customer_confirmation" | "ops_notification";

type DispatchResult = {
  kind: EmailKind;
  status: "sent" | "failed" | "skipped";
  error?: string;
};

/** Destinatário da ordem de produção. */
function opsRecipient() {
  return process.env.EMAIL_OPS ?? brand.email;
}

function build(order: Order, kind: EmailKind, config: DeliveryConfig) {
  return kind === "customer_confirmation"
    ? { to: order.customer.email, ...customerEmail(order, config) }
    : { to: opsRecipient(), ...opsEmail(order, config) };
}

/**
 * Reserva a linha do log. Devolve null quando o e-mail já saiu — é assim que
 * uma segunda chamada não reenvia.
 */
async function claim(
  db: NonNullable<ReturnType<typeof getSupabaseAdmin>>,
  order: Order,
  kind: EmailKind,
  to: string,
  subject: string,
  force: boolean,
) {
  const { data: existing } = await db
    .from("email_log")
    .select("id, status, attempts")
    .eq("order_code", order.code)
    .eq("kind", kind)
    .maybeSingle();

  if (existing) {
    if (existing.status === "sent" && !force) return null;
    await db
      .from("email_log")
      .update({ status: "pending", recipient: to, subject, attempts: existing.attempts + 1 })
      .eq("id", existing.id);
    return { id: existing.id as string, attempts: existing.attempts + 1 };
  }

  const { data, error } = await db
    .from("email_log")
    .insert({ order_code: order.code, kind, recipient: to, subject, status: "pending", attempts: 1 })
    .select("id")
    .single();

  /* Corrida: outra chamada inseriu primeiro. A UNIQUE fez seu trabalho —
     desistir aqui é o comportamento correto, não um erro. */
  if (error) return null;
  return { id: data.id as string, attempts: 1 };
}

async function dispatchOne(
  order: Order,
  kind: EmailKind,
  force: boolean,
  config: DeliveryConfig,
): Promise<DispatchResult> {
  const db = getSupabaseAdmin();
  if (!db) return { kind, status: "skipped", error: "Sin base de datos" };

  const message = build(order, kind, config);

  if (!isValidEmail(message.to)) {
    /* Endereço inválido é falha registrada, não exceção: o pedido continua
       válido e a operação precisa saber que ninguém foi avisado. */
    const claimed = await claim(db, order, kind, message.to, message.subject, true);
    if (claimed) {
      await db
        .from("email_log")
        .update({ status: "failed", last_error: `Dirección inválida: ${message.to}` })
        .eq("id", claimed.id);
    }
    return { kind, status: "failed", error: `Dirección inválida: ${message.to}` };
  }

  const claimed = await claim(db, order, kind, message.to, message.subject, force);
  if (!claimed) return { kind, status: "skipped" };

  const result = await sendEmail(message);

  if (result.ok) {
    await db
      .from("email_log")
      .update({
        status: "sent",
        sent_at: new Date().toISOString(),
        provider: result.provider,
        provider_id: result.providerId,
        simulated: result.simulated,
        last_error: null,
      })
      .eq("id", claimed.id);
    return { kind, status: "sent" };
  }

  await db.from("email_log").update({ status: "failed", last_error: result.error }).eq("id", claimed.id);
  return { kind, status: "failed", error: result.error };
}

/**
 * Envia confirmação ao cliente e ordem de produção à operação.
 *
 * As duas rodam em paralelo e independentes: e-mail do cliente inválido não
 * pode impedir a cozinha de receber o pedido.
 */
export async function sendOrderEmails(code: string, { force = false } = {}) {
  try {
    const stored = await getOrder(code);
    if (!stored) return [];

    /* As fotos ficam num balde privado: o caminho guardado no pedido não abre
       no navegador. A URL assinada é gerada aqui, no momento do envio, e vale
       30 dias — tempo de sobra para produzir e resolver pós-venda. */
    const order: Order = {
      ...stored,
      lines: await Promise.all(
        stored.lines.map(async (line) => ({
          ...line,
          photoUrl: await resolvePhotoUrl(line.photoUrl),
        })),
      ),
    };

    const config = await getDeliveryConfig();

    const results = await Promise.allSettled([
      dispatchOne(order, "customer_confirmation", force, config),
      dispatchOne(order, "ops_notification", force, config),
    ]);

    return results.map((r, i) =>
      r.status === "fulfilled"
        ? r.value
        : {
            kind: (i === 0 ? "customer_confirmation" : "ops_notification") as EmailKind,
            status: "failed" as const,
            error: String(r.reason),
          },
    );
  } catch (error) {
    /* Última rede de proteção. Se nem isto funcionou, o pedido segue de pé. */
    console.error("[email] fallo inesperado al despachar", code, error);
    return [];
  }
}

/** Estado dos e-mails de um pedido, para a tela de confirmação e o painel. */
export async function getEmailStatus(code: string) {
  const db = getSupabaseAdmin();
  if (!db) return [];

  const { data } = await db
    .from("email_log")
    .select("kind, status, recipient, attempts, last_error, sent_at, simulated")
    .eq("order_code", code);

  return data ?? [];
}
