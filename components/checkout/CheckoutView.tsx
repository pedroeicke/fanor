"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { cartLeadTime, computeTotals, useCart, type DeliveryMethod } from "@/lib/cart";
import { findDistrict, formatDateLong, slotsForDate } from "@/lib/delivery";
import { useDeliveryConfig } from "@/components/delivery/DeliveryConfigProvider";
import { cdnImage, cx, soles } from "@/lib/format";
import { track } from "@/lib/analytics";
import { Button, FieldLabel, Input, Select, Textarea } from "@/components/ui/primitives";
import { PaymentMarks } from "@/components/ui/PaymentMarks";
import {
  IconBank,
  IconCalendar,
  IconCard,
  IconCheck,
  IconLock,
  IconPin,
  IconStore,
  IconTruck,
  IconUser,
} from "@/components/ui/icons";
import { DeliveryPicker } from "@/components/product/DeliveryPicker";
import { markCheckoutStopped, useCulqi } from "./useCulqi";
import { useHydrated } from "@/lib/use-hydrated";
import type { DeliveryCoordinates } from "./DeliveryLocationPicker";
import { CheckoutMapPicker } from "./CheckoutMapPicker";
import { AddressAutocomplete } from "./AddressAutocomplete";
import type { DistanceQuote } from "@/lib/delivery";

type PaymentMethod = "card" | "transfer";
type FieldErrors = Record<string, string>;

const STEPS = ["Carrito", "Datos", "Pago"];

