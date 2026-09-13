"use client";

import { PAYMENT_METHOD } from "@/lib/gestion/labels";
import { cx, soles } from "@/lib/format";
import { inputClass, labelClass } from "@/components/admin/ui";
import { LIMITS, PAY_METHODS, checkPayments, parseMoney, type PayMethod } from "./shared";

/**
 * Campos de pagamento: a forma em botões (um toque, sem abrir select no
 * celular) e o valor em teclado decimal.
 */

export function MethodChips({ value, onChange, name }: { value: string; onChange: (m: PayMethod) => void; name: string }) {
  return (
    <div role="radiogroup" aria-label={name} className="flex flex-wrap gap-2">
      {PAY_METHODS.map((m) => (
        <button
          key={m}
          type="button"
          role="radio"
          aria-checked={value === m}
          onClick={() => onChange(m)}
          className={cx(
            "h-11 rounded-full border px-4 text-sm font-semibold transition-colors",
            value === m ? "border-dorado bg-dorado text-cacao" : "border-crema-300 bg-white text-cacao-700 hover:border-cacao/35",
          )}
        >
          {PAYMENT_METHOD[m]}
        </button>
      ))}
    </div>
  );
}

export type PaymentDraft = { key: string; method: PayMethod; amount: string; reference: string };

let seq = 0;
export function newPayment(method: PayMethod, amount: string): PaymentDraft {
  seq += 1;
  return { key: `p${seq}`, method, amount, reference: "" };
}

/** Converte o rascunho; null se algum valor estiver ilegível. */
export function parsePayments(drafts: PaymentDraft[]) {
  const out: { method: PayMethod; amount: number; reference: string }[] = [];
  for (const d of drafts) {
    if (!d.amount.trim()) continue;
    const amount = parseMoney(d.amount);
    if (amount === null) return null;
    if (amount > 0) out.push({ method: d.method, amount, reference: d.reference.trim() });
  }
  return out;
}

/**
 * Pagamento do saldo, podendo dividir (parte Yape, parte efectivo). Mostra o
 * vuelto antes de confirmar: é o número que a vendedora conta na mão.
 */
export function PaymentEditor({
  due,
  drafts,
  onChange,
  disabled,
}: {
  due: number;
  drafts: PaymentDraft[];
  onChange: (next: PaymentDraft[]) => void;
  disabled?: boolean;
}) {
  const parsed = parsePayments(drafts);
  const check = parsed ? checkPayments(due, parsed) : null;

  function update(key: string, patch: Partial<PaymentDraft>) {
    onChange(drafts.map((d) => (d.key === key ? { ...d, ...patch } : d)));
  }

  function add() {
    const paid = parsed?.reduce((s, p) => s + p.amount, 0) ?? 0;
    const rest = Math.max(0, Math.round((due - paid) * 100) / 100);
    onChange([...drafts, newPayment("yape", rest > 0 ? rest.toFixed(2) : "")]);
  }

  return (
    <div className="space-y-3">
      {drafts.map((d, i) => (
        <fieldset key={d.key} disabled={disabled} aria-label={`Pago ${i + 1}`} className="space-y-2 rounded-2xl border border-crema-300 bg-crema-100 p-3">
          <div className="flex min-h-11 items-center justify-between gap-2">
            <p className="text-sm font-semibold text-cacao">Pago {drafts.length > 1 ? i + 1 : ""}</p>
            {drafts.length > 1 && (
              <button
                type="button"
                onClick={() => onChange(drafts.filter((x) => x.key !== d.key))}
                className="h-11 px-2 text-sm font-semibold text-terracota"
              >
                Quitar
              </button>
            )}
          </div>
          <MethodChips name={`Forma del pago ${i + 1}`} value={d.method} onChange={(method) => update(d.key, { method })} />
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <label htmlFor={`${d.key}-amount`} className={labelClass}>Monto (S/)</label>
              <input
                id={`${d.key}-amount`}
                className={inputClass}
                inputMode="decimal"
                autoComplete="off"
                value={d.amount}
                onChange={(e) => update(d.key, { amount: e.target.value })}
              />
            </div>
            {d.method !== "cash" && (
              <div>
                <label htmlFor={`${d.key}-ref`} className={labelClass}>N.º de operación</label>
                <input
                  id={`${d.key}-ref`}
                  className={inputClass}
                  maxLength={LIMITS.reference}
                  autoComplete="off"
                  value={d.reference}
                  onChange={(e) => update(d.key, { reference: e.target.value })}
                  placeholder="Opcional"
                />
              </div>
            )}
          </div>
        </fieldset>
      ))}

      {drafts.length < LIMITS.payments && (
        <button
          type="button"
          onClick={add}
          disabled={disabled}
          className="h-11 w-full rounded-full border border-cacao/25 px-4 text-sm font-semibold text-cacao hover:bg-crema-100 disabled:opacity-50"
        >
          + Dividir en otra forma de pago
        </button>
      )}

      <dl className="space-y-1 rounded-2xl bg-white px-4 py-3 text-sm ring-1 ring-crema-300">
        <div className="flex justify-between"><dt className="text-cacao-500">A cobrar</dt><dd className="font-semibold tabular-nums">{soles(due)}</dd></div>
        <div className="flex justify-between"><dt className="text-cacao-500">Recibido</dt><dd className="tabular-nums">{parsed ? soles(check?.paid ?? 0) : "—"}</dd></div>
        {check?.ok && check.change > 0 && (
          <div className="flex justify-between text-base"><dt className="font-semibold text-verde">Vuelto</dt><dd className="font-bold tabular-nums text-verde">{soles(check.change)}</dd></div>
        )}
        {!parsed && <p role="alert" className="pt-1 text-terracota">Hay un monto con formato inválido.</p>}
        {check && !check.ok && <p role="alert" className="pt-1 font-semibold text-terracota">{check.error}</p>}
      </dl>
    </div>
  );
}
