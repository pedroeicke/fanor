"use server";

import { revalidatePath } from "next/cache";
import { getOperator, listStores, runOp, type ActionResult, type Operator } from "@/lib/gestion/server";
import { limaToday } from "@/lib/gestion/dates";
import { LEAD_SOURCE } from "@/lib/gestion/labels";
import { LOST_REASONS, OPEN_STATUSES } from "@/components/admin/leads/shared";

/**
 * Ações da tela de leads.
 *
 * Criar, atribuir, contatar, anotar e fechar passam pelas funções `op_lead_*`
 * do banco — cada uma grava o evento com hora e autor, que é justamente o que
 * o Joseka não tinha. A única escrita direta é o celular que faltava num lead
 * vindo do Messenger (cadastro simples, pela sessão e com RLS).
 *
 * Toda entrada é conferida aqui: a ação é um POST público, e o formulário do
 * celular não é garantia de nada.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const LIMITS = { name: 120, phone: 30, interest: 200, context: 4000, note: 2000, reason: 300 };

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/** Celular opcional: vazio vale; preenchido precisa ter cara de número. */
function checkPhone(raw: string): string | null | false {
  if (!raw) return null;
  if (raw.length > LIMITS.phone || !/^[\d\s()+\-.]+$/.test(raw)) return false;
  const digits = raw.replace(/\D/g, "");
  return digits.length >= 6 && digits.length <= 15 ? raw : false;
}

