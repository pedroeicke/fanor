"use client";

import { useState, type FormEvent } from "react";
import { registerCount, registerPurchase, saveArticleCost } from "@/app/admin/(panel)/insumos/actions";
import { ActionFeedback, buttonClass, useActionRunner } from "@/components/admin/catalogos/useActionRunner";
import { inputClass, labelClass } from "@/components/admin/ui";

/**
 * Lista de insumos de um lugar. Cada linha abre um formulário por vez: no celular
 * a lista é longa, e dois abertos empurrariam o botão para fora da tela.
 */

export type StockRow = {
  code: string;
  description: string;
  type: string;
  /** Na unidade de estoque. */
  quantity: number;
  unit: string;
  /** Unidades de receita em uma de estoque, quando são diferentes. */
  conversion: string | null;
  cost: number | null;
  lastCount: string | null;
};

type Mode = "count" | "purchase" | "cost";

const quantityFormat = new Intl.NumberFormat("es-PE", { maximumFractionDigits: 3 });
const costFormat = new Intl.NumberFormat("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 4 });

export function StockRows({ rows, storeId, canCost }: { rows: StockRow[]; storeId: string | null; canCost: boolean }) {
  const { pending, busyKey, feedbackFor, run } = useActionRunner();
  const [open, setOpen] = useState<{ code: string; mode: Mode } | null>(null);

  function toggle(code: string, mode: Mode) {
    setOpen((current) => (current?.code === code && current.mode === mode ? null : { code, mode }));
  }

  return (
    <ul className="divide-y divide-crema-200">
      {rows.map((row) => {
        const mode = open?.code === row.code ? open.mode : null;
        return (
          <li key={row.code} className="space-y-3 px-4 py-3 sm:px-5">
            <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
              <div className="min-w-0">
                <p className="font-medium text-cacao">{row.description}</p>
                <p className="text-[13px] text-cacao-500">
                  {row.code}
                  {row.conversion && ` · ${row.conversion}`}
                  {row.cost !== null && ` · S/ ${costFormat.format(row.cost)} por ${row.unit}`}
                </p>
                <p className="text-[12px] text-cacao-300">{row.lastCount ? `Último registro: ${row.lastCount}` : "Sin contar todavía"}</p>
              </div>
              <p className={`shrink-0 text-lg font-semibold tabular-nums ${row.quantity < 0 ? "text-terracota-700" : "text-cacao"}`}>
                {quantityFormat.format(row.quantity)} <span className="text-[13px] font-normal text-cacao-500">{row.unit}</span>
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <button type="button" className={buttonClass.outline} disabled={pending} onClick={() => toggle(row.code, "count")}>
                Contar
              </button>
              {row.type !== "PI" && (
                <button type="button" className={buttonClass.outline} disabled={pending} onClick={() => toggle(row.code, "purchase")}>
                  Compra
                </button>
              )}
              {canCost && (
                <button type="button" className={buttonClass.outline} disabled={pending} onClick={() => toggle(row.code, "cost")}>
                  Costo
                </button>
              )}
            </div>

            {mode === "count" && (
              <CountForm
                row={row}
                busy={busyKey === `count:${row.code}`}
                pending={pending}
                onSubmit={(counted, notes) =>
                  run(`count:${row.code}`, () => registerCount({ code: row.code, storeId, counted, notes }), {
                    success: "Conteo registrado.",
                    onSuccess: () => setOpen(null),
                  })
                }
              />
            )}
            {mode === "purchase" && (
              <PurchaseForm
                row={row}
                busy={busyKey === `purchase:${row.code}`}
                pending={pending}
                onSubmit={(quantity, unitCost, document, notes) =>
                  run(`purchase:${row.code}`, () => registerPurchase({ code: row.code, storeId, quantity, unitCost, document, notes }), {
                    success: "Compra registrada.",
                    onSuccess: () => setOpen(null),
                  })
                }
              />
            )}
            {mode === "cost" && (
              <CostForm
                row={row}
                busy={busyKey === `cost:${row.code}`}
                pending={pending}
                onSubmit={(cost) =>
                  run(`cost:${row.code}`, () => saveArticleCost(row.code, cost), {
                    success: "Costo guardado.",
                    onSuccess: () => setOpen(null),
                  })
                }
              />
            )}
            <ActionFeedback feedback={feedbackFor(row.code)} />
          </li>
        );
      })}
    </ul>
  );
}

function CountForm({ row, busy, pending, onSubmit }: { row: StockRow; busy: boolean; pending: boolean; onSubmit: (counted: string, notes: string) => void }) {
  const [counted, setCounted] = useState("");
  const [notes, setNotes] = useState("");
  function submit(event: FormEvent) {
    event.preventDefault();
    if (counted.trim()) onSubmit(counted, notes);
  }
  return (
    <form onSubmit={submit} className="grid gap-3 rounded-xl bg-crema-100 p-3 sm:grid-cols-2">
      <label className="block">
        <span className={labelClass}>Cuánto hay ({row.unit})</span>
        <input className={inputClass} inputMode="decimal" autoFocus value={counted} onChange={(e) => setCounted(e.target.value)} />
      </label>
      <label className="block">
        <span className={labelClass}>Observación (opcional)</span>
        <input className={inputClass} maxLength={200} placeholder="Inventario inicial" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      <p className="text-[13px] text-cacao-500 sm:col-span-2">La diferencia con el saldo actual queda como ajuste.</p>
      <div className="sm:col-span-2">
        <button type="submit" className={buttonClass.primary} disabled={pending || !counted.trim()}>
          {busy ? "Guardando…" : "Guardar conteo"}
        </button>
      </div>
    </form>
  );
}

function PurchaseForm({
  row,
  busy,
  pending,
  onSubmit,
}: {
  row: StockRow;
  busy: boolean;
  pending: boolean;
  onSubmit: (quantity: string, unitCost: string, document: string, notes: string) => void;
}) {
  const [quantity, setQuantity] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [document, setDocument] = useState("");
  const [notes, setNotes] = useState("");
  function submit(event: FormEvent) {
    event.preventDefault();
    if (quantity.trim()) onSubmit(quantity, unitCost, document, notes);
  }
  return (
    <form onSubmit={submit} className="grid gap-3 rounded-xl bg-crema-100 p-3 sm:grid-cols-2">
      <label className="block">
        <span className={labelClass}>Cantidad ({row.unit})</span>
        <input className={inputClass} inputMode="decimal" autoFocus value={quantity} onChange={(e) => setQuantity(e.target.value)} />
      </label>
      <label className="block">
        <span className={labelClass}>Costo por {row.unit}, S/ (opcional)</span>
        <input className={inputClass} inputMode="decimal" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} />
      </label>
      <label className="block">
        <span className={labelClass}>Factura o guía (opcional)</span>
        <input className={inputClass} maxLength={200} value={document} onChange={(e) => setDocument(e.target.value)} />
      </label>
      <label className="block">
        <span className={labelClass}>Observación (opcional)</span>
        <input className={inputClass} maxLength={200} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      <div className="sm:col-span-2">
        <button type="submit" className={buttonClass.primary} disabled={pending || !quantity.trim()}>
          {busy ? "Guardando…" : "Guardar compra"}
        </button>
      </div>
    </form>
  );
}

function CostForm({ row, busy, pending, onSubmit }: { row: StockRow; busy: boolean; pending: boolean; onSubmit: (cost: string) => void }) {
  const [cost, setCost] = useState(row.cost === null ? "" : String(row.cost));
  function submit(event: FormEvent) {
    event.preventDefault();
    onSubmit(cost);
  }
  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-3 rounded-xl bg-crema-100 p-3">
      <label className="block min-w-44 flex-1">
        <span className={labelClass}>Costo por {row.unit}, S/</span>
        <input className={inputClass} inputMode="decimal" autoFocus value={cost} onChange={(e) => setCost(e.target.value)} />
      </label>
      <button type="submit" className={buttonClass.primary} disabled={pending}>
        {busy ? "Guardando…" : "Guardar costo"}
      </button>
    </form>
  );
}
