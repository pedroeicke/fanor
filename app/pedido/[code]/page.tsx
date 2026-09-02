import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getOrder } from "@/lib/orders";
import { findDistrict, formatDateLong } from "@/lib/delivery";
import { getDeliveryConfig } from "@/lib/delivery-db";
import { brand, whatsappLink } from "@/lib/config";
import { getTransferAccounts } from "@/lib/payment-config";
import { soles } from "@/lib/format";
import { ButtonLink } from "@/components/ui/primitives";
import { IconCalendar, IconCheck, IconPin, IconWhatsapp } from "@/components/ui/icons";
import { PurchaseTracker } from "@/components/checkout/PurchaseTracker";
import { getEmailStatus } from "@/lib/email/dispatch";

export const metadata: Metadata = {
  title: "Pedido confirmado",
  robots: { index: false, follow: false },
};

export default async function OrderPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const order = await getOrder(code);
  if (!order) notFound();

  const emails = await getEmailStatus(code);
  const emailSent = emails.some(
    (e) => e.kind === "customer_confirmation" && e.status === "sent" && !e.simulated,
  );

  const config = await getDeliveryConfig();
  const slot = config.slots.find((s) => s.id === order.delivery.slotId);
  const district = findDistrict(config, order.delivery.districtSlug);
  const awaitingTransfer = order.paymentMethod === "transfer" && order.status === "pending_payment";
  const paymentProblem = ["failed", "cancelled", "abandoned"].includes(order.status);
  const bankAccounts = getTransferAccounts();

  const whatsappMessage = `Hola ${brand.name}, envío el comprobante de mi pedido ${order.code} por ${soles(
    order.totals.total,
  )}.`;

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      {order.status === "paid" && (
        <PurchaseTracker
          code={order.code}
          value={order.totals.total}
          shipping={order.totals.shipping}
          items={order.lines.map((l) => ({
            item_id: l.slug,
            item_name: l.name,
            price: l.unitPrice,
            quantity: l.qty,
          }))}
        />
      )}

      <div className="text-center">
        <span className={`mx-auto grid h-16 w-16 place-items-center rounded-full ${paymentProblem ? "bg-terracota/10 text-terracota" : "bg-verde-100 text-verde"}`}>
          <IconCheck className="h-8 w-8" />
        </span>
        <h1 className="mt-5 text-4xl">
          {paymentProblem
            ? order.status === "failed"
              ? "El pago fue rechazado"
              : order.status === "abandoned"
                ? "El pago quedó incompleto"
                : "El pago fue cancelado"
            : awaitingTransfer
              ? "Pedido registrado"
              : "¡Pedido confirmado!"}
        </h1>
        <p className="mt-3 text-lg text-cacao-500">
          {paymentProblem
            ? "No se realizó ningún cobro. Puedes volver al checkout e intentarlo nuevamente."
            : awaitingTransfer
            ? "Reservamos tu torta. Envíanos el comprobante y la ponemos en producción."
            : `Ya estamos con las manos en la masa, ${order.customer.name.split(" ")[0]}.`}
        </p>
        <p className="mt-4 inline-block rounded-full bg-crema-100 px-5 py-2.5 font-mono text-lg font-semibold tracking-wide">
          {order.code}
        </p>
        {order.simulated && (
          <p className="mx-auto mt-4 max-w-md rounded-lg bg-dorado-100 px-4 py-3 text-sm text-cacao-700">
            <strong>Pedido de demostración.</strong> No se realizó ningún cobro real porque las
            llaves del procesador de pagos no están configuradas.
          </p>
        )}
      </div>

      {awaitingTransfer && (
        <section className="card mt-8 p-6">
          <h2 className="text-2xl">Completa tu pago</h2>
          <p className="mt-2 text-cacao-500">
            {bankAccounts.length > 0
              ? `Transfiere ${soles(order.totals.total)} a cualquiera de estas cuentas y envíanos la captura por WhatsApp. Confirmamos en minutos dentro del horario de atención.`
              : `Escríbenos por WhatsApp para coordinar el pago de ${soles(order.totals.total)}. No mostramos datos bancarios hasta que la tienda los confirme.`}
          </p>

          {bankAccounts.length > 0 && (
            <ul className="mt-5 space-y-3">
              {bankAccounts.map((acc) => (
                <li
                  key={acc.bank}
                  className="rounded-xl border border-crema-200 bg-crema-100 px-4 py-3"
                >
                  <p className="text-sm font-semibold">{acc.bank}</p>
                  <p className="mt-0.5 font-mono text-[15px]">{acc.account}</p>
                  <p className="text-[13px] text-cacao-500">
                    {acc.kind} · {acc.holder}
                  </p>
                </li>
              ))}
            </ul>
          )}

          <a
            href={whatsappLink(whatsappMessage)}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-5 inline-flex h-14 w-full items-center justify-center gap-2.5 rounded-full bg-[#25D366] font-semibold text-[#0b3d20] transition-colors hover:bg-[#1fbb59]"
          >
            <IconWhatsapp className="h-5 w-5" />
            Enviar mi comprobante
          </a>
        </section>
      )}

      <section className="card mt-6 p-6">
        <h2 className="text-2xl">
          {order.delivery.method === "pickup" ? "Tu recojo" : "Tu entrega"}
        </h2>

        <div className="mt-4 space-y-3.5">
          <p className="flex items-start gap-3">
            <IconCalendar className="mt-0.5 h-5 w-5 shrink-0 text-dorado-600" />
            <span>
              <strong className="block">{formatDateLong(order.delivery.dateISO)}</strong>
              <span className="text-cacao-500">{slot?.label}</span>
            </span>
          </p>

          <p className="flex items-start gap-3">
            <IconPin className="mt-0.5 h-5 w-5 shrink-0 text-dorado-600" />
            <span>
              {order.delivery.method === "pickup" ? (
                <>
                  <strong className="block">Recojo en tienda</strong>
                  <span className="text-cacao-500">Te enviamos la dirección por WhatsApp.</span>
                </>
              ) : (
                <>
                  <strong className="block">{order.delivery.address}</strong>
                  <span className="text-cacao-500">
                    {district?.name}
                    {order.delivery.reference && ` · ${order.delivery.reference}`}
                  </span>
                </>
              )}
            </span>
          </p>
        </div>

        <ul className="mt-6 space-y-3 border-t border-crema-200 pt-5">
          {order.lines.map((line, i) => (
            <li key={`${line.slug}-${i}`} className="flex justify-between gap-4 text-[15px]">
              <span>
                <strong className="font-medium">
                  {line.name} × {line.qty}
                </strong>
                {line.cakeMessage && (
                  <span className="block text-[13px] text-terracota">“{line.cakeMessage}”</span>
                )}
                {line.photoUrl && (
                  <span className="block text-[13px] text-cacao-500">Con tu foto adjunta ✓</span>
                )}
              </span>
              <span className="shrink-0 font-medium">{soles(line.unitPrice * line.qty)}</span>
            </li>
          ))}
        </ul>

        <dl className="mt-5 space-y-2 border-t border-crema-200 pt-5 text-[15px]">
          <div className="flex justify-between">
            <dt className="text-cacao-500">Subtotal</dt>
            <dd>{soles(order.totals.subtotal)}</dd>
          </div>
          {/* Recojo não tem frete "grátis": não tem frete. A linha diz o que
              a pessoa escolheu, em vez de "Delivery — Gratis" num pedido
              sem entrega. */}
          <div className="flex justify-between">
            <dt className="text-cacao-500">
              {order.delivery.method === "pickup" ? "Recojo en tienda" : "Delivery"}
            </dt>
            <dd>
              {order.delivery.method === "pickup"
                ? "Sin costo"
                : order.totals.shipping === 0
                  ? "Gratis"
                  : soles(order.totals.shipping)}
            </dd>
          </div>
          <div className="flex items-baseline justify-between pt-2">
            <dt className="font-display text-xl">Total</dt>
            <dd className="font-display text-2xl font-semibold">{soles(order.totals.total)}</dd>
          </div>
        </dl>
      </section>

      {/* A frase só afirma o envio quando o provedor confirmou. Prometer um
          e-mail que não saiu faz o cliente esperar em vez de anotar o código. */}
      <p className="mt-6 text-center text-[15px] text-cacao-500">
        {emailSent ? (
          <>
            Enviamos el detalle a <strong className="text-cacao">{order.customer.email}</strong>.{" "}
          </>
        ) : (
          <>
            Anota tu código: es lo que necesitas para cualquier consulta.{" "}
          </>
        )}
        Guarda el código <strong className="text-cacao">{order.code}</strong>.
      </p>

      <div className="mt-8 flex flex-wrap justify-center gap-3">
        {paymentProblem && (
          <ButtonLink href="/checkout">Intentar el pago nuevamente</ButtonLink>
        )}
        <ButtonLink href="/tortas" variant="outline">
          Seguir explorando
        </ButtonLink>
        <Link
          href={whatsappLink(`Hola, tengo una consulta sobre mi pedido ${order.code}.`)}
          target="_blank"
          className="inline-flex h-12 items-center gap-2 rounded-full border border-cacao/25 px-6 text-[15px] font-semibold hover:bg-crema-100"
        >
          <IconWhatsapp className="h-[18px] w-[18px]" />
          Hablar con nosotros
        </Link>
      </div>
    </div>
  );
}