export function CheckoutView({ transferEnabled }: { transferEnabled: boolean }) {
  const router = useRouter();
  const { items, addons, delivery, setDelivery, clear } = useCart();
  const config = useDeliveryConfig();
  const districtTotals = computeTotals(items, addons, delivery, config);
  const leadTime = cartLeadTime(items);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [payment, setPayment] = useState<PaymentMethod>("card");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [coordinates, setCoordinates] = useState<DeliveryCoordinates | null>(null);
  const [distanceQuote, setDistanceQuote] = useState<DistanceQuote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);

  /* Uma chave por tentativa de compra. Sobrevive a duplo clique e a retry de
     rede; só é renovada quando o pedido falha e a pessoa corrige algo. */
  const idempotencyKey = useRef(crypto.randomUUID());
  const pendingPayment = useRef<{ code: string; paymentSession: string } | null>(null);

  const mounted = useHydrated();

  const { ready: culqiReady, charge: culqiCharge, configured: culqiConfigured } = useCulqi();
  const summaryRef = useRef<HTMLDivElement>(null);

  const district = findDistrict(config, delivery.districtSlug);
  const distanceMode = config.distance.enabled;
  const shipping =
    delivery.method === "pickup"
      ? 0
      : distanceMode
        ? distanceQuote?.shipping ?? null
        : districtTotals.shipping;
  const totals = {
    ...districtTotals,
    shipping,
    total: districtTotals.subtotal + (shipping ?? 0),
  };
  const slot = useMemo(
    () =>
      delivery.dateISO
        ? slotsForDate(config, delivery.dateISO).find((s) => s.id === delivery.slotId)
        : null,
    [config, delivery.dateISO, delivery.slotId],
  );

  /* O checklist pede o evento do cálculo de frete: é onde se vê quanta gente
     desiste ao descobrir o custo de entrega. */
  useEffect(() => {
    if (!mounted || totals.shipping === null) return;
    track("add_shipping_info", {
      currency: "PEN",
      value: totals.total,
      shipping_tier: distanceQuote?.storeName
        ? `${distanceQuote.storeName} — ${distanceQuote.distanceKm} km`
        : `${district?.name ?? "Recojo"} — ${delivery.method}`,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, district?.slug, delivery.method, distanceQuote?.storeId]);

  useEffect(() => {
    if (!mounted || items.length === 0) return;
    track("begin_checkout", {
      currency: "PEN",
      value: totals.total,
      items: items.map((i) => ({ item_id: i.slug, item_name: i.name, price: i.unitPrice, quantity: i.qty })),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted]);

  useEffect(() => {
    const abandon = () => {
      const pending = pendingPayment.current;
      if (pending) void markCheckoutStopped(pending.code, pending.paymentSession, "abandoned");
    };
    window.addEventListener("pagehide", abandon);
    return () => window.removeEventListener("pagehide", abandon);
  }, []);

  if (mounted && items.length === 0) {
    return (
      <div className="mx-auto max-w-md px-4 py-20 text-center">
        <h1 className="text-3xl">No hay nada que pagar</h1>
        <p className="mt-3 text-cacao-500">Tu carrito está vacío.</p>
        <Link
          href="/tortas"
          className="mt-8 inline-flex h-14 items-center rounded-full bg-dorado px-8 font-semibold text-cacao"
        >
          Ver las tortas
        </Link>
      </div>
    );
  }

  function validate(): FieldErrors {
    const e: FieldErrors = {};
    if (name.trim().length < 3) e.name = "Escribe tu nombre completo.";
    if (!/^9\d{8}$/.test(phone.replace(/\D/g, ""))) e.phone = "Celular de 9 dígitos, empieza con 9.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) e.email = "Ingresa un correo válido.";
    if (delivery.method === "delivery") {
      if (distanceMode) {
        if (!coordinates || !distanceQuote?.covered) {
          e.address = quoteError || "Marca el punto exacto de entrega en el mapa.";
        }
      } else if (!delivery.districtSlug) e.district = "Elige tu distrito.";
      if (address.trim().length < 6) e.address = "Escribe la dirección completa.";
    }
    if (!delivery.dateISO) e.date = "Elige el día de entrega.";
    else if (!delivery.slotId) e.slot = "Elige una franja horaria.";
    return e;
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);

    const found = validate();
    setErrors(found);
    if (Object.keys(found).length) {
      document.getElementById(`field-${Object.keys(found)[0]}`)?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
      return;
    }

    setSubmitting(true);
    try {
      /* 1. O servidor recalcula os preços e devolve o código do pedido. */
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer: { name, phone, email },
          delivery: {
            method: delivery.method,
            dateISO: delivery.dateISO,
            slotId: delivery.slotId,
            districtSlug: delivery.districtSlug,
            address,
            reference,
            coordinates,
          },
          lines: items.map((i) => ({
            slug: i.slug,
            sizeSlug: i.sizeSlug,
            qty: i.qty,
            cakeMessage: i.cakeMessage,
            photoUrl: i.photoUrl,
            flavors: i.flavors,
            custom: i.custom ?? null,
          })),
          addons: addons.map((a) => ({ addonId: a.addonId, qty: a.qty, message: a.message })),
          paymentMethod: payment,
          notes,
          idempotencyKey: idempotencyKey.current,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setFormError(data.error ?? "No pudimos registrar tu pedido.");
        if (data.field) setErrors({ [data.field]: data.error });
        /* Pedido recusado: a próxima tentativa é outra compra, não a mesma. */
        idempotencyKey.current = crypto.randomUUID();
        return;
      }

      track("add_payment_info", { currency: "PEN", value: totals.total, payment_type: payment });

      /* 2. Transferência não passa por gateway: o pedido fica aguardando o
            comprovante, e as instruções aparecem na tela de confirmação. */
      if (payment === "transfer") {
        clear();
        router.push(`/pedido/${data.code}`);
        return;
      }

      /* 3. Cartão: tokeniza no navegador e cobra no servidor. */
      pendingPayment.current = {
        code: data.code,
        paymentSession: data.paymentSession ?? idempotencyKey.current,
      };
      const result = await culqiCharge({
        code: data.code,
        amount: data.totals.total,
        email,
        description: `Pedido ${data.code}`,
        paymentSession: data.paymentSession ?? idempotencyKey.current,
      });

      if (result.status !== "paid") {
        pendingPayment.current = null;
        setFormError(result.error ?? "El pago no pudo completarse.");
        return;
      }

      clear();
      pendingPayment.current = null;
      router.push(`/pedido/${data.code}`);
    } catch {
      setFormError("Hubo un problema de conexión. Tu pedido no fue cobrado; intenta de nuevo.");
    } finally {
      setSubmitting(false);
    }
  }

  async function selectCoordinates(nextCoordinates: DeliveryCoordinates) {
    setCoordinates(nextCoordinates);
    setDistanceQuote(null);
    setQuoteError(null);
    if (!distanceMode) return;

    setQuoteLoading(true);
    try {
      const response = await fetch("/api/delivery/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...nextCoordinates, subtotal: districtTotals.subtotal }),
      });
      const data = await response.json();
      if (!response.ok) {
        setQuoteError(data.error ?? "No pudimos calcular el delivery.");
        if (typeof data.distanceKm === "number") setDistanceQuote(data as DistanceQuote);
        return;
      }
      setDistanceQuote(data as DistanceQuote);
      setErrors((current) => ({ ...current, address: "" }));
    } catch {
      setQuoteError("No pudimos validar la dirección. Intenta de nuevo.");
    } finally {
      setQuoteLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8" noValidate>
      <h1 className="text-4xl sm:text-[2.75rem]">Finaliza tu pedido</h1>

      <ol className="mt-6 flex items-center gap-3 text-sm">
        {STEPS.map((label, i) => {
          const state = i < 1 ? "done" : i === 1 ? "current" : "next";
          return (
            <li key={label} className="flex items-center gap-3">
              <span className="flex items-center gap-2">
                <span
                  className={cx(
                    "grid h-7 w-7 place-items-center rounded-full text-[13px] font-bold",
                    state === "done" && "bg-cacao text-crema",
                    state === "current" && "bg-dorado text-cacao",
                    state === "next" && "border border-crema-300 bg-white text-cacao-300",
                  )}
                >
                  {state === "done" ? <IconCheck className="h-4 w-4" /> : i + 1}
                </span>
                <span className={cx(state === "next" ? "text-cacao-300" : "font-medium")}>{label}</span>
              </span>
              {i < STEPS.length - 1 && <span className="h-px w-8 bg-crema-300 sm:w-14" />}
            </li>
          );
        })}
      </ol>

      <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_400px] lg:items-start">
        <div className="space-y-6">
          <Section icon={<IconUser className="h-[18px] w-[18px]" />} title="Datos de contacto">
            <div className="grid gap-4 sm:grid-cols-3">
              <Field id="field-name" label="Nombre completo" error={errors.name}>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ej. María Fernanda García"
                  autoComplete="name"
                  aria-invalid={Boolean(errors.name)}
                />
              </Field>
              <Field id="field-phone" label="Celular" error={errors.phone}>
                <Input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="987 654 321"
                  inputMode="numeric"
                  autoComplete="tel"
                  aria-invalid={Boolean(errors.phone)}
                />
              </Field>
              <Field id="field-email" label="Correo" error={errors.email}>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="maria@gmail.com"
                  autoComplete="email"
                  aria-invalid={Boolean(errors.email)}
                />
              </Field>
            </div>
            <p className="mt-3 text-[13px] text-cacao-300">
              Te avisamos por WhatsApp cuando la torta salga para tu dirección.
            </p>
          </Section>

          <Section icon={<IconPin className="h-[18px] w-[18px]" />} title="Entrega">
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  { id: "delivery", label: "Delivery", icon: <IconTruck className="h-[18px] w-[18px]" /> },
                  { id: "pickup", label: "Recojo en tienda", icon: <IconStore className="h-[18px] w-[18px]" /> },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  aria-pressed={delivery.method === opt.id}
                  onClick={() => setDelivery({ method: opt.id as DeliveryMethod })}
                  className={cx(
                    "flex h-12 items-center justify-center gap-2 rounded-xl border text-sm font-medium transition-colors",
                    delivery.method === opt.id
                      ? "border-dorado-600 bg-dorado-100"
                      : "border-crema-300 bg-white text-cacao-700 hover:border-cacao/30",
                  )}
                >
                  {opt.icon}
                  {opt.label}
                </button>
              ))}
            </div>

            {delivery.method === "delivery" ? (
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                {!distanceMode && (
                  <Field id="field-district" label="Distrito" error={errors.district}>
                    <Select
                      value={delivery.districtSlug ?? ""}
                      onChange={(e) => setDelivery({ districtSlug: e.target.value || null })}
                      aria-invalid={Boolean(errors.district)}
                    >
                      <option value="">Selecciona tu distrito</option>
                      {config.districts.map((d) => (
                        <option key={d.slug} value={d.slug}>
                          {d.name} — {soles(d.fee)}
                        </option>
                      ))}
                    </Select>
                  </Field>
                )}
                <div className={distanceMode ? "sm:col-span-2" : undefined}>
                  <Field
                    id="field-address"
                    label="Dirección"
                    hint="(escribe y elige de la lista)"
                    error={errors.address}
                  >
                    <AddressAutocomplete
                      value={address}
                      onChange={setAddress}
                      onSelect={(place) => {
                        setAddress(place.address);
                        void selectCoordinates({ lat: place.lat, lng: place.lng });
                      }}
                      invalid={Boolean(errors.address)}
                    />
                  </Field>
                  {quoteLoading && (
                    <p className="mt-1.5 text-[13px] text-cacao-500">Calculando la ruta…</p>
                  )}
                  {distanceQuote?.covered && (
                    <p className="mt-1.5 text-[13px] text-verde">
                      Dentro de cobertura · {distanceQuote.distanceKm} km desde {distanceQuote.storeName}
                    </p>
                  )}
                  {quoteError && <p className="mt-1.5 text-[13px] text-terracota">{quoteError}</p>}
                </div>
                {config.distance.stores.length > 0 && (
                  <div className="sm:col-span-2">
                    <CheckoutMapPicker
                      stores={config.distance.stores}
                      maxDistanceKm={config.distance.maxDistanceKm}
                      value={coordinates}
                      onChange={selectCoordinates}
                      invalid={Boolean(errors.address && distanceMode && !coordinates)}
                      required={distanceMode}
                    />
                  </div>
                )}
                <div className="sm:col-span-2">
                  <Field id="field-reference" label="Referencia" hint="(opcional)">
                    <Input
                      value={reference}
                      onChange={(e) => setReference(e.target.value)}
                      placeholder="Frente a la clínica, portón blanco"
                    />
                  </Field>
                </div>
              </div>
            ) : (
              <p className="mt-4 flex items-start gap-2.5 rounded-xl bg-crema-100 px-4 py-3 text-sm text-cacao-700">
                <IconStore className="mt-0.5 h-[18px] w-[18px] shrink-0 text-dorado-600" />
                Recoges en nuestra tienda dentro de la franja que elijas. Te enviamos la dirección
                exacta por WhatsApp al confirmar.
              </p>
            )}

            <div className="mt-5 border-t border-crema-200 pt-5" id="field-date">
              <DeliveryPicker
                leadTimeHours={leadTime}
                method={delivery.method}
                dateISO={delivery.dateISO}
                slotId={delivery.slotId}
                onMethodChange={(m) => setDelivery({ method: m })}
                onDateChange={(iso) => setDelivery({ dateISO: iso, slotId: null })}
                onSlotChange={(id) => setDelivery({ slotId: id })}
                error={errors.date ?? errors.slot}
              />
            </div>

            <div className="mt-5">
              <FieldLabel hint="(opcional)">Notas para el pedido</FieldLabel>
              <Textarea
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Ej. Es una sorpresa, no toques el timbre."
              />
            </div>
          </Section>

          <Section icon={<IconCard className="h-[18px] w-[18px]" />} title="Método de pago">
            <div className="space-y-2.5">
              <PaymentOption
                selected={payment === "card"}
                onSelect={() => setPayment("card")}
                icon={<IconCard className="h-5 w-5" />}
                title="Tarjeta de crédito o débito"
                subtitle="Visa, Mastercard, American Express"
                marks={["VISA", "Mastercard", "AMEX"]}
              />
              {transferEnabled && (
                <PaymentOption
                  selected={payment === "transfer"}
                  onSelect={() => setPayment("transfer")}
                  icon={<IconBank className="h-5 w-5" />}
                  title="Transferencia o billetera"
                  subtitle="Yape, Plin, BCP o Interbank — confirmas enviando el comprobante"
                  marks={["Yape", "Plin", "BCP", "Interbank"]}
                />
              )}
            </div>

            <p className="mt-4 flex items-start gap-2 text-[13px] text-cacao-300">
              <IconLock className="mt-px h-4 w-4 shrink-0" />
              No almacenamos los datos de tu tarjeta. El cobro se procesa cifrado por nuestro
              procesador de pagos.
            </p>

            {payment === "card" && !culqiConfigured && (
              <p className="mt-3 rounded-lg bg-dorado-100 px-3.5 py-2.5 text-[13px] text-cacao-700">
                <strong>Modo demostración:</strong> falta configurar las llaves de Culqi, así que el
                pago se aprobará sin cobrar. Ver <code className="font-mono">.env.example</code>.
              </p>
            )}
          </Section>
        </div>

        <aside className="card p-6 lg:sticky lg:top-[100px]" ref={summaryRef}>
          <div className="flex items-baseline justify-between">
            <h2 className="text-2xl">Tu pedido</h2>
            <Link href="/carrito" className="text-sm text-terracota underline underline-offset-4">
              Editar
            </Link>
          </div>

          <ul className="mt-5 space-y-4 border-b border-crema-200 pb-5">
            {mounted &&
              items.map((i) => (
                <li key={i.key} className="flex gap-3">
                  <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-crema-100">
                    <Image src={cdnImage(i.image, 160)} alt="" fill sizes="64px" className="object-cover" />
                    <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-cacao px-1 text-[11px] font-bold text-crema">
                      {i.qty}
                    </span>
                  </div>
                  <div className="min-w-0 flex-1 text-sm">
                    <p className="font-display text-[1.05rem] leading-snug">{i.name}</p>
                    {i.sizeLabel && (
                      <p className="text-[13px] text-cacao-500">
                        {i.sizeLabel} · {i.sizeServes}
                      </p>
                    )}
                    {i.cakeMessage && (
                      <p className="truncate text-[13px] text-terracota">“{i.cakeMessage}”</p>
                    )}
                  </div>
                  <p className="shrink-0 text-sm font-medium">{soles(i.unitPrice * i.qty)}</p>
                </li>
              ))}

            {mounted &&
              addons.map((a) => (
                <li key={a.addonId} className="flex justify-between text-sm">
                  <span className="text-cacao-500">
                    {a.name} × {a.qty}
                  </span>
                  <span className="font-medium">{soles(a.unitPrice * a.qty)}</span>
                </li>
              ))}
          </ul>

          {mounted && delivery.dateISO && slot && (
            <p className="mt-4 flex items-start gap-2 rounded-lg bg-dorado-100 px-3.5 py-3 text-[13px] text-cacao-700">
              <IconCalendar className="mt-px h-4 w-4 shrink-0 text-dorado-600" />
              <span>
                <strong className="block font-semibold text-cacao">{formatDateLong(delivery.dateISO)}</strong>
                {slot.label}
              </span>
            </p>
          )}

          <dl className="mt-5 space-y-2.5 text-[15px]">
            <div className="flex justify-between">
              <dt className="text-cacao-500">Subtotal</dt>
              <dd className="font-medium">{soles(totals.subtotal)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-cacao-500">
                {delivery.method === "pickup"
                  ? "Recojo"
                  : distanceQuote?.storeName
                    ? `Delivery · ${distanceQuote.distanceKm} km`
                    : `Delivery${district ? ` · ${district.name}` : ""}`}
              </dt>
              <dd className="font-medium">
                {totals.shipping === null ? (
                  <span className="text-cacao-300">
                    {distanceMode ? "Valida tu dirección" : "Elige tu distrito"}
                  </span>
                ) : totals.shipping === 0 ? (
                  <span className="text-verde">Gratis</span>
                ) : (
                  soles(totals.shipping)
                )}
              </dd>
            </div>
          </dl>

          <div className="mt-4 flex items-baseline justify-between border-t border-crema-200 pt-4">
            <span className="font-display text-2xl">Total</span>
            <span className="font-display text-3xl font-semibold">{soles(totals.total)}</span>
          </div>

          {formError && (
            <p role="alert" className="mt-4 rounded-lg bg-terracota/10 px-3.5 py-3 text-sm font-medium text-terracota-700">
              {formError}
            </p>
          )}

          <Button
            type="submit"
            size="lg"
            className="mt-5 w-full"
            disabled={
              submitting ||
              quoteLoading ||
              (payment === "card" && culqiConfigured && !culqiReady)
            }
          >
            {submitting ? (
              "Procesando..."
            ) : (
              <>
                <IconLock className="h-[18px] w-[18px]" />
                {payment === "transfer" ? "Confirmar pedido" : `Pagar ${soles(totals.total)}`}
              </>
            )}
          </Button>

          {/* Checklist 12: políticas e consentimentos visíveis no checkout. As
              páginas já existiam; faltava dizer aqui que o pedido as aceita. */}
          <p className="mt-3 text-center text-[13px] leading-relaxed text-cacao-300">
            Al confirmar aceptas los{" "}
            <Link href="/terminos-y-condiciones" className="underline underline-offset-2 hover:text-cacao">
              Términos y condiciones
            </Link>{" "}
            y la{" "}
            <Link href="/politicas-de-privacidad" className="underline underline-offset-2 hover:text-cacao">
              Política de privacidad
            </Link>
            . Tus datos están protegidos con cifrado SSL.
          </p>
          <PaymentMarks
            only={transferEnabled ? undefined : ["VISA", "Mastercard", "AMEX"]}
            className="mt-4 justify-center"
          />
        </aside>
      </div>
    </form>
  );
}

