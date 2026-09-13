import { EmptyState } from "@/components/admin/ui";
import { Legend, StackedBar } from "./StackedBar";
import { int, pct } from "./format";

/**
 * Onde a loja pede demais: produto × sabor, com o que foi despachado, o que
 * vendeu e o que sobrou (devolvida, descartada ou faltante).
 *
 * Verde e terracota aqui não são "série 1 e 2": querem dizer bom e ruim,
 * como no resto do painel. Nunca sozinhos — a legenda e os números vão junto.
 */

type Row = {
  key: string; product: string; sku: string | null; flavor: string;
  dispatched: number; sold: number; leftover: number; returned: number; discarded: number; missing: number; pending: number;
};

const LIMIT = 25;

/** "2 devueltas · 1 descartada · 1 faltante" — de onde veio a sobra, que pede ação diferente em cada caso. */
function leftoverParts(row: Row) {
  return [
    row.returned && `${int(row.returned)} ${row.returned === 1 ? "devuelta" : "devueltas"}`,
    row.discarded && `${int(row.discarded)} ${row.discarded === 1 ? "descartada" : "descartadas"}`,
    row.missing && `${int(row.missing)} ${row.missing === 1 ? "faltante" : "faltantes"}`,
  ].filter(Boolean);
}

const PARTS = [
  { key: "sold", label: "Vendidas", className: "bg-verde" },
  { key: "leftover", label: "Sobra (devuelta, descartada o faltante)", className: "bg-terracota" },
  { key: "pending", label: "Aún en tienda o en camino", className: "bg-crema-300" },
];

export function LeftoverList({ rows, dispatched }: { rows: Row[]; /** Tortas despachadas no período, para o vazio dizer a coisa certa. */ dispatched: number }) {
  if (!rows.length) {
    return (
      <EmptyState>
        {dispatched
          ? "Ninguna torta despachada en este período sobró. Todo lo enviado se vendió o sigue en tienda."
          : "Sin tortas despachadas en este período."}
      </EmptyState>
    );
  }

  return (
    <>
      <div className="px-5 pt-4">
        <Legend items={PARTS} />
      </div>
      <ol className="mt-2 divide-y divide-crema-200">
        {rows.slice(0, LIMIT).map((row) => (
          <li key={row.key} className="px-5 py-3">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <p className="min-w-0 break-words text-sm font-medium text-cacao">
                {row.product}
                {row.sku && <span className="ml-1.5 text-[12px] font-normal text-cacao-300">{row.sku}</span>}
                <span className="font-normal text-cacao-500"> · {row.flavor}</span>
              </p>
              <p className="shrink-0 text-[13px] tabular-nums text-cacao-700">
                <strong className="font-semibold text-cacao">{int(row.leftover)} de {int(row.dispatched)}</strong> sobraron ({pct(row.leftover, row.dispatched)})
              </p>
            </div>
            <StackedBar
              className="mt-2"
              label={`${row.product} ${row.flavor}`}
              segments={[
                { key: "sold", label: "Vendidas", value: row.sold, className: "bg-verde" },
                { key: "leftover", label: "Sobra", value: row.leftover, className: "bg-terracota" },
                { key: "pending", label: "Aún en tienda o en camino", value: row.pending, className: "bg-crema-300" },
              ]}
            />
            <p className="mt-1 text-[12px] text-cacao-500">
              {[
                `${int(row.sold)} ${row.sold === 1 ? "vendida" : "vendidas"}`,
                ...leftoverParts(row),
                row.pending > 0 && `${int(row.pending)} aún en tienda o en camino`,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </li>
        ))}
      </ol>
      {rows.length > LIMIT && (
        <p className="border-t border-crema-200 px-5 py-3 text-[12px] text-cacao-300">
          Se muestran las {LIMIT} combinaciones con más sobra, de {rows.length}.
        </p>
      )}
    </>
  );
}
