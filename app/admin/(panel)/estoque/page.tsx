import type { Metadata } from "next";
import { getServerSupabase } from "@/lib/supabase-server";
import { formatDateShort } from "@/lib/delivery";
import { cx } from "@/lib/format";

export const metadata: Metadata = { title: "Inventario" };
export const dynamic = "force-dynamic";

/**
 * O que existe no almacén agora — torta por torta, com série e validade —
 * e o que não tem série, por saldo. Tudo aqui vem do espelho do Sisgeco
 * (ou, mais tarde, do balcão novo); a tela não escreve nada.
 *
 * Existe para responder duas perguntas sem abrir o Sisgeco: "o que tenho
 * para vender agora?" e "o espelho está em dia?".
 */

type Cake = {
  serial: string; status: string; produced_on: string; expires_on: string;
  products: { name: string; sku: string | null } | null;
  stores: { name: string } | null;
};
type Level = { quantity: string; products: { name: string; sku: string | null } | null; stores: { name: string } | null };
type Movement = {
  source_number: number | null; kind: string; reference: string | null; created_at: string;
  stores: { name: string } | null; stock_movement_lines: { id: string }[];
};
type Run = { finished_at: string | null; movements: number; cake_units: number; products: number; error: string | null; agent: string | null };

/** Relógio lido uma vez, fora do componente: render tem de ser puro. */
function clock() {
  const now = new Date();
  return { today: now.toISOString().slice(0, 10), ms: now.getTime() };
}

const KIND_LABEL: Record<string, string> = { production: "Ingreso de producción", sale: "Salida por venta", transfer: "Traslado", adjustment: "Ajuste", discard: "Descarte", purchase: "Compra" };

