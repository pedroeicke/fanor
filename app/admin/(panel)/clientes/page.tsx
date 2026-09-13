import type { Metadata } from "next";
import Link from "next/link";
import Form from "next/form";
import { getOperator } from "@/lib/gestion/server";
import { limaToday } from "@/lib/gestion/dates";
import { cx, soles } from "@/lib/format";
import { EmptyState, Notice, PageHeader, Section, StatCard, inputClass } from "@/components/admin/ui";
import { IconSearch } from "@/components/ui/icons";
import { sourceLabel } from "@/components/admin/clientes/labels";
import { limaWhen, solesRound } from "@/components/admin/clientes/format";
import { BIRTHDAY_WINDOW_DAYS, SEGMENTS, VIP_MIN_SPENT, birthdayCountdown, formatPhone } from "@/components/admin/clientes/rules";
import {
  PAGE_SIZE,
  customerStats,
  filtersSearch,
  listCustomerPage,
  parseFilters,
  type CustomerFilters,
  type CustomerRow,
} from "./query";

export const metadata: Metadata = { title: "Clientes" };
export const dynamic = "force-dynamic";

/**
 * Carteira de clientes.
 *
 * Ninguém cadastra cliente à mão: ele nasce sozinho do pedido do site, da
 * venda com cliente, da encomenda, do lead e da reclamação (gatilhos da
 * 0012). Esta tela serve para achar alguém rápido — pelo nome, pelo celular
 * que a pessoa dita, pelo DNI da boleta — e para separar quem vale uma
 * mensagem: quem sumiu, quem faz aniversário, quem gasta mais.
 */

