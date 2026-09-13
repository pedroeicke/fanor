"use server";

import { revalidatePath } from "next/cache";
import { friendlyDbError, getOperator, type ActionResult, type Operator } from "@/lib/gestion/server";
import {
  REDECORATED_MAX,
  SLA_FIELDS,
  TEMPLATE_MAX,
  confirmsChange,
  isStockSource,
  slaFieldError,
  templateLength,
  unknownPlaceholders,
} from "@/components/admin/ajustes/config";

/**
 * Ajustes que mudam o comportamento do sistema inteiro: de onde a vitrine
 * pública lê, quando um atraso vira alerta, quanto dura a torta redecorada e
 * o que a vendedora escreve ao cliente.
 *
 * Só o dono muda. A checagem está aqui e não só na tela: uma ação do servidor
 * é um POST que qualquer sessão do painel consegue disparar.
 */

const PATH = "/admin/ajustes";

async function ownerOperator(): Promise<{ ok: true; op: Operator } | { ok: false; error: string }> {
  const op = await getOperator();
  if (!op) return { ok: false, error: "Sesión expirada. Vuelve a entrar." };
  if (op.user.role !== "owner") return { ok: false, error: "Solo el dueño puede cambiar los ajustes." };
  return { ok: true, op };
}

/**
 * Grava uma chave com o valor anterior na trilha. `upsert` porque a chave
 * pode ter sido apagada à mão no banco; a migração só a cria uma vez.
 */
async function writeSetting(op: Operator, key: string, value: unknown, before: unknown): Promise<ActionResult> {
  const { error } = await op.db
    .from("system_settings")
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) return { ok: false, error: friendlyDbError(error) };

  const { error: auditError } = await op.db.from("audit_log").insert({
    actor: op.user.id,
    action: `settings.${key}`,
    entity: "system_settings",
    entity_id: key,
    changes: { before: before ?? null, after: value },
  });
  if (auditError) console.error("[auditoria]", key, auditError.code, auditError.message);

  return { ok: true, data: undefined };
}

async function readSetting(op: Operator, key: string) {
  const { data, error } = await op.db.from("system_settings").select("value").eq("key", key).maybeSingle();
  return { value: (data?.value ?? null) as unknown, error };
}

/**
 * Vira a fonte da vitrine. Ir para "native" exige a palavra de confirmação
 * também no servidor: é a mudança que, feita cedo demais, obriga a loja a
 * digitar cada venda duas vezes (aqui e no Sisgeco, que ainda emite a boleta).
 */
export async function saveStockSource(source: string, confirmation: string): Promise<ActionResult> {
  const auth = await ownerOperator();
  if (!auth.ok) return auth;
  const { op } = auth;

  if (!isStockSource(source)) return { ok: false, error: "Fuente inválida." };

  const current = await readSetting(op, "stock_source");
  if (current.error) return { ok: false, error: friendlyDbError(current.error) };
  if (current.value === source) return { ok: true, data: undefined };

  if (source === "native" && !confirmsChange(typeof confirmation === "string" ? confirmation : "")) {
    return { ok: false, error: "Escribe CAMBIAR para confirmar el cambio." };
  }

  const result = await writeSetting(op, "stock_source", source, current.value);
  if (!result.ok) return result;

  /* A vitrina e o selo "disponible hoy" aparecem em várias páginas da loja;
     revalidar o layout raiz cobre todas de uma vez. */
  revalidatePath(PATH);
  revalidatePath("/vitrina");
  revalidatePath("/", "layout");
  return result;
}

/** Prazos dos alertas. Chaves que o painel não conhece continuam no objeto. */
export async function saveSla(input: Record<string, unknown>): Promise<ActionResult> {
  const auth = await ownerOperator();
  if (!auth.ok) return auth;
  const { op } = auth;

  if (!input || typeof input !== "object") return { ok: false, error: "Datos inválidos." };

  const next: Record<string, number> = {};
  for (const field of SLA_FIELDS) {
    const raw = input[field.key];
    const value = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : raw;
    const invalid = slaFieldError(field, value);
    if (invalid) return { ok: false, error: invalid };
    next[field.key] = value as number;
  }

  const current = await readSetting(op, "sla");
  if (current.error) return { ok: false, error: friendlyDbError(current.error) };
  const base = current.value && typeof current.value === "object" && !Array.isArray(current.value) ? (current.value as Record<string, unknown>) : {};
  const merged = { ...base, ...next };

  if (SLA_FIELDS.every((f) => base[f.key] === next[f.key])) return { ok: true, data: undefined };

  const result = await writeSetting(op, "sla", merged, current.value);
  if (!result.ok) return result;
  /* Os alertas leem o prazo no banco a cada `alerts_refresh()`: não há cache
     de página para invalidar além desta. */
  revalidatePath(PATH);
  return result;
}

/** Validade da torta redecorada. Lida por `op_cake_redecorate` no momento da redecoração. */
export async function saveRedecoratedShelfLife(days: number): Promise<ActionResult> {
  const auth = await ownerOperator();
  if (!auth.ok) return auth;
  const { op } = auth;

  if (typeof days !== "number" || !Number.isInteger(days) || days < 0 || days > REDECORATED_MAX) {
    return { ok: false, error: `La validez debe ser de 0 a ${REDECORATED_MAX} días.` };
  }

  const current = await readSetting(op, "redecorated_shelf_life_days");
  if (current.error) return { ok: false, error: friendlyDbError(current.error) };
  if (current.value === days) return { ok: true, data: undefined };

  const result = await writeSetting(op, "redecorated_shelf_life_days", days, current.value);
  if (!result.ok) return result;
  revalidatePath(PATH);
  return result;
}

/** Mensagem que abre o WhatsApp da vendedora já com o contexto do lead. */
export async function saveLeadTemplate(template: string): Promise<ActionResult> {
  const auth = await ownerOperator();
  if (!auth.ok) return auth;
  const { op } = auth;

  if (typeof template !== "string") return { ok: false, error: "Mensaje inválido." };
  /* Quebra de linha do Windows vira "\n": o link do WhatsApp codifica cada
     caractere, e um "\r" sobrando aparece como símbolo estranho no celular. */
  const value = template.replace(/\r\n?/g, "\n").trim();

  if (!value) return { ok: false, error: "Escribe el mensaje." };
  if (templateLength(value) > TEMPLATE_MAX) return { ok: false, error: `El mensaje admite hasta ${TEMPLATE_MAX} caracteres.` };
  const unknown = unknownPlaceholders(value);
  if (unknown.length) {
    return { ok: false, error: `No existe ${unknown.join(", ")}. Usa {nombre}, {vendedora}, {interes} o {contexto}.` };
  }

  const current = await readSetting(op, "lead_whatsapp_template");
  if (current.error) return { ok: false, error: friendlyDbError(current.error) };
  if (current.value === value) return { ok: true, data: undefined };

  const result = await writeSetting(op, "lead_whatsapp_template", value, current.value);
  if (!result.ok) return result;
  revalidatePath(PATH);
  return result;
}
