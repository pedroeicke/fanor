"use server";

import { revalidatePath } from "next/cache";
import { friendlyDbError, getOperator, runOp, shortStoreName, type ActionResult } from "@/lib/gestion/server";
import { isSerial, parseQr } from "@/lib/gestion/qr";
import type { ReceiveInput, ReceiveResult, ScanLookup } from "@/components/admin/recepcion/types";

/**
 * Ações da recepção na loja.
 *
 * A conferência em si é `op_dispatch_receive` (atômica, no banco). Aqui fica
 * o que o banco não confere: formato das séries, tamanho da observação e o
 * teto da quantidade recebida — o banco só barra negativo, e um "300"
 * digitado no lugar de "30" viraria saldo fantasma no estoque.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_NOTES = 500;
const MAX_CAKES = 500;
const EXPIRED = "Sesión expirada. Vuelve a entrar.";

type DispatchRow = {
  id: string;
  number: number;
  code: string;
  status: string;
  store_id: string;
  stores: { name: string } | null;
};

function toLookup(d: DispatchRow, cake: ScanLookup["cake"]): ScanLookup {
  return {
    dispatchId: d.id,
    number: d.number,
    code: d.code,
    status: d.status,
    storeId: d.store_id,
    storeName: shortStoreName(d.stores?.name),
    cake,
  };
}

/**
 * O QR lido na lista de recepção aponta para qual despacho?
 *
 * Aceita a guia (abre o despacho inteiro) ou a etiqueta de uma torta — a
 * vendedora abre a caixa e escaneia a primeira torta que vê, sem procurar
 * a guia no meio do papel.
 */
export async function locateScan(raw: string): Promise<ActionResult<ScanLookup>> {
  const op = await getOperator();
  if (!op) return { ok: false, error: EXPIRED };

  if (typeof raw !== "string" || raw.length > 64) return { ok: false, error: "Código no reconocido." };
  const parsed = parseQr(raw);
  if (!parsed) return { ok: false, error: "Código no reconocido." };

  const dispatchFields = "id, number, code, status, store_id, stores(name)";

  if (parsed.type === "dispatch") {
    const { data, error } = await op.db.from("dispatches").select(dispatchFields).eq("code", parsed.code).maybeSingle();
    if (error) return { ok: false, error: friendlyDbError(error) };
    if (!data) return { ok: false, error: `No hay ningún despacho con la guía ${parsed.code}.` };
    return { ok: true, data: toLookup(data as unknown as DispatchRow, null) };
  }

  const { data, error } = await op.db
    .from("cake_units")
    .select(`serial, status, dispatches(${dispatchFields})`)
    .eq("serial", parsed.serial)
    .eq("source", "native")
    .maybeSingle();
  if (error) return { ok: false, error: friendlyDbError(error) };
  if (!data) return { ok: false, error: `La torta ${parsed.serial} no está en ningún despacho del taller.` };

  const cake = data as unknown as { serial: string; status: string; dispatches: DispatchRow | null };
  if (!cake.dispatches) return { ok: false, error: `La torta ${cake.serial} no llegó por despacho.` };
  return { ok: true, data: toLookup(cake.dispatches, { serial: cake.serial, status: cake.status }) };
}

function cleanSerials(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > MAX_CAKES) return null;
  const serials = [...new Set(value.map((s) => (typeof s === "string" ? s.trim().toUpperCase() : "")))];
  return serials.every(isSerial) ? serials : null;
}

/**
 * Confirma a recepção. O que não estiver em `received` vira faltante.
 *
 * Idempotência vem do banco: a função trava o despacho e recusa o segundo
 * envio ("Este despacho ya fue recibido."), então dois celulares
 * confirmando ao mesmo tempo não dobram o estoque.
 *
 * O banco, porém, marca como faltante TODA torta em trânsito que não vier na
 * lista — inclusive uma que a tela nem mostrou (consulta que falhou, página
 * velha). Por isso a tela manda as séries que exibiu e o servidor recusa se
 * não baterem: "N quedarán como FALTANTES" tem de ser exatamente o que acontece.
 */
