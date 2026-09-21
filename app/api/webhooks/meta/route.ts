import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import {
  displayPhone,
  messageIdPattern,
  messageNote,
  normalizePhone,
  parseMetaWebhook,
  safeEqualText,
  senderPattern,
  verifyMetaSignature,
  type MetaInboundMessage,
} from "@/lib/gestion/meta";

/**
 * Webhook da Meta: mensagem nova de WhatsApp, Messenger ou Instagram vira
 * lead sozinha, com o texto como contexto.
 *
 * Hoje o Joseka copia o número do Messenger e cola num grupo; com isto
 * ligado, o lead nasce na hora em que o cliente escreve e o relógio do
 * primeiro contato começa a contar dali.
 *
 * Inerte sem credenciais: sem `META_VERIFY_TOKEN` a verificação é recusada,
 * sem `META_APP_SECRET` o POST devolve 503. Nada entra sem assinatura válida.
 *
 * Configurar no app da Meta: URL de callback `https://<domínio>/api/webhooks/meta`,
 * token de verificação = META_VERIFY_TOKEN, campo `messages` (WhatsApp) e
 * `messages` da página (Messenger/Instagram).
 */

export const dynamic = "force-dynamic";

const OPEN_STATUSES = ["new", "assigned", "contacted"];
/* Conversa que volta depois de uma semana é pedido novo, não o mesmo lead. */
const SAME_LEAD_DAYS = 7;
/* Payload da Meta tem poucos KB; um corpo enorme é abuso, não mensagem. */
const MAX_BODY_BYTES = 1_000_000;

const DEFAULT_NAME: Record<MetaInboundMessage["channel"], string> = {
  whatsapp: "Cliente WhatsApp",
  messenger: "Cliente Messenger",
  instagram: "Cliente Instagram",
};

/** Verificação do endpoint: a Meta chama uma vez ao salvar o webhook. */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const token = process.env.META_VERIFY_TOKEN?.trim();
  const mode = params.get("hub.mode");
  const provided = params.get("hub.verify_token") ?? "";
  const challenge = params.get("hub.challenge") ?? "";

  if (!token || mode !== "subscribe" || !safeEqualText(provided, token)) {
    return new Response("Forbidden", { status: 403 });
  }
  return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

export async function POST(request: Request) {
  const secret = process.env.META_APP_SECRET?.trim();
  if (!secret) return NextResponse.json({ error: "Webhook no configurado." }, { status: 503 });

  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) return NextResponse.json({ error: "Cuerpo demasiado grande." }, { status: 413 });

  /* Corpo cru, antes de qualquer parse: a assinatura é sobre os bytes. */
  const raw = Buffer.from(await request.arrayBuffer());
  if (raw.length > MAX_BODY_BYTES) return NextResponse.json({ error: "Cuerpo demasiado grande." }, { status: 413 });
  if (!verifyMetaSignature(raw, request.headers.get("x-hub-signature-256"), secret)) {
    return NextResponse.json({ error: "Firma inválida." }, { status: 401 });
  }

  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Sin conexión." }, { status: 503 });

  let payload: unknown;
  try {
    payload = JSON.parse(raw.toString("utf8"));
  } catch {
    /* Assinado mas ilegível: reenviar não conserta. 200 para a Meta parar. */
    console.error("[webhook/meta] JSON inválido");
    return NextResponse.json({ received: true, messages: 0 });
  }

  const messages = parseMetaWebhook(payload);
  const summary = { created: 0, noted: 0, duplicate: 0, ignored: 0, failed: 0 };

  /* Em ordem: duas mensagens seguidas do mesmo cliente no mesmo envelope têm
     de cair no mesmo lead, e a segunda só acha o lead se a primeira já gravou. */
  for (const message of messages) {
    try {
      const result = await ingest(db, message);
      summary[result] += 1;
    } catch (error) {
      summary.failed += 1;
      console.error("[webhook/meta]", message.channel, message.messageId, error instanceof Error ? error.message : error);
    }
  }

  /* Sempre 200 depois de processar: a Meta reenvia em erro e, com falhas
     seguidas, desativa o webhook. A falha fica no log. */
  return NextResponse.json({ received: true, messages: messages.length, ...summary });
}

type Outcome = "created" | "noted" | "duplicate" | "ignored";

async function ingest(db: SupabaseClient, message: MetaInboundMessage): Promise<Outcome> {
  /* Idempotência: a mesma mensagem reenviada já está numa nota. */
  const { data: seen, error: seenError } = await db
    .from("lead_events")
    .select("id")
    .like("notes", messageIdPattern(message))
    .limit(1);
  if (seenError) throw new Error(`idempotencia: ${seenError.message}`);
  if (seen?.length) return "duplicate";

  const note = messageNote(message);
  const leadId = await findOpenLead(db, message);

  if (leadId) {
    const { error } = await db.rpc("op_lead_note", { p_lead: leadId, p_notes: note, p_external_id: message.messageId });
    /* 23505 = a mesma mensagem chegou duas vezes ao mesmo tempo e a chave
       única barrou a segunda. É repetida, não é erro. */
    if (error) {
      if (error.code === "23505") return "duplicate";
      throw new Error(`op_lead_note: ${error.message}`);
    }
    return "noted";
  }
  if (!message.startsLead) return "ignored";

  const { data: created, error: createError } = await db.rpc("op_lead_create", {
    p_name: message.profileName || DEFAULT_NAME[message.channel],
    p_phone: message.phone ? displayPhone(message.phone) : null,
    p_source: message.channel,
    p_context: message.text,
    p_external_id: message.messageId,
  });
  if (createError) {
    if (createError.code === "23505") return "duplicate";
    throw new Error(`op_lead_create: ${createError.message}`);
  }

  /* A primeira mensagem também vira nota: é ela que carrega o id (reenvio não
     duplica o lead) e, no Messenger, o remetente para agrupar a conversa. */
  const id = (created as { id?: string } | null)?.id;
  if (id) {
    /* O id da mensagem já ficou no evento 'created'; a nota inicial guarda o
       texto e, por isso, vai sem chave. */
    const { error } = await db.rpc("op_lead_note", { p_lead: id, p_notes: note });
    if (error) console.error("[webhook/meta] nota inicial", id, error.message);
  }
  return "created";
}

/** Lead aberto da mesma pessoa, criado nos últimos dias. */
async function findOpenLead(db: SupabaseClient, message: MetaInboundMessage): Promise<string | null> {
  const since = new Date(Date.now() - SAME_LEAD_DAYS * 86_400_000).toISOString();

  if (message.channel === "whatsapp") {
    const phone = normalizePhone(message.phone);
    if (!phone) return null;
    /* O celular no lead foi digitado de qualquer jeito ("987 654 321",
       "+51987654321"): compara normalizado, como o CRM faz. */
    const { data, error } = await db
      .from("leads")
      .select("id, phone")
      .in("status", OPEN_STATUSES)
      .gte("created_at", since)
      .not("phone", "is", null)
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) throw new Error(`leads abiertos: ${error.message}`);
    return (data ?? []).find((lead) => normalizePhone(lead.phone) === phone)?.id ?? null;
  }

  /* Messenger/Instagram não dão celular: a conversa é achada pelo remetente
     gravado nas notas das mensagens anteriores. */
  const { data, error } = await db
    .from("lead_events")
    .select("lead_id, leads!inner(status, created_at)")
    .like("notes", senderPattern(message.senderId))
    .in("leads.status", OPEN_STATUSES)
    .gte("leads.created_at", since)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(`conversación abierta: ${error.message}`);
  return (data?.[0]?.lead_id as string | undefined) ?? null;
}
