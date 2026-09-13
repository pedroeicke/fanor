import { EmptyState } from "@/components/admin/ui";
import { int, pct } from "./format";

/**
 * O que aconteceu com as tortas redecoradas.
 *
 * A redecoração só compensa se a torta refeita vende. Se a maioria acaba
 * comprada pelo pessoal ou no lixo, o trabalho de redecorar está custando
 * mais que descartar de uma vez.
 */

type Summary = { total: number; sold: number; staff: number; discarded: number; inStock: number; other: number };

export function RedecoratedSummary({ data }: { data: Summary }) {
  if (!data.total) return <EmptyState>Ninguna torta redecorada salió del taller en este período.</EmptyState>;

  const rows = [
    { key: "sold", label: "Vendidas", value: data.sold },
    { key: "staff", label: "Compradas por el personal", value: data.staff },
    { key: "discarded", label: "Descartadas", value: data.discarded },
    { key: "inStock", label: "Todavía en vitrina", value: data.inStock },
    { key: "other", label: "En camino, faltantes o devueltas", value: data.other },
  ].filter((row) => row.key !== "other" || row.value > 0);

  return (
    <div className="space-y-4 px-5 py-4">
      <p className="text-sm text-cacao-700">
        <span className="font-display text-3xl font-semibold text-cacao">{int(data.total)}</span>{" "}
        {data.total === 1 ? "torta redecorada despachada" : "tortas redecoradas despachadas"} en el período.
      </p>
      <dl className="space-y-3">
        {rows.map((row) => (
          <div key={row.key}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <dt className="text-cacao-700">{row.label}</dt>
              <dd className="tabular-nums text-cacao">
                <strong className="font-semibold">{int(row.value)}</strong>
                <span className="ml-2 text-[12px] text-cacao-300">{pct(row.value, data.total)}</span>
              </dd>
            </div>
            <span aria-hidden className="mt-1 block h-2 bg-crema-100">
              <span className="block h-full rounded-r-[4px] bg-dorado-600" style={{ width: row.value ? `${Math.max(2, (row.value / data.total) * 100)}%` : 0 }} />
            </span>
          </div>
        ))}
      </dl>
    </div>
  );
}
