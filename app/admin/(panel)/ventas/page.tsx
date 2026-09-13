import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { friendlyDbError, getOperator, shortStoreName } from "@/lib/gestion/server";
import { addDays, limaDateTime, limaTime, limaToday } from "@/lib/gestion/dates";
import { PAYMENT_METHOD, SALE_KIND, TONE_CLASS } from "@/lib/gestion/labels";
import { cx } from "@/lib/format";
import { AutoRefresh } from "@/components/admin/AutoRefresh";
import { EmptyState, Notice, PageHeader, Section, StatCard, inputClass, labelClass } from "@/components/admin/ui";
import { money, solesToCents } from "@/components/admin/venta/money";
import { daysBetween, shortDay } from "@/components/admin/venta/format";

export const metadata: Metadata = { title: "Ventas" };
export const dynamic = "force-dynamic";

/**
 * Vendas registradas no sistema novo, com o arqueo por forma de pagamento e
 * a fila de boleta pendente.
 *
 * O arqueo é o que a vendedora confere contra a gaveta no fim do turno: o
 * dinheiro já vem líquido do vuelto (o banco desconta na hora de gravar),
 * então "Efectivo" é o que deveria estar no caixa.
 */

/** Linhas na tabela. O arqueo soma o período inteiro, não só estas. */
const LIST_LIMIT = 300;
/** Mais que isto num período de 31 dias não é balcão, é erro. */
const MAX_PAID_ROWS = 30_000;
const MAX_DAYS = 31;
/* O Peru não tem horário de verão desde 1994: o dia de Lima é sempre UTC−5.
   Filtrar por "2026-09-13" em UTC perderia as vendas depois das 19h. */
const LIMA_OFFSET = "-05:00";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const METHOD_ORDER = ["cash", "yape", "plin", "card", "transfer", "deposit", "credit"];

type Filters = { from: string; to: string; storeId: string; kind: string; pending: boolean; clamped: boolean };

type ListRow = {
  id: string;
  number: number;
  sold_at: string;
  kind: string;
  status: string;
  total: number | string;
  fiscal_pending: boolean;
  stores: { name: string } | null;
  sellers: { name: string } | null;
  customers: { name: string } | null;
  sale_payments: { method: string; amount: number | string }[];
};

type PaidRow = {
  store_id: string;
  total: number | string;
  fiscal_pending: boolean;
  stores: { name: string } | null;
  sale_payments: { method: string; amount: number | string }[];
};

type StoreSummary = { id: string; name: string; count: number; totalCents: number; pending: number; methods: Map<string, number> };

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

/** "AAAA-MM-DD" que existe no calendário (30 de fevereiro não passa). */
function isDay(value: string | undefined): value is string {
  return !!value && /^\d{4}-\d{2}-\d{2}$/.test(value) && addDays(value, 0) === value;
}

function parseFilters(params: Record<string, string | string[] | undefined>, today: string): Filters {
  const desde = first(params.desde);
  const hasta = first(params.hasta);
  let from = isDay(desde) ? desde : today;
  let to = isDay(hasta) ? hasta : from > today ? from : today;
  if (to < from) [from, to] = [to, from];

  let clamped = false;
  if (daysBetween(from, to) >= MAX_DAYS) {
    to = addDays(from, MAX_DAYS - 1);
    clamped = true;
  }

  const tienda = first(params.tienda) ?? "";
  const tipo = first(params.tipo) ?? "";
  return {
    from,
    to,
    clamped,
    storeId: UUID.test(tienda) ? tienda : "",
    kind: Object.hasOwn(SALE_KIND, tipo) ? tipo : "",
    pending: first(params.pendiente) === "1",
  };
}

function salesQuery(db: SupabaseClient, columns: string, f: Filters, count?: "exact") {
  let query = db
    .from("sales")
    .select(columns, count ? { count } : undefined)
    .gte("sold_at", `${f.from}T00:00:00${LIMA_OFFSET}`)
    .lt("sold_at", `${addDays(f.to, 1)}T00:00:00${LIMA_OFFSET}`);
  if (f.storeId) query = query.eq("store_id", f.storeId);
  if (f.kind) query = query.eq("kind", f.kind);
  if (f.pending) query = query.eq("fiscal_pending", true);
  return query;
}

