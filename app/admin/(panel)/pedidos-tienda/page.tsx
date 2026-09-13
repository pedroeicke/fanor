import type { Metadata } from "next";
import Link from "next/link";
import { getOperator, listStores, shortStoreName } from "@/lib/gestion/server";
import { addDays, limaDateTime, limaDay, limaTime, limaToday } from "@/lib/gestion/dates";
import { REQUEST_STATUS } from "@/lib/gestion/labels";
import { cx } from "@/lib/format";
import { AutoRefresh } from "@/components/admin/AutoRefresh";
import { EmptyState, Notice, PageHeader, Section, StatusPill } from "@/components/admin/ui";
import { loadCatalog } from "@/components/admin/pedidos-tienda/catalog";
import { StoreRequestForm } from "@/components/admin/pedidos-tienda/StoreRequestForm";
import type { CatalogProduct } from "@/components/admin/pedidos-tienda/types";
import { ReasonAction } from "@/components/admin/taller/ReasonAction";
import { cancelStoreRequest } from "./actions";

export const metadata: Metadata = { title: "Pedir al taller" };
export const dynamic = "force-dynamic";

/**
 * Tela da vendedora, no celular: pede ao taller o que falta na vitrine e
 * acompanha o que já saiu.
 *
 * A loja padrão é a da vendedora do login; quem cuida das duas lojas troca
 * pelo seletor (fica na URL, para o link aberto no celular de cada loja já
 * cair na loja certa).
 */

type RequestRow = {
  id: string;
  number: number;
  status: string;
  created_at: string;
  notes: string | null;
  sellers: { name: string } | null;
  production_order_lines: { id: string; quantity: number; produced_quantity: number; products: { name: string; sku: string | null } | null }[];
};

type TopLine = { product_id: string; quantity: number };

/** Relógio lido fora do componente: render tem de ser puro. */
function clock() {
  const today = limaToday();
  return { today, since14: `${addDays(today, -13)}T00:00:00-05:00`, since60: `${addDays(today, -59)}T00:00:00-05:00` };
}

