"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { findRecentSale, lookupCake, registerSale } from "@/app/admin/(panel)/venta/actions";
import { QrScanner } from "@/components/admin/QrScanner";
import { Notice, Section, inputClass, labelClass } from "@/components/admin/ui";
import { cx } from "@/lib/format";
import { limaToday } from "@/lib/gestion/dates";
import type { ParsedQr } from "@/lib/gestion/qr";
import { useHydrated } from "@/lib/use-hydrated";
import { CartList, type LineView } from "./CartList";
import { CustomerPicker } from "./CustomerPicker";
import { useSaleDraft } from "./draft-store";
import { daysBetween, expiryLabel, shortDay } from "./format";
import {
  MAX_CENTS,
  igvIncluded,
  lineTotal,
  money,
  parseMoney,
  parseQuantity,
  resolvePayments,
  settle,
  type CounterMethod,
} from "./money";
import { PaymentPanel } from "./PaymentPanel";
import { ProductSearch } from "./ProductSearch";
import { SaleSuccess } from "./SaleSuccess";
import type { CakeLookup, RegisterSaleInput, SellerOption, StoreOption } from "./types";

type Message = { tone: "ok" | "warn" | "bad"; text: string };

const LOST_CONNECTION =
  "Se perdió la conexión al cobrar y no sabemos si la venta quedó registrada. Al tocar Reintentar, primero revisamos si ya está grabada, para no cobrarla dos veces.";

/**
 * Tela do balcão.
 *
 * Uma ação principal: Cobrar. Todo o resto — escanear, buscar, cliente,
 * forma de pagamento — existe para chegar nela com o total certo. O botão só
 * libera quando a conta fecha, e diz o que falta quando não fecha.
 */
