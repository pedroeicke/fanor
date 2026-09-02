"use client";

import Image from "next/image";
import Link from "next/link";
import { computeTotals, useCart } from "@/lib/cart";
import { ADDONS } from "@/lib/addons";
import { findDistrict, formatDateLong, slotsForDate } from "@/lib/delivery";
import { useDeliveryConfig } from "@/components/delivery/DeliveryConfigProvider";
import { cdnImage, soles } from "@/lib/format";
import { ButtonLink } from "@/components/ui/primitives";
import {
  IconCake,
  IconCamera,
  IconCalendar,
  IconLock,
  IconMessage,
  IconMinus,
  IconPlus,
  IconRuler,
  IconStore,
  IconTrash,
  IconTruck,
} from "@/components/ui/icons";
import { AddonArt } from "./AddonArt";
import { useHydrated } from "@/lib/use-hydrated";

export function CartView() {
  const { items, addons, delivery, setQty, removeItem, addAddon, setAddonQty } = useCart();
  const config = useDeliveryConfig();
  const totals = computeTotals(items, addons, delivery, config);
  const district = findDistrict(config, delivery.districtSlug);
  const slot = delivery.slotId
    ? slotsForDate(config, delivery.dateISO ?? "").find((s) => s.id === delivery.slotId)
    : null;

  /* O carrinho vive no localStorage: só renderiza depois de hidratar. */
  const mounted = useHydrated();

  if (!mounted) {
    return <div className="mx-auto max-w-7xl px-4 py-24 text-center text-cacao-300">Cargando tu pedido…</div>;
  }

  if (items.length === 0) {
    return (
      <div className="mx-auto max-w-md px-4 py-20 text-center">
        <h1 className="text-3xl">Tu carrito está vacío</h1>
        <p className="mt-3 text-cacao-500">
          Elige una torta, escoge la fecha de entrega y nosotros nos encargamos del resto.
        </p>
        <ButtonLink href="/tortas" size="lg" className="mt-8">
          Ver todas las tortas
        </ButtonLink>
      </div>
    );
  }

  const suggested = ADDONS.filter((a) => !addons.some((x) => x.addonId === a.id));

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <h1 className="text-4xl sm:text-[2.75rem]">Tu pedido</h1>
      <p className="mt-2 text-cacao-500">Revisa cada detalle antes de continuar.</p>

      <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_380px] lg:items-start">
        <div className="space-y-4">
          {items.map((item) => (
            <article key={item.key} className="card flex flex-col gap-4 p-4 sm:flex-row">
              <Link
                href={`/tortas/${item.slug}`}
                className="relative aspect-square w-full shrink-0 overflow-hidden rounded-xl bg-crema-100 sm:h-[136px] sm:w-[136px]"
              >
                <Image
                  src={cdnImage(item.image, 320)}
                  alt={item.name}
                  fill
                  sizes="(min-width:640px) 136px, 100vw"
                  className="object-cover"
                />
              </Link>

              <div className="flex min-w-0 flex-1 flex-col">
                <div className="flex items-start justify-between gap-3">
                  <h2 className="font-display text-xl leading-snug">
                    <Link href={`/tortas/${item.slug}`} className="hover:text-cacao-700">
                      {item.name}
                    </Link>
                  </h2>
                  <button
                    type="button"
                    onClick={() => removeItem(item.key)}
                    className="shrink-0 p-1.5 text-cacao-300 transition-colors hover:text-terracota"
                    aria-label={`Quitar ${item.name} del pedido`}
                  >
                    <IconTrash className="h-[18px] w-[18px]" />
                  </button>
                </div>

                {/* Cada detalhe da personalização visível na linha: se algo está
                    errado, a hora de descobrir é aqui, não na entrega. */}
                <ul className="mt-2.5 space-y-1.5 text-sm">
                  {item.sizeLabel && (
                    <Detail icon={<IconRuler className="h-4 w-4" />}>
                      {item.sizeLabel} · {item.sizeServes}
                    </Detail>
                  )}
                  {item.flavors.length > 0 && (
                    <Detail icon={<IconCake className="h-4 w-4" />}>{item.flavors.join(" · ")}</Detail>
                  )}
                  <Detail icon={delivery.method === "pickup" ? <IconStore className="h-4 w-4" /> : <IconTruck className="h-4 w-4" />}>
                    {delivery.method === "pickup" ? "Recojo en tienda" : "Delivery"}
                    {delivery.dateISO && <> · {formatDateLong(delivery.dateISO)}</>}
                  </Detail>
                  {item.cakeMessage && (
                    <Detail icon={<IconMessage className="h-4 w-4" />}>
                      <span className="text-cacao-500">Mensaje: </span>
                      <span className="text-terracota">“{item.cakeMessage}”</span>
                    </Detail>
                  )}
                  {item.photoName && (
                    <Detail icon={<IconCamera className="h-4 w-4" />}>
                      <span className="text-cacao-500">Foto: </span>
                      {item.photoName}
                    </Detail>
                  )}
                </ul>

                <div className="mt-auto flex items-center justify-between gap-4 pt-4">
                  <QtyStepper value={item.qty} onChange={(q) => setQty(item.key, q)} label={item.name} />
                  <p className="font-display text-xl font-semibold">{soles(item.unitPrice * item.qty)}</p>
                </div>
              </div>
            </article>
          ))}

          {addons.map((a) => (
            <article key={a.addonId} className="card flex items-center gap-4 p-4">
              <span className="grid h-16 w-16 shrink-0 place-items-center rounded-xl bg-crema-100">
                <AddonArt art={ADDONS.find((x) => x.id === a.addonId)?.art ?? "velas"} className="h-10 w-10" />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="font-display text-lg">{a.name}</h2>
                <p className="text-[13px] text-cacao-500">{a.detail}</p>
              </div>
              <QtyStepper value={a.qty} onChange={(q) => setAddonQty(a.addonId, q)} label={a.name} compact />
              <p className="w-20 text-right font-medium">{soles(a.unitPrice * a.qty)}</p>
            </article>
          ))}

          {suggested.length > 0 && (
            <section className="pt-6">
              <h2 className="text-2xl">¿Olvidaste algo?</h2>
              <p className="mt-1.5 text-cacao-500">Complementa tu pedido y hazlo aún más especial.</p>
              <ul className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {suggested.map((a) => (
                  <li key={a.id} className="card flex items-center gap-3.5 p-3.5">
                    <span className="grid h-16 w-16 shrink-0 place-items-center rounded-xl bg-crema-100">
                      <AddonArt art={a.art} className="h-10 w-10" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-display text-[1.05rem] leading-snug">{a.name}</span>
                      <span className="mt-0.5 block text-[13px] leading-snug text-cacao-500">{a.detail}</span>
                      <span className="mt-1 block font-semibold">{soles(a.price)}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => addAddon(a.id)}
                      className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-crema-100 text-cacao transition-colors hover:bg-dorado"
                      aria-label={`Agregar ${a.name}`}
                    >
                      <IconPlus className="h-[18px] w-[18px]" />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <aside className="card p-6 lg:sticky lg:top-[100px]">
          <h2 className="text-2xl">Resumen</h2>

          <dl className="mt-5 space-y-3 border-b border-crema-200 pb-5 text-[15px]">
            <div className="flex justify-between">
              <dt className="text-cacao-500">Subtotal</dt>
              <dd className="font-medium">{soles(totals.subtotal)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-cacao-500">
                {delivery.method === "pickup" ? "Recojo en tienda" : "Delivery"}
              </dt>
              <dd className="text-right font-medium">
                {totals.shipping === null ? (
                  <span className="text-cacao-300">Se calcula con tu distrito</span>
                ) : totals.shipping === 0 ? (
                  <span className="text-verde">Gratis</span>
                ) : (
                  soles(totals.shipping)
                )}
              </dd>
            </div>
            {district && (
              <p className="text-[13px] text-cacao-300">Entrega en {district.name}</p>
            )}
            {slot && delivery.dateISO && (
              <p className="flex items-start gap-2 rounded-lg bg-dorado-100 px-3 py-2.5 text-[13px] text-cacao-700">
                <IconCalendar className="mt-px h-4 w-4 shrink-0 text-dorado-600" />
                {formatDateLong(delivery.dateISO)} · {slot.label}
              </p>
            )}
          </dl>

          <div className="mt-5 flex items-baseline justify-between">
            <span className="font-display text-2xl">Total</span>
            <span className="font-display text-3xl font-semibold">{soles(totals.total)}</span>
          </div>

          {totals.freeShippingGap > 0 && delivery.method === "delivery" && (
            <p className="mt-3 rounded-lg bg-crema-100 px-3.5 py-2.5 text-[13px] text-cacao-700">
              Agrega {soles(totals.freeShippingGap)} más y el delivery corre por nuestra cuenta.
            </p>
          )}

          {/* Sem `begin_checkout` aqui: o checkout já o emite ao montar, e
              disparar nos dois lugares contava cada início duas vezes. */}
          <ButtonLink href="/checkout" size="lg" className="mt-5 w-full">
            Continuar con el pago
          </ButtonLink>

          <p className="mt-3 flex items-center justify-center gap-2 text-[13px] text-cacao-300">
            <IconLock className="h-4 w-4" />
            Compra segura y protegida
          </p>

          <Link
            href="/tortas"
            className="mt-4 block text-center text-sm text-cacao-500 underline underline-offset-4 hover:text-cacao"
          >
            Seguir comprando
          </Link>
        </aside>
      </div>
    </div>
  );
}

function Detail({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2.5">
      <span className="mt-0.5 shrink-0 text-dorado-600">{icon}</span>
      <span className="min-w-0">{children}</span>
    </li>
  );
}

function QtyStepper({
  value,
  onChange,
  label,
  compact = false,
}: {
  value: number;
  onChange: (q: number) => void;
  label: string;
  compact?: boolean;
}) {
  return (
    <div className={`flex items-center rounded-full border border-crema-300 bg-white ${compact ? "h-9" : "h-11"}`}>
      <button
        type="button"
        onClick={() => onChange(value - 1)}
        className={`grid h-full place-items-center rounded-l-full text-cacao-700 ${compact ? "w-9" : "w-11"}`}
        aria-label={`Disminuir cantidad de ${label}`}
      >
        <IconMinus className="h-3.5 w-3.5" />
      </button>
      <span className="w-7 text-center text-sm font-semibold tabular-nums">{value}</span>
      <button
        type="button"
        onClick={() => onChange(value + 1)}
        className={`grid h-full place-items-center rounded-r-full text-cacao-700 ${compact ? "w-9" : "w-11"}`}
        aria-label={`Aumentar cantidad de ${label}`}
      >
        <IconPlus className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
