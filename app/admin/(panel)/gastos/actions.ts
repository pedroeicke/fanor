"use server";

import { revalidatePath } from "next/cache";
import { getOperator, runOp, type ActionResult } from "@/lib/gestion/server";
import { cleanText, isUuid } from "@/components/admin/pedidos-tienda/catalog";

/** Lançar, corrigir e anular gasto. A trilha fica nas funções do banco. */

const SESSION_EXPIRED = "Sesión expirada. Vuelve a entrar.";
const TEXT_MAX = 200;

export type ExpenseInput = { id: string | null; spentOn: string; code: string; amount: string; storeId: string; document: string; notes: string };

export async function saveExpense(input: ExpenseInput): Promise<ActionResult> {
  const op = await getOperator("/admin/gastos");
  if (!op) return { ok: false, error: SESSION_EXPIRED };

  if (input?.id !== null && !isUuid(input?.id)) return { ok: false, error: "Gasto inválido." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(input.spentOn))) return { ok: false, error: "Fecha inválida." };
  if (typeof input.code !== "string" || !input.code) return { ok: false, error: "Elige el concepto." };
  const amount = Number(String(input.amount ?? "").trim().replace(",", "."));
  if (!Number.isFinite(amount) || amount <= 0 || amount > 10_000_000) return { ok: false, error: "Revisa el monto." };
  if (input.storeId && !isUuid(input.storeId)) return { ok: false, error: "Tienda inválida." };

  const result = await runOp("op_expense_save", {
    p_id: input.id,
    p_spent_on: input.spentOn,
    p_code: input.code,
    p_amount: Math.round(amount * 100) / 100,
    p_store: input.storeId || null,
    p_document: cleanText(input.document, TEXT_MAX),
    p_notes: cleanText(input.notes, TEXT_MAX),
  });
  if (!result.ok) return result;
  revalidatePath("/admin/gastos");
  return { ok: true, data: undefined };
}

export async function voidExpense(id: string, reason: string): Promise<ActionResult> {
  const op = await getOperator("/admin/gastos");
  if (!op) return { ok: false, error: SESSION_EXPIRED };
  if (!isUuid(id)) return { ok: false, error: "Gasto inválido." };
  const why = cleanText(reason, TEXT_MAX);
  if (!why || why.length < 3) return { ok: false, error: "Indica por qué se anula." };

  const result = await runOp("op_expense_void", { p_id: id, p_reason: why });
  if (!result.ok) return result;
  revalidatePath("/admin/gastos");
  return { ok: true, data: undefined };
}
