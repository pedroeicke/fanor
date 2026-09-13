import type { Metadata } from "next";
import Link from "next/link";
import { AutoRefresh } from "@/components/admin/AutoRefresh";
import { EmptyState, PageHeader, Section, StatCard, StatusPill } from "@/components/admin/ui";
import { ButtonLink } from "@/components/ui/primitives";
import { shortTime } from "@/components/admin/encomiendas/shared";
import { formatDateShort } from "@/lib/delivery";
import { cx, soles } from "@/lib/format";
import { addDays, limaDateTime, limaToday } from "@/lib/gestion/dates";
import { CONTRACT_STATUS } from "@/lib/gestion/labels";
import { getOperator, listStores, shortStoreName } from "@/lib/gestion/server";

export const metadata: Metadata = { title: "Encomiendas" };
export const dynamic = "force-dynamic";

/**
 * Encomendas por data de entrega. A pergunta do balcão é "o que sai hoje e
 * quanto falta cobrar", então a lista abre pelas atrasadas e por hoje — não
 * pela ordem em que foram registradas.
 */

type Row = {
  id: string;
  number: number;
  status: string;
  deliver_on: string;
  deliver_at: string | null;
  deliver_place: string | null;
  total: string | number;
  store_id: string;
  closed_at: string | null;
  stores: { name: string } | null;
  customers: { name: string; phone: string | null } | null;
  contract_lines: { description: string; quantity: string | number; sort_order: number; flavors: { name: string } | null }[];
  sales: { total: string | number; status: string }[];
};

type Item = Row & { paid: number; balance: number };

const SELECT =
  "id, number, status, deliver_on, deliver_at, deliver_place, total, store_id, closed_at, stores(name), customers(name, phone), " +
  "contract_lines(description, quantity, sort_order, flavors(name)), sales(total, status)";

/** Relógio lido uma vez, fora do render. Lima é UTC−5 o ano todo (sem horário de verão). */
function clock() {
  const today = limaToday();
  return { today, tomorrow: addDays(today, 1), since: `${addDays(today, -7)}T00:00:00-05:00` };
}

function toItem(row: Row): Item {
  const paid = row.sales.filter((s) => s.status === "paid").reduce((sum, s) => sum + Number(s.total), 0);
  const total = Number(row.total);
  return { ...row, paid: Math.round(paid * 100) / 100, balance: Math.max(0, Math.round((total - paid) * 100) / 100) };
}

function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

function lineSummary(row: Row) {
  return [...row.contract_lines]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((l) => `${Number(l.quantity) > 1 ? `${Number(l.quantity)}× ` : ""}${l.description}${l.flavors ? ` · ${l.flavors.name}` : ""}`)
    .join(" + ");
}

