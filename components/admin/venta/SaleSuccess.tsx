"use client";

import Link from "next/link";
import { PAYMENT_METHOD } from "@/lib/gestion/labels";
import { Notice } from "@/components/admin/ui";
import { money } from "./money";
import type { SaleReceipt } from "./types";

/**
 * Venda gravada. O vuelto é o número maior da tela: é o que a vendedora
 * precisa ler com o cliente estendendo a mão, não o número da venda.
 */
export function SaleSuccess({
  receipt,
  storeName,
  onNewSale,
}: {
  receipt: SaleReceipt;
  storeName: string;
  onNewSale: () => void;
}) {
  const cashReceived = (method: string, amount: number) => (method === "cash" ? amount + receipt.changeCents : amount);

  return (
    <div className="mx-auto max-w-lg space-y-4">
      {receipt.recovered && (
        <Notice tone="ok">
          La venta ya había quedado registrada antes de que se cortara la conexión. No se cobró dos veces.
        </Notice>
      )}
      <section className="card p-6 text-center" aria-live="polite">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-verde-100 text-verde">
          <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="m5 12.5 4.5 4.5L19 7.5" />
          </svg>
        </div>
        <p className="mt-3 text-sm text-cacao-500">
          Venta registrada · {storeName}
          {receipt.kind === "staff" && " · Personal"}
        </p>
        <h2 className="mt-1 font-display text-3xl">N.º {receipt.number}</h2>
        <p className="mt-1 text-cacao-700">
          Total <span className="font-semibold tabular-nums">{money(receipt.totalCents)}</span>
        </p>

        {receipt.changeCents > 0 ? (
          <div className="mt-5 rounded-2xl border border-dorado-600/40 bg-dorado-100 px-4 py-5">
            <p className="text-[12px] font-bold uppercase tracking-[0.12em] text-cacao-700">Vuelto</p>
            <p className="mt-1 font-display text-5xl font-semibold tabular-nums text-cacao sm:text-6xl">
              {money(receipt.changeCents)}
            </p>
          </div>
        ) : (
          <p className="mt-5 rounded-2xl bg-crema-100 px-4 py-3 text-sm font-medium text-cacao-500">Sin vuelto</p>
        )}

        {!!receipt.payments.length && (
          <ul className="mt-4 space-y-1 text-sm">
            {receipt.payments.map((p, i) => (
              <li key={i} className="flex justify-between gap-3 text-cacao-700">
                <span>{PAYMENT_METHOD[p.method]}{p.method === "cash" && receipt.changeCents > 0 ? " recibido" : ""}</span>
                <span className="tabular-nums">{money(cashReceived(p.method, p.amountCents))}</span>
              </li>
            ))}
          </ul>
        )}
        {receipt.customerName && <p className="mt-3 text-sm text-cacao-500">Cliente: {receipt.customerName}</p>}
      </section>

      <Notice tone="warn">Boleta pendiente: se emitirá cuando se active Close2U.</Notice>

      <button
        type="button"
        onClick={onNewSale}
        className="h-14 w-full rounded-full bg-cacao text-base font-semibold text-crema transition-colors hover:bg-cacao-700"
      >
        Nueva venta
      </button>
      <Link
        href={`/admin/ventas/${receipt.id}`}
        className="flex h-11 items-center justify-center text-sm font-medium text-terracota underline underline-offset-4"
      >
        Ver detalle de la venta
      </Link>
    </div>
  );
}
