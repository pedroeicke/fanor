import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { DEFAULT_SLA, getOperator, getSetting, listStores, shortStoreName, type SlaSettings } from "@/lib/gestion/server";
import { addDays, formatDuration, limaDateTime, limaDay, limaTime, limaToday, minutesBetween } from "@/lib/gestion/dates";
import { DISPATCH_STATUS, REQUEST_STATUS } from "@/lib/gestion/labels";
import { formatDateShort } from "@/lib/delivery";
import { cx } from "@/lib/format";
import { AutoRefresh } from "@/components/admin/AutoRefresh";
import { EmptyState, Notice, PageHeader, Section, StatCard, StatusPill } from "@/components/admin/ui";
import { ReasonAction } from "@/components/admin/taller/ReasonAction";
import { RedecorateAction } from "@/components/admin/taller/RedecorateAction";
import type { NamedOption } from "@/components/admin/taller/types";
import { closeRequest, discardCakes, resolveMissing } from "./actions";

export const metadata: Metadata = { title: "Taller" };
export const dynamic = "force-dynamic";

/**
 * Tela do taller, aberta num tablet ou celular o dia inteiro.
 *
 * Ordem de urgência: primeiro encomenda (tem cliente e hora marcada), depois
 * pedidos das lojas, mais antigo primeiro. Embaixo, o que voltou das lojas
 * (redecorar ou descartar) e as tortas que sumiram no caminho.
 */

type QueueLine = {
  id: string;
  quantity: number;
  produced_quantity: number;
  products: { name: string; sku: string | null } | null;
  flavors: { name: string } | null;
  decorators: { name: string } | null;
  cake_types: { name: string } | null;
  contract_lines: {
    description: string | null;
    cake_message: string | null;
    flavors: { name: string } | null;
    decorators: { name: string } | null;
    cake_types: { name: string } | null;
  } | null;
};

type QueueRow = {
  id: string;
  number: number;
  kind: "restock" | "contract";
  status: string;
  for_date: string;
  notes: string | null;
  created_at: string;
  store_id: string;
  stores: { name: string } | null;
  sellers: { name: string } | null;
  contracts: { number: number; status: string; deliver_at: string | null; customers: { name: string } | null } | null;
  production_order_lines: QueueLine[];
};

/* Desde a 0015 entregar ou cancelar a encomenda já fecha a OP no banco.
   Isto cobre OPs que ficaram abertas antes disso: o taller vê o aviso e
   encerra, em vez de despachar torta para encomenda que ninguém entrega. */
const CLOSED_CONTRACT: Record<string, { notice: string; reason: string }> = {
  delivered: { notice: "La encomienda ya fue entregada.", reason: "Encomienda entregada" },
  cancelled: { notice: "La encomienda fue cancelada.", reason: "Encomienda cancelada" },
};

type CakeRow = {
  id: string;
  serial: string;
  store_id: string;
  decorator_id: string | null;
  redecorated: boolean;
  returned_at: string | null;
  updated_at: string;
  products: { name: string; sku: string | null } | null;
  flavors: { name: string } | null;
  stores: { name: string } | null;
  dispatches: { id: string; number: number } | null;
};

type DispatchRow = {
  id: string;
  number: number;
  code: string;
  status: string;
  dispatched_at: string;
  stores: { name: string } | null;
  cake_units: { count: number }[];
  dispatch_lines: { count: number }[];
};

/** Relógio lido fora do componente: render tem de ser puro. */
function clock() {
  return { now: new Date().toISOString(), today: limaToday() };
}

