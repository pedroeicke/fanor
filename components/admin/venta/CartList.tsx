"use client";

import { cx } from "@/lib/format";
import { inputClass, labelClass } from "@/components/admin/ui";
import { money } from "./money";
import { expiryLabel, shortDay } from "./format";
import type { CartLine } from "./types";

/** Linha do carrinho já com as contas feitas pela tela. */
export type LineView = {
  line: CartLine;
  totalCents: number | null;
  error: string | null;
  /** Só torta: dias desde o vencimento (0 = vence hoje). */
  daysExpired: number | null;
};

type Patch = { price?: string; discount?: string; quantity?: string };

/**
 * Carrinho editável: preço, desconto e quantidade por linha.
 *
 * O preço sugerido é só ponto de partida — a T26 já mudou de preço sete
 * vezes em dois anos e a promoção do dia não passa pelo cadastro. Por isso
 * tudo é editável aqui, e o servidor recalcula o total antes de gravar.
 */
export function CartList({
  items,
  disabled,
  onChange,
  onRemove,
}: {
  items: LineView[];
  disabled?: boolean;
  onChange: (key: string, patch: Patch) => void;
  onRemove: (key: string) => void;
}) {
  if (!items.length) {
    return (
      <p className="px-5 py-6 text-sm text-cacao-500">
        El carrito está vacío. Escanea una torta o busca un producto.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-crema-200">
      {items.map((item) => (
        <CartRow key={item.line.key} item={item} disabled={disabled} onChange={onChange} onRemove={onRemove} />
      ))}
    </ul>
  );
}

function CartRow({
  item,
  disabled,
  onChange,
  onRemove,
}: {
  item: LineView;
  disabled?: boolean;
  onChange: (key: string, patch: Patch) => void;
  onRemove: (key: string) => void;
}) {
  const { line, totalCents, error, daysExpired } = item;
  const id = `venta-${line.key}`;
  const quantity = line.kind === "item" ? Number(line.quantity) || 0 : 1;

  return (
    <li className={cx("space-y-3 px-4 py-4 sm:px-5", daysExpired !== null && daysExpired > 0 && "bg-terracota/5")}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-medium leading-snug text-cacao">
            {line.name}
            {line.sku && <span className="ml-2 text-[13px] font-normal text-cacao-300">{line.sku}</span>}
          </p>
          {line.kind === "cake" && (
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-cacao-500">
              <span className="font-mono text-cacao-700">{line.serial}</span>
              {line.flavor && <span>· {line.flavor}</span>}
              <span>· vence {shortDay(line.expiresOn)}</span>
              {daysExpired !== null && daysExpired >= 0 && (
                <span
                  className={cx(
                    "inline-flex h-6 items-center rounded-full border px-2 text-[11px] font-semibold",
                    daysExpired > 0
                      ? "border-terracota/30 bg-terracota/10 text-terracota-700"
                      : "border-dorado-600/40 bg-dorado-100 text-cacao-700",
                  )}
                >
                  {expiryLabel(daysExpired)}
                </span>
              )}
            </p>
          )}
        </div>
        <p className="shrink-0 pt-0.5 font-display text-lg font-semibold tabular-nums text-cacao">
          {totalCents === null ? "—" : money(totalCents)}
        </p>
        <button
          type="button"
          onClick={() => onRemove(line.key)}
          disabled={disabled}
          aria-label={`Quitar ${line.name}${line.kind === "cake" ? ` ${line.serial}` : ""}`}
          className="-mr-2 -mt-1.5 grid h-11 w-11 shrink-0 place-items-center rounded-full text-cacao-300 transition-colors hover:bg-crema-100 hover:text-terracota disabled:opacity-50"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      </div>

      <div className={cx("grid grid-cols-2 gap-2", line.kind === "item" && "sm:grid-cols-3")}>
        {line.kind === "item" && (
          <div className="col-span-2 sm:col-span-1">
            <label htmlFor={`${id}-qty`} className={labelClass}>Cantidad</label>
            <div className="flex overflow-hidden rounded-xl border border-crema-300 bg-white">
              <button
                type="button"
                disabled={disabled || quantity <= 1}
                onClick={() => onChange(line.key, { quantity: String(Math.max(1, quantity - 1)) })}
                aria-label="Quitar uno"
                className="h-11 w-11 shrink-0 text-lg font-semibold text-cacao-700 hover:bg-crema-100 disabled:opacity-40"
              >
                −
              </button>
              <input
                id={`${id}-qty`}
                inputMode="numeric"
                autoComplete="off"
                value={line.quantity}
                disabled={disabled}
                onChange={(e) => onChange(line.key, { quantity: e.target.value.replace(/\D/g, "").slice(0, 3) })}
                className="h-11 min-w-0 flex-1 border-x border-crema-300 text-center text-[15px] font-semibold tabular-nums text-cacao focus:outline-none"
              />
              <button
                type="button"
                disabled={disabled || quantity >= 999}
                onClick={() => onChange(line.key, { quantity: String(Math.min(999, quantity + 1)) })}
                aria-label="Agregar uno"
                className="h-11 w-11 shrink-0 text-lg font-semibold text-cacao-700 hover:bg-crema-100 disabled:opacity-40"
              >
                +
              </button>
            </div>
          </div>
        )}
        <div>
          <label htmlFor={`${id}-price`} className={labelClass}>
            {line.kind === "item" ? "Precio unit." : "Precio"}
          </label>
          <input
            id={`${id}-price`}
            inputMode="decimal"
            autoComplete="off"
            placeholder="0.00"
            value={line.price}
            disabled={disabled}
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => onChange(line.key, { price: e.target.value })}
            className={cx(inputClass, "tabular-nums", error && !line.price.trim() && "border-terracota/60")}
          />
        </div>
        <div>
          <label htmlFor={`${id}-discount`} className={labelClass}>Descuento</label>
          <input
            id={`${id}-discount`}
            inputMode="decimal"
            autoComplete="off"
            placeholder="0.00"
            value={line.discount}
            disabled={disabled}
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => onChange(line.key, { discount: e.target.value })}
            className={cx(inputClass, "tabular-nums")}
          />
        </div>
      </div>

      {error && (
        <p role="alert" className="text-[13px] font-medium text-terracota">
          {error}
        </p>
      )}
    </li>
  );
}
