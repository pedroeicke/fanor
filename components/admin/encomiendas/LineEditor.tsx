"use client";

import { useMemo, useState } from "react";
import { inputClass, labelClass } from "@/components/admin/ui";
import { cx, soles } from "@/lib/format";
import { PhotoUpload } from "./PhotoUpload";
import { LIMITS, parseMoney, type Option, type PhotoRef, type ProductOption } from "./shared";

/**
 * Uma linha da encomenda: produto, quantidade, preço e o que o taller precisa
 * saber para fazer a torta certa (sabor, tipo, decoradora, mensagem, foto).
 */

export type LineDraft = {
  key: string;
  product: ProductOption | null;
  quantity: number;
  price: string;
  flavorId: string;
  decoratorId: string;
  cakeTypeId: string;
  message: string;
  photo: PhotoRef | null;
  /** Detalhes abertos à mão em produto que não é torta com série. */
  details: boolean;
};

export function emptyLine(key: string): LineDraft {
  return { key, product: null, quantity: 1, price: "", flavorId: "", decoratorId: "", cakeTypeId: "", message: "", photo: null, details: false };
}

/** "Três Leches" casa com "tres leches": a vendedora não digita acento no celular. */
function fold(value: string) {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function ProductPicker({ products, onPick }: { products: ProductOption[]; onPick: (p: ProductOption) => void }) {
  const [query, setQuery] = useState("");

  const index = useMemo(() => products.map((p) => ({ p, text: fold(`${p.sku ?? ""} ${p.name}`) })), [products]);

  const matches = useMemo(() => {
    const q = fold(query.trim());
    if (!q) return [];
    const words = q.split(/\s+/);
    return index
      .filter(({ text }) => words.every((w) => text.includes(w)))
      /* Torta primeiro (é quase toda encomenda); código exato no topo. */
      .sort((a, b) => {
        const exact = Number(fold(b.p.sku ?? "") === q) - Number(fold(a.p.sku ?? "") === q);
        return exact || Number(b.p.isCake) - Number(a.p.isCake);
      })
      .slice(0, 8)
      .map(({ p }) => p);
  }, [index, query]);

  return (
    <div className="space-y-2">
      <input
        type="search"
        className={inputClass}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Busca por nombre o código (T26, tres leches…)"
        autoComplete="off"
        aria-label="Buscar producto"
      />
      {query.trim() && (
        matches.length ? (
          <ul className="divide-y divide-crema-200 overflow-hidden rounded-2xl border border-crema-300 bg-white">
            {matches.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => onPick(p)}
                  className="flex min-h-11 w-full items-center justify-between gap-3 px-4 py-2 text-left hover:bg-crema-100"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-cacao">{p.name}</span>
                    <span className="text-[12px] text-cacao-300">{[p.sku, p.isCake ? "Torta" : null].filter(Boolean).join(" · ")}</span>
                  </span>
                  <span className="shrink-0 text-sm tabular-nums text-cacao-500">{p.price > 0 ? soles(p.price) : "—"}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-cacao-500">Ningún producto con “{query.trim()}”.</p>
        )
      )}
    </div>
  );
}

function CatalogSelect({
  id, label, value, options, empty, onChange, disabled,
}: {
  id: string; label: string; value: string; options: Option[]; empty: string; onChange: (v: string) => void; disabled?: boolean;
}) {
  return (
    <div>
      <label htmlFor={id} className={labelClass}>{label}</label>
      <select id={id} className={inputClass} value={value} disabled={disabled || !options.length} onChange={(e) => onChange(e.target.value)}>
        <option value="">{options.length ? "— Sin especificar —" : empty}</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>{o.name}</option>
        ))}
      </select>
    </div>
  );
}