/**
 * Todas as vendas pagas do período, em páginas: o PostgREST corta cada
 * resposta (1000 linhas no Supabase), e um arqueo que soma só a primeira
 * página fecha errado sem avisar ninguém.
 */
async function loadPaid(db: SupabaseClient, f: Filters) {
  const columns = "id, store_id, total, fiscal_pending, stores(name), sale_payments(method, amount)";
  const rows: PaidRow[] = [];
  let expected: number | null = null;

  while (expected === null || rows.length < expected) {
    const { data, error, count } = await salesQuery(db, columns, f, expected === null ? "exact" : undefined)
      .eq("status", "paid")
      .order("sold_at")
      .order("id")
      .range(rows.length, rows.length + 999);
    if (error) return { rows, error: friendlyDbError(error), truncated: false };
    if (expected === null) expected = Math.min(count ?? 0, MAX_PAID_ROWS);
    const page = (data ?? []) as unknown as PaidRow[];
    if (!page.length) break;
    rows.push(...page);
  }
  return { rows: rows.slice(0, MAX_PAID_ROWS), error: null, truncated: (expected ?? 0) >= MAX_PAID_ROWS };
}

function summarize(rows: PaidRow[]) {
  const stores = new Map<string, StoreSummary>();
  const all: StoreSummary = { id: "all", name: "Todas las tiendas", count: 0, totalCents: 0, pending: 0, methods: new Map() };

  for (const sale of rows) {
    const summary =
      stores.get(sale.store_id) ??
      { id: sale.store_id, name: shortStoreName(sale.stores?.name), count: 0, totalCents: 0, pending: 0, methods: new Map<string, number>() };
    stores.set(sale.store_id, summary);

    const total = solesToCents(sale.total);
    for (const target of [summary, all]) {
      target.count += 1;
      target.totalCents += total;
      if (sale.fiscal_pending) target.pending += 1;
      for (const payment of sale.sale_payments ?? []) {
        target.methods.set(payment.method, (target.methods.get(payment.method) ?? 0) + solesToCents(payment.amount));
      }
    }
  }
  return { stores: [...stores.values()].sort((a, b) => a.name.localeCompare(b.name, "es")), all };
}

function sortedMethods(methods: Map<string, number>) {
  return [...methods.entries()].sort((a, b) => METHOD_ORDER.indexOf(a[0]) - METHOD_ORDER.indexOf(b[0]));
}