export default async function EncomiendasPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const op = await getOperator();
  if (!op) return <p className="card p-6">Sesión expirada. Vuelve a entrar.</p>;

  const params = await searchParams;
  const { today, tomorrow, since } = clock();
  const stores = await listStores(op.db);

  /* Sem filtro na URL, abre na loja da vendedora logada: é a lista que ela
     vai atender. "todas" mostra as duas. */
  const requested = typeof params.tienda === "string" ? params.tienda : null;
  const storeId =
    requested === "todas"
      ? null
      : (stores.find((s) => s.id === requested)?.id ?? (requested ? null : (stores.find((s) => s.id === op.seller?.storeId)?.id ?? null)));

  let openQuery = op.db
    .from("contracts")
    .select(SELECT)
    .in("status", ["open", "in_production", "ready"])
    .order("deliver_on")
    .order("deliver_at", { nullsFirst: false })
    .limit(500);
  let closedQuery = op.db
    .from("contracts")
    .select(SELECT)
    .in("status", ["delivered", "cancelled"])
    .gte("closed_at", since)
    .order("closed_at", { ascending: false })
    .limit(150);
  if (storeId) {
    openQuery = openQuery.eq("store_id", storeId);
    closedQuery = closedQuery.eq("store_id", storeId);
  }

  const [{ data: openRows, error: openError }, { data: closedRows }] = await Promise.all([openQuery, closedQuery]);
  const open = ((openRows ?? []) as unknown as Row[]).map(toItem);
  const closed = ((closedRows ?? []) as unknown as Row[]).map(toItem);

  const overdue = open.filter((c) => c.deliver_on < today);
  const forToday = open.filter((c) => c.deliver_on === today);
  const forTomorrow = open.filter((c) => c.deliver_on === tomorrow);
  const later = open.filter((c) => c.deliver_on > tomorrow);
  const dueNow = [...overdue, ...forToday].reduce((sum, c) => sum + c.balance, 0);

  const groups = [
    { key: "overdue", title: "Atrasadas", items: overdue, empty: null },
    { key: "today", title: "Hoy", items: forToday, empty: "Nada para entregar hoy." },
    { key: "tomorrow", title: "Mañana", items: forTomorrow, empty: "Nada para mañana." },
    { key: "later", title: "Próximas", items: later, empty: "Sin encomiendas para los próximos días." },
  ];

  return (
    <div className="space-y-6">
      {/* A lista fica aberta no balcão: encomienda nova ou entregue na outra loja aparece sozinha. */}
      <AutoRefresh everyMs={30_000} />

      <PageHeader
        title="Encomiendas"
        description="Pedidos con fecha de entrega, adelanto y saldo. La torta de cada encomienda se elige al entregar."
        actions={<ButtonLink href="/admin/encomiendas/nueva" size="md">+ Nueva encomienda</ButtonLink>}
      />

      {stores.length > 1 && (
        <nav aria-label="Filtrar por tienda" className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
          {[{ id: "todas", name: "Todas las tiendas" }, ...stores.map((s) => ({ id: s.id, name: shortStoreName(s.name) }))].map((s) => {
            const active = s.id === "todas" ? storeId === null : s.id === storeId;
            return (
              <Link
                key={s.id}
                href={`/admin/encomiendas?tienda=${s.id}`}
                aria-current={active ? "page" : undefined}
                className={cx(
                  "h-11 shrink-0 rounded-full border px-5 text-sm font-medium leading-[2.6rem] transition-colors",
                  active ? "border-cacao bg-cacao text-crema" : "border-crema-300 bg-white text-cacao-700 hover:border-cacao/35",
                )}
              >
                {s.name}
              </Link>
            );
          })}
        </nav>
      )}

      {/* Sem os dados, contador zerado e "saldo S/ 0.00" seriam mentira: só o aviso. */}
      {openError ? (
        <p role="alert" className="card p-4 text-sm text-terracota">No se pudieron cargar las encomiendas. Recarga la página.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <StatCard label="Atrasadas" value={overdue.length} tone={overdue.length ? "warn" : undefined} />
          <StatCard label="Para hoy" value={forToday.length} />
          <li className="col-span-2 sm:col-span-1">
            <div className="card p-5">
              <p className="text-[12px] font-bold uppercase tracking-[0.12em] text-cacao-300">Saldo por cobrar hoy</p>
              <p className="mt-1 font-display text-3xl font-semibold text-cacao">{soles(dueNow)}</p>
              <p className="mt-1 text-[13px] text-cacao-500">atrasadas + hoy</p>
            </div>
          </li>
        </ul>
      )}

      {openError ? null : !open.length ? (
        <section className="card">
          <EmptyState>
            No hay encomiendas pendientes{storeId ? " en esta tienda" : ""}.{" "}
            <Link href="/admin/encomiendas/nueva" className="font-semibold text-terracota underline underline-offset-2">Registrar una</Link>
          </EmptyState>
        </section>
      ) : (
        groups
          .filter((g) => g.items.length || g.empty)
          .map((g) => (
            <Section
              key={g.key}
              title={<span className={cx(g.key === "overdue" && "text-terracota")}>{g.title}</span>}
              aside={`${g.items.length} ${g.items.length === 1 ? "encomienda" : "encomiendas"}`}
              className={cx(g.key === "overdue" && "border-terracota/40")}
            >
              {g.items.length ? (
                <ul className="divide-y divide-crema-200">
                  {g.items.map((c) => (
                    <ContractItem key={c.id} item={c} today={today} showStore={!storeId} />
                  ))}
                </ul>
              ) : (
                <EmptyState>{g.empty}</EmptyState>
              )}
            </Section>
          ))
      )}

      {closed.length > 0 && (
        <details className="card group overflow-hidden">
          <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-2 px-5 py-3">
            <span className="font-display text-lg">Entregadas y canceladas · últimos 7 días</span>
            <span className="text-sm text-cacao-500">{closed.length} <span aria-hidden className="inline-block transition-transform group-open:rotate-180">▾</span></span>
          </summary>
          <ul className="divide-y divide-crema-200 border-t border-crema-200">
            {closed.map((c) => (
              <ContractItem key={c.id} item={c} today={today} showStore={!storeId} closed />
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function ContractItem({ item: c, today, showStore, closed }: { item: Item; today: string; showStore: boolean; closed?: boolean }) {
  const late = !closed && c.deliver_on < today ? daysBetween(c.deliver_on, today) : 0;
  const time = shortTime(c.deliver_at);
  return (
    <li>
      <Link
        href={`/admin/encomiendas/${c.id}`}
        className={cx("flex flex-col gap-3 px-4 py-3 transition-colors hover:bg-crema-100 sm:flex-row sm:items-center sm:px-5", closed && "opacity-80")}
      >
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-mono text-sm text-cacao-300">#{c.number}</span>
            <span className="font-semibold text-cacao">{c.customers?.name ?? "Sin cliente"}</span>
            <StatusPill status={c.status} map={CONTRACT_STATUS} />
          </div>
          <p className={cx("text-sm", late ? "font-semibold text-terracota" : "text-cacao-700")}>
            {formatDateShort(c.deliver_on)}
            {time && ` · ${time}`}
            {late > 0 && ` · ${late === 1 ? "ayer" : `hace ${late} días`}`}
            <span className="font-normal text-cacao-500">
              {" · "}{c.deliver_place ?? "Lugar sin definir"}
              {showStore && ` · ${shortStoreName(c.stores?.name)}`}
            </span>
          </p>
          <p className="line-clamp-2 text-sm text-cacao-500">{lineSummary(c) || "Sin productos"}</p>
          {closed && c.closed_at && (
            <p className="text-[12px] text-cacao-300">{c.status === "cancelled" ? "Cancelada" : "Entregada"} {limaDateTime(c.closed_at)}</p>
          )}
        </div>
        <dl className="grid shrink-0 grid-cols-3 gap-3 text-sm sm:w-72 sm:text-right">
          <div>
            <dt className="text-[11px] font-bold uppercase tracking-[0.1em] text-cacao-300">Total</dt>
            <dd className="tabular-nums text-cacao">{soles(Number(c.total))}</dd>
          </div>
          <div>
            <dt className="text-[11px] font-bold uppercase tracking-[0.1em] text-cacao-300">Pagado</dt>
            <dd className="tabular-nums text-cacao-700">{soles(c.paid)}</dd>
          </div>
          <div>
            <dt className="text-[11px] font-bold uppercase tracking-[0.1em] text-cacao-300">Saldo</dt>
            <dd className={cx("font-semibold tabular-nums", c.balance > 0 && c.status !== "cancelled" ? "text-terracota" : "text-verde")}>
              {soles(c.balance)}
            </dd>
          </div>
        </dl>
      </Link>
    </li>
  );
}
