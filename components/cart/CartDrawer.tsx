"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect } from "react";
import { computeTotals, useCart } from "@/lib/cart";
import { formatDateLong } from "@/lib/delivery";
import { useDeliveryConfig } from "@/components/delivery/DeliveryConfigProvider";
import { cdnImage, soles } from "@/lib/format";
import { Button, ButtonLink } from "@/components/ui/primitives";
import { IconCalendar, IconCheck, IconClose, IconTruck } from "@/components/ui/icons";

/**
 * Gaveta que confirma a adição sem tirar a pessoa da vitrine.
 * O site antigo empurrava para a página do carrinho a cada item, o que
 * interrompia a navegação e derrubava o número de itens por pedido.
 */
export function CartDrawer() {
  const { drawerOpen, closeDrawer, items, addons, delivery } = useCart();
  const config = useDeliveryConfig();
  const totals = computeTotals(items, addons, delivery, config);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeDrawer();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [drawerOpen, closeDrawer]);

  if (!drawerOpen) return null;

  const last = items[items.length - 1];

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Carrito">
      <button className="absolute inset-0 bg-cacao/40" onClick={closeDrawer} aria-label="Cerrar" />

      <aside className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col bg-crema shadow-lift">
        <header className="flex items-center justify-between border-b border-crema-200 px-5 py-4">
          <p className="flex items-center gap-2 font-display text-lg">
            <span className="grid h-7 w-7 place-items-center rounded-full bg-verde-100 text-verde">
              <IconCheck className="h-4 w-4" />
            </span>
            Añadido a tu pedido
          </p>
          <button onClick={closeDrawer} className="p-2" aria-label="Cerrar">
            <IconClose className="h-5 w-5" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-5">
          {last && (
            <div className="flex gap-4 rounded-2xl border border-crema-200 bg-white p-3">
              <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-crema-100">
                <Image src={cdnImage(last.image, 200)} alt={last.name} fill sizes="80px" className="object-cover" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-display text-[1.05rem] leading-snug">{last.name}</p>
                {last.sizeLabel && (
                  <p className="mt-0.5 text-[13px] text-cacao-500">
                    {last.sizeLabel} · {last.sizeServes}
                  </p>
                )}
                {last.cakeMessage && (
                  <p className="mt-1 truncate text-[13px] text-terracota">“{last.cakeMessage}”</p>
                )}
                <p className="mt-1 font-medium">{soles(last.unitPrice * last.qty)}</p>
              </div>
            </div>
          )}

          {delivery.dateISO && (
            <p className="mt-4 flex items-center gap-2.5 rounded-xl bg-dorado-100 px-4 py-3 text-sm text-cacao-700">
              <IconCalendar className="h-[18px] w-[18px] shrink-0 text-dorado-600" />
              Entrega el <strong className="font-semibold text-cacao">{formatDateLong(delivery.dateISO)}</strong>
            </p>
          )}

          {items.length > 1 && (
            <p className="mt-4 text-sm text-cacao-500">
              y {items.length - 1} {items.length === 2 ? "producto más" : "productos más"} en tu pedido.
            </p>
          )}

          {totals.freeShippingGap > 0 ? (
            <div className="mt-5 rounded-xl border border-crema-200 bg-white p-4">
              <p className="flex items-center gap-2 text-sm text-cacao-700">
                <IconTruck className="h-[18px] w-[18px] text-dorado-600" />
                Te faltan <strong>{soles(totals.freeShippingGap)}</strong> para el delivery de cortesía.
              </p>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-crema-200">
                <div
                  className="h-full rounded-full bg-dorado transition-[width] duration-500"
                  style={{ width: `${Math.min(100, (totals.subtotal / config.freeFrom) * 100)}%` }}
                />
              </div>
            </div>
          ) : (
            <p className="mt-5 flex items-center gap-2 rounded-xl bg-verde-100 px-4 py-3 text-sm font-medium text-verde">
              <IconTruck className="h-[18px] w-[18px]" />
              Delivery de cortesía incluido.
            </p>
          )}
        </div>

        <footer className="border-t border-crema-200 bg-white px-5 py-5">
          <div className="mb-4 flex items-baseline justify-between">
            <span className="text-cacao-500">Subtotal</span>
            <span className="font-display text-2xl font-semibold">{soles(totals.subtotal)}</span>
          </div>
          <ButtonLink href="/carrito" size="lg" className="w-full" onClick={closeDrawer}>
            Ver mi pedido
          </ButtonLink>
          <Button variant="ghost" size="sm" className="mt-1.5 w-full" onClick={closeDrawer}>
            Seguir comprando
          </Button>
          <p className="mt-3 text-center text-xs text-cacao-300">
            <Link href="/delivery" className="underline underline-offset-2" onClick={closeDrawer}>
              Costos y zonas de delivery
            </Link>
          </p>
        </footer>
      </aside>
    </div>
  );
}
