"use server";

import { revalidatePath } from "next/cache";
import { getOperator, runOp, type ActionResult } from "@/lib/gestion/server";
import { isSerial } from "@/lib/gestion/qr";

/**
 * Ações de "Mi vitrina": devolver vencidas ao taller e esclarecer faltantes.
 *
 * As regras de estado (só `in_stock` volta, só `missing` se esclarece) estão
 * nas funções do banco, que respondem em espanhol. Aqui só entra o que chega
 * bem formado — a ação é alcançável por POST direto, não só pela tela.
 */

const MAX_NOTES = 500;
const MAX_SERIALS = 200;
const EXPIRED = "Sesión expirada. Vuelve a entrar.";

function cleanNotes(value: unknown): { ok: true; notes: string | null } | { ok: false; error: string } {
  if (value === undefined || value === null) return { ok: true, notes: null };
  if (typeof value !== "string") return { ok: false, error: "Nota inválida." };
  const notes = value.trim();
  if (notes.length > MAX_NOTES) return { ok: false, error: `La nota admite hasta ${MAX_NOTES} caracteres.` };
  return { ok: true, notes: notes || null };
}

/* A vitrina pública lê as tortas nativas quando a chave virar: o que sai da
   loja tem de sair de lá também, sem esperar o cache. */
function revalidateStock() {
  revalidatePath("/admin/tienda");
  revalidatePath("/admin/taller");
  /* O resumo do despacho mostra quantas seguem faltantes; a encomenda lista as tortas reservadas dela. */
  revalidatePath("/admin/recepcion", "layout");
  revalidatePath("/admin/encomiendas", "layout");
  revalidatePath("/vitrina");
}

export async function returnCakes(input: { serials: string[]; notes?: string }): Promise<ActionResult<{ returned: number }>> {
  const op = await getOperator();
  if (!op) return { ok: false, error: EXPIRED };

  if (!input || !Array.isArray(input.serials) || input.serials.length === 0) {
    return { ok: false, error: "Selecciona al menos una torta." };
  }
  if (input.serials.length > MAX_SERIALS) {
    return { ok: false, error: `Máximo ${MAX_SERIALS} tortas por devolución.` };
  }
  const serials = [...new Set(input.serials.map((s) => (typeof s === "string" ? s.trim().toUpperCase() : "")))];
  if (serials.some((s) => !isSerial(s))) return { ok: false, error: "Hay una serie inválida en la selección." };

  const notes = cleanNotes(input.notes);
  if (!notes.ok) return notes;

  const result = await runOp<{ returned: number }>("op_cakes_return", { p_serials: serials, p_notes: notes.notes });
  if (!result.ok) return result;

  revalidateStock();
  return result;
}

export async function resolveMissingCake(input: { serial: string; found: boolean; notes?: string }): Promise<ActionResult> {
  const op = await getOperator();
  if (!op) return { ok: false, error: EXPIRED };

  const serial = input && typeof input.serial === "string" ? input.serial.trim().toUpperCase() : "";
  if (!isSerial(serial)) return { ok: false, error: "Serie inválida." };
  if (typeof input.found !== "boolean") return { ok: false, error: "Indica si la torta apareció o se perdió." };

  const notes = cleanNotes(input.notes);
  if (!notes.ok) return notes;

  const result = await runOp("op_cake_resolve_missing", { p_serial: serial, p_found: input.found, p_notes: notes.notes });
  if (!result.ok) return result;

  revalidateStock();
  return { ok: true, data: undefined };
}
