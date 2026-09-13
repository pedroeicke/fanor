import type { ReactNode } from "react";
import { EmptyState } from "@/components/admin/ui";

/**
 * Lista ordenada com barra proporcional ao primeiro lugar.
 *
 * Uma série só, uma cor só: a barra repete o comprimento que o número já
 * diz, então pintar cada linha de uma cor gastaria cor sem dizer nada. O
 * número fica sempre escrito ao lado — a barra é leitura rápida, não a única.
 */

export type RankingRow = { key: string; label: string; sublabel?: string; value: number; context?: string };

export function RankingList({
  rows,
  format,
  unit,
  empty,
}: {
  rows: RankingRow[];
  format: (value: number) => string;
  /** Medida na dica da linha: "tortas despachadas". Dinheiro já se explica pelo "S/". */
  unit?: string;
  empty: ReactNode;
}) {
  if (!rows.length) return <EmptyState>{empty}</EmptyState>;
  const max = Math.max(...rows.map((r) => r.value), 1);

  return (
    <ol className="divide-y divide-crema-200">
      {rows.map((row, index) => (
        <li key={row.key} className="px-5 py-3" title={`${row.label}: ${format(row.value)}${unit ? ` ${unit}` : ""}`}>
          <div className="flex items-baseline gap-3">
            <span className="w-5 shrink-0 text-[12px] tabular-nums text-cacao-300">{index + 1}</span>
            <p className="min-w-0 flex-1 break-words text-sm font-medium text-cacao">
              {row.label}
              {row.sublabel && <span className="ml-2 text-[12px] font-normal text-cacao-300">{row.sublabel}</span>}
            </p>
            <span className="shrink-0 text-sm font-semibold tabular-nums text-cacao">{format(row.value)}</span>
          </div>
          <div className="mt-1.5 flex items-center gap-3 pl-8">
            <span className="block h-2 flex-1 bg-crema-100" aria-hidden>
              <span className="block h-full rounded-r-[4px] bg-dorado-600" style={{ width: `${Math.max(2, (row.value / max) * 100)}%` }} />
            </span>
            {row.context && <span className="shrink-0 text-[12px] text-cacao-300">{row.context}</span>}
          </div>
        </li>
      ))}
    </ol>
  );
}