const BASE = "/admin/clientes";

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const op = await getOperator();
  if (!op) return <Notice tone="bad">Sesión expirada. Vuelve a entrar.</Notice>;

  const filters = parseFilters(await searchParams);
  const [stats, result] = await Promise.all([customerStats(op.db), listCustomerPage(op.db, filters)]);
  const today = limaToday();
  const isOwner = op.user.role === "owner";
  const filtered = Boolean(filters.q || filters.tag || filters.segment !== "todos");
  const activeSegment = SEGMENTS.find((s) => s.key === filters.segment);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Clientes"
        description="Se crean solos con cada pedido web, venta con cliente, encomienda, lead o reclamo. Busca por nombre, celular, documento o correo."
        actions={
          isOwner && (
            /* <a> e não <Link>: é um download, não uma página para o roteador buscar. */
            <a
              href={`${BASE}/exportar${filtersSearch(filters, { page: 1 })}`}
              className="inline-flex h-11 items-center rounded-full border border-cacao/25 px-5 text-sm font-semibold text-cacao transition-colors hover:border-cacao hover:bg-crema-100"
            >
              Exportar CSV
            </a>
          )
        }
      />

      {stats.failed && <Notice tone="warn">Algunos indicadores no se pudieron calcular. Recarga la página.</Notice>}

      <ul className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard label="Clientes" value={stats.total.toLocaleString("es-PE")} />
        <StatCard label="Nuevos este mes" value={stats.newThisMonth.toLocaleString("es-PE")} />
        <StatCard
          label="Recurrentes"
          value={stats.recurrent.toLocaleString("es-PE")}
          hint={stats.buyers ? `${Math.round((stats.recurrent / stats.buyers) * 100)}% de los que compraron` : undefined}
        />
        <StatCard
          label="Ticket promedio"
          value={stats.averageTicket === null ? "—" : solesRound(stats.averageTicket)}
          hint={stats.averageTicket === null ? (stats.failed ? undefined : "Aún sin compras") : `${soles(stats.averageTicket)} por compra`}
        />
      </ul>

      <div className="space-y-3">
        <Form action={BASE} className="flex gap-2" role="search">
          {/* Buscar volta para a página 1, mas mantém segmento e etiqueta. */}
          {filters.segment !== "todos" && <input type="hidden" name="s" value={filters.segment} />}
          {filters.tag && <input type="hidden" name="tag" value={filters.tag} />}
          <label htmlFor="clientes-q" className="sr-only">Buscar cliente</label>
          <input
            id="clientes-q"
            type="search"
            name="q"
            defaultValue={filters.q}
            maxLength={80}
            enterKeyHint="search"
            autoComplete="off"
            placeholder="Nombre, celular, DNI/RUC o correo"
            className={cx(inputClass, "min-w-0 flex-1")}
          />
          <button
            type="submit"
            className="inline-flex h-11 shrink-0 items-center gap-2 rounded-full bg-dorado px-5 text-sm font-semibold text-cacao transition-colors hover:bg-dorado-600"
          >
            <IconSearch className="h-4 w-4" />
            <span className="hidden sm:inline">Buscar</span>
            <span className="sr-only sm:hidden">Buscar</span>
          </button>
        </Form>

        <nav aria-label="Segmentos" className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
          {SEGMENTS.map((segment) => {
            const active = segment.key === filters.segment;
            return (
              <Link
                key={segment.key}
                href={`${BASE}${filtersSearch(filters, { segment: segment.key, page: 1 })}`}
                aria-current={active ? "page" : undefined}
                title={"hint" in segment ? segment.hint : undefined}
                className={cx(
                  "inline-flex h-11 shrink-0 items-center rounded-full border px-4 text-sm font-medium transition-colors",
                  active ? "border-dorado bg-dorado text-cacao" : "border-crema-300 bg-white text-cacao-700 hover:border-cacao/35",
                )}
              >
                {segment.label}
              </Link>
            );
          })}
        </nav>

        {(filters.tag || filters.q) && (
          <div className="flex flex-wrap items-center gap-2 text-sm text-cacao-500">
            {filters.q && <span>Búsqueda: <strong className="text-cacao">“{filters.q}”</strong></span>}
            {filters.tag && (
              <Link
                href={`${BASE}${filtersSearch(filters, { tag: null, page: 1 })}`}
                className="inline-flex h-9 items-center gap-1.5 rounded-full border border-cacao/20 bg-crema-100 pl-3 pr-2 text-[13px] font-medium text-cacao-700 hover:border-cacao/40"
                aria-label={`Quitar filtro de etiqueta ${filters.tag}`}
              >
                #{filters.tag} <span aria-hidden className="text-base leading-none">×</span>
              </Link>
            )}
            <Link href={BASE} className="inline-flex h-9 items-center text-terracota underline underline-offset-2">
              Limpiar filtros
            </Link>
          </div>
        )}
      </div>

      {/* Com erro, nada de "0 clientes" nem "todavía no hay clientes": seria uma base vazia que não existe. */}
      {result.error ? (
        <Notice tone="bad">{result.error}</Notice>
      ) : (
        <Section
          title={`${result.total.toLocaleString("es-PE")} ${result.total === 1 ? "cliente" : "clientes"}`}
          aside={activeSegment && "hint" in activeSegment ? activeSegment.hint : result.pages > 1 ? `Página ${Math.min(filters.page, result.pages)} de ${result.pages}` : undefined}
        >
          {result.outOfRange ? (
            <EmptyState>
              Esta página ya no existe.{" "}
              <Link href={`${BASE}${filtersSearch(filters, { page: 1 })}`} className="text-terracota underline underline-offset-2">
                Volver a la primera
              </Link>
            </EmptyState>
          ) : result.rows.length === 0 ? (
            <EmptyState>
              {!filtered
                ? "Todavía no hay clientes. Aparecen solos con el primer pedido web, venta con cliente, encomienda, lead o reclamo."
                : filters.segment === "cumpleanos" && !filters.q && !filters.tag
                  ? `Nadie cumple años en los próximos ${BIRTHDAY_WINDOW_DAYS} días (o aún no tienen el cumpleaños registrado en su ficha).`
                  : "Ningún cliente coincide con este filtro."}
            </EmptyState>
          ) : (
            <>
              <MobileList rows={result.rows} birthdays={result.birthdays} today={today} />
              <DesktopTable rows={result.rows} birthdays={result.birthdays} today={today} filters={filters} />
            </>
          )}
        </Section>
      )}

      {!result.error && result.pages > 1 && !result.outOfRange && <Pagination filters={filters} pages={result.pages} total={result.total} />}
    </div>
  );
}

type ListProps = { rows: CustomerRow[]; birthdays: Record<string, number>; today: string };

