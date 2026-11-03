"use client";

import { useState, type FormEvent } from "react";
import { saveExpense, voidExpense } from "@/app/admin/(panel)/gastos/actions";
import { ActionFeedback, buttonClass, useActionRunner } from "@/components/admin/catalogos/useActionRunner";
import { ReasonAction } from "@/components/admin/taller/ReasonAction";
import { EmptyState, inputClass, labelClass } from "@/components/admin/ui";
import { formatDateShort } from "@/lib/delivery";
import { cx, soles } from "@/lib/format";

/**
 * Lançamento do dia e correção do que já foi lançado. Corrigir usa o mesmo
 * formulário, no alto da tela: quem lança todo dia não precisa aprender outro.
 */

export type ExpenseRow = {
  id: string;
  spentOn: string;
  code: string;
  concept: string;
  amount: number;
  storeId: string;
  storeName: string | null;
  document: string;
  notes: string;
  voided: boolean;
  voidReason: string | null;
};

type Concept = { code: string; description: string; type: string };
type Store = { id: string; name: string };

export function ExpenseBoard({ rows, concepts, stores, today }: { rows: ExpenseRow[]; concepts: Concept[]; stores: Store[]; today: string }) {
  const { pending, busyKey, feedbackFor, run } = useActionRunner();
  const [editing, setEditing] = useState<ExpenseRow | null>(null);

  return (
    <div className="space-y-6">
      <section className="card space-y-3 p-4 sm:p-5">
        <h2 className="font-semibold text-cacao">{editing ? "Corregir gasto" : "Nuevo gasto"}</h2>
        <ExpenseForm
          key={editing?.id ?? "new"}
          initial={editing}
          today={today}
          concepts={concepts}
          stores={stores}
          pending={pending}
          busy={busyKey === "save"}
          onCancel={editing ? () => setEditing(null) : null}
          onSubmit={(values, reset) =>
            run("save", () => saveExpense({ id: editing?.id ?? null, ...values }), {
              success: editing ? "Gasto corregido." : "Gasto guardado.",
              onSuccess: () => {
                setEditing(null);
                reset();
              },
            })
          }
        />
        <ActionFeedback feedback={feedbackFor()} />
      </section>

      <section className="card overflow-hidden">
        <h2 className="border-b border-crema-200 px-4 py-3 font-semibold text-cacao sm:px-5">Gastos del mes</h2>
        {rows.length === 0 ? (
          <EmptyState>Todavía no hay gastos en este mes.</EmptyState>
        ) : (
          <ul className="divide-y divide-crema-200">
            {rows.map((row) => (
              <li key={row.id} className={cx("space-y-2 px-4 py-3 sm:px-5", row.voided && "opacity-60")}>
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <div className="min-w-0">
                    <p className={cx("font-medium text-cacao", row.voided && "line-through")}>{row.concept}</p>
                    <p className="text-[13px] text-cacao-500">
                      {formatDateShort(row.spentOn)}
                      {row.storeName && ` · ${row.storeName}`}
                      {row.document && ` · ${row.document}`}
                      {row.notes && ` · ${row.notes}`}
                    </p>
                    {row.voided && <p className="text-[13px] font-medium text-terracota-700">Anulado: {row.voidReason}</p>}
                  </div>
                  <p className="shrink-0 font-semibold tabular-nums text-cacao">{soles(row.amount)}</p>
                </div>
                {!row.voided && (
                  <div className="flex flex-wrap items-start gap-2">
                    <button type="button" className={buttonClass.outline} disabled={pending} onClick={() => setEditing(row)}>
                      Corregir
                    </button>
                    <ReasonAction
                      action={voidExpense.bind(null, row.id)}
                      label="Anular"
                      confirmLabel="Sí, anular"
                      prompt={`¿Anular ${row.concept} de ${soles(row.amount)}? Sale de la suma y queda en el registro.`}
                      suggestions={["Registrado dos veces", "Monto equivocado", "No corresponde"]}
                      requireReason
                      tone="danger"
                    />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

type Values = { spentOn: string; code: string; amount: string; storeId: string; document: string; notes: string };

function ExpenseForm({
  initial,
  today,
  concepts,
  stores,
  pending,
  busy,
  onCancel,
  onSubmit,
}: {
  initial: ExpenseRow | null;
  today: string;
  concepts: Concept[];
  stores: Store[];
  pending: boolean;
  busy: boolean;
  onCancel: (() => void) | null;
  onSubmit: (values: Values, reset: () => void) => void;
}) {
  const blank: Values = { spentOn: today, code: "", amount: "", storeId: "", document: "", notes: "" };
  const [values, setValues] = useState<Values>(
    initial
      ? { spentOn: initial.spentOn, code: initial.code, amount: String(initial.amount), storeId: initial.storeId, document: initial.document, notes: initial.notes }
      : blank,
  );
  const set = (key: keyof Values, value: string) => setValues((v) => ({ ...v, [key]: value }));

  function submit(event: FormEvent) {
    event.preventDefault();
    if (values.code && values.amount.trim()) onSubmit(values, () => setValues((v) => ({ ...blank, spentOn: v.spentOn })));
  }

  const groups = [
    { label: "Consumibles", items: concepts.filter((c) => c.type === "CS") },
    { label: "Servicios", items: concepts.filter((c) => c.type === "SV") },
  ];

  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
      <label className="block">
        <span className={labelClass}>Fecha</span>
        <input type="date" className={inputClass} max={today} value={values.spentOn} onChange={(e) => set("spentOn", e.target.value)} />
      </label>
      <label className="block">
        <span className={labelClass}>Monto, S/</span>
        <input className={inputClass} inputMode="decimal" value={values.amount} onChange={(e) => set("amount", e.target.value)} />
      </label>
      <label className="block sm:col-span-2">
        <span className={labelClass}>Concepto</span>
        <select className={inputClass} value={values.code} onChange={(e) => set("code", e.target.value)}>
          <option value="">Elegir</option>
          {groups.map((group) => (
            <optgroup key={group.label} label={group.label}>
              {group.items.map((item) => (
                <option key={item.code} value={item.code}>
                  {item.description}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      <label className="block">
        <span className={labelClass}>Tienda (opcional)</span>
        <select className={inputClass} value={values.storeId} onChange={(e) => set("storeId", e.target.value)}>
          <option value="">General</option>
          {stores.map((store) => (
            <option key={store.id} value={store.id}>
              {store.name}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className={labelClass}>Comprobante (opcional)</span>
        <input className={inputClass} maxLength={200} value={values.document} onChange={(e) => set("document", e.target.value)} />
      </label>
      <label className="block sm:col-span-2">
        <span className={labelClass}>Observación (opcional)</span>
        <input className={inputClass} maxLength={200} value={values.notes} onChange={(e) => set("notes", e.target.value)} />
      </label>
      <div className="flex flex-wrap gap-2 sm:col-span-2">
        <button type="submit" className={buttonClass.primary} disabled={pending || !values.code || !values.amount.trim()}>
          {busy ? "Guardando…" : initial ? "Guardar corrección" : "Guardar gasto"}
        </button>
        {onCancel && (
          <button type="button" className={buttonClass.outline} disabled={pending} onClick={onCancel}>
            Cancelar
          </button>
        )}
      </div>
    </form>
  );
}