export function LineEditor({
  index,
  line,
  products,
  flavors,
  decorators,
  cakeTypes,
  canRemove,
  disabled,
  onChange,
  onRemove,
  onBusyChange,
}: {
  index: number;
  line: LineDraft;
  products: ProductOption[];
  flavors: Option[];
  decorators: Option[];
  cakeTypes: Option[];
  canRemove: boolean;
  disabled: boolean;
  onChange: (patch: Partial<LineDraft>) => void;
  onRemove: () => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const price = parseMoney(line.price);
  const subtotal = price === null ? null : Math.round(price * line.quantity * 100) / 100;
  /* Detalhe já preenchido nunca some: trocar a torta por um produto sem série
     mandaria sabor e foto escondidos, sem a vendedora ver o que vai. */
  const filled = Boolean(line.flavorId || line.decoratorId || line.cakeTypeId || line.message.trim() || line.photo);
  const showDetails = line.product ? line.product.isCake || line.details || filled : false;
  const k = line.key;

  return (
    <fieldset disabled={disabled} aria-label={`Producto ${index + 1}`} className="space-y-3 rounded-2xl border border-crema-300 bg-white p-4">
      <div className="flex min-h-11 items-center justify-between gap-2">
        <p className="text-[12px] font-bold uppercase tracking-[0.12em] text-cacao-300">Producto {index + 1}</p>
        {canRemove && (
          <button type="button" onClick={onRemove} className="h-11 px-2 text-sm font-semibold text-terracota">
            Quitar
          </button>
        )}
      </div>

      {line.product ? (
        <div className="flex items-center justify-between gap-3 rounded-xl bg-crema-100 px-3 py-2">
          <div className="min-w-0">
            <p className="truncate font-semibold text-cacao">{line.product.name}</p>
            <p className="text-[12px] text-cacao-500">
              {[line.product.sku, line.product.isCake ? "Torta · va al taller" : "No pasa por el taller"].filter(Boolean).join(" · ")}
            </p>
          </div>
          <button
            type="button"
            onClick={() => onChange({ product: null })}
            className="h-11 shrink-0 rounded-full border border-cacao/25 bg-white px-4 text-sm font-semibold text-cacao"
          >
            Cambiar
          </button>
        </div>
      ) : (
        <ProductPicker
          products={products}
          onPick={(p) => onChange({ product: p, price: p.price > 0 ? p.price.toFixed(2) : "" })}
        />
      )}

      {line.product && (
        <>
          <div className="grid grid-cols-[auto_minmax(0,1fr)] items-end gap-3">
            <div>
              <span className={labelClass}>Cantidad</span>
              <div className="flex h-11 items-center rounded-xl border border-crema-300 bg-white">
                <button
                  type="button"
                  aria-label="Menos"
                  onClick={() => onChange({ quantity: Math.max(1, line.quantity - 1) })}
                  className="h-11 w-11 text-lg font-semibold text-cacao disabled:opacity-40"
                  disabled={line.quantity <= 1}
                >
                  −
                </button>
                <span className="w-8 text-center font-semibold tabular-nums" aria-live="polite">{line.quantity}</span>
                <button
                  type="button"
                  aria-label="Más"
                  onClick={() => onChange({ quantity: Math.min(LIMITS.quantity, line.quantity + 1) })}
                  className="h-11 w-11 text-lg font-semibold text-cacao disabled:opacity-40"
                  disabled={line.quantity >= LIMITS.quantity}
                >
                  +
                </button>
              </div>
            </div>
            <div>
              <label htmlFor={`${k}-price`} className={labelClass}>Precio unit. (S/)</label>
              <input
                id={`${k}-price`}
                className={cx(inputClass, line.price && price === null && "border-terracota")}
                inputMode="decimal"
                autoComplete="off"
                value={line.price}
                onChange={(e) => onChange({ price: e.target.value })}
              />
            </div>
          </div>
          <p className="text-right text-sm text-cacao-500">
            Subtotal <strong className="tabular-nums text-cacao">{subtotal === null ? "—" : soles(subtotal)}</strong>
          </p>

          {showDetails ? (
            <div className="space-y-3 border-t border-crema-200 pt-3">
              <div className="grid gap-3 sm:grid-cols-3">
                <CatalogSelect id={`${k}-flavor`} label="Sabor" value={line.flavorId} options={flavors} empty="Sin sabores registrados" onChange={(v) => onChange({ flavorId: v })} />
                <CatalogSelect id={`${k}-type`} label="Tipo de torta" value={line.cakeTypeId} options={cakeTypes} empty="Sin tipos registrados" onChange={(v) => onChange({ cakeTypeId: v })} />
                <CatalogSelect id={`${k}-decorator`} label="Decoradora" value={line.decoratorId} options={decorators} empty="Sin decoradoras registradas" onChange={(v) => onChange({ decoratorId: v })} />
              </div>
              <div>
                <label htmlFor={`${k}-msg`} className={labelClass}>Mensaje en la torta</label>
                <input
                  id={`${k}-msg`}
                  className={inputClass}
                  maxLength={LIMITS.message}
                  value={line.message}
                  onChange={(e) => onChange({ message: e.target.value })}
                  placeholder="Ej.: Feliz cumpleaños, Sofía"
                />
              </div>
              <PhotoUpload value={line.photo} onChange={(photo) => onChange({ photo })} onBusyChange={onBusyChange} />
            </div>
          ) : (
            <button type="button" onClick={() => onChange({ details: true })} className="h-11 text-sm font-semibold text-terracota underline underline-offset-2">
              + Agregar sabor, mensaje o foto
            </button>
          )}
        </>
      )}
    </fieldset>
  );
}