/** No celular, um cartão por cliente, tocável inteiro. */
function MobileList({ rows, birthdays, today }: ListProps) {
  return (
    <ul className="divide-y divide-crema-200 md:hidden">
      {rows.map((c) => {
        const spent = Number(c.total_spent) || 0;
        const days = birthdays[c.id];
        return (
          <li key={c.id}>
            <Link href={`${BASE}/${c.id}`} className="block px-4 py-3 transition-colors active:bg-crema-100">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-cacao">{c.name}</p>
                  <p className="text-[13px] text-cacao-500">{formatPhone(c.phone_norm, c.phone) || "Sin celular"}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-semibold tabular-nums text-cacao">{soles(spent)}</p>
                  <p className="text-[12px] text-cacao-300">
                    {c.orders_count} {c.orders_count === 1 ? "compra" : "compras"}
                  </p>
                </div>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-cacao-500">
                {days !== undefined && <span className="font-semibold text-terracota">{birthdayCountdown(days)}</span>}
                {spent >= VIP_MIN_SPENT && <VipBadge />}
                <span>{c.last_purchase_at ? `Última: ${limaWhen(c.last_purchase_at, today)}` : "Sin compras"}</span>
                <span className="text-cacao-300">{sourceLabel(c.source)}</span>
                {(c.tags ?? []).slice(0, 3).map((tag) => (
                  <span key={tag} className="rounded-full bg-crema-100 px-2 py-0.5 text-cacao-700">#{tag}</span>
                ))}
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function DesktopTable({ rows, birthdays, today, filters }: ListProps & { filters: CustomerFilters }) {
  return (
    <div className="hidden overflow-x-auto md:block">
      <table className="w-full text-sm">
        <thead className="bg-crema-100 text-left text-[12px] font-bold uppercase tracking-[0.12em] text-cacao-300">
          <tr>
            <th className="px-5 py-2.5">Cliente</th>
            <th className="px-3 py-2.5">Celular</th>
            <th className="px-3 py-2.5 text-right">Compras</th>
            <th className="px-3 py-2.5 text-right">Total gastado</th>
            <th className="px-3 py-2.5">Última compra</th>
            <th className="px-3 py-2.5">Origen</th>
            <th className="px-5 py-2.5">Etiquetas</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-crema-200">
          {rows.map((c) => {
            const spent = Number(c.total_spent) || 0;
            const days = birthdays[c.id];
            return (
              <tr key={c.id} className="align-top hover:bg-crema-100/60">
                <td className="px-5 py-3">
                  <Link href={`${BASE}/${c.id}`} className="font-semibold text-cacao underline-offset-2 hover:underline">
                    {c.name}
                  </Link>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[12px] text-cacao-300">
                    {c.doc_type !== "NONE" && c.doc_number && <span>{c.doc_type} {c.doc_number}</span>}
                    {spent >= VIP_MIN_SPENT && <VipBadge />}
                    {days !== undefined && <span className="font-semibold text-terracota">{birthdayCountdown(days)}</span>}
                  </div>
                </td>
                <td className="whitespace-nowrap px-3 py-3 text-cacao-700">{formatPhone(c.phone_norm, c.phone) || <span className="text-cacao-300">—</span>}</td>
                <td className="px-3 py-3 text-right tabular-nums text-cacao-700">{c.orders_count}</td>
                <td className="whitespace-nowrap px-3 py-3 text-right font-semibold tabular-nums text-cacao">{soles(spent)}</td>
                <td className="whitespace-nowrap px-3 py-3 text-cacao-500">{c.last_purchase_at ? limaWhen(c.last_purchase_at, today) : "—"}</td>
                <td className="whitespace-nowrap px-3 py-3 text-cacao-500">{sourceLabel(c.source)}</td>
                <td className="px-5 py-3">
                  <div className="flex max-w-[16rem] flex-wrap gap-1">
                    {(c.tags ?? []).map((tag) => (
                      <Link
                        key={tag}
                        href={`${BASE}${filtersSearch(filters, { tag, page: 1 })}`}
                        className="rounded-full bg-crema-100 px-2 py-0.5 text-[12px] text-cacao-700 hover:bg-crema-200"
                      >
                        #{tag}
                      </Link>
                    ))}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function VipBadge() {
  return <span className="rounded-full bg-dorado px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-cacao">VIP</span>;
}

function Pagination({ filters, pages, total }: { filters: CustomerFilters; pages: number; total: number }) {
  const page = Math.min(filters.page, pages);
  const link =
    "inline-flex h-11 min-w-11 shrink-0 items-center justify-center gap-1 rounded-full border border-crema-300 bg-white px-4 text-sm font-medium text-cacao-700 transition-colors hover:border-cacao/35";
  const first = (page - 1) * PAGE_SIZE + 1;
  const last = Math.min(page * PAGE_SIZE, total);
  return (
    <nav aria-label="Paginación" className="flex items-center justify-between gap-2">
      {page > 1 ? (
        <Link href={`${BASE}${filtersSearch(filters, { page: page - 1 })}`} className={link} rel="prev" aria-label="Página anterior">
          <span aria-hidden>←</span>
          {/* No celular só a seta: as três peças precisam caber em 375 px. */}
          <span className="hidden sm:inline">Anterior</span>
        </Link>
      ) : (
        <span className="min-w-11" />
      )}
      <span className="min-w-0 text-center text-sm text-cacao-500">
        {first}–{last} de {total.toLocaleString("es-PE")}
      </span>
      {page < pages ? (
        <Link href={`${BASE}${filtersSearch(filters, { page: page + 1 })}`} className={link} rel="next" aria-label="Página siguiente">
          <span className="hidden sm:inline">Siguiente</span>
          <span aria-hidden>→</span>
        </Link>
      ) : (
        <span className="min-w-11" />
      )}
    </nav>
  );
}
