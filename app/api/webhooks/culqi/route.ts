import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { sendOrderEmails } from "@/lib/email/dispatch";
import { processPaymentEvent } from "@/lib/payment-events";

type Json = Record<string, unknown>;

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function object(value: unknown): Json {
  return value && typeof value === "object" ? (value as Json) : {};
}

function string(value: unknown) {
  return typeof value === "string" ? value : "";
}

async function verifyCharge(reference: string, orderCode: string) {
  const secret = process.env.CULQI_SECRET_KEY;
  if (!secret || !reference.startsWith("chr_")) return false;
  const response = await fetch(`https://api.culqi.com/v2/charges/${encodeURIComponent(reference)}`, {
    headers: { Authorization: `Bearer ${secret}` },
    cache: "no-store",
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) return false;
  const charge = object(await response.json());
  return string(object(charge.metadata).order_code) === orderCode;
}

/**
 * Webhook idempotente. No CulqiPanel, configure autenticação e envie o mesmo
 * segredo de CULQI_WEBHOOK_SECRET no cabeçalho Authorization como Bearer.
 */
export async function POST(request: Request) {
  const secret = process.env.CULQI_WEBHOOK_SECRET?.trim();
  const authorization = request.headers.get("authorization") ?? "";
  if (!secret || !safeEqual(authorization, `Bearer ${secret}`)) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  const payload = object(await request.json());
  const eventType = string(payload.type || payload.event);
  const eventId = string(payload.id) || string(object(payload.data).id);
  const data = object(payload.data);
  const resource = object(data.object ?? data);
  const metadata = object(resource.metadata);
  const orderCode = string(metadata.order_code || resource.order_code);
  const reference = string(resource.id || resource.charge_id || resource.payment_reference);

  if (!eventType || !eventId || !orderCode) {
    return NextResponse.json({ error: "Evento incompleto." }, { status: 400 });
  }

  let status: "paid" | "failed" | "cancelled" | null = null;
  if (eventType === "charge.created" || eventType === "charge.succeeded") status = "paid";
  if (eventType === "charge.failed") status = "failed";
  if (eventType === "charge.cancelled" || eventType === "charge.canceled") status = "cancelled";
  if (eventType === "order.status.changed") {
    const providerStatus = string(resource.status).toLowerCase();
    if (["paid", "completed", "successful"].includes(providerStatus)) status = "paid";
    if (["expired", "cancelled", "canceled"].includes(providerStatus)) status = "cancelled";
    if (["failed", "declined"].includes(providerStatus)) status = "failed";
  }

  if (!status) return NextResponse.json({ received: true, ignored: true });
  if (status === "paid" && !(await verifyCharge(reference, orderCode))) {
    return NextResponse.json({ error: "La cobranza no pudo verificarse." }, { status: 400 });
  }

  const result = await processPaymentEvent({
    provider: "culqi",
    eventId,
    eventType,
    orderCode,
    paymentReference: reference || null,
    status,
    payload,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 404 });

  if (status === "paid" && !result.duplicate) await sendOrderEmails(orderCode);
  return NextResponse.json({ received: true, duplicate: result.duplicate, status });
}
