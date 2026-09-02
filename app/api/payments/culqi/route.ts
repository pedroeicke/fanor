import { NextResponse } from "next/server";
import { getOrder } from "@/lib/orders";
import { sendOrderEmails } from "@/lib/email/dispatch";
import { localPaymentEventId, processPaymentEvent } from "@/lib/payment-events";

/**
 * Cobrança com Culqi — o gateway mais usado por lojas peruanas, aceita
 * Visa/Mastercard/Amex e Yape.
 *
 * O cartão nunca passa por este servidor: o navegador tokeniza com Culqi.js
 * usando a chave pública, e aqui só viaja o token. É o que mantém a loja fora
 * do escopo pesado de PCI-DSS.
 *
 * Configuração (.env.local):
 *   NEXT_PUBLIC_CULQI_PUBLIC_KEY=pk_test_xxx
 *   CULQI_SECRET_KEY=sk_test_xxx
 *
 * Sem CULQI_SECRET_KEY o endpoint entra em modo simulado: aprova o pedido e o
 * marca com `simulated: true`, para que o fluxo completo seja navegável antes
 * de existirem credenciais. Nenhum pedido simulado se confunde com um real.
 */

const CULQI_CHARGES = "https://api.culqi.com/v2/charges";

export async function POST(request: Request) {
  const { code, token, email } = (await request.json()) as {
    code: string;
    token?: string;
    email?: string;
  };

  const order = await getOrder(code);
  if (!order) {
    return NextResponse.json({ error: "Pedido no encontrado." }, { status: 404 });
  }
  if (order.status === "paid") {
    return NextResponse.json({ status: "paid", code: order.code });
  }

  const secret = process.env.CULQI_SECRET_KEY;

  if (!secret) {
    const updated = await processPaymentEvent({
      provider: "culqi",
      eventId: localPaymentEventId(code, "simulated-paid"),
      eventType: "charge.simulated",
      orderCode: code,
      paymentReference: `sim_${code}`,
      status: "paid",
    });
    if (updated.ok) {
      /* Mantém a marca visual de demonstração no pedido. */
      const { updateOrder } = await import("@/lib/orders");
      await updateOrder(code, { simulated: true });
    }
    await sendOrderEmails(code);
    return NextResponse.json({
      status: "paid",
      code,
      simulated: true,
      notice: "Pago simulado: falta configurar CULQI_SECRET_KEY.",
    });
  }

  if (!token) {
    return NextResponse.json({ error: "Falta el token de la tarjeta." }, { status: 400 });
  }

  try {
    /* Culqi cobra em centavos, como inteiro. */
    const response = await fetch(CULQI_CHARGES, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: Math.round(order.totals.total * 100),
        currency_code: "PEN",
        email: email ?? order.customer.email,
        source_id: token,
        description: `Pedido ${order.code} — Tortas Fanor`,
        metadata: { order_code: order.code, delivery_date: order.delivery.dateISO },
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      await processPaymentEvent({
        provider: "culqi",
        eventId: String(data?.id ?? localPaymentEventId(code, "failed", Date.now().toString())),
        eventType: "charge.failed",
        orderCode: code,
        paymentReference: data?.id ?? null,
        status: "failed",
        payload: data,
      });
      /* A mensagem do Culqi já vem em espanhol e é acionável pelo cliente. */
      return NextResponse.json(
        { error: data?.user_message ?? "No pudimos procesar el pago.", status: "failed" },
        { status: 402 },
      );
    }

    await processPaymentEvent({
      provider: "culqi",
      eventId: String(data.id),
      eventType: "charge.created",
      orderCode: code,
      paymentReference: data.id,
      status: "paid",
      payload: data,
    });

    /* Cobrança aprovada é ponto sem volta: daqui em diante, qualquer falha de
       e-mail é registrada, nunca propagada. Devolver erro agora faria o
       cliente tentar pagar de novo. */
    await sendOrderEmails(code);

    return NextResponse.json({ status: "paid", code: order.code, chargeId: data.id });
  } catch (error) {
    console.error("[culqi] fallo de red", error);
    return NextResponse.json({ error: "El procesador de pagos no respondió." }, { status: 502 });
  }
}