export async function receiveDispatch(input: ReceiveInput): Promise<ActionResult<ReceiveResult>> {
  const op = await getOperator();
  if (!op) return { ok: false, error: EXPIRED };

  if (!input || typeof input.dispatchId !== "string" || !UUID.test(input.dispatchId)) {
    return { ok: false, error: "Despacho inválido." };
  }
  const received = cleanSerials(input.received);
  const expected = cleanSerials(input.expected);
  if (!received || !expected) {
    return { ok: false, error: "La lista de tortas es inválida." };
  }

  const notes = typeof input.notes === "string" ? input.notes.trim() : "";
  if (notes.length > MAX_NOTES) {
    return { ok: false, error: `La observación admite hasta ${MAX_NOTES} caracteres.` };
  }

  if (!Array.isArray(input.items) || input.items.length > MAX_CAKES) {
    return { ok: false, error: "La lista de ítems es inválida." };
  }

  const [dispatchRes, cakesRes, linesRes] = await Promise.all([
    op.db.from("dispatches").select("status").eq("id", input.dispatchId).maybeSingle(),
    op.db.from("cake_units").select("serial").eq("dispatch_id", input.dispatchId).eq("status", "in_transit"),
    op.db.from("dispatch_lines").select("id, quantity, products(name)").eq("dispatch_id", input.dispatchId),
  ]);
  const readError = dispatchRes.error ?? cakesRes.error ?? linesRes.error;
  if (readError) return { ok: false, error: friendlyDbError(readError) };
  if (!dispatchRes.data) return { ok: false, error: "Despacho no encontrado." };
  if (dispatchRes.data.status === "cancelled") return { ok: false, error: "Este despacho fue anulado." };
  if (dispatchRes.data.status !== "in_transit") return { ok: false, error: "Este despacho ya fue recibido." };

  const inTransit = new Set(((cakesRes.data ?? []) as { serial: string }[]).map((c) => c.serial));
  const shown = new Set(expected);
  if (inTransit.size !== shown.size || [...inTransit].some((s) => !shown.has(s))) {
    return { ok: false, error: "La lista de tortas de este despacho cambió. Actualiza la página y vuelve a conferir." };
  }
  if (received.some((s) => !shown.has(s))) {
    return { ok: false, error: "Hay una torta marcada que no pertenece a este despacho." };
  }

  const lines = new Map(
    ((linesRes.data ?? []) as unknown as { id: string; quantity: number | string; products: { name: string } | null }[]).map((l) => [
      l.id,
      { quantity: Number(l.quantity), name: l.products?.name ?? "ítem" },
    ]),
  );

  const items: ReceiveInput["items"] = [];
  const seen = new Set<string>();
  for (const item of input.items) {
    const id = item && typeof item.dispatch_line_id === "string" ? item.dispatch_line_id : "";
    const line = lines.get(id);
    if (!line || seen.has(id)) return { ok: false, error: "Hay un ítem que no pertenece a este despacho." };
    seen.add(id);

    const q = Number(item.received_quantity);
    const max = line.quantity * 2;
    if (typeof item.received_quantity !== "number" || !Number.isFinite(q) || q < 0 || q > max) {
      return { ok: false, error: `Cantidad recibida de ${line.name} inválida: entre 0 y ${max}.` };
    }
    /* numeric(12,3) no banco: arredonda aqui para o que foi gravado ser o que a tela mostrou. */
    items.push({ dispatch_line_id: id, received_quantity: Math.round(q * 1000) / 1000 });
  }
  /* Linha sem contagem o banco grava como "chegou tudo" — só vale se a vendedora viu a linha. */
  if (items.length !== lines.size) {
    return { ok: false, error: "Faltan ítems sin serie por contar. Actualiza la página y vuelve a conferir." };
  }

  const result = await runOp<ReceiveResult>("op_dispatch_receive", {
    p_dispatch: input.dispatchId,
    p_received: received,
    p_items: items,
    p_notes: notes || null,
  });
  if (!result.ok) return result;

  /* A página do próprio despacho não entra aqui: o cliente navega para o
     resultado, e revalidá-la trocaria a tela no meio do envio. */
  revalidatePath("/admin/recepcion");
  revalidatePath("/admin/tienda");
  revalidatePath("/admin/taller");
  /* Encomenda com todas as tortas recebidas passa a "lista para entregar". */
  revalidatePath("/admin/encomiendas", "layout");
  revalidatePath("/vitrina");
  return result;
}
