import { NextResponse } from "next/server";
import {
  OrderError,
  makeOrderCode,
  priceOrder,
  saveOrder,
  validateDelivery,
  type Order,
  type PaymentMethod,
} from "@/lib/orders";
import { getProducts } from "@/lib/catalog-db";
import { getDeliveryConfig } from "@/lib/delivery-db";
import { checkRateLimit } from "@/lib/rate-limit";
import { findOrderByIdempotencyKey } from "@/lib/orders";
import { CUSTOM_LEAD_TIME_HOURS } from "@/lib/custom-cake";
import { sendOrderEmails } from "@/lib/email/dispatch";
import { isTransferEnabled } from "@/lib/payment-config";

type Payload = {
  customer: { name: string; phone: string; email: string };
  delivery: {
    method: "delivery" | "pickup";
    dateISO: string;
    slotId: string;
    districtSlug: string | null;
    address: string;
    reference: string;
    coordinates?: { lat: number; lng: number } | null;
  };
  lines: {
    slug: string;
    sizeSlug: string | null;
    qty: number;
    cakeMessage: string;
    photoUrl: string | null;
    flavors: string[];
    custom?: { sizeId: string; styleId: string } | null;
  }[];
  addons: { addonId: string; qty: number; message: string }[];
  paymentMethod: PaymentMethod;
  notes: string;
  /** Gerada no navegador, uma por tentativa de compra. */
  idempotencyKey?: string;
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
/** Celular peruano: 9 dígitos começando em 9. */
const PHONE = /^9\d{8}$/;

export async function POST(request: Request) {
  try {
    const limit = await checkRateLimit("orders", request);
    if (!limit.ok) {
      return NextResponse.json(
        { error: limit.message },
        { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
      );
    }

    const body = (await request.json()) as Payload;

    /* Duplo clique e retry de rede chegam aqui como dois POSTs idênticos.
       Sem esta checagem viravam dois pedidos — e, no cartão, duas cobranças. */
    const key = body.idempotencyKey?.trim();
    if (key) {
      const existing = await findOrderByIdempotencyKey(key);
      if (existing) {
        return NextResponse.json({
          code: existing.code,
          totals: existing.totals,
          paymentMethod: existing.paymentMethod,
          paymentSession: key,
          reused: true,
        });
      }
    }

    const name = body.customer?.name?.trim() ?? "";
    const phone = (body.customer?.phone ?? "").replace(/\D/g, "");
    const email = body.customer?.email?.trim().toLowerCase() ?? "";

    if (name.length < 3) throw new OrderError("Escribe tu nombre completo.", "name");
    if (!PHONE.test(phone)) throw new OrderError("Ingresa un celular de 9 dígitos.", "phone");
    if (!EMAIL.test(email)) throw new OrderError("Ingresa un correo válido.", "email");

    if (body.paymentMethod === "transfer" && !isTransferEnabled()) {
      throw new OrderError(
        "La transferencia todavía no está disponible. Elige pago con tarjeta.",
        "payment",
      );
    }

    if (body.delivery.method === "delivery" && (body.delivery.address ?? "").trim().length < 6) {
      throw new OrderError("Escribe la dirección de entrega.", "address");
    }

    const priced = await priceOrder({
      /* flavors segue junto: a regra de sabores é revalidada no servidor. */
      lines: body.lines.map((l) => ({ ...l, flavors: l.flavors ?? [] })),
      addons: body.addons,
      delivery: body.delivery,
    });

    const products = await getProducts();

    /* A antecedência do carrinho é a do item mais demorado. */
    const leadTime = body.lines.reduce((max, l) => {
      if (l.custom) return Math.max(max, CUSTOM_LEAD_TIME_HOURS);
      const p = products.find((x) => x.slug === l.slug);
      return Math.max(max, p?.leadTimeHours ?? 24);
    }, 24);
    const deliveryConfig = await getDeliveryConfig();
    validateDelivery(deliveryConfig, body.delivery.dateISO, body.delivery.slotId, leadTime);

    /* FotoTortas sem imagem não entram: é o defeito que o site atual tem hoje.
       As personalizadas já foram checadas dentro de priceOrder. */
    for (const line of body.lines) {
      if (line.custom) continue;
      const product = products.find((p) => p.slug === line.slug);
      if (product?.acceptsPhoto && !line.photoUrl) {
        throw new OrderError(`Falta subir la foto de ${product.name}.`, "photo");
      }
    }

    const order: Order = {
      code: makeOrderCode(),
      createdAt: new Date().toISOString(),
      status: "pending_payment",
      paymentMethod: body.paymentMethod === "transfer" ? "transfer" : "card",
      customer: { name, phone, email },
      delivery: {
        method: body.delivery.method,
        dateISO: body.delivery.dateISO,
        slotId: body.delivery.slotId,
        districtSlug: body.delivery.districtSlug,
        address: (body.delivery.address ?? "").trim(),
        reference: (body.delivery.reference ?? "").trim(),
        storeId: priced.deliveryQuote?.storeId ?? null,
        coordinates: body.delivery.coordinates ?? null,
      },
      lines: priced.lines.map((l, i) => ({
        slug: l.product.slug,
        name: l.product.name,
        sizeSlug: l.size,
        qty: l.qty,
        unitPrice: l.unitPrice,
        cakeMessage: (body.lines[i].cakeMessage ?? "").slice(0, 80),
        photoUrl: body.lines[i].photoUrl ?? null,
        flavors: body.lines[i].flavors ?? [],
      })),
      addons: body.addons.map((a) => ({
        addonId: a.addonId,
        qty: Math.floor(a.qty),
        message: (a.message ?? "").slice(0, 200),
      })),
      totals: { subtotal: priced.subtotal, shipping: priced.shipping, total: priced.total },
      notes: (body.notes ?? "").slice(0, 500),
      idempotencyKey: key || null,
    };

    const saved = await saveOrder(order);

    /* saveOrder devolve o pedido vencedor quando duas tentativas simultâneas
       usaram a mesma chave. Nesse caso não há e-mail novo a enviar. */
    if (saved.code !== order.code) {
      return NextResponse.json({
        code: saved.code,
        totals: saved.totals,
        paymentMethod: saved.paymentMethod,
        reused: true,
      });
    }

    /* Transferência não passa por gateway: o pedido já é definitivo aqui.
       Cartão espera a cobrança confirmar — avisar antes seria prometer uma
       torta que pode não ser paga.

       O await é intencional (serverless mata trabalho solto depois da
       resposta), mas sendOrderEmails() nunca lança: uma falha de e-mail vira
       registro em email_log, não erro no pedido. */
    if (order.paymentMethod === "transfer") {
      await sendOrderEmails(order.code);
    }

    return NextResponse.json({
      code: order.code,
      totals: order.totals,
      paymentMethod: order.paymentMethod,
      paymentSession: key,
    });
  } catch (error) {
    if (error instanceof OrderError) {
      return NextResponse.json({ error: error.message, field: error.field }, { status: 400 });
    }
    console.error("[orders] fallo inesperado", error);
    return NextResponse.json({ error: "No pudimos registrar tu pedido." }, { status: 500 });
  }
}