/* -------------------------------------------------------------------------- */

function Section({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="card p-5 sm:p-6">
      <h2 className="flex items-center gap-3 text-xl">
        <span className="grid h-9 w-9 place-items-center rounded-full bg-dorado text-cacao">{icon}</span>
        {title}
      </h2>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label id={id} className="block scroll-mt-28">
      <FieldLabel hint={hint}>{label}</FieldLabel>
      {children}
      {error && (
        <span role="alert" className="mt-1.5 block text-[13px] font-medium text-terracota">
          {error}
        </span>
      )}
    </label>
  );
}

function PaymentOption({
  selected,
  onSelect,
  icon,
  title,
  subtitle,
  marks,
}: {
  selected: boolean;
  onSelect: () => void;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  marks: string[];
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cx(
        "flex w-full items-center gap-3.5 rounded-xl border px-4 py-3.5 text-left transition-colors",
        selected ? "border-dorado-600 bg-dorado-100" : "border-crema-300 bg-white hover:border-cacao/30",
      )}
    >
      <span
        className={cx(
          "grid h-5 w-5 shrink-0 place-items-center rounded-full border-2",
          selected ? "border-dorado-600" : "border-crema-300",
        )}
      >
        {selected && <span className="h-2.5 w-2.5 rounded-full bg-dorado-600" />}
      </span>
      <span className="shrink-0 text-cacao-700">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-medium">{title}</span>
        <span className="mt-0.5 block text-[13px] leading-snug text-cacao-500">{subtitle}</span>
      </span>
      <PaymentMarks only={marks} className="hidden shrink-0 sm:flex" />
    </button>
  );
}
