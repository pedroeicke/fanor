import type { Metadata } from "next";
import Link from "next/link";
import { AutoRefresh } from "@/components/admin/AutoRefresh";
import { EmptyState, Notice, PageHeader, Section, StatusPill } from "@/components/admin/ui";
import { ReceptionScanner } from "@/components/admin/recepcion/ReceptionScanner";
import { StorePicker, pickStore } from "@/components/admin/tienda/StorePicker";
import { DEFAULT_SLA, getOperator, getSetting, listStores, shortStoreName, type SlaSettings } from "@/lib/gestion/server";
import { formatDuration, limaDateTime, minutesBetween } from "@/lib/gestion/dates";
import { DISPATCH_STATUS } from "@/lib/gestion/labels";
import { cx } from "@/lib/format";

export const metadata: Metadata = { title: "Recepción" };
export const dynamic = "force-dynamic";

/**
 * Despachos a caminho da loja.
 *
 * A torta que saiu do taller não está na vitrine enquanto ninguém a
 * conferir. Esta tela é a fila do que chegou (ou está chegando) e a porta
 * para conferir: escanear a guia ou qualquer torta da caixa abre o despacho.
 *
 * Mais antigo primeiro: é o que está esperando há mais tempo — e o que o
 * alerta "despacho sin recibir" vai cobrar.
 */

type InTransit = {
  id: string;
  number: number;
  code: string;
  dispatched_at: string;
  notes: string | null;
  cake_units: { count: number }[];
  dispatch_lines: { quantity: number | string }[];
};

type Received = {
  id: string;
  number: number;
  status: string;
  received_at: string | null;
};

/** Relógio lido uma vez, fora do componente: render tem de ser puro. */
function clock() {
  return new Date();
}

function formatQty(n: number) {
  return n.toLocaleString("es-PE", { maximumFractionDigits: 3 });
}

export default async function ReceptionPage({ searchParams }: { searchParams: Promise<{ tienda?: string | string[] }> }) {
  const op = await getOperator();
  if (!op) return <Notice tone="bad">Sesión expirada. Vuelve a entrar.</Notice>;

  const [{ tienda }, stores] = await Promise.all([searchParams, listStores(op.db)]);
  const store = pickStore(stores, tienda, op.seller?.storeId);

  if (!store) {
    return (
      <div className="space-y-6">
        <PageHeader title="Recepción" />
        <Notice tone="warn">Ninguna tienda tiene prefijo de serie configurado. Sin eso no hay despachos que recibir.</Notice>
      </div>
    );
  }

  const [{ data: transitData, error: transitError }, { data: receivedData }, slaStored] = await Promise.all([
    op.db
      .from("dispatches")
      .select("id, number, code, dispatched_at, notes, cake_units(count), dispatch_lines(quantity)")
      .eq("store_id", store.id)
      .eq("status", "in_transit")
      .order("dispatched_at", { ascending: true }),
    op.db
      .from("dispatches")
      .select("id, number, status, received_at")
      .eq("store_id", store.id)
      .in("status", ["received", "received_with_issues"])
      .order("received_at", { ascending: false })
      .limit(5),
    getSetting<Partial<SlaSettings>>(op.db, "sla", DEFAULT_SLA),
  ]);

  const now = clock();
  const sla = { ...DEFAULT_SLA, ...slaStored };
  const dispatches = (transitData ?? []) as unknown as InTransit[];
  const received = (receivedData ?? []) as unknown as Received[];
  const storeName = shortStoreName(store.name);

  return (
    <div className="space-y-6">
      {/* Tela aberta no balcão: o despacho que o taller acabou de mandar aparece sem F5. */}
      <AutoRefresh everyMs={15_000} />

      <PageHeader
        title="Recepción"
        description={`Despachos en camino a ${storeName}. Escanea la guía o cualquier torta de la caja para conferir.`}
      />

      <StorePicker stores={stores} currentId={store.id} basePath="/admin/recepcion" />

      <ReceptionScanner storeId={store.id} />

      {transitError && <Notice tone="bad">No se pudieron cargar los despachos. Inténtalo de nuevo en unos segundos.</Notice>}

      <Section
        title="En camino"
        aside={dispatches.length ? `${dispatches.length} ${dispatches.length === 1 ? "despacho" : "despachos"}` : undefined}
      >
        {transitError ? (
          /* Erro não é "nada a caminho": a vendedora não pode concluir que o despacho não saiu. */
          <EmptyState>No se pudo verificar qué despachos vienen en camino.</EmptyState>
        ) : dispatches.length === 0 ? (
          <EmptyState>No hay despachos en camino a {storeName}. Cuando el taller despache, aparece aquí.</EmptyState>
        ) : (
          <ul className="divide-y divide-crema-200">
            {dispatches.map((d) => {
              const minutes = minutesBetween(d.dispatched_at, now);
              const late = minutes > sla.dispatch_receive_hours * 60;
              const cakes = d.cake_units[0]?.count ?? 0;
              const items = d.dispatch_lines.reduce((sum, l) => sum + Number(l.quantity), 0);
              return (
                <li key={d.id}>
                  <Link
                    href={`/admin/recepcion/${d.id}`}
                    className="flex min-h-11 items-center gap-3 px-4 py-4 transition-colors hover:bg-crema-100 sm:px-5"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-baseline gap-x-2">
                        <span className="font-display text-lg font-semibold text-cacao">Despacho #{d.number}</span>
                        <span className="font-mono text-[13px] text-cacao-300">{d.code}</span>
                      </p>
                      <p className={cx("text-sm", late ? "font-semibold text-terracota" : "text-cacao-500")}>
                        Salió hace {formatDuration(minutes)} · {limaDateTime(d.dispatched_at)}
                      </p>
                      <p className="mt-0.5 text-sm text-cacao-700">
                        {cakes} {cakes === 1 ? "torta" : "tortas"}
                        {items > 0 && ` · ${formatQty(items)} ${items === 1 ? "ítem" : "ítems"} sin serie`}
                      </p>
                      {d.notes && <p className="mt-1 line-clamp-2 text-[13px] italic text-cacao-500">{d.notes}</p>}
                    </div>
                    <span className="inline-flex h-11 shrink-0 items-center rounded-full bg-dorado px-4 text-sm font-semibold text-cacao">
                      Recibir
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      {received.length > 0 && (
        <Section title="Últimos recibidos">
          <ul className="divide-y divide-crema-200">
            {received.map((d) => (
              <li key={d.id}>
                <Link
                  href={`/admin/recepcion/${d.id}`}
                  className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm transition-colors hover:bg-crema-100 sm:px-5"
                >
                  <span className="font-medium text-cacao">Despacho #{d.number}</span>
                  <StatusPill status={d.status} map={DISPATCH_STATUS} />
                  {d.received_at && <span className="ml-auto text-cacao-500">{limaDateTime(d.received_at)}</span>}
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <p className="text-sm text-cacao-500">
        Lo recibido aparece en{" "}
        <Link href={`/admin/tienda?tienda=${store.id}`} className="font-semibold text-cacao underline underline-offset-4">
          Mi vitrina
        </Link>
        .
      </p>
    </div>
  );
}
