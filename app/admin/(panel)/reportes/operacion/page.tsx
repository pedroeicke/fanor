import type { Metadata } from "next";
import { getOperator } from "@/lib/gestion/server";
import { limaToday } from "@/lib/gestion/dates";
import { SALE_KIND } from "@/lib/gestion/labels";
import { Notice, PageHeader, Section, StatCard } from "@/components/admin/ui";
import { ReportTabs } from "@/components/admin/reportes/ReportTabs";
import { ReportFilters } from "@/components/admin/reportes/ReportFilters";
import { RankingList } from "@/components/admin/reportes/RankingList";
import { LeftoverList } from "@/components/admin/reportes/LeftoverList";
import { RedecoratedSummary } from "@/components/admin/reportes/RedecoratedSummary";
import { ColumnChart } from "@/components/admin/reportes/ColumnChart";
import { PaymentMix } from "@/components/admin/reportes/PaymentMix";
import { int, money, moneyShort, pct } from "@/components/admin/reportes/format";
import { MAX_RANGE_DAYS, bucketLabel, daySpan, loadOperationReport, parseFilters, shortDay } from "./data";

export const metadata: Metadata = { title: "Reporte de operación" };
export const dynamic = "force-dynamic";

/**
 * Relatório da operação das lojas: o que o taller mandou, o que vendeu, o
 * que sobrou e como entrou o dinheiro.
 *
 * É a tela que fecha o ciclo do fluxo novo. Sem ela o Joseka registra tudo
 * (pedido, despacho, recepção, venda) e continua sem saber a resposta que
 * motivou o projeto: "qual torta a loja pede demais?".
 */

