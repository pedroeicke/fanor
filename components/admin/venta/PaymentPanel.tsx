"use client";

import { cx } from "@/lib/format";
import { PAYMENT_METHOD } from "@/lib/gestion/labels";
import { Section, inputClass, labelClass } from "@/components/admin/ui";
import { COUNTER_METHODS, centsToInput, igvIncluded, money, type CounterMethod, type Settlement } from "./money";
import type { PaymentLine } from "./types";

const REFERENCE_HINT: Record<CounterMethod, string> = {
  cash: "",
  yape: "N.º de operación",
  plin: "N.º de operación",
  card: "Voucher o últimos 4 dígitos",
  transfer: "N.º de operación",
};

/* Notas que a loja mais recebe. "S/ 50" em um toque é mais rápido e erra
   menos do que digitar "50.00" com o cliente esperando. */
const BILLS = [1000, 2000, 5000, 10000, 20000];

/**
 * Formas de pagamento, com divisão e vuelto.
 *
 * Tocar a forma cria o pagamento com o que falta. Para dividir, toca outra
 * e digita quanto vai nela; o efectivo, se houver, fica com o resto. Só o
 * dinheiro pode passar do total — é de onde sai o vuelto.
 */
export function PaymentPanel({
  totalCents,
  payments,
  resolved,
  settlement,
  disabled,
  onAdd,
  onAmount,
  onReference,
  onRemove,
}: {
  totalCents: number;
  payments: PaymentLine[];
  /** Valor efetivo de cada pagamento (null = inválido), na ordem de `payments`. */
  resolved: (number | null)[];
  settlement: Settlement;
  disabled?: boolean;
  onAdd: (method: CounterMethod) => void;
  onAmount: (key: string, value: string) => void;
  onReference: (key: string, value: string) => void;
  onRemove: (key: string) => void;
}) {
  const hasCash = payments.some((p) => p.method === "cash");
  const nonCash = payments.reduce((sum, p, i) => (p.method === "cash" ? sum : sum + (resolved[i] ?? 0)), 0);
  const exactCash = Math.max(0, totalCents - nonCash);

  return (
    <Section title="Cobro" aside={<span className="tabular-nums">IGV incluido {money(igvIncluded(totalCents))}</span>}>
      <div className="space-y-4 p-4 sm:p-5">
        {/* Efectivo ocupa a linha inteira no celular: foi quase 9 de cada 10 pagamentos nos comprovantes do Sisgeco. */}
        <div className="grid grid-cols-2 gap-2 md:grid-cols-5 lg:grid-cols-2" role="group" aria-label="Forma de pago">
          {COUNTER_METHODS.map((method) => {
            const active = payments.some((p) => p.method === method);
            return (
              <button
                key={method}
                type="button"
                disabled={disabled || (method === "cash" && hasCash)}
                onClick={() => onAdd(method)}
                aria-pressed={active}
                className={cx(
                  "h-12 rounded-xl border px-2 text-sm font-semibold leading-tight transition-colors",
                  method === "cash" && "col-span-2 md:col-span-1 lg:col-span-2",
                  active
                    ? "border-dorado-600 bg-dorado-100 text-cacao"
                    : "border-crema-300 bg-white text-cacao-700 hover:border-cacao/35",
                  "disabled:cursor-default",
                  disabled && "opacity-50",
                )}
              >
                {PAYMENT_METHOD[method]}
              </button>
            );
          })}
        </div>

        {!payments.length && totalCents > 0 && (
          <p className="text-sm text-cacao-500">Toca la forma de pago. Para dividir el pago, toca otra más.</p>
        )}

        {!!payments.length && (
          <ul className="space-y-3">
            {payments.map((payment, i) => {
              const id = `venta-pago-${payment.key}`;
              const isCash = payment.method === "cash";
              const bills = BILLS.filter((b) => b > exactCash).slice(0, 3);
              return (
                <li key={payment.key} className="rounded-2xl border border-crema-300 bg-crema-100/60 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-semibold text-cacao">{PAYMENT_METHOD[payment.method]}</p>
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => onRemove(payment.key)}
                      className="-mr-1 h-11 rounded-full px-3 text-sm font-medium text-terracota hover:bg-white disabled:opacity-50"
                    >
                      Quitar
                    </button>
                  </div>

                  <div className="mt-1 space-y-2">
                    <div>
                      <label htmlFor={`${id}-monto`} className={labelClass}>
                        {isCash ? "Recibido" : "Monto"}
                      </label>
                      <input
                        id={`${id}-monto`}
                        inputMode="decimal"
                        autoComplete="off"
                        placeholder="0.00"
                        disabled={disabled}
                        value={payment.auto ? centsToInput(resolved[i]) : payment.amount}
                        onFocus={(e) => e.currentTarget.select()}
                        onChange={(e) => onAmount(payment.key, e.target.value)}
                        className={cx(inputClass, "text-lg font-semibold tabular-nums", resolved[i] === null && "border-terracota/60")}
                      />
                    </div>

                    {isCash ? (
                      exactCash > 0 && (
                        <div className="flex flex-wrap gap-2">
                          <QuickAmount label="Exacto" disabled={disabled} onClick={() => onAmount(payment.key, centsToInput(exactCash))} />
                          {bills.map((bill) => (
                            <QuickAmount
                              key={bill}
                              label={money(bill).replace(".00", "")}
                              disabled={disabled}
                              onClick={() => onAmount(payment.key, centsToInput(bill))}
                            />
                          ))}
                        </div>
                      )
                    ) : (
                      <div>
                        <label htmlFor={`${id}-ref`} className={labelClass}>Referencia (opcional)</label>
                        <input
                          id={`${id}-ref`}
                          autoComplete="off"
                          maxLength={60}
                          placeholder={REFERENCE_HINT[payment.method]}
                          disabled={disabled}
                          value={payment.reference}
                          onChange={(e) => onReference(payment.key, e.target.value)}
                          className={inputClass}
                        />
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <dl className="space-y-1.5 border-t border-crema-200 pt-3 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-cacao-500">Total</dt>
            <dd className="font-semibold tabular-nums text-cacao">{money(totalCents)}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-cacao-500">Pagado</dt>
            <dd className="tabular-nums text-cacao-700">{money(settlement.paid)}</dd>
          </div>
          {settlement.missing > 0 && (
            <div className="flex justify-between gap-3">
              <dt className="font-medium text-terracota">Falta</dt>
              <dd className="font-semibold tabular-nums text-terracota">{money(settlement.missing)}</dd>
            </div>
          )}
        </dl>

        {settlement.change > 0 && !settlement.error && (
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-dorado-600/40 bg-dorado-100 px-4 py-3">
            <span className="font-semibold text-cacao-700">Vuelto</span>
            <span className="font-display text-3xl font-semibold tabular-nums text-cacao">{money(settlement.change)}</span>
          </div>
        )}
      </div>
    </Section>
  );
}

function QuickAmount({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="h-11 min-w-16 rounded-full border border-crema-300 bg-white px-4 text-sm font-semibold tabular-nums text-cacao-700 hover:border-cacao/35 disabled:opacity-50"
    >
      {label}
    </button>
  );
}
