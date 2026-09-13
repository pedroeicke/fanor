"use server";

import { revalidatePath } from "next/cache";
import { getOperator, listStores, runOp, type ActionResult } from "@/lib/gestion/server";
import { cleanText, isUuid } from "@/components/admin/pedidos-tienda/catalog";
import {
  NOTES_MAX,
  REASON_MAX,
  REQUEST_MAX_LINES,
  REQUEST_MAX_QTY,
  type CreateRequestInput,
} from "@/components/admin/pedidos-tienda/types";

/**
 * Pedido da vendedora ao taller: tamanho × quantidade, sem sabor.
 *
 * A função do banco já recusa loja e produto inexistentes; aqui repetimos o
 * que ela não sabe — que o produto é de produção (não serviço), que a loja
 * recebe torta, que a quantidade é inteira — para a vendedora ler o motivo
 * certo em vez de um pedido de "0,5 torta" entrar na fila do taller.
 */

export async function createStoreRequest(input: CreateRequestInput): Promise<ActionResult<{ id: string; number: number }>> {
  const op = await getOperator();
  if (!op) return { ok: false, error: "Sesión expirada. Vuelve a entrar." };

  if (!input || !isUuid(input.storeId)) return { ok: false, error: "Elige la tienda." };
  const stores = await listStores(op.db);
  if (!stores.some((s) => s.id === input.storeId)) return { ok: false, error: "Esa tienda no recibe tortas del taller." };

  if (!Array.isArray(input.lines) || input.lines.length === 0) return { ok: false, error: "Agrega al menos un producto." };
  if (input.lines.length > REQUEST_MAX_LINES) return { ok: false, error: `Máximo ${REQUEST_MAX_LINES} productos por pedido.` };

  /* Mesmo produto duas vezes vira uma linha só: o taller lê "10 × T26",
     não "4 × T26" e "6 × T26" em lugares diferentes da lista. */
  const merged = new Map<string, number>();
  for (const line of input.lines) {
    if (!line || !isUuid(line.productId)) return { ok: false, error: "Hay un producto inválido en el pedido." };
    const qty = Number(line.quantity);
    if (!Number.isInteger(qty) || qty < 1 || qty > REQUEST_MAX_QTY) {
      return { ok: false, error: `La cantidad debe ser un número entero entre 1 y ${REQUEST_MAX_QTY}.` };
    }
    merged.set(line.productId, (merged.get(line.productId) ?? 0) + qty);
  }
  if ([...merged.values()].some((q) => q > REQUEST_MAX_QTY)) {
    return { ok: false, error: `Máximo ${REQUEST_MAX_QTY} unidades por producto.` };
  }

  const ids = [...merged.keys()];
  const { data: products, error: productsError } = await op.db
    .from("products")
    .select("id, product_families!inner(is_service)")
    .in("id", ids)
    .eq("product_families.is_service", false);
  if (productsError) return { ok: false, error: "No se pudo validar el pedido. Inténtalo de nuevo." };
  if ((products ?? []).length !== ids.length) return { ok: false, error: "Algún producto no se puede pedir al taller." };

  const result = await runOp<{ id: string; number: number; lines: number }>("op_request_create", {
    p_store: input.storeId,
    p_lines: ids.map((id) => ({ product_id: id, quantity: merged.get(id) })),
    p_notes: cleanText(input.notes, NOTES_MAX),
    p_seller: op.seller?.id ?? null,
  });
  if (!result.ok) return result;

  revalidatePath("/admin/pedidos-tienda");
  revalidatePath("/admin/taller");
  return { ok: true, data: { id: result.data.id, number: Number(result.data.number) } };
}

/** Só enquanto o taller não despachou nada; depois disso, o taller fecha o pedido. */
export async function cancelStoreRequest(orderId: string, reason: string): Promise<ActionResult> {
  const op = await getOperator();
  if (!op) return { ok: false, error: "Sesión expirada. Vuelve a entrar." };
  if (!isUuid(orderId)) return { ok: false, error: "Pedido inválido." };
  /* O motivo fica nas notas do pedido; sem ele, ninguém sabe depois se foi
     engano ou se a loja deixou de precisar. */
  const why = cleanText(reason, REASON_MAX);
  if (!why || why.length < 3) return { ok: false, error: "Indica el motivo de la cancelación." };

  const { data: order } = await op.db
    .from("production_orders")
    .select("id, kind")
    .eq("id", orderId)
    .maybeSingle();
  if (!order || order.kind !== "restock") return { ok: false, error: "Pedido no encontrado." };

  const result = await runOp("op_request_cancel", { p_order: orderId, p_reason: why });
  if (!result.ok) return result;

  revalidatePath("/admin/pedidos-tienda");
  revalidatePath("/admin/taller");
  return { ok: true, data: undefined };
}