export function SaleCounter({
  stores,
  sellers,
  defaultStoreId,
  defaultSellerId,
}: {
  stores: StoreOption[];
  sellers: SellerOption[];
  defaultStoreId: string;
  defaultSellerId: string | null;
}) {
  const hydrated = useHydrated();
  const draft = useSaleDraft();
  const [pendingStore, setPendingStore] = useState<string | null>(null);
  const [scanMessage, setScanMessage] = useState<Message | null>(null);
  const [expiredCake, setExpiredCake] = useState<CakeLookup | null>(null);
  const [chargeError, setChargeError] = useState<string | null>(null);
  const [looking, startLookup] = useTransition();
  const [charging, startCharge] = useTransition();
  const inFlight = useRef(new Set<string>());
  /* O `charging` da transição só chega no próximo render; dois toques no
     mesmo quadro passariam os dois. A ref trava na hora. */
  const chargeLock = useRef(false);

  /* O rascunho vem do sessionStorage, que o servidor não enxerga: renderizar o
     carrinho antes da hidratação quebraria o HTML do servidor. */
  if (!hydrated) {
    return (
      <div className="card p-5 text-sm text-cacao-500" aria-busy="true">
        Cargando la venta…
      </div>
    );
  }

  /* Loja do rascunho se ainda existir; senão a da vendedora do login. */
  const resolveStore = (id: string | null) => (id && stores.some((s) => s.id === id) ? id : defaultStoreId);
  const storeId = resolveStore(draft.storeId);
  const store = stores.find((s) => s.id === storeId) ?? stores[0];

  const storeSellers = sellers.filter((s) => !s.storeId || s.storeId === storeId);
  const wantedSeller = draft.sellerId === null ? defaultSellerId : draft.sellerId;
  const sellerId = wantedSeller && storeSellers.some((s) => s.id === wantedSeller) ? wantedSeller : "";

  /* ---- Contas ---------------------------------------------------------- */

  const today = limaToday();
  const views: (LineView & { priceCents: number | null; discountCents: number | null; quantity: number | null })[] =
    draft.lines.map((line) => {
      const priceCents = parseMoney(line.price);
      const discountCents = line.discount.trim() === "" ? 0 : parseMoney(line.discount);
      const quantity = line.kind === "cake" ? 1 : parseQuantity(line.quantity);
      let totalCents: number | null = null;
      let error: string | null = null;
      if (quantity === null) error = "Cantidad inválida (de 1 a 999).";
      else if (priceCents === null) error = line.price.trim() ? "Precio inválido." : "Escribe el precio.";
      else if (discountCents === null) error = "Descuento inválido.";
      else {
        totalCents = lineTotal(quantity, priceCents, discountCents);
        if (totalCents === null) error = "El descuento supera el precio.";
      }
      return {
        line,
        totalCents,
        error,
        priceCents,
        discountCents,
        quantity,
        daysExpired: line.kind === "cake" ? daysBetween(line.expiresOn, today) : null,
      };
    });

  const totalCents = views.reduce((sum, v) => sum + (v.totalCents ?? 0), 0);
  const resolved = resolvePayments(totalCents, draft.payments);
  /* Pagamento automático zerado (o resto já está coberto) não vai ao banco. */
  const effectivePayments = draft.payments
    .map((payment, i) => ({ payment, cents: resolved[i] }))
    .filter((p): p is { payment: (typeof draft.payments)[number]; cents: number } => p.cents !== null && p.cents > 0);
  const invalidPayment = draft.payments.find((p, i) => resolved[i] === null && !p.auto);
  const settlement = settle(
    totalCents,
    effectivePayments.map((p) => ({ method: p.payment.method, cents: p.cents })),
  );

  const lineWithError = views.find((v) => v.error);
  const blocker = !views.length
    ? "Agrega al menos un producto."
    : lineWithError
      ? `${lineWithError.line.name}: ${lineWithError.error}`
      : draft.kind === "staff" && !sellerId
        ? "Elige la vendedora para la venta al personal."
        : totalCents > MAX_CENTS
          ? "El total es demasiado alto. Revisa los precios."
          : invalidPayment
            ? `Escribe un monto válido para ${invalidPayment.method === "cash" ? "el efectivo" : "el pago"}.`
            : totalCents > 0 && !effectivePayments.length
              ? "Elige la forma de pago."
              : settlement.error;

  /* ---- Loja ------------------------------------------------------------ */

  function clearMessages() {
    setScanMessage(null);
    setExpiredCake(null);
    setChargeError(null);
  }

  function chooseStore(id: string) {
    if (id === storeId) {
      setPendingStore(null);
      return;
    }
    if (draft.lines.length || draft.payments.length) {
      setPendingStore(id);
      return;
    }
    draft.setStore(id);
    clearMessages();
  }

  function confirmStore() {
    if (!pendingStore) return;
    draft.setStore(pendingStore);
    setPendingStore(null);
    clearMessages();
  }

  /* ---- Torta pelo QR --------------------------------------------------- */

  function handleScan(parsed: ParsedQr) {
    if (charging) {
      setScanMessage({ tone: "warn", text: "Espera: se está registrando la venta." });
      return;
    }
    if (parsed.type === "dispatch") {
      setScanMessage({ tone: "bad", text: "Ese QR es la guía del despacho. Escanea la etiqueta de la torta." });
      return;
    }
    const serial = parsed.serial;
    if (useSaleDraft.getState().lines.some((l) => l.kind === "cake" && l.serial === serial)) {
      setScanMessage({ tone: "warn", text: `La torta ${serial} ya está en el carrito.` });
      return;
    }
    if (inFlight.current.has(serial)) return;
    inFlight.current.add(serial);

    const scannedStore = storeId;
    startLookup(async () => {
      try {
        const result = await lookupCake(scannedStore, serial);
        /* Trocou de loja enquanto consultava: a torta era da loja anterior. */
        if (resolveStore(useSaleDraft.getState().storeId) !== scannedStore) return;
        if (!result.ok) {
          setScanMessage({ tone: "bad", text: result.error });
        } else if (result.data.expired) {
          setScanMessage(null);
          setExpiredCake(result.data);
        } else {
          addCake(result.data, false);
        }
      } catch {
        setScanMessage({ tone: "bad", text: "Sin conexión. Vuelve a escanear." });
      } finally {
        inFlight.current.delete(serial);
      }
    });
  }

  function addCake(cake: CakeLookup, expiredAccepted: boolean) {
    const added = useSaleDraft.getState().addCake(cake, expiredAccepted);
    if (!added) {
      setScanMessage({ tone: "warn", text: `La torta ${cake.serial} ya está en el carrito.` });
      return;
    }
    const flavor = cake.flavor ? ` · ${cake.flavor}` : "";
    setScanMessage(
      cake.daysExpired === 0
        ? { tone: "warn", text: `Agregada: ${cake.name}${flavor}. Vence hoy.` }
        : { tone: "ok", text: `Agregada: ${cake.name}${flavor} (${cake.serial}).` },
    );
  }

  /* ---- Pagamento ------------------------------------------------------- */

  function addPayment(method: CounterMethod) {
    if (method === "cash" && draft.payments.some((p) => p.method === "cash")) return;
    const freeze = Object.fromEntries(draft.payments.map((p, i) => [p.key, resolved[i] ?? 0]));
    draft.addPayment(method, freeze);
  }

  /* ---- Cobrar ---------------------------------------------------------- */

  function charge() {
    if (blocker || charging || chargeLock.current) return;
    const input: RegisterSaleInput = {
      clientRef: draft.clientRef,
      storeId,
      sellerId: sellerId || null,
      customerId: draft.customer?.id ?? null,
      kind: draft.kind,
      notes: draft.notes,
      lines: views.map((v) =>
        v.line.kind === "cake"
          ? {
              kind: "cake" as const,
              serial: v.line.serial,
              priceCents: v.priceCents ?? 0,
              discountCents: v.discountCents ?? 0,
              expiredAccepted: v.line.expiredAccepted,
            }
          : {
              kind: "item" as const,
              productId: v.line.productId,
              quantity: v.quantity ?? 1,
              priceCents: v.priceCents ?? 0,
              discountCents: v.discountCents ?? 0,
            },
      ),
      payments: effectivePayments.map((p) => ({
        method: p.payment.method,
        amountCents: p.cents,
        reference: p.payment.reference,
      })),
    };

    setChargeError(null);
    chargeLock.current = true;
    startCharge(async () => {
      const drafts = useSaleDraft.getState();
      try {
        /* Cobrança anterior sem resposta: se a venda já está gravada, mostra
           o recibo dela em vez de gravar outra. */
        if (drafts.unconfirmed) {
          const found = await findRecentSale(input);
          if (!found.ok) {
            setChargeError(found.error);
            return;
          }
          if (found.data) {
            clearMessages();
            drafts.finish(found.data);
            window.scrollTo({ top: 0, behavior: "smooth" });
            return;
          }
        }

        /* Marcado antes de enviar: se a aba cair no meio, o F5 ainda sabe
           que houve uma cobrança sem resposta. */
        drafts.setUnconfirmed(true);
        const result = await registerSale(input);
        if (!result.ok) {
          /* O banco respondeu: nada foi gravado (a operação é atômica). */
          drafts.setUnconfirmed(false);
          setChargeError(result.error);
          return;
        }
        clearMessages();
        drafts.finish(result.data);
        window.scrollTo({ top: 0, behavior: "smooth" });
      } catch {
        setChargeError(LOST_CONNECTION);
      } finally {
        chargeLock.current = false;
      }
    });
  }

  function newSale() {
    draft.newSale();
    clearMessages();
    window.scrollTo({ top: 0 });
  }

  if (draft.receipt) {
    return <SaleSuccess receipt={draft.receipt} storeName={store.name} onNewSale={newSale} />;
  }

  const busy = charging;
  const itemCount = views.reduce((sum, v) => sum + (v.quantity ?? 0), 0);

  return (
    <div className="space-y-5">
      {/* Loja, vendedora e tipo */}
      <section className="card space-y-4 p-4 sm:p-5">
        <div>
          <p className={labelClass} id="venta-tienda">Tienda</p>
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-labelledby="venta-tienda">
            {stores.map((s) => (
              <button
                key={s.id}
                type="button"
                role="radio"
                aria-checked={s.id === storeId}
                disabled={busy}
                onClick={() => chooseStore(s.id)}
                className={cx(
                  "h-12 rounded-xl border px-3 text-sm font-semibold leading-tight transition-colors",
                  s.id === storeId
                    ? "border-dorado bg-dorado text-cacao"
                    : "border-crema-300 bg-white text-cacao-700 hover:border-cacao/35",
                  busy && "opacity-60",
                )}
              >
                {s.name}
              </button>
            ))}
          </div>
        </div>

        {pendingStore && (
          <Notice tone="warn">
            <p>
              Cambiar a <strong>{stores.find((s) => s.id === pendingStore)?.name}</strong> vacía el carrito: las tortas
              escaneadas son de {store.name}.
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setPendingStore(null)}
                className="h-11 rounded-full border border-crema-300 bg-white text-sm font-semibold text-cacao-700"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirmStore}
                className="h-11 rounded-full bg-cacao text-sm font-semibold text-crema"
              >
                Cambiar y vaciar
              </button>
            </div>
          </Notice>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="venta-vendedora" className={labelClass}>Vendedora</label>
            <select
              id="venta-vendedora"
              value={sellerId}
              disabled={busy}
              onChange={(e) => draft.setSeller(e.target.value)}
              className={inputClass}
            >
              <option value="">{draft.kind === "staff" ? "Elige la vendedora" : "Sin vendedora"}</option>
              {storeSellers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            {!storeSellers.length && (
              <p className="mt-1 text-[13px] text-cacao-500">No hay vendedoras registradas en esta tienda.</p>
            )}
          </div>

          <button
            type="button"
            role="switch"
            aria-checked={draft.kind === "staff"}
            disabled={busy}
            onClick={() => draft.setKind(draft.kind === "staff" ? "counter" : "staff")}
            className={cx(
              "flex min-h-11 items-center gap-3 self-end rounded-xl border px-3 py-2 text-left transition-colors",
              draft.kind === "staff" ? "border-dorado-600 bg-dorado-100" : "border-crema-300 bg-white hover:border-cacao/35",
            )}
          >
            <span
              aria-hidden
              className={cx(
                "relative h-6 w-10 shrink-0 rounded-full transition-colors",
                draft.kind === "staff" ? "bg-cacao" : "bg-crema-300",
              )}
            >
              <span
                className={cx(
                  "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all",
                  draft.kind === "staff" ? "left-[1.125rem]" : "left-0.5",
                )}
              />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-cacao">Venta al personal</span>
              <span className="block text-[12px] text-cacao-500">Consumo del equipo; pide la vendedora.</span>
            </span>
          </button>
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)] lg:items-start">
        <div className="space-y-5">
          {/* Torta pela etiqueta */}
          <div className="space-y-3">
            <QrScanner onScan={handleScan} label="Escanear torta" />
            <div aria-live="polite" className="space-y-3">
              {looking && <p className="px-1 text-sm text-cacao-300">Buscando torta…</p>}
              {scanMessage && <Notice tone={scanMessage.tone}>{scanMessage.text}</Notice>}
              {expiredCake && (
                <div role="alertdialog" aria-labelledby="venta-vencida" className="card border-terracota/40 p-4">
                  <p id="venta-vencida" className="font-semibold text-terracota-700">
                    Torta vencida: {expiryLabel(expiredCake.daysExpired).toLowerCase()}. ¿Vender igual?
                  </p>
                  <p className="mt-1 text-sm text-cacao-700">
                    {expiredCake.name}
                    {expiredCake.flavor && ` · ${expiredCake.flavor}`} · serie{" "}
                    <span className="font-mono">{expiredCake.serial}</span> · vencía el {shortDay(expiredCake.expiresOn)}.
                  </p>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setExpiredCake(null);
                        setScanMessage({ tone: "warn", text: "No se agregó. Devuélvela al taller desde Mi vitrina." });
                      }}
                      className="h-11 rounded-full border border-crema-300 bg-white text-sm font-semibold text-cacao-700"
                    >
                      No agregar
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const cake = expiredCake;
                        setExpiredCake(null);
                        addCake(cake, true);
                      }}
                      className="h-11 rounded-full bg-terracota text-sm font-semibold text-white hover:bg-terracota-700"
                    >
                      Vender igual
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          <ProductSearch onPick={(product) => draft.addItem(product)} disabled={busy} />

          <Section
            title="Carrito"
            aside={views.length ? `${itemCount} ${itemCount === 1 ? "unidad" : "unidades"}` : undefined}
          >
            <CartList
              items={views}
              disabled={busy}
              onChange={(key, patch) => draft.updateLine(key, patch)}
              onRemove={(key) => draft.removeLine(key)}
            />
          </Section>
        </div>

        <div className="space-y-5">
          <CustomerPicker customer={draft.customer} onChange={(c) => draft.setCustomer(c)} disabled={busy} />

          <PaymentPanel
            totalCents={totalCents}
            payments={draft.payments}
            resolved={resolved}
            settlement={settlement}
            disabled={busy}
            onAdd={addPayment}
            onAmount={(key, value) => draft.updatePayment(key, { amount: value })}
            onReference={(key, value) => draft.updatePayment(key, { reference: value })}
            onRemove={(key) => draft.removePayment(key)}
          />

          {/* Cobrar */}
          <section className="card space-y-3 p-4 sm:p-5">
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className={labelClass}>{draft.kind === "staff" ? "Total · personal" : "Total a cobrar"}</p>
                <p className="text-[13px] tabular-nums text-cacao-500">IGV incluido {money(igvIncluded(totalCents))}</p>
              </div>
              <p className="font-display text-3xl font-semibold tabular-nums text-cacao">{money(totalCents)}</p>
            </div>

            <details className="group rounded-xl border border-crema-300 bg-white">
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between px-3 text-sm font-medium text-cacao-700 [&::-webkit-details-marker]:hidden">
                {draft.notes.trim() ? "Nota de la venta" : "Agregar nota (opcional)"}
                <span aria-hidden className="text-cacao-300 transition-transform group-open:rotate-180">▾</span>
              </summary>
              <div className="px-3 pb-3">
                <label htmlFor="venta-nota" className="sr-only">Nota de la venta</label>
                <textarea
                  id="venta-nota"
                  rows={2}
                  maxLength={300}
                  disabled={busy}
                  value={draft.notes}
                  onChange={(e) => draft.setNotes(e.target.value)}
                  className="w-full rounded-xl border border-crema-300 bg-white px-3 py-2 text-[15px] text-cacao focus:border-dorado-600 focus:outline-none"
                />
              </div>
            </details>

            <button
              type="button"
              onClick={charge}
              disabled={!!blocker || charging}
              className="h-14 w-full rounded-full bg-cacao text-base font-semibold text-crema transition-colors hover:bg-cacao-700 disabled:cursor-not-allowed disabled:opacity-45"
            >
              {charging
                ? "Registrando venta…"
                : draft.unconfirmed
                  ? `Reintentar cobro ${money(totalCents)}`
                  : `Cobrar ${money(totalCents)}`}
            </button>
            {blocker && !charging && <p className="text-center text-sm text-cacao-500">{blocker}</p>}
            {draft.unconfirmed && !charging && !chargeError && (
              <Notice tone="warn">
                La última cobranza quedó sin respuesta. Al reintentar, primero revisamos si la venta ya está grabada.
              </Notice>
            )}
            {chargeError && (
              <Notice tone="bad">
                {chargeError}
                {chargeError === LOST_CONNECTION && (
                  <>
                    {" "}
                    <Link href="/admin/ventas" className="font-semibold underline underline-offset-2">
                      Ver ventas
                    </Link>
                  </>
                )}
              </Notice>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
