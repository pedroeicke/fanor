"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { createContract } from "@/app/admin/(panel)/encomiendas/actions";
import { Notice, inputClass, labelClass } from "@/components/admin/ui";
import { addDays } from "@/lib/gestion/dates";
import { cx, soles } from "@/lib/format";
import { CustomerPicker } from "./CustomerPicker";
import { LineEditor, emptyLine, type LineDraft } from "./LineEditor";
import { MethodChips } from "./PaymentFields";
import { discardPhoto } from "./PhotoUpload";
import {
  LIMITS,
  PICKUP_PLACE,
  parseMoney,
  round2,
  type CreateContractInput,
  type CustomerSummary,
  type Option,
  type PayMethod,
  type ProductOption,
  type SellerOption,
} from "./shared";

/**
 * Cadastro da encomenda, de cima para baixo na ordem em que a conversa com o
 * cliente acontece: quem é, para quando, o que vai levar, quanto deixa.
 *
 * Tudo vira uma chamada só (`op_contract_create`): contrato, ordem para o
 * taller e venda do adiantamento nascem juntos ou não nascem.
 */

let lineSeq = 0;
function nextLineKey() {
  lineSeq += 1;
  return `l${lineSeq}`;
}

export function ContractForm({
  stores,
  defaultStoreId,
  sellers,
  defaultSellerId,
  products,
  flavors,
  decorators,
  cakeTypes,
  today,
}: {
  stores: Option[];
  defaultStoreId: string | null;
  sellers: SellerOption[];
  defaultSellerId: string | null;
  products: ProductOption[];
  flavors: Option[];
  decorators: Option[];
  cakeTypes: Option[];
  today: string;
}) {
  const router = useRouter();
  /* Loja só vem marcada quando não há dúvida: a da vendedora logada, ou a única. */
  const [storeId, setStoreId] = useState(defaultStoreId ?? (stores.length === 1 ? stores[0].id : ""));
  const [sellerId, setSellerId] = useState(defaultSellerId ?? "");
  const [customer, setCustomer] = useState<CustomerSummary | null>(null);
  const [deliverOn, setDeliverOn] = useState("");
  const [deliverAt, setDeliverAt] = useState("");
  const [pickup, setPickup] = useState(true);
  const [address, setAddress] = useState("");
  const [lines, setLines] = useState<LineDraft[]>(() => [emptyLine("l0")]);
  const [advanceAmount, setAdvanceAmount] = useState("");
  const [advanceMethod, setAdvanceMethod] = useState<PayMethod>("cash");
  const [advanceRef, setAdvanceRef] = useState("");
  const [notes, setNotes] = useState("");
  const [uploading, setUploading] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  const busy = pending || done;

  /* Vendedoras da loja escolhida primeiro; as demais continuam na lista
     (cobrir a colega de outra loja acontece). */
  const sortedSellers = useMemo(
    () => [...sellers].sort((a, b) => Number(b.storeId === storeId) - Number(a.storeId === storeId) || a.name.localeCompare(b.name)),
    [sellers, storeId],
  );

  const total = round2(
    lines.reduce((sum, l) => {
      const price = parseMoney(l.price);
      return l.product && price !== null ? sum + price * l.quantity : sum;
    }, 0),
  );
  const advance = advanceAmount.trim() ? parseMoney(advanceAmount) : 0;
  const balance = advance === null ? null : round2(total - advance);

  function patchLine(key: string, patch: Partial<LineDraft>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function removeLine(line: LineDraft) {
    if (line.photo) discardPhoto(line.photo.path);
    setLines((prev) => prev.filter((l) => l.key !== line.key));
    setUploading((prev) => prev.filter((k) => k !== line.key));
  }

  function setLineBusy(key: string, value: boolean) {
    setUploading((prev) => (value ? [...new Set([...prev, key])] : prev.filter((k) => k !== key)));
  }

  /** Primeiro problema que impede salvar, na ordem da tela. */
  function validate(): string | CreateContractInput {
    if (!storeId) return "Elige la tienda.";
    if (!customer) return "Elige o registra al cliente.";
    if (!deliverOn) return "Elige la fecha de entrega.";
    if (deliverOn < today) return "La fecha de entrega no puede ser pasada.";
    if (!pickup && address.trim().length < 3) return "Escribe la dirección de entrega.";
    if (!lines.length) return "Agrega al menos un producto.";
    const out: CreateContractInput["lines"] = [];
    for (const [i, l] of lines.entries()) {
      if (!l.product) return `Producto ${i + 1}: elige el producto.`;
      const price = parseMoney(l.price);
      if (price === null) return `Producto ${i + 1}: precio inválido.`;
      out.push({
        productId: l.product.id,
        quantity: l.quantity,
        unitPrice: price,
        flavorId: l.flavorId || null,
        decoratorId: l.decoratorId || null,
        cakeTypeId: l.cakeTypeId || null,
        message: l.message.trim(),
        photoPath: l.photo?.path ?? null,
      });
    }
    if (uploading.length) return "Espera a que termine de subir la foto.";
    if (advance === null) return "Monto de adelanto inválido.";
    if (advance > total) return "El adelanto supera el total de la encomienda.";
    return {
      storeId,
      sellerId: sellerId || null,
      customerId: customer.id,
      deliverOn,
      deliverAt: deliverAt || null,
      deliverPlace: pickup ? PICKUP_PLACE : address.trim(),
      notes: notes.trim(),
      lines: out,
      advance: advance > 0 ? { amount: advance, method: advanceMethod, reference: advanceMethod === "cash" ? "" : advanceRef.trim() } : null,
    };
  }

  function submit() {
    setError(null);
    const input = validate();
    if (typeof input === "string") {
      setError(input);
      return;
    }
    startTransition(async () => {
      try {
        const res = await createContract(input);
        if (!res.ok) {
          setError(res.error);
          return;
        }
        /* Fica travado até a navegação terminar: sem segundo toque, sem segunda encomienda. */
        setDone(true);
        router.push(`/admin/encomiendas/${res.data.id}`);
      } catch {
        /* A resposta pode ter caído depois de gravar: repetir às cegas duplicaria a encomenda e o adelanto. */
        setError("Sin conexión. Revisa en Encomiendas si se registró antes de volver a intentar.");
      }
    });
  }

  const tomorrow = addDays(today, 1);

  return (
    <div className="space-y-5 pb-4">
      {/* Tienda */}
      <section className="card space-y-3 p-4 sm:p-5">
        <h3 className="font-display text-lg">Tienda</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="enc-store" className={labelClass}>Tienda que entrega</label>
            <select id="enc-store" className={inputClass} value={storeId} disabled={busy} onChange={(e) => setStoreId(e.target.value)}>
              {!storeId && <option value="">Elige la tienda</option>}
              {stores.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="enc-seller" className={labelClass}>Vendedora</label>
            <select id="enc-seller" className={inputClass} value={sellerId} disabled={busy || !sellers.length} onChange={(e) => setSellerId(e.target.value)}>
              <option value="">{sellers.length ? "— Sin asignar —" : "Sin vendedoras registradas"}</option>
              {sortedSellers.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
        </div>
      </section>

      {/* Cliente */}
      <section className="card space-y-3 p-4 sm:p-5">
        <h3 className="font-display text-lg">Cliente</h3>
        <CustomerPicker value={customer} onChange={setCustomer} />
      </section>

      {/* Entrega */}
      <section className="card space-y-3 p-4 sm:p-5">
        <h3 className="font-display text-lg">Entrega</h3>
        <div>
          <label htmlFor="enc-date" className={labelClass}>Fecha</label>
          <div className="flex flex-wrap gap-2">
            <input
              id="enc-date"
              type="date"
              min={today}
              className={cx(inputClass, "w-auto min-w-0 flex-1")}
              value={deliverOn}
              disabled={busy}
              onChange={(e) => setDeliverOn(e.target.value)}
            />
            {[{ label: "Hoy", value: today }, { label: "Mañana", value: tomorrow }].map((d) => (
              <button
                key={d.label}
                type="button"
                disabled={busy}
                onClick={() => setDeliverOn(d.value)}
                className={cx(
                  "h-11 rounded-full border px-4 text-sm font-semibold",
                  deliverOn === d.value ? "border-dorado bg-dorado text-cacao" : "border-crema-300 bg-white text-cacao-700",
                )}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>
        <div className="max-w-[12rem]">
          <label htmlFor="enc-time" className={labelClass}>Hora</label>
          <input id="enc-time" type="time" className={inputClass} value={deliverAt} disabled={busy} onChange={(e) => setDeliverAt(e.target.value)} />
        </div>
        <div>
          <span className={labelClass}>Lugar</span>
          <div role="radiogroup" aria-label="Lugar de entrega" className="grid grid-cols-2 gap-2">
            {[{ label: "Recojo en tienda", value: true }, { label: "Delivery", value: false }].map((o) => (
              <button
                key={o.label}
                type="button"
                role="radio"
                aria-checked={pickup === o.value}
                disabled={busy}
                onClick={() => setPickup(o.value)}
                className={cx(
                  "h-11 rounded-xl border px-3 text-sm font-semibold",
                  pickup === o.value ? "border-dorado bg-dorado text-cacao" : "border-crema-300 bg-white text-cacao-700",
                )}
              >
                {o.label}
              </button>
            ))}
          </div>
          {!pickup && (
            <input
              aria-label="Dirección de entrega"
              className={cx(inputClass, "mt-2")}
              value={address}
              maxLength={LIMITS.place}
              disabled={busy}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Dirección y referencia"
            />
          )}
        </div>
      </section>

      {/* Produtos */}
      <section className="card space-y-3 p-4 sm:p-5">
        <h3 className="font-display text-lg">Productos</h3>
        {!products.length && <Notice tone="warn">No hay productos disponibles para mostrador.</Notice>}
        {lines.map((line, i) => (
          <LineEditor
            key={line.key}
            index={i}
            line={line}
            products={products}
            flavors={flavors}
            decorators={decorators}
            cakeTypes={cakeTypes}
            canRemove={lines.length > 1}
            disabled={busy}
            onChange={(patch) => patchLine(line.key, patch)}
            onRemove={() => removeLine(line)}
            onBusyChange={(value) => setLineBusy(line.key, value)}
          />
        ))}
        {lines.length < LIMITS.lines && (
          <button
            type="button"
            disabled={busy}
            onClick={() => setLines((prev) => [...prev, emptyLine(nextLineKey())])}
            className="h-11 w-full rounded-full border border-cacao/25 px-4 text-sm font-semibold text-cacao hover:bg-crema-100 disabled:opacity-50"
          >
            + Agregar otro producto
          </button>
        )}
      </section>

      {/* Adelanto */}
      <section className="card space-y-3 p-4 sm:p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-display text-lg">Adelanto</h3>
          <span className="text-sm text-cacao-500">Total {soles(total)}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {[
            { label: "Sin adelanto", value: "" },
            { label: "50 %", value: total > 0 ? round2(total / 2).toFixed(2) : "" },
            { label: "Todo", value: total > 0 ? total.toFixed(2) : "" },
          ].map((o) => (
            <button
              key={o.label}
              type="button"
              disabled={busy || (o.label !== "Sin adelanto" && total <= 0)}
              onClick={() => setAdvanceAmount(o.value)}
              className={cx(
                "h-11 rounded-full border px-4 text-sm font-semibold disabled:opacity-40",
                (o.value ? advanceAmount === o.value : !advanceAmount.trim()) ? "border-dorado bg-dorado text-cacao" : "border-crema-300 bg-white text-cacao-700",
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
        <div className="max-w-[14rem]">
          <label htmlFor="enc-adv" className={labelClass}>Monto (S/)</label>
          <input
            id="enc-adv"
            className={cx(inputClass, advance === null && "border-terracota")}
            inputMode="decimal"
            autoComplete="off"
            value={advanceAmount}
            disabled={busy}
            onChange={(e) => setAdvanceAmount(e.target.value)}
            placeholder="0.00"
          />
        </div>
        {advance !== null && advance > 0 && (
          <>
            <MethodChips name="Forma de pago del adelanto" value={advanceMethod} onChange={setAdvanceMethod} />
            {advanceMethod !== "cash" && (
              <div className="max-w-sm">
                <label htmlFor="enc-adv-ref" className={labelClass}>N.º de operación</label>
                <input
                  id="enc-adv-ref"
                  className={inputClass}
                  maxLength={LIMITS.reference}
                  autoComplete="off"
                  value={advanceRef}
                  disabled={busy}
                  onChange={(e) => setAdvanceRef(e.target.value)}
                  placeholder="Opcional"
                />
              </div>
            )}
          </>
        )}
      </section>

      {/* Observações */}
      <section className="card space-y-2 p-4 sm:p-5">
        <label htmlFor="enc-notes" className="font-display text-lg">Observaciones</label>
        <textarea
          id="enc-notes"
          rows={3}
          className={cx(inputClass, "h-auto py-2")}
          maxLength={LIMITS.notes}
          value={notes}
          disabled={busy}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Alergias, forma, colores, quién recoge…"
        />
      </section>

      {/* Resumo fixo embaixo: o total e o botão ficam à mão enquanto a tela rola. */}
      <div className="sticky bottom-0 z-40 -mx-4 border-t border-crema-300 bg-white/95 px-4 py-3 shadow-[0_-8px_24px_-16px_rgb(59_35_20/0.35)] backdrop-blur-sm sm:mx-0 sm:rounded-2xl sm:border">
        <dl className="grid grid-cols-3 gap-2 text-center text-sm">
          <div><dt className="text-[11px] font-bold uppercase tracking-[0.1em] text-cacao-300">Total</dt><dd className="font-semibold tabular-nums">{soles(total)}</dd></div>
          <div><dt className="text-[11px] font-bold uppercase tracking-[0.1em] text-cacao-300">Adelanto</dt><dd className="tabular-nums">{advance === null ? "—" : soles(advance)}</dd></div>
          <div><dt className="text-[11px] font-bold uppercase tracking-[0.1em] text-cacao-300">Saldo</dt><dd className={cx("font-semibold tabular-nums", balance !== null && balance < 0 && "text-terracota")}>{balance === null ? "—" : soles(balance)}</dd></div>
        </dl>
        {error && <p role="alert" className="mt-2 text-center text-sm font-semibold text-terracota">{error}</p>}
        <button
          type="button"
          onClick={submit}
          disabled={busy || uploading.length > 0}
          className="mt-2 h-12 w-full rounded-full bg-dorado text-base font-semibold text-cacao hover:bg-dorado-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending || done ? "Registrando…" : uploading.length ? "Subiendo foto…" : "Registrar encomienda"}
        </button>
      </div>
    </div>
  );
}