function isRealDate(iso: string) {
  if (!DATE_RE.test(iso)) return false;
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

function done() {
  revalidatePath("/admin/leads");
  revalidatePath("/admin/alertas");
}

/**
 * Loja e vendedora vindas do formulário, conferidas contra o cadastro.
 * Vendedora sem loja escolhida leva a loja dela: é o que a pessoa quis dizer
 * ao escolher "María" sem mexer no campo de cima.
 */
async function resolveAssignment(op: Operator, storeRaw: unknown, sellerRaw: unknown): Promise<
  { ok: true; store: string | null; seller: string | null } | { ok: false; error: string }
> {
  const storeId = text(storeRaw) || null;
  const sellerId = text(sellerRaw) || null;
  if (storeId && !isUuid(storeId)) return { ok: false, error: "Tienda inválida." };
  if (sellerId && !isUuid(sellerId)) return { ok: false, error: "Vendedora inválida." };

  let store = storeId;
  if (sellerId) {
    const { data: seller } = await op.db
      .from("sellers")
      .select("id, store_id, role")
      .eq("id", sellerId)
      .eq("active", true)
      .maybeSingle();
    if (!seller) return { ok: false, error: "La vendedora no existe o está inactiva." };
    /* A tela já esconde o taller e filtra por loja; aqui vale para quem chama
       a ação sem a tela. Lead de uma loja com vendedora de outra sumiria do
       filtro das duas. */
    if (seller.role === "workshop") return { ok: false, error: "El personal del taller no atiende leads." };
    if (store && seller.store_id && seller.store_id !== store) {
      return { ok: false, error: "La vendedora es de otra tienda." };
    }
    store ??= seller.store_id;
  }

  if (store) {
    const stores = await listStores(op.db);
    if (!stores.some((s) => s.id === store)) return { ok: false, error: "La tienda no existe o está inactiva." };
  }

  return { ok: true, store, seller: sellerId };
}

export async function createLead(input: {
  name: string;
  phone: string;
  source: string;
  interest: string;
  wantedOn: string;
  context: string;
  storeId: string;
  sellerId: string;
}): Promise<ActionResult<{ id: string; number: number }>> {
  const op = await getOperator();
  if (!op) return { ok: false, error: "Sesión expirada. Vuelve a entrar." };
  if (!input || typeof input !== "object") return { ok: false, error: "Datos inválidos." };

  const name = text(input.name);
  if (!name) return { ok: false, error: "Escribe el nombre del cliente." };
  if (name.length > LIMITS.name) return { ok: false, error: `El nombre admite hasta ${LIMITS.name} caracteres.` };

  const phone = checkPhone(text(input.phone));
  if (phone === false) return { ok: false, error: "El celular no es válido. Escribe solo números, ej. 987 654 321." };

  const source = text(input.source) || "messenger";
  /* hasOwn, não `in`: "constructor" in {} é true e passaria direto para o check do banco. */
  if (!Object.hasOwn(LEAD_SOURCE, source)) return { ok: false, error: "Origen inválido." };

  const interest = text(input.interest);
  if (interest.length > LIMITS.interest) return { ok: false, error: `El interés admite hasta ${LIMITS.interest} caracteres.` };

  const context = text(input.context);
  if (context.length > LIMITS.context) {
    return { ok: false, error: `El contexto admite hasta ${LIMITS.context} caracteres. Deja lo importante.` };
  }

  const wantedOn = text(input.wantedOn);
  if (wantedOn && !isRealDate(wantedOn)) return { ok: false, error: "Fecha deseada inválida." };
  if (wantedOn && wantedOn < limaToday()) return { ok: false, error: "La fecha deseada ya pasó." };

  const assignment = await resolveAssignment(op, input.storeId, input.sellerId);
  if (!assignment.ok) return assignment;

  const result = await runOp<{ id: string; number: number }>("op_lead_create", {
    p_name: name,
    p_phone: phone,
    p_source: source,
    p_context: context || null,
    p_interest: interest || null,
    p_wanted_on: wantedOn || null,
    p_store: assignment.store,
    p_seller: assignment.seller,
  });
  if (!result.ok) return result;

  done();
  return { ok: true, data: { id: result.data.id, number: Number(result.data.number) } };
}

export async function assignLead(leadId: string, storeId: string, sellerId: string): Promise<ActionResult> {
  const op = await getOperator();
  if (!op) return { ok: false, error: "Sesión expirada. Vuelve a entrar." };
  if (!isUuid(leadId)) return { ok: false, error: "Lead inválido." };
  if (!text(storeId)) return { ok: false, error: "Elige la tienda." };

  const assignment = await resolveAssignment(op, storeId, sellerId);
  if (!assignment.ok) return assignment;

  const result = await runOp("op_lead_assign", {
    p_lead: leadId,
    p_store: assignment.store,
    p_seller: assignment.seller,
  });
  if (!result.ok) return result;

  done();
  return { ok: true, data: undefined };
}

/**
 * A vendedora tocou "Escribir por WhatsApp". O WhatsApp já abriu no clique;
 * isto só grava a hora — é a medida de tempo de resposta do relatório.
 */
export async function contactLead(leadId: string): Promise<ActionResult> {
  const op = await getOperator();
  if (!op) return { ok: false, error: "Sesión expirada. Vuelve a entrar." };
  if (!isUuid(leadId)) return { ok: false, error: "Lead inválido." };

  /* `op_lead_contact` não confere o estado: num lead já fechado gravaria um
     "primeiro contato" depois do desfecho e distorceria o tempo de resposta. */
  const { data: lead } = await op.db.from("leads").select("status").eq("id", leadId).maybeSingle();
  if (!lead) return { ok: false, error: "Lead no encontrado." };
  if (!(OPEN_STATUSES as string[]).includes(lead.status)) return { ok: false, error: "El lead ya está cerrado." };

  const result = await runOp("op_lead_contact", { p_lead: leadId, p_notes: null });
  if (!result.ok) return result;

  done();
  return { ok: true, data: undefined };
}

export async function addLeadNote(leadId: string, notes: string): Promise<ActionResult> {
  if (!(await getOperator())) return { ok: false, error: "Sesión expirada. Vuelve a entrar." };
  if (!isUuid(leadId)) return { ok: false, error: "Lead inválido." };
  const body = text(notes);
  if (!body) return { ok: false, error: "La nota está vacía." };
  if (body.length > LIMITS.note) return { ok: false, error: `La nota admite hasta ${LIMITS.note} caracteres.` };

  const result = await runOp("op_lead_note", { p_lead: leadId, p_notes: body });
  if (!result.ok) return result;

  done();
  return { ok: true, data: undefined };
}

export async function closeLead(input: {
  leadId: string;
  won: boolean;
  value: string;
  reason: string;
  detail: string;
}): Promise<ActionResult> {
  if (!(await getOperator())) return { ok: false, error: "Sesión expirada. Vuelve a entrar." };
  if (!input || typeof input !== "object" || !isUuid(input.leadId)) return { ok: false, error: "Lead inválido." };
  if (typeof input.won !== "boolean") return { ok: false, error: "Indica si se ganó o se perdió." };

  let value: number | null = null;
  let reason: string | null = null;

  if (input.won) {
    const raw = text(input.value).replace(",", ".");
    if (raw) {
      value = Number(raw);
      if (!Number.isFinite(value) || value < 0 || value > 1_000_000) {
        return { ok: false, error: "Monto inválido." };
      }
      value = Math.round(value * 100) / 100;
    }
  } else {
    const category = text(input.reason);
    if (!(LOST_REASONS as readonly string[]).includes(category)) return { ok: false, error: "Elige el motivo de la pérdida." };
    const detail = text(input.detail);
    if (category === "Otro" && !detail) return { ok: false, error: "Cuenta brevemente el motivo." };
    if (detail.length > LIMITS.reason) return { ok: false, error: `El detalle admite hasta ${LIMITS.reason} caracteres.` };
    /* "Otro: texto" — o relatório agrupa pela parte antes dos dois-pontos. */
    reason = detail ? `${category}: ${detail}` : category;
  }

  const result = await runOp("op_lead_close", {
    p_lead: input.leadId,
    p_won: input.won,
    p_value: value,
    p_reason: reason,
  });
  if (!result.ok) return result;

  done();
  return { ok: true, data: undefined };
}

/**
 * Celular que faltava (lead do Messenger chega sem número).
 *
 * Sem função de banco para isto: é um campo de cadastro. Junto, o lead passa
 * a apontar para o cliente desse celular — senão o CRM ficaria com um
 * "Cliente Messenger" solto e o cliente real sem o histórico do lead.
 */
export async function setLeadPhone(leadId: string, phoneRaw: string): Promise<ActionResult> {
  const op = await getOperator();
  if (!op) return { ok: false, error: "Sesión expirada. Vuelve a entrar." };
  if (!isUuid(leadId)) return { ok: false, error: "Lead inválido." };

  const phone = checkPhone(text(phoneRaw));
  if (!phone) return { ok: false, error: "Escribe un celular válido, ej. 987 654 321." };

  const { data: lead } = await op.db
    .from("leads")
    .select("id, name, source, phone")
    .eq("id", leadId)
    .in("status", OPEN_STATUSES)
    .maybeSingle();
  if (!lead) return { ok: false, error: "Lead no encontrado o cerrado." };

  const customer = await runOp<string>("op_customer_upsert", {
    p_name: /^cliente\b/i.test(lead.name) ? null : lead.name,
    p_phone: phone,
    p_source: lead.source,
  });

  const patch: Record<string, unknown> = { phone };
  if (customer.ok && customer.data) patch.customer_id = customer.data;

  const { data: updated, error } = await op.db
    .from("leads")
    .update(patch)
    .eq("id", leadId)
    .in("status", OPEN_STATUSES)
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, error: "No se pudo guardar el celular." };
  if (!updated) return { ok: false, error: "Lead no encontrado o cerrado." };

  await runOp("op_lead_note", {
    p_lead: leadId,
    p_notes: lead.phone ? `Celular cambiado: ${lead.phone} → ${phone}` : `Celular agregado: ${phone}`,
  });

  await op.db.from("audit_log").insert({
    actor: op.user.id,
    action: "lead.phone",
    entity: "leads",
    entity_id: leadId,
    changes: { from: lead.phone, to: phone },
  });

  done();
  return { ok: true, data: undefined };
}