export default async function StoreRequestsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const op = await getOperator();
  if (!op) return <Notice tone="bad">Sesión expirada. Vuelve a entrar.</Notice>;

  const sp = await searchParams;
  const wanted = typeof sp.tienda === "string" ? sp.tienda : null;
  const stores = await listStores(op.db);
  const store = stores.find((s) => s.id === wanted) ?? stores.find((s) => s.id === op.seller?.storeId) ?? stores[0];

  if (!store) {
    return (
      <div className="space-y-6">
        <PageHeader title="Pedir al taller" />
        <Notice tone="warn">Ninguna tienda tiene prefijo de serie configurado. Sin eso, el taller no puede despacharle tortas.</Notice>
      </div>
    );
  }

  const { today, since14, since60 } = clock();

  const [catalog, { data: topData }, { data: requestData, error: requestError }] = await Promise.all([
    loadCatalog(op.db),
    /* "Más pedidos" desta loja nos últimos 60 dias: o atalho acompanha o
       que a loja pede de verdade, e não o que pedia no ano passado. */
    op.db
      .from("production_order_lines")
      .select("product_id, quantity, production_orders!inner(store_id, kind, created_at)")
      .eq("production_orders.store_id", store.id)
      .eq("production_orders.kind", "restock")
      .gte("production_orders.created_at", since60)
      .limit(3000),
    op.db
      .from("production_orders")
      .select("id, number, status, created_at, notes, sellers(name), production_order_lines(id, quantity, produced_quantity, products(name, sku))")
      .eq("store_id", store.id)
      .eq("kind", "restock")
      .gte("created_at", since14)
      .order("created_at", { ascending: false })
      .limit(100),
  ]);

  const tally = new Map<string, { lines: number; units: number }>();
  for (const l of (topData ?? []) as unknown as TopLine[]) {
    const t = tally.get(l.product_id) ?? { lines: 0, units: 0 };
    tally.set(l.product_id, { lines: t.lines + 1, units: t.units + Number(l.quantity) });
  }
  const byId = new Map(catalog.map((p) => [p.id, p]));
  const shortcuts = [...tally.entries()]
    .sort((a, b) => b[1].lines - a[1].lines || b[1].units - a[1].units)
    .map(([id]) => byId.get(id))
    .filter((p): p is CatalogProduct => p !== undefined)
    .slice(0, 8);

  const requests = (requestData ?? []) as unknown as RequestRow[];
  const open = requests.filter((r) => r.status === "planned" || r.status === "in_progress").length;
  const storeName = shortStoreName(store.name);

  return (
    <div className="space-y-6">
      {/* A vendedora vê o pedido passar a "Despacho parcial"/"Atendido" sem
          F5. 30 s basta: não é fila de produção, e a lista em montagem no
          formulário sobrevive ao refresh. */}
      <AutoRefresh everyMs={30_000} />
      <PageHeader
        title="Pedir al taller"
        description="Pide tamaño y cantidad. El taller elige los sabores y te manda las tortas con su etiqueta."
      />

      {stores.length > 1 && (
        <nav aria-label="Tienda" className="flex gap-2 overflow-x-auto no-scrollbar">
          {stores.map((s) => {
            const active = s.id === store.id;
            return (
              <Link
                key={s.id}
                href={`/admin/pedidos-tienda?tienda=${s.id}`}
                aria-current={active ? "page" : undefined}
                className={cx(
                  "flex h-11 shrink-0 items-center rounded-full border px-5 text-sm font-semibold transition-colors",
                  active ? "border-dorado bg-dorado text-cacao" : "border-crema-300 bg-white text-cacao-700 hover:border-cacao/35",
                )}
              >
                {shortStoreName(s.name)}
              </Link>
            );
          })}
        </nav>
      )}

      <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
        {/* Sem o `overflow-hidden` do <Section>: ele prenderia o botão
            "Enviar" fixo no rodapé dentro do cartão. */}
        <section className="card">
          <header className="flex flex-wrap items-center justify-between gap-2 border-b border-crema-200 px-5 py-4">
            <h3 className="font-display text-lg">Nuevo pedido</h3>
            <span className="text-sm text-cacao-500">{storeName}</span>
          </header>
          <div className="p-4 sm:p-5">
            {catalog.length === 0 ? (
              <p className="text-sm text-cacao-500">
                No hay productos de producción. Los productos necesitan familia (T, PS, G…) para poder pedirse.
              </p>
            ) : (
              <StoreRequestForm storeId={store.id} storeName={storeName} products={catalog} shortcuts={shortcuts} />
            )}
          </div>
        </section>

        <Section title="Pedidos recientes" aside={open ? `${open} en curso` : "Últimos 14 días"}>
          {requestError && (
            <div className="p-4">
              <Notice tone="bad">No se pudieron cargar los pedidos. Recarga la página.</Notice>
            </div>
          )}
          {!requestError && requests.length === 0 && (
            <EmptyState>Sin pedidos de {storeName} en los últimos 14 días.</EmptyState>
          )}
          <ul className="divide-y divide-crema-200">
            {requests.map((r) => {
              const lines = r.production_order_lines ?? [];
              const dispatched = lines.reduce((s, l) => s + Number(l.produced_quantity), 0);
              const canCancel = r.status === "planned" && dispatched === 0;
              const when = limaDay(r.created_at) === today ? `Hoy, ${limaTime(r.created_at)}` : limaDateTime(r.created_at);
              return (
                <li key={r.id} className="space-y-3 px-4 py-4 sm:px-5">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold text-cacao">Pedido #{r.number}</p>
                      <p className="text-[13px] text-cacao-500">
                        {when}
                        {r.sellers?.name && ` · ${r.sellers.name}`}
                      </p>
                    </div>
                    <StatusPill status={r.status} map={REQUEST_STATUS} />
                  </div>

                  <ul className="space-y-1.5 text-sm">
                    {lines.map((l) => {
                      const qty = Number(l.quantity);
                      const sent = Number(l.produced_quantity);
                      return (
                        <li key={l.id} className="flex items-baseline justify-between gap-3">
                          <span className="min-w-0">
                            <span className="text-cacao">{l.products?.name ?? "Producto"}</span>
                            {l.products?.sku && <span className="ml-1.5 text-[12px] text-cacao-300">{l.products.sku}</span>}
                          </span>
                          <span
                            className={cx(
                              "shrink-0 tabular-nums",
                              sent >= qty ? "font-semibold text-verde" : sent > 0 ? "font-semibold text-cacao-700" : "text-cacao-500",
                            )}
                          >
                            {sent} de {qty} {qty === 1 ? "despachada" : "despachadas"}
                          </span>
                        </li>
                      );
                    })}
                  </ul>

                  {r.notes && (
                    <p className="whitespace-pre-line rounded-xl bg-crema-100 px-3 py-2 text-[13px] text-cacao-700">{r.notes}</p>
                  )}

                  {canCancel && (
                    <ReasonAction
                      action={cancelStoreRequest.bind(null, r.id)}
                      label="Cancelar pedido"
                      confirmLabel="Sí, cancelar"
                      prompt={`¿Cancelar el pedido #${r.number}? El taller deja de verlo.`}
                      suggestions={["Pedido duplicado", "Ya no hace falta", "Me equivoqué de producto"]}
                      requireReason
                      tone="danger"
                    />
                  )}
                </li>
              );
            })}
          </ul>
        </Section>
      </div>
    </div>
  );
}
