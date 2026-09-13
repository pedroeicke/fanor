"use server";

import { revalidatePath } from "next/cache";
import { getOperator, listStores, runOp, type ActionResult } from "@/lib/gestion/server";
import { isSerial } from "@/lib/gestion/qr";
import { cleanText, isUuid } from "@/components/admin/pedidos-tienda/catalog";
import { NOTES_MAX, REASON_MAX } from "@/components/admin/pedidos-tienda/types";
import {
  CAKES_PER_ENTRY_MAX,
  CAKES_TOTAL_MAX,
  ENTRIES_MAX,
  ITEM_QTY_MAX,
  type CreateDispatchInput,
  type RedecorateInput,
} from "@/components/admin/taller/types";

/**
 * Ações do taller. Tudo que cria ou mexe em torta passa pelas funções `op_*`
 * do banco (atômicas); aqui fica a conferência que o banco não faz:
 *
 * - a loja do despacho com pedido é a do pedido, lida do banco — nunca a que
 *   o navegador mandou;
 * - torta (família com série) só sai como torta, com etiqueta; pastel e vela
 *   só saem como item. Uma torta mandada como "item" entraria sem série e a
 *   venda do balcão, que exige a série, nunca conseguiria vendê-la.
 */

const SESSION_EXPIRED = "Sesión expirada. Vuelve a entrar.";

/* Despacho, redecoração e faltante mudam o que a loja vê chegando (Recepción),
   o que tem na vitrine (Mi vitrina) e o estado da encomenda. */
function revalidateFlow() {
  revalidatePath("/admin/taller");
  revalidatePath("/admin/pedidos-tienda");
  revalidatePath("/admin/recepcion");
  revalidatePath("/admin/tienda");
  revalidatePath("/admin/encomiendas");
}