export default async function VentasPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const op = await getOperator();
  if (!op) return <Notice tone="bad">Sesión expirada. Vuelve a entrar.</Notice>;

  const today = limaToday();
  const f = parseFilters(await searchParams, today);
  const singleDay = f.from === f.to;

  const [{ data: storeRows }, list, paid] = await Promise.all([
    op.db.from("stores").select("id, name").eq("active", true).order("sort_order"),
    salesQuery(
      op.db,
      "id, number, sold_at, kind, status, total, fiscal_pending, stores(name), sellers(name), customers(name), sale_payments(method, amount)",
      f,
      "exact",
    )
      .order("sold_at", { ascending: false })
      .limit(LIST_LIMIT),
    loadPaid(op.db, f),
  ]);

  const sales = (list.data ?? []) as unknown as ListRow[];
  const listError = list.error ? friendlyDbError(list.error) : null;
  const totalListed = list.count ?? sales.length;
  const { stores: byStore, all } = summarize(paid.rows);
  const periodLabel = singleDay
    ? f.from === today
      ? `Hoy, ${shortDay(f.from)}`
      : shortDay(f.from)
    : `Del ${shortDay(f.from)} al ${shortDay(f.to)}`;
  const filterKey = `${f.from}|${f.to}|${f.storeId}|${f.kind}|${f.pending}`;

  return (
    <div className="space-y-6">
      {/* Período que inclui hoje continua recebendo venda do balcão. */}
      {f.to >= today && <AutoRefresh everyMs={60_000} />}

      <PageHeader
        title="Ventas"
        description="Mostrador, personal y encomiendas registradas en el sistema. El arqueo suma lo cobrado por forma de pago."
        actions={
          <Link
            href="/admin/venta"
            className="inline-flex h-11 items-center rounded-full bg-dorado px-5 text-sm font-semibold text-cacao hover:bg-dorado-600"
          >
            Nueva venta
          </Link>
        }
      />

      <Form
        key={filterKey}
        action="/admin/ventas"
        className="card grid grid-cols-2 gap-3 p-4 sm:grid-cols-4 sm:p-5 lg:grid-cols-[repeat(4,minmax(0,1fr))_auto]"
      >
        <div>
          <label htmlFor="ventas-desde" className={labelClass}>Desde</label>
          <input id="ventas-desde" type="date" name="desde" defaultValue={f.from} max={today} className={inputClass} />
        </div>
        <div>
          <label htmlFor="ventas-hasta" className={labelClass}>Hasta</label>
          <input id="ventas-hasta" type="date" name="hasta" defaultValue={f.to} className={inputClass} />
        </div>
        <div>
          <label htmlFor="ventas-tienda" className={labelClass}>Tienda</label>
          <select id="ventas-tienda" name="tienda" defaultValue={f.storeId} className={inputClass}>
            <option value="">Todas</option>
            {((storeRows ?? []) as { id: string; name: string }[]).map((s) => (
              <option key={s.id} value={s.id}>
                {shortStoreName(s.name)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="ventas-tipo" className={labelClass}>Tipo</label>
          <select id="ventas-tipo" name="tipo" defaultValue={f.kind} className={inputClass}>
            <option value="">Todos</option>
            {Object.entries(SALE_KIND).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="col-span-2 flex flex-wrap items-end gap-2 sm:col-span-4 lg:col-span-1">
          <label className="flex h-11 cursor-pointer items-center gap-2 rounded-xl border border-crema-300 bg-white px-3 text-sm text-cacao-700">
            <input type="checkbox" name="pendiente" value="1" defaultChecked={f.pending} className="h-4 w-4 accent-cacao" />
            Solo boleta pendiente
          </label>
          <button type="submit" className="h-11 rounded-full bg-cacao px-5 text-sm font-semibold text-crema hover:bg-cacao-700">
            Aplicar
          </button>
          <Link
            href="/admin/ventas"
            className="inline-flex h-11 items-center rounded-full border border-crema-300 bg-white px-4 text-sm font-medium text-cacao-700"
          >
            Hoy
          </Link>
        </div>
      </Form>

      {f.clamped && (
        <Notice tone="warn">
          El período máximo es de {MAX_DAYS} días. Se muestra del {shortDay(f.from)} al {shortDay(f.to)}.
        </Notice>
      )}
      {(listError || paid.error) && <Notice tone="bad">{listError ?? paid.error}</Notice>}
      {paid.truncated && (
        <Notice tone="warn">Hay demasiadas ventas en el período; el arqueo se cortó. Elige un período más corto.</Notice>
      )}

      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Ventas" value={all.count} hint={periodLabel} />
        <StatCard label="Cobrado" value={money(all.totalCents)} hint="IGV incluido" />
        <StatCard label="Ticket promedio" value={money(all.count ? Math.round(all.totalCents / all.count) : 0)} />
        <StatCard
          label="Boleta pendiente"
          value={all.pending}
          hint={all.pending ? "Se emitirán cuando se active Close2U" : "Nada en cola"}
          tone={all.pending ? "warn" : undefined}
        />
      </ul>

      <Section title="Arqueo por forma de pago" aside={periodLabel}>
        {all.count === 0 ? (
          <EmptyState>No hay ventas cobradas en este período.</EmptyState>
        ) : (
          <div className="grid gap-4 p-4 sm:grid-cols-2 sm:p-5 xl:grid-cols-3">
            {[...byStore, ...(byStore.length > 1 ? [all] : [])].map((summary) => (
              <div
                key={summary.id}
                className={cx("rounded-2xl border p-4", summary.id === "all" ? "border-cacao/20 bg-crema-100" : "border-crema-300 bg-white")}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <h4 className="font-display text-base">{summary.name}</h4>
                  <span className="text-[13px] text-cacao-500">
                    {summary.count} {summary.count === 1 ? "venta" : "ventas"}
                  </span>
                </div>
                <dl className="mt-3 space-y-1.5 text-sm">
                  {sortedMethods(summary.methods).map(([method, cents]) => (
                    <div key={method} className="flex justify-between gap-3">
                      <dt className="text-cacao-700">{PAYMENT_METHOD[method] ?? method}</dt>
                      <dd className="tabular-nums text-cacao">{money(cents)}</dd>
                    </div>
                  ))}
                  <div className="flex justify-between gap-3 border-t border-crema-200 pt-2">
                    <dt className="font-semibold text-cacao">Total</dt>
                    <dd className="font-semibold tabular-nums text-cacao">{money(summary.totalCents)}</dd>
                  </div>
                </dl>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section
        title="Ventas"
        aside={totalListed > sales.length ? `Las ${sales.length} más recientes de ${totalListed}` : `${totalListed} en total`}
      >
        {!sales.length ? (
          <EmptyState>
            {f.pending ? "No hay ventas con boleta pendiente en este período." : "No hay ventas en este período."}
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] text-sm">
              <thead className="bg-crema-100 text-left text-[12px] font-bold uppercase tracking-[0.12em] text-cacao-300">
                <tr>
                  <th className="px-5 py-2.5">N.º</th>
                  <th className="px-3 py-2.5">{singleDay ? "Hora" : "Fecha"}</th>
                  <th className="px-3 py-2.5">Tienda</th>
                  <th className="px-3 py-2.5">Vendedora</th>
                  <th className="px-3 py-2.5">Cliente</th>
                  <th className="px-3 py-2.5">Tipo</th>
                  <th className="px-3 py-2.5 text-right">Total</th>
                  <th className="px-3 py-2.5">Pago</th>
                  <th className="px-5 py-2.5">Boleta</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-crema-200">
                {sales.map((sale) => (
                  <tr key={sale.id} className={cx(sale.status === "void" && "opacity-60")}>
                    <td className="px-5 py-3">
                      <Link
                        href={`/admin/ventas/${sale.id}`}
                        className="inline-flex min-h-11 items-center font-mono font-semibold text-terracota underline underline-offset-2"
                      >
                        {sale.number}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-cacao-700">
                      {singleDay ? limaTime(sale.sold_at) : limaDateTime(sale.sold_at)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-cacao-700">{shortStoreName(sale.stores?.name)}</td>
                    <td className="px-3 py-3 text-cacao-700">{sale.sellers?.name ?? "—"}</td>
                    <td className="px-3 py-3 text-cacao-700">{sale.customers?.name ?? "Público general"}</td>
                    <td className="whitespace-nowrap px-3 py-3 text-cacao-700">{SALE_KIND[sale.kind] ?? sale.kind}</td>
                    <td className="whitespace-nowrap px-3 py-3 text-right font-semibold tabular-nums text-cacao">
                      {money(solesToCents(sale.total))}
                    </td>
                    <td className="px-3 py-3 text-[13px] text-cacao-500">
                      {sale.sale_payments?.length
                        ? sale.sale_payments
                            .map((p) => `${PAYMENT_METHOD[p.method] ?? p.method} ${money(solesToCents(p.amount))}`)
                            .join(" · ")
                        : "—"}
                    </td>
                    <td className="px-5 py-3">
                      {sale.status === "void" ? (
                        <Pill tone="bad">Anulada</Pill>
                      ) : sale.status !== "paid" ? (
                        <Pill tone="muted">Sin cobrar</Pill>
                      ) : sale.fiscal_pending ? (
                        <Pill tone="warn">Boleta pendiente</Pill>
                      ) : (
                        <Pill tone="ok">Emitida</Pill>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}

function Pill({ tone, children }: { tone: keyof typeof TONE_CLASS; children: React.ReactNode }) {
  return (
    <span className={cx("inline-flex h-7 items-center whitespace-nowrap rounded-full border px-3 text-[12px] font-semibold", TONE_CLASS[tone])}>
      {children}
    </span>
  );
}