export default async function InventoryPage() {
  const db = await getServerSupabase();
  if (!db) return <p className="card p-6">Falta configurar la base de datos.</p>;

  const { today, ms: nowMs } = clock();
  const [{ data: cakes }, { data: levels }, { data: movements }, { data: runs }, { data: state }] = await Promise.all([
    db.from("cake_units").select("serial, status, produced_on, expires_on, products(name, sku), stores(name)")
      .in("status", ["in_stock", "reserved"]).order("expires_on").order("serial"),
    db.from("stock_levels").select("quantity, products(name, sku), stores(name)").neq("quantity", 0).order("quantity", { ascending: false }),
    db.from("stock_movements").select("source_number, kind, reference, created_at, stores(name), stock_movement_lines(id)")
      .order("created_at", { ascending: false }).limit(20),
    db.from("sync_runs").select("finished_at, movements, cake_units, products, error, agent").order("id", { ascending: false }).limit(1),
    db.from("sync_state").select("value").eq("key", "sisgeco:guias").maybeSingle(),
  ]);

  const inStock = (cakes ?? []) as unknown as Cake[];
  const byStore = new Map<string, Cake[]>();
  for (const c of inStock) {
    const store = c.stores?.name ?? "Sin tienda";
    byStore.set(store, [...(byStore.get(store) ?? []), c]);
  }
  const { count: soldToday } = await db.from("cake_units").select("id", { count: "exact", head: true })
    .eq("status", "sold").gte("updated_at", `${today}T00:00:00`);

  const lastRun = (runs?.[0] ?? null) as Run | null;
  const cursor = (state?.value as { cursor?: number } | null)?.cursor ?? null;
  const minutesAgo = lastRun?.finished_at ? Math.round((nowMs - new Date(lastRun.finished_at).getTime()) / 60_000) : null;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="font-display text-2xl">Inventario</h2>
          <p className="mt-1 text-sm text-cacao-500">Lo que hay en el almacén ahora, torta por torta. Se actualiza solo desde el sistema de la tienda.</p>
        </div>
        <SyncBadge lastRun={lastRun} cursor={cursor} minutesAgo={minutesAgo} />
      </div>

      {/* Resumo */}
      <ul className="grid gap-4 sm:grid-cols-3">
        <Stat label="Tortas en almacén" value={inStock.length} />
        <Stat label="Vendidas hoy" value={soldToday ?? 0} />
        <Stat label="Vencen hoy" value={inStock.filter((c) => c.expires_on <= today).length} tone={inStock.some((c) => c.expires_on <= today) ? "warn" : undefined} />
      </ul>

      {/* Tortas por loja */}
      {[...byStore.entries()].map(([store, list]) => (
        <section key={store} className="card overflow-hidden">
          <header className="flex items-center justify-between border-b border-crema-200 px-5 py-4">
            <h3 className="font-display text-lg">{store}</h3>
            <span className="text-sm text-cacao-500">{list.length} tortas</span>
          </header>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-crema-100 text-left text-[12px] font-bold uppercase tracking-[0.12em] text-cacao-300">
                <tr><th className="px-5 py-2.5">Serie</th><th className="px-3 py-2.5">Torta</th><th className="px-3 py-2.5">Producida</th><th className="px-3 py-2.5">Vence</th></tr>
              </thead>
              <tbody className="divide-y divide-crema-200">
                {list.map((c) => {
                  const expiring = c.expires_on <= today;
                  return (
                    <tr key={c.serial} className={cx(expiring && "bg-terracota/5")}>
                      <td className="px-5 py-2.5 font-mono text-[13px] text-cacao-700">{c.serial}</td>
                      <td className="px-3 py-2.5"><span className="font-medium text-cacao">{c.products?.name}</span>{c.products?.sku && <span className="ml-2 text-cacao-300">{c.products.sku}</span>}</td>
                      <td className="px-3 py-2.5 text-cacao-500">{formatDateShort(c.produced_on)}</td>
                      <td className={cx("px-3 py-2.5", expiring ? "font-semibold text-terracota" : "text-cacao-500")}>{formatDateShort(c.expires_on)}{expiring && " · hoy"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ))}
      {!inStock.length && <p className="card p-6 text-sm text-cacao-500">Ninguna torta en almacén. Cuando el lector envíe la primera guía de ingreso, aparece aquí.</p>}

      {/* Saldos sem série */}
      {!!levels?.length && (
        <section className="card overflow-hidden">
          <header className="border-b border-crema-200 px-5 py-4"><h3 className="font-display text-lg">Saldos por unidad</h3></header>
          <ul className="grid gap-x-8 gap-y-2 px-5 py-4 text-sm sm:grid-cols-2">
            {(levels as unknown as Level[]).map((l, i) => (
              <li key={i} className="flex justify-between border-b border-crema-200 py-1.5">
                <span><span className="font-medium text-cacao">{l.products?.name}</span> <span className="text-cacao-300">{l.products?.sku}</span> <span className="text-cacao-300">· {l.stores?.name}</span></span>
                <span className={cx("tabular-nums", Number(l.quantity) < 0 ? "font-semibold text-terracota" : "text-cacao-700")}>{Number(l.quantity)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Movimentos */}
      <section className="card overflow-hidden">
        <header className="border-b border-crema-200 px-5 py-4"><h3 className="font-display text-lg">Últimos movimientos</h3></header>
        <ul className="divide-y divide-crema-200 text-sm">
          {((movements ?? []) as unknown as Movement[]).map((m, i) => (
            <li key={i} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3">
              <span className="w-16 font-mono text-[13px] text-cacao-300">{m.source_number ?? "—"}</span>
              <span className={cx("font-medium", m.kind === "sale" ? "text-terracota" : m.kind === "production" ? "text-verde" : "text-cacao")}>{KIND_LABEL[m.kind] ?? m.kind}</span>
              <span className="text-cacao-500">{m.stores?.name}</span>
              <span className="text-cacao-300">{m.stock_movement_lines.length} {m.stock_movement_lines.length === 1 ? "ítem" : "ítems"}</span>
              <span className="ml-auto text-cacao-300">{new Date(m.created_at).toLocaleString("es-PE", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
              {m.reference && <span className="basis-full text-[12px] text-cacao-300">{m.reference}</span>}
            </li>
          ))}
          {!movements?.length && <li className="px-5 py-4 text-cacao-500">Sin movimientos todavía.</li>}
        </ul>
      </section>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "warn" }) {
  return (
    <li className="card p-5">
      <p className="text-[12px] font-bold uppercase tracking-[0.12em] text-cacao-300">{label}</p>
      <p className={cx("mt-1 font-display text-3xl font-semibold", tone === "warn" ? "text-terracota" : "text-cacao")}>{value}</p>
    </li>
  );
}

function SyncBadge({ lastRun, cursor, minutesAgo }: { lastRun: Run | null; cursor: number | null; minutesAgo: number | null }) {
  if (!lastRun) return <span className="rounded-full border border-crema-300 bg-white px-4 py-2 text-sm text-cacao-500">El lector aún no envió nada</span>;
  const stale = minutesAgo !== null && minutesAgo > 10;
  const tone = lastRun.error ? "border-terracota/40 bg-terracota/10 text-terracota" : stale ? "border-dorado bg-dorado-100 text-cacao" : "border-verde/30 bg-verde-100 text-verde";
  return (
    <span className={cx("rounded-full border px-4 py-2 text-sm font-medium", tone)} title={lastRun.agent ?? undefined}>
      {lastRun.error ? `Error en la última sincronización: ${lastRun.error}` : `Sincronizado hace ${minutesAgo} min · cursor ${cursor ?? "—"}`}
    </span>
  );
}
