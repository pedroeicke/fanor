"use server";

import { revalidatePath } from "next/cache";
import { friendlyDbError, getOperator, type ActionResult } from "@/lib/gestion/server";
import {
  DOC_LABEL,
  MAX_NOTE_LENGTH,
  UUID_RE,
  validateCustomerInput,
  type CustomerPatch,
} from "@/components/admin/clientes/rules";

/**
 * Cadastro do cliente: ficha e notas internas.
 *
 * Não mexe em estoque nem em dinheiro, então grava direto pela sessão
 * (RLS de administrador), sem função `op_*`. Compras, total gasto e última
 * compra NÃO passam por aqui: quem os mantém são os gatilhos do banco.
 */

export async function updateCustomer(id: string, input: unknown): Promise<ActionResult<CustomerPatch>> {
  const op = await getOperator();
  if (!op) return { ok: false, error: "Sesión expirada. Vuelve a entrar." };

  if (typeof id !== "string" || !UUID_RE.test(id)) return { ok: false, error: "Cliente inválido." };

  const { data: before, error: readError } = await op.db
    .from("customers")
    .select("name, phone, phone_norm, email, doc_type, doc_number, birthday, tags, marketing_opt_in")
    .eq("id", id)
    .maybeSingle();
  if (readError) return { ok: false, error: friendlyDbError(readError) };
  if (!before) return { ok: false, error: "Cliente no encontrado." };

  /* A ficha gravada entra na validação: celular, documento e correio antigos que ninguém mexeu não travam o resto. */
  const checked = validateCustomerInput(input, before);
  if (!checked.ok) return { ok: false, error: checked.error };
  const patch = checked.patch;

  /* Documento é único no banco. Conferir antes dá o nome de quem já tem o
     número — "ya existe un registro" sozinho não ajuda a vendedora a achar
     o cadastro duplicado. */
  if (patch.doc_number) {
    const { data: owner } = await op.db
      .from("customers")
      .select("name")
      .eq("doc_type", patch.doc_type)
      .eq("doc_number", patch.doc_number)
      .neq("id", id)
      .limit(1)
      .maybeSingle();
    if (owner) {
      return { ok: false, error: `El ${DOC_LABEL[patch.doc_type]} ${patch.doc_number} ya está registrado a nombre de ${owner.name}.` };
    }
  }

  const { data: saved, error } = await op.db.from("customers").update(patch).eq("id", id).select("id").maybeSingle();
  if (error) {
    /* Corrida: outro cadastro pegou o documento entre a conferência e a gravação. */
    if (error.code === "23505") return { ok: false, error: `Ese ${DOC_LABEL[patch.doc_type]} ya pertenece a otro cliente.` };
    return { ok: false, error: friendlyDbError(error) };
  }
  /* Update barrado pelo RLS não levanta erro: só não afeta linha nenhuma. */
  if (!saved) return { ok: false, error: "No se pudo guardar el cliente." };

  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of ["name", "phone", "email", "doc_type", "doc_number", "birthday", "tags", "marketing_opt_in"] as const) {
    if (JSON.stringify(before[key] ?? null) !== JSON.stringify(patch[key] ?? null)) {
      changes[key] = { from: before[key] ?? null, to: patch[key] ?? null };
    }
  }
  if (Object.keys(changes).length) {
    await op.db.from("audit_log").insert({
      actor: op.user.id,
      action: "customer.update",
      entity: "customers",
      entity_id: id,
      changes,
    });
  }

  revalidatePath("/admin/clientes");
  revalidatePath(`/admin/clientes/${id}`);
  return { ok: true, data: patch };
}

export async function addCustomerNote(customerId: string, body: unknown): Promise<ActionResult> {
  const op = await getOperator();
  if (!op) return { ok: false, error: "Sesión expirada. Vuelve a entrar." };

  if (typeof customerId !== "string" || !UUID_RE.test(customerId)) return { ok: false, error: "Cliente inválido." };
  if (typeof body !== "string") return { ok: false, error: "Nota inválida." };

  const text = body.normalize("NFC").replace(/\r\n/g, "\n").trim();
  if (!text) return { ok: false, error: "Escribe la nota." };
  if (text.length > MAX_NOTE_LENGTH) return { ok: false, error: `La nota es demasiado larga (máximo ${MAX_NOTE_LENGTH} caracteres).` };

  const { error } = await op.db.from("customer_notes").insert({ customer_id: customerId, body: text, actor: op.user.id });
  if (error) {
    if (error.code === "23503") return { ok: false, error: "Cliente no encontrado." };
    return { ok: false, error: friendlyDbError(error) };
  }

  revalidatePath(`/admin/clientes/${customerId}`);
  return { ok: true, data: undefined };
}
