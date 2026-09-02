import { NextResponse } from "next/server";
import { getOrder } from "@/lib/orders";
import { localPaymentEventId, processPaymentEvent } from "@/lib/payment-events";

export async function POST(request: Request) {
  const text = await request.text();
  let body: { code?: string; paymentSession?: string; reason?: string } = {};
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Solicitud inválida." }, { status: 400 });
  }

  const code = body.code?.trim() ?? "";
  const order = await getOrder(code);
  if (!order || !body.paymentSession || order.idempotencyKey !== body.paymentSession) {
    return NextResponse.json({ error: "Pedido no encontrado." }, { status: 404 });
  }
  if (order.status === "paid") return NextResponse.json({ status: "paid" });

  const status = body.reason === "abandoned" ? "abandoned" : "cancelled";
  const eventId = localPaymentEventId(code, status, order.idempotencyKey ?? "");
  const result = await processPaymentEvent({
    provider: "culqi",
    eventId,
    eventType: `checkout.${status}`,
    orderCode: code,
    status,
  });
  return NextResponse.json({ status, ok: result.ok });
}