export default async function WorkshopPage() {
  const op = await getOperator();
  if (!op) return <Notice tone="bad">Sesión expirada. Vuelve a entrar.</Notice>;
  const { db } = op;
  const { now, today } = clock();

  const cakeSelect = "id, serial, store_id, decorator_id, redecorated, returned_at, updated_at, products(name, sku), flavors(name), stores(name), dispatches(id, number)";

  const [queueRes, returnedRes, missingRes, recentRes, stores, decoratorRes, sla] = await Promise.all([
    db
      .from("production_orders")
      .select(
        "id, number, kind, status, for_date, notes, created_at, store_id, stores(name), sellers(name), contracts(number, status, deliver_at, customers(name)), production_order_lines(id, quantity, produced_quantity, products(name, sku), flavors(name), decorators(name), cake_types(name), contract_lines(description, cake_message, flavors(name), decorators(name), cake_types(name)))",
      )
      .in("status", ["planned", "in_progress"])
      .order("created_at", { ascending: true })
      .limit(200),
    /* A torta devolvida que já foi redecorada continua "devolvida" no banco (a
       nova é que segue viagem) e nunca sai desse estado. Filtrar no próprio
       select — "sem filha" — e não depois: com o tempo elas seriam centenas e
       ocupariam o limite, escondendo as devoluções novas. */
    db
      .from("cake_units")
      .select(`${cakeSelect}, children:cake_units!origin_unit_id(id)`)
      .eq("source", "native")
      .eq("status", "returned")
      .is("children", null)
      .order("returned_at", { ascending: true })
      .limit(200),
    db.from("cake_units").select(cakeSelect).eq("source", "native").eq("status", "missing").order("updated_at", { ascending: true }).limit(200),
    db
      .from("dispatches")
      .select("id, number, code, status, dispatched_at, stores(name), cake_units(count), dispatch_lines(count)")
      .order("dispatched_at", { ascending: false })
      .limit(20),
    listStores(db),
    db.from("decorators").select("id, name").eq("active", true).order("name"),
    getSetting<SlaSettings>(db, "sla", DEFAULT_SLA),
  ]);

  const loadError = queueRes.error || returnedRes.error || missingRes.error || recentRes.error;

  const queue = (queueRes.data ?? []) as unknown as QueueRow[];
  const contractOrders = queue
    .filter((o) => o.kind === "contract")
    .sort((a, b) => a.for_date.localeCompare(b.for_date) || (a.contracts?.deliver_at ?? "99").localeCompare(b.contracts?.deliver_at ?? "99"));
  const restockOrders = queue.filter((o) => o.kind === "restock");

  /* Agrupado por loja na ordem das lojas; loja fora da lista (sem prefixo)
     vai no fim, para o pedido não sumir da fila. */
  const storeOrder = new Map(stores.map((s, i) => [s.id, i]));
  const restockByStore = new Map<string, { name: string; orders: QueueRow[] }>();
  for (const o of restockOrders) {
    const group = restockByStore.get(o.store_id) ?? { name: shortStoreName(o.stores?.name), orders: [] };
    group.orders.push(o);
    restockByStore.set(o.store_id, group);
  }
  const restockGroups = [...restockByStore.entries()].sort(
    (a, b) => (storeOrder.get(a[0]) ?? 99) - (storeOrder.get(b[0]) ?? 99),
  );

  const returned = (returnedRes.data ?? []) as unknown as CakeRow[];
  const missing = (missingRes.data ?? []) as unknown as CakeRow[];
  const recent = (recentRes.data ?? []) as unknown as DispatchRow[];

  const storeOptions = stores.map((s) => ({ id: s.id, name: shortStoreName(s.name) }));
  const decorators = (decoratorRes.data ?? []) as NamedOption[];
  const slaMinutes = (Number(sla.request_attend_hours) || DEFAULT_SLA.request_attend_hours) * 60;

  return (
    <div className="space-y-6">
      <AutoRefresh everyMs={10_000} />

      <PageHeader
        title="Taller"
        description="Encomiendas y pedidos de las tiendas por atender, lo que volvió de las tiendas y los despachos del día."
        actions={
          <Link
            href="/admin/taller/despachar"
            className="inline-flex h-11 items-center justify-center rounded-full border border-cacao/25 bg-white px-5 text-sm font-semibold text-cacao transition-colors hover:border-cacao"
          >
            Despacho sin pedido
          </Link>
        }
      />

      {loadError && <Notice tone="bad">No se pudo cargar todo. La pantalla vuelve a intentar sola en unos segundos.</Notice>}

      <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Encomiendas" value={contractOrders.length} tone={contractOrders.some((o) => o.for_date <= today) ? "warn" : undefined} />
        <StatCard label="Pedidos de tienda" value={restockOrders.length} />
        <StatCard label="Devueltas" value={returned.length} tone={returned.length ? "warn" : undefined} />
        <StatCard label="Faltantes" value={missing.length} tone={missing.length ? "warn" : undefined} />
      </ul>

      <Section title="Encomiendas" aside={contractOrders.length ? `${contractOrders.length} por despachar` : undefined}>
        {contractOrders.length === 0 ? (
          <EmptyState>Ninguna encomienda pendiente.</EmptyState>
        ) : (
          <ul className="divide-y divide-crema-200">
            {contractOrders.map((o) => (
              <OrderCard key={o.id} order={o} today={today} now={now} slaMinutes={slaMinutes} />
            ))}
          </ul>
        )}
      </Section>

      {restockGroups.length === 0 ? (
        <Section title="Pedidos de tienda">
          <EmptyState>Ningún pedido de tienda pendiente.</EmptyState>
        </Section>
      ) : (
        restockGroups.map(([storeId, group]) => (
          <Section key={storeId} title={`Pedidos · ${group.name}`} aside={`${group.orders.length} ${group.orders.length === 1 ? "pedido" : "pedidos"}`}>
            <ul className="divide-y divide-crema-200">
              {group.orders.map((o) => (
                <OrderCard key={o.id} order={o} today={today} now={now} slaMinutes={slaMinutes} />
              ))}
            </ul>
          </Section>
        ))
      )}

      <Section title="Devueltas" aside={returned.length ? `${returned.length} en el taller` : undefined}>
        {returned.length === 0 ? (
          <EmptyState>No hay tortas devueltas esperando decisión.</EmptyState>
        ) : (
          <ul className="divide-y divide-crema-200">
            {returned.map((c) => (
              <li key={c.id} className="space-y-3 px-4 py-4 sm:px-5">
                <CakeSummary cake={c} extra={c.returned_at ? `Devuelta ${limaDateTime(c.returned_at)}` : null} />
                {c.redecorated && (
                  <p className="text-[13px] text-cacao-500">Ya fue redecorada una vez: no se puede redecorar de nuevo, solo descartar.</p>
                )}
                <div className="flex flex-wrap items-start gap-2">
                  {!c.redecorated && (
                    <RedecorateAction
                      serial={c.serial}
                      stores={storeOptions}
                      decorators={decorators}
                      defaultStoreId={c.store_id}
                      defaultDecoratorId={c.decorator_id}
                    />
                  )}
                  <ReasonAction
                    action={discardCakes.bind(null, [c.serial])}
                    label="Descartar"
                    confirmLabel="Sí, descartar"
                    prompt={`¿Descartar la torta ${c.serial}? Sale del inventario.`}
                    placeholder="Motivo del descarte"
                    suggestions={["Vencida", "Mal estado", "Dañada"]}
                    requireReason
                    tone="danger"
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Faltantes" aside={missing.length ? `${missing.length} sin aclarar` : undefined}>
        {missing.length === 0 ? (
          <EmptyState>Ninguna torta faltante. Todo lo despachado llegó.</EmptyState>
        ) : (
          <ul className="divide-y divide-crema-200">
            {missing.map((c) => (
              <li key={c.id} className="space-y-3 px-4 py-4 sm:px-5">
                <CakeSummary cake={c} extra={`Faltante desde ${limaDateTime(c.updated_at)}`} />
                <div className="flex flex-wrap items-start gap-2">
                  <ReasonAction
                    action={resolveMissing.bind(null, c.serial, true)}
                    label="Apareció"
                    confirmLabel="Sí, apareció"
                    prompt={`¿La torta ${c.serial} apareció en ${shortStoreName(c.stores?.name)}? Vuelve a estar disponible en la tienda.`}
                    placeholder="Dónde estaba"
                    suggestions={["Llegó en otro despacho", "Estaba en otra caja"]}
                    tone="ok"
                  />
                  <ReasonAction
                    action={resolveMissing.bind(null, c.serial, false)}
                    label="Perdida"
                    confirmLabel="Dar por perdida"
                    prompt={`¿Dar la torta ${c.serial} por perdida? Sale del inventario.`}
                    suggestions={["Perdida en el traslado", "Se dañó en el traslado"]}
                    tone="danger"
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Despachos recientes" aside="Últimos 20">
        {recent.length === 0 ? (
          <EmptyState>Todavía no hay despachos.</EmptyState>
        ) : (
          <ul className="divide-y divide-crema-200">
            {recent.map((d) => {
              const cakes = d.cake_units?.[0]?.count ?? 0;
              const items = d.dispatch_lines?.[0]?.count ?? 0;
              const when = limaDay(d.dispatched_at) === today ? `Hoy, ${limaTime(d.dispatched_at)}` : limaDateTime(d.dispatched_at);
              return (
                <li key={d.id}>
                  <Link href={`/admin/taller/despachos/${d.id}`} className="flex min-h-14 flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 transition-colors hover:bg-crema-100 sm:px-5">
                    <span className="font-semibold text-cacao">#{d.number}</span>
                    <span className="text-cacao-700">{shortStoreName(d.stores?.name)}</span>
                    <span className="font-mono text-[13px] text-cacao-300">{d.code}</span>
                    <span className="text-[13px] text-cacao-500">
                      {cakes} {cakes === 1 ? "torta" : "tortas"}
                      {items > 0 && ` · ${items} ${items === 1 ? "ítem" : "ítems"}`}
                    </span>
                    <span className="ml-auto flex items-center gap-3">
                      <span className="text-[13px] text-cacao-500">{when}</span>
                      <StatusPill status={d.status} map={DISPATCH_STATUS} />
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Section>
    </div>
  );
}

function OrderCard({ order, today, now, slaMinutes }: { order: QueueRow; today: string; now: string; slaMinutes: number }) {
  const isContract = order.kind === "contract";
  const lines = order.production_order_lines ?? [];
  const pending = lines.reduce((s, l) => s + Math.max(0, Number(l.quantity) - Number(l.produced_quantity)), 0);
  const waited = minutesBetween(order.created_at, now);
  const contractClosed = isContract && order.contracts ? (CLOSED_CONTRACT[order.contracts.status] ?? null) : null;

  let heading: string;
  let meta: ReactNode;
  if (isContract) {
    heading = `Encomienda #${order.contracts?.number ?? order.number}`;
    const day = order.for_date === today ? "Hoy" : order.for_date === addDays(today, 1) ? "Mañana" : formatDateShort(order.for_date);
    const late = order.for_date < today;
    meta = (
      <>
        <span className={cx(late || order.for_date === today ? "font-semibold text-terracota-700" : "text-cacao-700")}>
          {late ? "Atrasada · " : ""}Entrega {day}
          {order.contracts?.deliver_at ? `, ${order.contracts.deliver_at.slice(0, 5)}` : ""}
        </span>
        {` · ${shortStoreName(order.stores?.name)}`}
        {order.contracts?.customers?.name && ` · ${order.contracts.customers.name}`}
      </>
    );
  } else {
    heading = `Pedido #${order.number}`;
    meta = (
      <>
        <span className={cx(waited > slaMinutes && order.status === "planned" ? "font-semibold text-terracota-700" : "text-cacao-700")}>
          Espera {formatDuration(waited)}
        </span>
        {` · ${limaDay(order.created_at) === today ? `hoy ${limaTime(order.created_at)}` : limaDateTime(order.created_at)}`}
        {order.sellers?.name && ` · ${order.sellers.name}`}
      </>
    );
  }

  return (
    <li className="space-y-3 px-4 py-4 sm:px-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-cacao">{heading}</p>
          <p className="text-[13px]">{meta}</p>
        </div>
        {order.status === "in_progress" && <StatusPill status={order.status} map={REQUEST_STATUS} />}
      </div>

      <ul className="space-y-2 text-sm">
        {lines.map((l) => {
          const qty = Number(l.quantity);
          const sent = Number(l.produced_quantity);
          const left = Math.max(0, qty - sent);
          /* Na encomenda vale o que está no contrato; a cópia na OP é reserva. */
          const cl = l.contract_lines;
          const flavor = cl?.flavors?.name ?? l.flavors?.name;
          const decorator = cl?.decorators?.name ?? l.decorators?.name;
          const cakeType = cl?.cake_types?.name ?? l.cake_types?.name;
          const details = [flavor && `Sabor ${flavor}`, decorator && `Decora ${decorator}`, cakeType && `Tipo ${cakeType}`].filter(Boolean);
          return (
            <li key={l.id} className={cx("rounded-xl px-3 py-2", left === 0 ? "bg-crema-100 text-cacao-300" : "bg-crema-100")}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0">
                  <span className={cx("font-medium", left === 0 ? "text-cacao-300" : "text-cacao")}>
                    {l.contract_lines?.description || l.products?.name || "Producto"}
                  </span>
                  {l.products?.sku && <span className="ml-1.5 text-[12px] text-cacao-300">{l.products.sku}</span>}
                </span>
                <span className="shrink-0 text-right tabular-nums">
                  {left === 0 ? (
                    <span className="text-[13px] text-verde">Completa</span>
                  ) : sent > 0 ? (
                    <>
                      <span className="text-lg font-semibold text-cacao">{left}</span>
                      <span className="text-[12px] text-cacao-500"> de {qty}</span>
                    </>
                  ) : (
                    <span className="text-lg font-semibold text-cacao">{qty}</span>
                  )}
                </span>
              </div>
              {(details.length > 0 || l.contract_lines?.cake_message) && (
                <p className="mt-1 text-[13px] text-cacao-700">
                  {details.join(" · ")}
                  {l.contract_lines?.cake_message && (
                    <>
                      {details.length > 0 && " · "}
                      Mensaje: <span className="italic">“{l.contract_lines.cake_message}”</span>
                    </>
                  )}
                </p>
              )}
            </li>
          );
        })}
      </ul>

      {order.notes && <p className="whitespace-pre-line text-[13px] text-cacao-500">{order.notes}</p>}

      {contractClosed && <Notice tone="warn">{contractClosed.notice} No despaches más tortas: cierra este pedido.</Notice>}

      <div className="flex flex-wrap items-start gap-2">
        {!contractClosed && (
          <Link
            href={`/admin/taller/despachar?pedido=${order.id}`}
            className="inline-flex h-12 flex-1 items-center justify-center rounded-full bg-dorado px-6 font-semibold text-cacao transition-colors hover:bg-dorado-600 sm:flex-none"
          >
            Armar despacho{pending > 0 ? ` · ${pending}` : ""}
          </Link>
        )}
        <ReasonAction
          action={closeRequest.bind(null, order.id)}
          label={isContract ? "Cerrar" : "Cerrar pedido"}
          confirmLabel="Sí, cerrar"
          prompt={`¿Cerrar ${heading.toLowerCase()}? Lo que falta ya no se enviará.`}
          suggestions={contractClosed ? [contractClosed.reason] : ["Faltó insumo", "No se alcanzó a producir", "La tienda ya no lo necesita"]}
          requireReason
        />
      </div>
    </li>
  );
}

function CakeSummary({ cake, extra }: { cake: CakeRow; extra: string | null }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
      <div className="min-w-0">
        <p className="font-mono text-[15px] font-semibold tracking-wide text-cacao">{cake.serial}</p>
        <p className="text-sm text-cacao-700">
          {cake.products?.name ?? "Torta"}
          {cake.flavors?.name && ` · ${cake.flavors.name}`}
        </p>
        <p className="text-[13px] text-cacao-500">
          De {shortStoreName(cake.stores?.name)}
          {cake.dispatches && (
            <>
              {" · "}
              <Link href={`/admin/taller/despachos/${cake.dispatches.id}`} className="underline underline-offset-2 hover:text-cacao">
                Despacho #{cake.dispatches.number}
              </Link>
            </>
          )}
          {extra && ` · ${extra}`}
        </p>
      </div>
      {cake.redecorated && (
        <span className="inline-flex h-7 items-center rounded-full border border-dorado-600/40 bg-dorado-100 px-3 text-[12px] font-semibold text-cacao-700">
          Redecorada
        </span>
      )}
    </div>
  );
}
