"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createDispatch } from "@/app/admin/(panel)/taller/actions";
import { cx } from "@/lib/format";
import { Notice, inputClass, labelClass } from "@/components/admin/ui";
import { ProductSearch } from "@/components/admin/pedidos-tienda/ProductSearch";
import { QuantityStepper } from "@/components/admin/pedidos-tienda/QuantityStepper";
import { NOTES_MAX, type CatalogProduct, type StoreOption } from "@/components/admin/pedidos-tienda/types";
import { CAKES_PER_ENTRY_MAX, ITEM_QTY_MAX, type DispatchOrder, type DispatchOrderLine, type NamedOption } from "./types";

/**
 * Montagem do despacho.
 *
 * O pedido chega como "10 × T26"; o taller decide que saem 2 de fresa, 3 de
 * chocolate e 5 de moka. Cada linha de torta vira várias filas sabor ×
 * decoradora × quantidade, todas apontando a mesma linha do pedido — é assim
 * que o banco sabe quanto do pedido já foi atendido.
 *
 * Mandar menos ou mais que o pedido é permitido (faltou insumo, sobrou
 * massa); a tela só avisa. Despacho não tem desfazer — cada torta ganha
 * série e etiqueta —, por isso o envio passa por uma confirmação.
 */

type Entry = { key: string; flavorId: string; decoratorId: string; quantity: number };

type LineState = {
  key: string;
  lineId: string | null;
  productId: string;
  productName: string;
  sku: string | null;
  tracksSerial: boolean;
  /** Quanto falta mandar da linha do pedido. Null no despacho sem pedido. */
  missing: number | null;
  info: DispatchOrderLine | null;
  entries: Entry[];
  itemQty: number;
};

function initialLines(order: DispatchOrder | null): LineState[] {
  if (!order) return [];
  return order.lines.map((l) => {
    const missing = Math.max(0, l.quantity - l.produced);
    return {
      key: l.id,
      lineId: l.id,
      productId: l.productId,
      productName: l.productName,
      sku: l.sku,
      tracksSerial: l.tracksSerial,
      missing,
      info: l,
      entries: l.tracksSerial
        ? [{ key: `${l.id}-0`, flavorId: l.flavorId ?? "", decoratorId: l.decoratorId ?? "", quantity: Math.min(missing, CAKES_PER_ENTRY_MAX) }]
        : [],
      itemQty: Math.min(missing, ITEM_QTY_MAX),
    };
  });
}

function sent(line: LineState) {
  return line.tracksSerial ? line.entries.reduce((s, e) => s + e.quantity, 0) : line.itemQty;
}

