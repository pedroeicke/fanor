import "server-only";
import { createHash } from "node:crypto";
import { getSupabaseAdmin } from "./supabase-admin";
import { getOrder, updateOrder, type OrderStatus } from "./orders";

export type PaymentEventInput = {
  provider: string;
  eventId: string;
  eventType: string;
  orderCode: string;
  paymentReference?: string | null;
  status: Extract<OrderStatus, "paid" | "failed" | "cancelled" | "abandoned">;
  payload?: unknown;
};

/** Hash estável para eventos locais que não possuem id do provedor. */
export function localPaymentEventId(...parts: string[]) {
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 32);
}

export async function processPaymentEvent(input: PaymentEventInput) {
  const current = await getOrder(input.orderCode);
  if (!current) return { ok: false as const, error: "Pedido no encontrado." };
  if (current.status === "paid" && input.status !== "paid") {
    return { ok: true as const, duplicate: true, order: current };
  }

  const db = getSupabaseAdmin();
  if (db) {
    const { error } = await db.from("payment_events").insert({
      provider: input.provider,
      event_id: input.eventId,
      event_type: input.eventType,
      order_code: input.orderCode,
      payment_reference: input.paymentReference ?? null,
      payload: input.payload ?? {},
    });
    if (error?.code === "23505") return { ok: true as const, duplicate: true, order: current };
    /* A migração pode ainda não ter sido aplicada; não perde a atualização do
       pedido, mas registra o problema para a operação corrigir. */
    if (error) console.error("[payment-events] no se pudo registrar", error.message);
  }

  const updated = await updateOrder(input.orderCode, {
    status: input.status,
    chargeId: input.paymentReference ?? current.chargeId,
  });
  if (!updated) return { ok: false as const, error: "No se pudo actualizar el pedido." };
  return { ok: true as const, duplicate: false, order: updated };
}