function normalizeSerial(value: unknown) {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

export async function createDispatch(
  input: CreateDispatchInput,
): Promise<ActionResult<{ id: string; number: number; cakes: number }>> {
  const op = await getOperator();
  if (!op) return { ok: false, error: SESSION_EXPIRED };

  if (!input || !Array.isArray(input.cakes) || !Array.isArray(input.items)) {
    return { ok: false, error: "Datos del despacho inválidos." };
  }
  if (input.cakes.length + input.items.length === 0) return { ok: false, error: "El despacho está vacío." };
  if (input.cakes.length + input.items.length > ENTRIES_MAX) {
    return { ok: false, error: `Máximo ${ENTRIES_MAX} filas por despacho. Divídelo en dos.` };
  }

  /* Destino e linhas válidas saem do banco. */
  let storeId: string;
  const orderLines = new Map<string, { productId: string; cakeTypeId: string | null }>();

  if (input.orderId !== null) {
    if (!isUuid(input.orderId)) return { ok: false, error: "Pedido inválido." };
    const { data: order } = await op.db
      .from("production_orders")
      .select("id, store_id, status, contracts(status), production_order_lines(id, product_id, cake_type_id, contract_lines(cake_type_id))")
      .eq("id", input.orderId)
      .maybeSingle();
    if (!order) return { ok: false, error: "Pedido no encontrado." };
    if (order.status !== "planned" && order.status !== "in_progress") {
      return { ok: false, error: "El pedido ya fue cerrado o cancelado." };
    }
    /* A OP da encomenda continua aberta depois de entregar ou cancelar a
       encomenda. Torta mandada para ela chegaria "reservada" a um contrato
       morto e nunca subiria na vitrine. */
    const contractStatus = (order.contracts as unknown as { status: string } | null)?.status;
    if (contractStatus === "delivered" || contractStatus === "cancelled") {
      return {
        ok: false,
        error: `La encomienda ya fue ${contractStatus === "delivered" ? "entregada" : "cancelada"}. Cierra este pedido en vez de despacharlo.`,
      };
    }
    storeId = order.store_id as string;
    type Line = { id: string; product_id: string; cake_type_id: string | null; contract_lines: { cake_type_id: string | null } | null };
    for (const l of (order.production_order_lines ?? []) as unknown as Line[]) {
      /* Tipo de torta da encomenda: o do contrato manda, a cópia na OP é reserva. */
      orderLines.set(l.id, { productId: l.product_id, cakeTypeId: l.contract_lines?.cake_type_id ?? l.cake_type_id });
    }
  } else {
    if (!isUuid(input.storeId)) return { ok: false, error: "Elige la tienda de destino." };
    const stores = await listStores(op.db);
    if (!stores.some((s) => s.id === input.storeId)) return { ok: false, error: "Esa tienda no recibe tortas del taller." };
    storeId = input.storeId;
  }

  const productIds = new Set<string>();
  const flavorIds = new Set<string>();
  const decoratorIds = new Set<string>();

  const lineFor = (lineId: unknown, productId: string) => {
    if (lineId === null || lineId === undefined || lineId === "") return { ok: true as const, line: null };
    if (input.orderId === null || !isUuid(lineId)) return { ok: false as const };
    const line = orderLines.get(lineId);
    if (!line || line.productId !== productId) return { ok: false as const };
    return { ok: true as const, line: { id: lineId, cakeTypeId: line.cakeTypeId } };
  };

  const optionalId = (value: unknown) => (value === null || value === undefined || value === "" ? null : value);

  const cakes: Record<string, unknown>[] = [];
  let totalCakes = 0;
  for (const c of input.cakes) {
    if (!c || !isUuid(c.productId)) return { ok: false, error: "Hay un producto inválido en el despacho." };
    const qty = Number(c.quantity);
    if (!Number.isInteger(qty) || qty < 1 || qty > CAKES_PER_ENTRY_MAX) {
      return { ok: false, error: `Cada fila de tortas lleva entre 1 y ${CAKES_PER_ENTRY_MAX} unidades.` };
    }
    const flavorId = optionalId(c.flavorId);
    const decoratorId = optionalId(c.decoratorId);
    if ((flavorId !== null && !isUuid(flavorId)) || (decoratorId !== null && !isUuid(decoratorId))) {
      return { ok: false, error: "Sabor o decoradora inválidos." };
    }
    const link = lineFor(c.lineId, c.productId);
    if (!link.ok) return { ok: false, error: "Una línea no pertenece a este pedido. Recarga la página." };

    productIds.add(c.productId);
    if (flavorId) flavorIds.add(flavorId);
    if (decoratorId) decoratorIds.add(decoratorId);
    totalCakes += qty;
    cakes.push({
      product_id: c.productId,
      quantity: qty,
      flavor_id: flavorId,
      decorator_id: decoratorId,
      /* Tipo de torta só existe na encomenda; vem da linha, não do navegador. */
      cake_type_id: link.line?.cakeTypeId ?? null,
      production_order_line_id: link.line?.id ?? null,
    });
  }
  if (totalCakes > CAKES_TOTAL_MAX) {
    return { ok: false, error: `Son ${totalCakes} tortas: el máximo por despacho es ${CAKES_TOTAL_MAX}. Divídelo en dos.` };
  }

  const items: Record<string, unknown>[] = [];
  for (const i of input.items) {
    if (!i || !isUuid(i.productId)) return { ok: false, error: "Hay un producto inválido en el despacho." };
    const qty = Number(i.quantity);
    if (!Number.isInteger(qty) || qty < 1 || qty > ITEM_QTY_MAX) {
      return { ok: false, error: `La cantidad de cada ítem va de 1 a ${ITEM_QTY_MAX}.` };
    }
    const link = lineFor(i.lineId, i.productId);
    if (!link.ok) return { ok: false, error: "Una línea no pertenece a este pedido. Recarga la página." };
    productIds.add(i.productId);
    items.push({ product_id: i.productId, quantity: qty, production_order_line_id: link.line?.id ?? null });
  }

  const [{ data: productRows }, flavorCheck, decoratorCheck] = await Promise.all([
    op.db.from("products").select("id, name, product_families(tracks_serial, is_service)").in("id", [...productIds]),
    flavorIds.size ? op.db.from("flavors").select("id").in("id", [...flavorIds]) : Promise.resolve({ data: [] as { id: string }[] }),
    decoratorIds.size ? op.db.from("decorators").select("id").in("id", [...decoratorIds]) : Promise.resolve({ data: [] as { id: string }[] }),
  ]);

  const products = new Map(
    ((productRows ?? []) as unknown as { id: string; name: string; product_families: { tracks_serial: boolean; is_service: boolean } | null }[]).map(
      (p) => [p.id, p],
    ),
  );
  if (products.size !== productIds.size) return { ok: false, error: "Algún producto ya no existe." };
  if ((flavorCheck.data ?? []).length !== flavorIds.size) return { ok: false, error: "Algún sabor ya no existe. Recarga la página." };
  if ((decoratorCheck.data ?? []).length !== decoratorIds.size) return { ok: false, error: "Alguna decoradora ya no existe. Recarga la página." };

  for (const c of input.cakes) {
    const p = products.get(c.productId)!;
    if (!p.product_families?.tracks_serial) return { ok: false, error: `${p.name} no lleva serie: despáchalo como ítem.` };
  }
  for (const i of input.items) {
    const p = products.get(i.productId)!;
    if (p.product_families?.tracks_serial) return { ok: false, error: `${p.name} es torta: sale con sabor y etiqueta.` };
    if (p.product_families?.is_service || !p.product_families) return { ok: false, error: `${p.name} no se despacha desde el taller.` };
  }

  const result = await runOp<{ id: string; number: number; code: string; serials: string[]; cakes: number }>("op_dispatch_create", {
    p_store: storeId,
    p_order: input.orderId,
    p_cakes: cakes,
    p_items: items,
    p_notes: cleanText(input.notes, NOTES_MAX),
  });
  if (!result.ok) return result;

  revalidateFlow();
  return { ok: true, data: { id: result.data.id, number: Number(result.data.number), cakes: Number(result.data.cakes) } };
}

/** O taller decide não mandar o resto (faltou insumo). O que já saiu continua valendo. */
export async function closeRequest(orderId: string, reason: string): Promise<ActionResult> {
  const op = await getOperator();
  if (!op) return { ok: false, error: SESSION_EXPIRED };
  if (!isUuid(orderId)) return { ok: false, error: "Pedido inválido." };
  /* O motivo vai para as notas do pedido: é o que explica à loja (e ao Joseka)
     por que chegou menos do que se pediu. */
  const why = cleanText(reason, REASON_MAX);
  if (!why || why.length < 3) return { ok: false, error: "Indica por qué se cierra el pedido." };

  const result = await runOp("op_request_close", { p_order: orderId, p_reason: why });
  if (!result.ok) return result;

  revalidateFlow();
  return { ok: true, data: undefined };
}

/** Torta devolvida em bom estado vira torta nova (série nova, validade curta) num despacho próprio. */
export async function redecorateCake(input: RedecorateInput): Promise<ActionResult<{ dispatchId: string; serial: string }>> {
  const op = await getOperator();
  if (!op) return { ok: false, error: SESSION_EXPIRED };

  const serial = normalizeSerial(input?.serial);
  if (!isSerial(serial)) return { ok: false, error: "Serie inválida." };
  if (!isUuid(input.storeId)) return { ok: false, error: "Elige la tienda de destino." };

  const decoratorId = input.decoratorId === null || input.decoratorId === "" ? null : input.decoratorId;
  if (decoratorId !== null && !isUuid(decoratorId)) return { ok: false, error: "Decoradora inválida." };

  const [stores, decorator] = await Promise.all([
    listStores(op.db),
    decoratorId ? op.db.from("decorators").select("id").eq("id", decoratorId).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  if (!stores.some((s) => s.id === input.storeId)) return { ok: false, error: "Esa tienda no recibe tortas del taller." };
  if (decoratorId && !decorator.data) return { ok: false, error: "La decoradora ya no existe. Recarga la página." };

  const result = await runOp<{ dispatch_id: string; number: number; code: string; serial: string; expires_on: string }>("op_cake_redecorate", {
    p_serial: serial,
    p_store: input.storeId,
    p_decorator: decoratorId,
    p_notes: cleanText(input.notes, REASON_MAX),
  });
  if (!result.ok) return result;

  revalidateFlow();
  return { ok: true, data: { dispatchId: result.data.dispatch_id, serial: result.data.serial } };
}

/** Descarte das devolvidas. Só `returned`: descartar torta da vitrine ou faltante tem tela própria. */
export async function discardCakes(serials: string[], reason: string): Promise<ActionResult<{ discarded: number }>> {
  const op = await getOperator();
  if (!op) return { ok: false, error: SESSION_EXPIRED };

  if (!Array.isArray(serials) || serials.length === 0 || serials.length > 50) return { ok: false, error: "Elige las tortas a descartar." };
  const list = [...new Set(serials.map(normalizeSerial))];
  if (!list.every(isSerial)) return { ok: false, error: "Hay una serie inválida." };

  const why = cleanText(reason, REASON_MAX);
  if (!why || why.length < 3) return { ok: false, error: "Indica el motivo del descarte." };

  const { data: rows, error: rowsError } = await op.db
    .from("cake_units")
    .select("serial, status, children:cake_units!origin_unit_id(id)")
    .eq("source", "native")
    .in("serial", list);
  if (rowsError) return { ok: false, error: "No se pudo verificar las tortas. Inténtalo de nuevo." };
  const found = (rows ?? []) as unknown as { serial: string; status: string; children: { id: string }[] | null }[];
  if (found.length !== list.length) return { ok: false, error: "Alguna torta no existe." };
  const notReturned = found.find((r) => r.status !== "returned");
  if (notReturned) return { ok: false, error: `La torta ${notReturned.serial} ya no está devuelta en el taller. Recarga la página.` };
  /* A original de uma redecorada fica "devolvida" para sempre. Descartá-la
     depois (tela desatualizada, dois aparelhos) contaria um descarte de uma
     torta que na verdade voltou à vitrine com outra série. */
  const transformed = found.find((r) => (r.children ?? []).length > 0);
  if (transformed) return { ok: false, error: `La torta ${transformed.serial} ya fue redecorada. Recarga la página.` };

  const result = await runOp<{ discarded: number }>("op_cakes_discard", { p_serials: list, p_reason: why });
  if (!result.ok) return result;

  revalidateFlow();
  return { ok: true, data: { discarded: Number(result.data.discarded) } };
}

/** Faltante: apareceu (volta a valer na loja) ou se deu por perdida (sai do estoque). */
export async function resolveMissing(serial: string, found: boolean, notes: string): Promise<ActionResult> {
  const op = await getOperator();
  if (!op) return { ok: false, error: SESSION_EXPIRED };

  const value = normalizeSerial(serial);
  if (!isSerial(value)) return { ok: false, error: "Serie inválida." };
  if (typeof found !== "boolean") return { ok: false, error: "Opción inválida." };

  const result = await runOp("op_cake_resolve_missing", { p_serial: value, p_found: found, p_notes: cleanText(notes, REASON_MAX) });
  if (!result.ok) return result;

  revalidateFlow();
  return { ok: true, data: undefined };
}