export function DispatchBuilder({
  order,
  stores = [],
  defaultStoreId = null,
  products = [],
  flavors,
  decorators,
}: {
  /** Com pedido: linhas pré-carregadas e loja fixa. Sem pedido: escolher loja e produtos. */
  order: DispatchOrder | null;
  stores?: StoreOption[];
  defaultStoreId?: string | null;
  products?: CatalogProduct[];
  flavors: NamedOption[];
  decorators: NamedOption[];
}) {
  const router = useRouter();
  const seq = useRef(0);
  const [lines, setLines] = useState<LineState[]>(() => initialLines(order));
  const [storeId, setStoreId] = useState<string>(order?.storeId ?? defaultStoreId ?? "");
  const [notes, setNotes] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  const busy = pending || done;
  const nextKey = () => {
    seq.current += 1;
    return `n${seq.current}`;
  };

  /** Toda edição desfaz a confirmação: o resumo confirmado tem de ser o que vai. */
  function update(fn: (current: LineState[]) => LineState[]) {
    setConfirming(false);
    setError(null);
    setLines(fn);
  }

  const patchLine = (key: string, fn: (line: LineState) => LineState) => update((ls) => ls.map((l) => (l.key === key ? fn(l) : l)));

  function addProduct(p: CatalogProduct) {
    /* Chave gerada fora do atualizador: ele pode rodar duas vezes em dev. */
    const key = nextKey();
    update((ls) => {
      const existing = ls.find((l) => l.key === p.id);
      if (existing) {
        return ls.map((l) => {
          if (l.key !== p.id) return l;
          if (!l.tracksSerial) return { ...l, itemQty: Math.min(ITEM_QTY_MAX, l.itemQty + 1) };
          const [first, ...rest] = l.entries;
          return first
            ? { ...l, entries: [{ ...first, quantity: Math.min(CAKES_PER_ENTRY_MAX, first.quantity + 1) }, ...rest] }
            : { ...l, entries: [{ key, flavorId: "", decoratorId: "", quantity: 1 }] };
        });
      }
      return [
        ...ls,
        {
          key: p.id,
          lineId: null,
          productId: p.id,
          productName: p.name,
          sku: p.sku,
          tracksSerial: p.tracksSerial,
          missing: null,
          info: null,
          entries: p.tracksSerial ? [{ key, flavorId: "", decoratorId: "", quantity: 1 }] : [],
          itemQty: p.tracksSerial ? 0 : 1,
        },
      ];
    });
  }

  function addEntry(line: LineState) {
    const already = sent(line);
    const rest = line.missing !== null ? line.missing - already : 0;
    const last = line.entries[line.entries.length - 1];
    const key = nextKey();
    patchLine(line.key, (l) => ({
      ...l,
      entries: [
        ...l.entries,
        {
          key,
          flavorId: "",
          /* A mesma decoradora costuma fazer a fornada inteira. */
          decoratorId: last?.decoratorId ?? l.info?.decoratorId ?? "",
          quantity: rest > 0 ? Math.min(rest, CAKES_PER_ENTRY_MAX) : 1,
        },
      ],
    }));
  }

  const totals = useMemo(() => {
    let cakes = 0, items = 0, noFlavor = 0;
    for (const l of lines) {
      if (l.tracksSerial) {
        for (const e of l.entries) {
          cakes += e.quantity;
          if (!e.flavorId && e.quantity > 0) noFlavor += e.quantity;
        }
      } else {
        items += l.itemQty;
      }
    }
    return { cakes, items, noFlavor };
  }, [lines]);

  const mismatches = lines
    .filter((l) => l.missing !== null && sent(l) !== l.missing)
    .map((l) => ({ key: l.key, name: l.productName, missing: l.missing!, sent: sent(l) }));

  const storeName = order?.storeName ?? stores.find((s) => s.id === storeId)?.name ?? null;
  const empty = totals.cakes + totals.items === 0;

  function review() {
    setError(null);
    if (!order && !storeId) return setError("Elige la tienda de destino.");
    if (empty) return setError("No hay nada para despachar: todas las cantidades están en cero.");
    setConfirming(true);
  }

  function submit() {
    if (busy) return;
    setError(null);
    startTransition(async () => {
      const result = await createDispatch({
        orderId: order?.id ?? null,
        storeId: order ? null : storeId,
        cakes: lines.flatMap((l) =>
          l.tracksSerial
            ? l.entries
                .filter((e) => e.quantity > 0)
                .map((e) => ({ productId: l.productId, quantity: e.quantity, flavorId: e.flavorId || null, decoratorId: e.decoratorId || null, lineId: l.lineId }))
            : [],
        ),
        items: lines
          .filter((l) => !l.tracksSerial && l.itemQty > 0)
          .map((l) => ({ productId: l.productId, quantity: l.itemQty, lineId: l.lineId })),
        notes,
      });
      if (!result.ok) {
        setConfirming(false);
        setError(result.error);
        return;
      }
      setDone(true);
      router.push(`/admin/taller/despachos/${result.data.id}`);
    });
  }

  const picked = Object.fromEntries(lines.filter((l) => !l.lineId).map((l) => [l.productId, sent(l)]));

  return (
    <div className="space-y-5">
      {!order && (
        <div className="card space-y-4 p-4 sm:p-5">
          <div>
            <p className={labelClass}>Tienda de destino</p>
            {stores.length === 0 ? (
              <p className="text-sm text-cacao-500">Ninguna tienda tiene prefijo de serie configurado.</p>
            ) : (
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Tienda de destino">
                {stores.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    role="radio"
                    aria-checked={storeId === s.id}
                    disabled={busy}
                    onClick={() => {
                      setConfirming(false);
                      setStoreId(s.id);
                    }}
                    className={cx(
                      "h-11 rounded-full border px-5 text-sm font-semibold transition-colors",
                      storeId === s.id ? "border-dorado bg-dorado text-cacao" : "border-crema-300 bg-white text-cacao-700 hover:border-cacao/35",
                    )}
                  >
                    {s.name}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div>
            <p className={labelClass}>Agregar productos</p>
            <ProductSearch products={products} onPick={addProduct} picked={picked} placeholder="Buscar torta o producto (ej. T26)" />
          </div>
        </div>
      )}

      {lines.length === 0 && !order && (
        <p className="rounded-xl border border-dashed border-crema-300 px-4 py-5 text-center text-sm text-cacao-500">
          Busca un producto para empezar el despacho.
        </p>
      )}

      <ul className="space-y-4">
        {lines.map((line) => {
          const count = sent(line);
          const complete = line.missing === 0;
          return (
            <li key={line.key} className="card p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold leading-snug text-cacao">{line.productName}</p>
                  <p className="text-[13px] text-cacao-500">
                    {line.sku ?? "Sin código"}
                    {line.info && ` · pedidas ${line.info.quantity}, ya despachadas ${line.info.produced}`}
                  </p>
                </div>
                {!line.lineId && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => update((ls) => ls.filter((l) => l.key !== line.key))}
                    className="h-11 rounded-full px-3 text-sm font-medium text-terracota-700 hover:bg-terracota/10 disabled:opacity-45"
                  >
                    Quitar
                  </button>
                )}
              </div>

              {line.info && (line.info.flavorName || line.info.decoratorName || line.info.cakeTypeName || line.info.message) && (
                <dl className="mt-3 grid gap-x-4 gap-y-1 rounded-xl bg-dorado-100 px-3 py-2 text-[13px] text-cacao-700 sm:grid-cols-2">
                  {line.info.flavorName && <Detail term="Sabor pedido" value={line.info.flavorName} />}
                  {line.info.decoratorName && <Detail term="Decoradora" value={line.info.decoratorName} />}
                  {line.info.cakeTypeName && <Detail term="Tipo" value={line.info.cakeTypeName} />}
                  {line.info.message && <Detail term="Mensaje" value={`“${line.info.message}”`} wide />}
                </dl>
              )}

              {line.tracksSerial ? (
                <div className="mt-3 space-y-2">
                  {line.entries.map((entry, index) => {
                    const differs = line.info?.flavorId && entry.flavorId && entry.flavorId !== line.info.flavorId;
                    return (
                      <div key={entry.key} className="space-y-2 rounded-xl border border-crema-200 bg-crema-100 p-3">
                        <div className="grid gap-2 sm:grid-cols-2">
                          <select
                            aria-label={`Sabor, fila ${index + 1}`}
                            value={entry.flavorId}
                            disabled={busy}
                            onChange={(e) =>
                              patchLine(line.key, (l) => ({ ...l, entries: l.entries.map((x) => (x.key === entry.key ? { ...x, flavorId: e.target.value } : x)) }))
                            }
                            className={inputClass}
                          >
                            <option value="">Sin sabor</option>
                            {flavors.map((f) => (
                              <option key={f.id} value={f.id}>
                                {f.name}
                              </option>
                            ))}
                          </select>
                          <select
                            aria-label={`Decoradora, fila ${index + 1}`}
                            value={entry.decoratorId}
                            disabled={busy}
                            onChange={(e) =>
                              patchLine(line.key, (l) => ({ ...l, entries: l.entries.map((x) => (x.key === entry.key ? { ...x, decoratorId: e.target.value } : x)) }))
                            }
                            className={inputClass}
                          >
                            <option value="">Sin decoradora</option>
                            {decorators.map((d) => (
                              <option key={d.id} value={d.id}>
                                {d.name}
                              </option>
                            ))}
                          </select>
                        </div>
                        {differs && <p className="text-[13px] font-medium text-terracota-700">Distinto del sabor que pidió el cliente.</p>}
                        <div className="flex items-center justify-between gap-2">
                          <QuantityStepper
                            value={entry.quantity}
                            min={0}
                            max={CAKES_PER_ENTRY_MAX}
                            label={`${line.productName}, fila ${index + 1}`}
                            disabled={busy}
                            onChange={(q) =>
                              patchLine(line.key, (l) => ({ ...l, entries: l.entries.map((x) => (x.key === entry.key ? { ...x, quantity: q } : x)) }))
                            }
                          />
                          {line.entries.length > 1 && (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => patchLine(line.key, (l) => ({ ...l, entries: l.entries.filter((x) => x.key !== entry.key) }))}
                              className="h-11 rounded-full px-3 text-sm font-medium text-terracota-700 hover:bg-terracota/10 disabled:opacity-45"
                            >
                              Quitar fila
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => addEntry(line)}
                    className="flex h-11 w-full items-center justify-center rounded-xl border border-dashed border-cacao/25 text-sm font-semibold text-cacao-700 hover:border-cacao/50 disabled:opacity-45"
                  >
                    + Otro sabor
                  </button>
                </div>
              ) : (
                <div className="mt-3 flex items-center justify-between gap-3">
                  <span className="text-sm text-cacao-500">Cantidad (sin serie)</span>
                  <QuantityStepper
                    value={line.itemQty}
                    min={0}
                    max={ITEM_QTY_MAX}
                    label={line.productName}
                    disabled={busy}
                    onChange={(q) => patchLine(line.key, (l) => ({ ...l, itemQty: q }))}
                  />
                </div>
              )}

              {line.missing !== null && (
                <p
                  className={cx(
                    "mt-3 text-sm font-medium",
                    complete && count === 0 ? "text-cacao-300" : count === line.missing ? "text-verde" : "text-terracota-700",
                  )}
                >
                  {complete && count === 0
                    ? "Esta línea ya se despachó completa."
                    : count === line.missing
                      ? `Enviando ${count} de ${line.missing}: completa la línea.`
                      : count < line.missing
                        ? `Enviando ${count} de ${line.missing}: faltarán ${line.missing - count} y el pedido sigue abierto.`
                        : `Enviando ${count} de ${line.missing}: ${count - line.missing} de más.`}
                </p>
              )}
            </li>
          );
        })}
      </ul>

      <div>
        <label htmlFor="dispatch-notes" className={labelClass}>
          Observación (opcional)
        </label>
        <textarea
          id="dispatch-notes"
          value={notes}
          onChange={(e) => {
            setConfirming(false);
            setNotes(e.target.value);
          }}
          maxLength={NOTES_MAX}
          rows={2}
          disabled={busy}
          placeholder="Ej. va en la movilidad de las 3 pm"
          className={cx(inputClass, "h-auto min-h-11 py-2.5")}
        />
      </div>

      {error && (
        <p role="alert" className="rounded-xl border border-terracota/30 bg-terracota/10 px-4 py-3 text-sm font-medium text-terracota-700">
          {error}
        </p>
      )}

      <div className="sticky bottom-3 z-10 space-y-3">
        {confirming && (
          <div className="card space-y-3 p-4 shadow-lift">
            <p className="font-semibold text-cacao">
              ¿Despachar a {storeName ?? "la tienda"}?
            </p>
            <p className="text-sm text-cacao-700">
              {totals.cakes > 0 && `${totals.cakes} ${totals.cakes === 1 ? "torta" : "tortas"} con etiqueta`}
              {totals.cakes > 0 && totals.items > 0 && " y "}
              {totals.items > 0 && `${totals.items} ${totals.items === 1 ? "ítem" : "ítems"} sin serie`}. Salen “en camino” y la tienda
              las confirma al recibir. No se puede deshacer.
            </p>
            {mismatches.length > 0 && (
              <Notice tone="warn">
                {/* Com muitas linhas o resumo passaria da altura do celular e
                    empurraria o "Sí, despachar" para fora da tela. */}
                <ul className="max-h-32 space-y-0.5 overflow-y-auto">
                  {mismatches.map((m) => (
                    <li key={m.key}>
                      {m.name}: {m.sent < m.missing ? `faltan ${m.missing - m.sent}` : `${m.sent - m.missing} de más`} ({m.sent} de {m.missing})
                    </li>
                  ))}
                </ul>
              </Notice>
            )}
            {totals.noFlavor > 0 && flavors.length > 0 && (
              <Notice tone="warn">
                {totals.noFlavor} {totals.noFlavor === 1 ? "torta va" : "tortas van"} sin sabor en la etiqueta.
              </Notice>
            )}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={submit}
                disabled={busy}
                className="flex h-12 flex-1 items-center justify-center rounded-full bg-dorado px-6 font-semibold text-cacao transition-colors hover:bg-dorado-600 disabled:cursor-not-allowed disabled:opacity-45"
              >
                {pending || done ? "Despachando…" : "Sí, despachar"}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={busy}
                className="h-12 rounded-full border border-crema-300 bg-white px-5 text-sm font-medium text-cacao-700 disabled:opacity-45"
              >
                Revisar
              </button>
            </div>
          </div>
        )}

        {!confirming && (
          <button
            type="button"
            onClick={review}
            disabled={busy || lines.length === 0}
            className="flex h-14 w-full items-center justify-center rounded-full bg-dorado px-6 text-base font-semibold text-cacao shadow-lift transition-colors hover:bg-dorado-600 disabled:cursor-not-allowed disabled:opacity-45"
          >
            {empty ? "Despachar" : `Despachar · ${summary(totals.cakes, totals.items)}`}
          </button>
        )}
      </div>
    </div>
  );
}

function summary(cakes: number, items: number) {
  const parts: string[] = [];
  if (cakes) parts.push(`${cakes} ${cakes === 1 ? "torta" : "tortas"}`);
  if (items) parts.push(`${items} ${items === 1 ? "ítem" : "ítems"}`);
  return parts.join(" y ");
}

function Detail({ term, value, wide = false }: { term: string; value: string; wide?: boolean }) {
  return (
    <div className={cx("flex gap-1.5", wide && "sm:col-span-2")}>
      <dt className="shrink-0 font-semibold">{term}:</dt>
      <dd className="min-w-0 break-words">{value}</dd>
    </div>
  );
}