/** Relógio lido uma vez, fora do componente: render tem de ser puro. */
function readToday() {
  return limaToday();
}

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function longDay(day: string) {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString("es-PE", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export default async function OperationReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const op = await getOperator();
  if (!op) return <Notice tone="bad">Sesión expirada. Vuelve a entrar.</Notice>;

  const today = readToday();
  const filters = parseFilters((key) => first(query[key]), today);
  const result = await loadOperationReport(op, filters);

  if (!result.ok) {
    return (
      <div className="space-y-6">
        <ReportTabs active="operacion" />
        <Notice tone="bad">{result.error} Recarga la página; si sigue igual, prueba con un período más corto.</Notice>
      </div>
    );
  }

  const r = result.report;
  const storeLabel = filters.storeId ? r.storeName(filters.storeId) : "todas las tiendas";
  const exportParams = new URLSearchParams({ desde: filters.from, hasta: filters.to, agrupar: filters.group });
  if (filters.storeId) exportParams.set("tienda", filters.storeId);
  const exportHref = (datos: "tortas" | "ventas") => `/admin/reportes/operacion/exportar?${exportParams.toString()}&datos=${datos}`;

  const { cakes, cohort, sales } = r;
  const soldTotal = cakes.sold + cakes.staffSold;
  const leftover = cohort.returned + cohort.discarded + cohort.missing;
  const hasCakeData = r.cakeRows.length > 0 || cohort.total > 0 || r.redecorated.total > 0;

  const kindParts = (field: "revenue" | "count") =>
    (["counter", "staff", "contract_advance", "contract_balance"] as const)
      .map((kind) => ({ kind, value: sales.byKind[kind]?.[field] ?? 0 }))
      .filter((p) => p.value > 0);
  const contractRevenue = (sales.byKind.contract_advance?.revenue ?? 0) + (sales.byKind.contract_balance?.revenue ?? 0);
  const revenueHint = [
    sales.byKind.counter?.revenue ? `Mostrador ${money(sales.byKind.counter.revenue)}` : null,
    contractRevenue ? `Encomiendas ${money(contractRevenue)}` : null,
    sales.byKind.staff?.revenue ? `Personal ${money(sales.byKind.staff.revenue)}` : null,
  ].filter(Boolean).join(" · ");

  const groupWord = filters.group === "semana" ? "semana" : "día";
  const span = daySpan(filters.from, filters.to);
  const periodLabel = span === 1 ? longDay(filters.from) : `${longDay(filters.from)} – ${longDay(filters.to)} (${span} días)`;

  /* Com todas as lojas no filtro, a tabela abre a faturação por loja: é o
     "por dia e por loja" sem precisar trocar o filtro e comparar de cabeça. */
  const tableStores = !filters.storeId && sales.byStore.length > 1 ? sales.byStore : [];
  const storeRevenue = new Map(sales.table.map((t) => [`${t.bucket}|${t.storeId}`, t.revenue]));

  return (
    <div className="space-y-6">
      <ReportTabs active="operacion" />

      <PageHeader
        title="Reporte de operación"
        description={`${periodLabel} · ${storeLabel}. Tortas del taller a la tienda y ventas registradas en este sistema.`}
        actions={
          <>
            <a href={exportHref("tortas")} className="inline-flex h-11 items-center rounded-full border border-crema-300 bg-white px-5 text-sm font-semibold text-cacao-700 transition-colors hover:border-cacao/35">
              CSV de tortas
            </a>
            <a href={exportHref("ventas")} className="inline-flex h-11 items-center rounded-full border border-crema-300 bg-white px-5 text-sm font-semibold text-cacao-700 transition-colors hover:border-cacao/35">
              CSV de ventas
            </a>
          </>
        }
      />

      <ReportFilters filters={filters} stores={r.stores} today={today} maxDays={MAX_RANGE_DAYS} />

      {filters.clamped && (
        <Notice tone="warn">El período pedido pasaba de {MAX_RANGE_DAYS} días. Se muestran los últimos {MAX_RANGE_DAYS} hasta el {longDay(filters.to)}.</Notice>
      )}

      {r.stockSource !== "native" && (
        <Notice tone="info">
          <strong className="font-semibold">La vitrina todavía lee el Sisgeco.</strong> Estos números salen solo del flujo nuevo: pedidos
          al taller, despachos con QR, recepción en tienda y ventas registradas en este panel. Mientras las tiendas sigan trabajando
          en el Sisgeco, aquí aparecerá poco o nada; las ventas del Sisgeco no entran en este reporte.
        </Notice>
      )}

      {/* ------------------------------------------------------------------ Tortas */}
      <h3 className="pt-2 font-display text-xl">Tortas</h3>
      {!hasCakeData && (
        <Notice tone="info">Ninguna torta pasó por el flujo nuevo en este período{filters.storeId ? " en esta tienda" : ""}.</Notice>
      )}

      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Despachadas" value={int(cakes.dispatched)} hint="Salieron del taller" />
        <StatCard label="Recibidas" value={int(cakes.received)} hint="Conferidas en tienda" />
        <StatCard label="Vendidas" value={int(soldTotal)} hint={cakes.staffSold ? `${int(cakes.staffSold)} al personal` : "Mostrador y encomiendas"} />
        <StatCard label="Devueltas" value={int(cakes.returned)} hint="Volvieron al taller" />
        <StatCard label="Redecoradas" value={int(cakes.redecorated)} hint="Rehechas en el taller" />
        <StatCard label="Descartadas" value={int(cakes.discarded)} hint="Perdidas o a la basura" />
        <StatCard label="Faltantes" value={int(cakes.missing)} hint="No llegaron a la tienda" tone={cakes.missing > 0 ? "warn" : undefined} />
        <StatCard
          label="% de sobra"
          value={pct(leftover, cohort.total)}
          hint={
            cohort.total
              ? `${int(leftover)} de ${int(cohort.total)} tortas no se vendieron${cohort.pending ? ` · ${int(cohort.pending)} aún pueden venderse` : ""}`
              : cakes.dispatched
                ? "Solo se despacharon redecoradas"
                : "Sin despachos en el período"
          }
        />
      </ul>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Más producidas" aside="por producto">
          <RankingList rows={r.producedByProduct} format={int} unit="tortas despachadas" empty="Sin tortas despachadas en este período." />
        </Section>
        <Section title="Más vendidas" aside="por producto">
          <RankingList rows={r.soldByProduct} format={int} unit="tortas vendidas" empty="Sin tortas vendidas en este período." />
        </Section>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Más vendidas por sabor" aside="con lo despachado de cada sabor">
          <RankingList rows={r.soldByFlavor} format={int} unit="tortas vendidas" empty="Sin tortas vendidas en este período." />
        </Section>
        <Section title="Redecoradas" aside="y su destino">
          <RedecoratedSummary data={r.redecorated} />
        </Section>
      </div>

      {/* A sobra conta cada torta uma vez, pelo destino dela: somar os
          eventos contaria duas vezes a que voltou e depois foi descartada. */}
      <Section title="Sobras" aside="tortas despachadas en el período (sin redecoradas), por producto y sabor">
        <LeftoverList rows={r.leftovers} dispatched={cohort.total} />
      </Section>

      {/* ------------------------------------------------------------------ Ventas */}
      <h3 className="pt-2 font-display text-xl">Ventas</h3>

      <ul className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Facturación" value={money(sales.revenue)} hint={revenueHint || "Sin ventas pagadas"} />
        <StatCard
          label="Ventas"
          value={int(sales.count)}
          hint={kindParts("count").map((p) => `${int(p.value)} ${SALE_KIND[p.kind].toLowerCase()}`).join(" · ") || "Sin ventas pagadas"}
        />
        <StatCard label="Ticket promedio" value={sales.count ? money(sales.revenue / sales.count) : "—"} hint="Facturación ÷ ventas" />
      </ul>

      <Section title={`Facturación por ${groupWord}`} aside={money(sales.revenue)}>
        <ColumnChart
          caption={`Facturación por ${groupWord}, del ${longDay(filters.from)} al ${longDay(filters.to)}`}
          formatTick={moneyShort}
          points={sales.buckets.map((b) => ({
            key: b.bucket,
            axisLabel: shortDay(b.bucket),
            label: filters.group === "semana" ? `Semana del ${shortDay(b.bucket)}` : bucketLabel(b.bucket, "dia"),
            value: b.revenue,
            display: money(b.revenue),
            detail: `${int(b.count)} ${b.count === 1 ? "venta" : "ventas"}`,
          }))}
        />
        <details className="border-t border-crema-200">
          <summary className="flex h-11 cursor-pointer items-center px-5 text-sm font-medium text-cacao-700">Ver tabla</summary>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-crema-100 text-left text-[12px] font-bold uppercase tracking-[0.12em] text-cacao-300">
                <tr>
                  <th scope="col" className="px-5 py-2.5">{filters.group === "semana" ? "Semana desde" : "Día"}</th>
                  <th scope="col" className="px-3 py-2.5 text-right">Ventas</th>
                  {tableStores.map((s) => (
                    <th key={s.storeId} scope="col" className="whitespace-nowrap px-3 py-2.5 text-right">{s.storeName}</th>
                  ))}
                  <th scope="col" className="px-3 py-2.5 text-right">{tableStores.length ? "Total" : "Facturación"}</th>
                  <th scope="col" className="px-5 py-2.5 text-right">Ticket</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-crema-200">
                {sales.buckets.map((b) => (
                  <tr key={b.bucket}>
                    <th scope="row" className="whitespace-nowrap px-5 py-2 text-left font-medium text-cacao">{longDay(b.bucket)}</th>
                    <td className="px-3 py-2 text-right tabular-nums text-cacao-700">{int(b.count)}</td>
                    {tableStores.map((s) => (
                      <td key={s.storeId} className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-cacao-700">
                        {money(storeRevenue.get(`${b.bucket}|${s.storeId}`) ?? 0)}
                      </td>
                    ))}
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums font-medium text-cacao">{money(b.revenue)}</td>
                    <td className="whitespace-nowrap px-5 py-2 text-right tabular-nums text-cacao-500">{b.count ? money(b.revenue / b.count) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </Section>

      <Section title="Formas de pago por tienda">
        <PaymentMix stores={sales.byStore} totals={sales.methodTotals} />
      </Section>

      <Section title="Facturación por producto" aside="mostrador y personal; sin adelantos ni saldos de encomienda">
        <RankingList rows={sales.revenueByProduct} format={money} empty="Sin productos vendidos en este período." />
      </Section>
    </div>
  );
}
