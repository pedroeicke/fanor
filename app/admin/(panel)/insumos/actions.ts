"use server";

import { revalidatePath } from "next/cache";
import { getOperator, runOp, type ActionResult } from "@/lib/gestion/server";
import { cleanText, isUuid } from "@/components/admin/pedidos-tienda/catalog";

/**
 * Contagem, compra, custo e caixa. A conta de unidade e o saldo moram nas funções
 * do banco; aqui fica o que chega do navegador. A tela fala em unidade de estoque.
 */

const SESSION_EXPIRED = "Sesión expirada. Vuelve a entrar.";
const TEXT_MAX = 200;
const QUANTITY_MAX = 10_000_000;

function refresh() {
  revalidatePath("/admin/insumos");
  revalidatePath("/admin/costos");
}

/* Celular peruano digita "2,5". Vazio vira null: custo e documento são opcionais. */
function decimal(value: unknown) {
  const text = String(value ?? "").trim().replace(",", ".");
  if (!text) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : Number.NaN;
}

function place(value: unknown) {
  return value === null || value === "" || value === undefined ? null : isUuid(value) ? value : undefined;
}

export type PurchaseInput = { code: string; storeId: string | null; quantity: string; unitCost: string; document: string; notes: string };

export async function registerPurchase(input: PurchaseInput): Promise<ActionResult> {
  const op = await getOperator("/admin/insumos");
  if (!op) return { ok: false, error: SESSION_EXPIRED };

  const storeId = place(input?.storeId);
  if (storeId === undefined || typeof input?.code !== "string") return { ok: false, error: "Datos inválidos." };
  const quantity = decimal(input.quantity);
  if (quantity === null || Number.isNaN(quantity) || quantity <= 0 || quantity > QUANTITY_MAX) return { ok: false, error: "Revisa la cantidad comprada." };
  const unitCost = decimal(input.unitCost);
  if (unitCost !== null && (Number.isNaN(unitCost) || unitCost < 0 || unitCost > QUANTITY_MAX)) return { ok: false, error: "Revisa el costo." };

  const result = await runOp("op_stock_purchase", {
    p_code: input.code,
    p_store: storeId,
    p_quantity: quantity,
    p_unit_cost: unitCost,
    p_document: cleanText(input.document, TEXT_MAX),
    p_notes: cleanText(input.notes, TEXT_MAX),
  });
  if (!result.ok) return result;
  refresh();
  return { ok: true, data: undefined };
}

export type CountInput = { code: string; storeId: string | null; counted: string; notes: string };

export async function registerCount(input: CountInput): Promise<ActionResult> {
  const op = await getOperator("/admin/insumos");
  if (!op) return { ok: false, error: SESSION_EXPIRED };

  const storeId = place(input?.storeId);
  if (storeId === undefined || typeof input?.code !== "string") return { ok: false, error: "Datos inválidos." };
  const counted = decimal(input.counted);
  if (counted === null || Number.isNaN(counted) || counted < 0 || counted > QUANTITY_MAX) return { ok: false, error: "Revisa la cantidad contada." };

  const result = await runOp("op_stock_count", {
    p_code: input.code,
    p_store: storeId,
    p_counted: counted,
    p_notes: cleanText(input.notes, TEXT_MAX),
  });
  if (!result.ok) return result;
  refresh();
  return { ok: true, data: undefined };
}

export async function saveArticleCost(code: string, rawCost: string): Promise<ActionResult> {
  const op = await getOperator("/admin/costos");
  if (!op) return { ok: false, error: "Solo la gerencia cambia costos." };
  const cost = decimal(rawCost);
  if (typeof code !== "string" || (cost !== null && (Number.isNaN(cost) || cost < 0 || cost > QUANTITY_MAX))) return { ok: false, error: "Revisa el costo." };

  const result = await runOp("op_article_cost", { p_code: code, p_cost: cost });
  if (!result.ok) return result;
  refresh();
  return { ok: true, data: undefined };
}

export async function savePackaging(format: string, boxCode: string): Promise<ActionResult> {
  const op = await getOperator("/admin/insumos");
  if (!op) return { ok: false, error: SESSION_EXPIRED };
  if (typeof format !== "string" || !format || typeof boxCode !== "string") return { ok: false, error: "Datos inválidos." };

  const result = await runOp("op_packaging_set", { p_format: format, p_box: boxCode });
  if (!result.ok) return result;
  refresh();
  return { ok: true, data: undefined };
}
