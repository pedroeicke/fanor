"use client";

import { useState } from "react";
import { cx } from "@/lib/format";
import { LeadCard } from "./LeadCard";
import type { LeadView, SellerOption, StoreOption } from "./shared";

/**
 * Quadro dos leads por estado.
 *
 * No computador, quatro colunas lado a lado (o Joseka vê o funil inteiro).
 * No celular, abas: quatro colunas de 90 px não mostram nada, e a vendedora
 * quer uma fila por vez. A aba escolhida sobrevive à atualização automática
 * da página, porque o estado fica aqui e a página só troca os dados.
 */

type ColumnKey = "new" | "assigned" | "contacted" | "closed";

const COLUMNS: { key: ColumnKey; label: string; hint?: string; empty: string }[] = [
  { key: "new", label: "Sin asignar", empty: "Ningún lead esperando tienda." },
  { key: "assigned", label: "Asignado", empty: "Nadie esperando el primer mensaje." },
  { key: "contacted", label: "Contactado", empty: "Sin conversaciones abiertas." },
  { key: "closed", label: "Cerrados", hint: "últimos 7 días", empty: "Nada cerrado en los últimos 7 días." },
];

export function LeadBoard({
  columns,
  stores,
  sellers,
  slaMin,
  serverNow,
  template,
  writerName,
  userName,
  defaultStoreId,
}: {
  columns: Record<ColumnKey, LeadView[]>;
  stores: StoreOption[];
  sellers: SellerOption[];
  slaMin: number;
  serverNow: number;
  template: string;
  writerName: string | null;
  userName: string;
  defaultStoreId: string | null;
}) {
  /* Abre na primeira fila com gente esperando: é a que precisa de ação. */
  const [tab, setTab] = useState<ColumnKey>(
    () => COLUMNS.find((c) => c.key !== "closed" && columns[c.key].length)?.key ?? "new",
  );

  return (
    <section aria-label="Leads por estado" className="space-y-3">
      <div role="tablist" aria-label="Estado" className="grid grid-cols-4 gap-1 rounded-2xl border border-crema-300 bg-crema-100 p-1 lg:hidden">
        {COLUMNS.map((column) => {
          const active = column.key === tab;
          const count = columns[column.key].length;
          return (
            <button
              key={column.key}
              type="button"
              role="tab"
              id={`tab-${column.key}`}
              aria-selected={active}
              aria-controls={`col-${column.key}`}
              onClick={() => setTab(column.key)}
              className={cx(
                "flex min-h-14 flex-col items-center justify-center rounded-xl px-1 leading-tight transition-colors",
                active ? "bg-white text-cacao shadow-[0_1px_2px_rgb(59_35_20/0.1)]" : "text-cacao-500",
              )}
            >
              <span
                className={cx(
                  "font-display text-lg font-semibold tabular-nums",
                  column.key === "new" && count > 0 && "text-terracota",
                )}
              >
                {count}
              </span>
              <span className="text-[11px] font-semibold">{column.label}</span>
            </button>
          );
        })}
      </div>

      <div className="grid gap-4 lg:grid-cols-4">
        {COLUMNS.map((column) => {
          const leads = columns[column.key];
          return (
            <div
              key={column.key}
              id={`col-${column.key}`}
              role="tabpanel"
              aria-labelledby={`tab-${column.key}`}
              className={cx("space-y-3", column.key !== tab && "hidden lg:block")}
            >
              <h3 className="hidden items-baseline justify-between gap-2 border-b border-crema-200 pb-2 lg:flex">
                <span className="font-display text-lg">{column.label}</span>
                <span className="text-sm text-cacao-500">
                  {column.hint ? `${column.hint} · ` : ""}
                  <span className="font-semibold tabular-nums text-cacao">{leads.length}</span>
                </span>
              </h3>
              {column.hint && <p className="text-[13px] text-cacao-500 lg:hidden">Cerrados en los {column.hint}.</p>}
              {leads.map((lead) => (
                <LeadCard
                  key={lead.id}
                  lead={lead}
                  stores={stores}
                  sellers={sellers}
                  slaMin={slaMin}
                  serverNow={serverNow}
                  template={template}
                  writerName={writerName}
                  userName={userName}
                  defaultStoreId={defaultStoreId}
                />
              ))}
              {!leads.length && (
                <p className="rounded-2xl border border-dashed border-crema-300 px-4 py-8 text-center text-sm text-cacao-500">
                  {column.empty}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
