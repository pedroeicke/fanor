import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getOperator, shortStoreName } from "@/lib/gestion/server";
import { limaDateTime } from "@/lib/gestion/dates";
import { CAKE_STATUS, DISPATCH_STATUS } from "@/lib/gestion/labels";
import { formatDateShort } from "@/lib/delivery";
import { cx } from "@/lib/format";
import { EmptyState, Notice, PageHeader, Section, StatusPill } from "@/components/admin/ui";
import { isUuid } from "@/components/admin/pedidos-tienda/catalog";

export const metadata: Metadata = { title: "Despacho" };
export const dynamic = "force-dynamic";

/**
 * Um despacho por inteiro: para onde foi, quem mandou, quem recebeu e onde
 * cada torta está agora. É a tela que responde "a G0000100231 chegou?" sem
 * precisar ligar para a loja — e de onde se reimprime a etiqueta perdida.
 */

type DispatchRow = {
  id: string;
  number: number;
  code: string;
  status: string;
  dispatched_at: string;
  dispatched_by: string | null;
  received_at: string | null;
  received_by: string | null;
  notes: string | null;
  stores: { name: string } | null;
  production_orders: { id: string; number: number; kind: string; contracts: { id: string; number: number } | null } | null;
};

type CakeRow = {
  id: string;
  serial: string;
  status: string;
  produced_on: string;
  expires_on: string;
  redecorated: boolean;
  products: { name: string; sku: string | null } | null;
  flavors: { name: string } | null;
  decorators: { name: string } | null;
  cake_types: { name: string } | null;
  origin: { serial: string } | null;
};

type LineRow = { id: string; quantity: number; received_quantity: number | null; products: { name: string; sku: string | null } | null };

export default async function DispatchDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const op = await getOperator();
  if (!op) return <Notice tone="bad">Sesión expirada. Vuelve a entrar.</Notice>;

  const [{ data: dispatchData }, { data: cakeData }, { data: lineData }] = await Promise.all([
    op.db
      .from("dispatches")
      .select(
        "id, number, code, status, dispatched_at, dispatched_by, received_at, received_by, notes, stores(name), production_orders(id, number, kind, contracts(id, number))",
      )
      .eq("id", id)
      .maybeSingle(),
    op.db
      .from("cake_units")
      .select("id, serial, status, produced_on, expires_on, redecorated, products(name, sku), flavors(name), decorators(name), cake_types(name), origin:origin_unit_id(serial)")
      .eq("dispatch_id", id)
      .order("serial"),
    op.db.from("dispatch_lines").select("id, quantity, received_quantity, products(name, sku)").eq("dispatch_id", id),
  ]);

  const dispatch = dispatchData as unknown as DispatchRow | null;
  if (!dispatch) notFound();

  const cakes = (cakeData ?? []) as unknown as CakeRow[];
  const lines = (lineData ?? []) as unknown as LineRow[];

  /* Quem mandou e quem recebeu são usuários do painel. A lista de admins só
     mostra a própria linha (RLS), então o nome sai da vendedora ligada ao
     login — ou do próprio usuário, quando foi ele. */
  const people = [dispatch.dispatched_by, dispatch.received_by].filter((v): v is string => Boolean(v));
  const names = new Map<string, string>();
  if (people.length) {
    const { data: sellers } = await op.db.from("sellers").select("user_id, name").in("user_id", people);
    for (const s of (sellers ?? []) as { user_id: string; name: string }[]) names.set(s.user_id, s.name);
  }
  const who = (userId: string | null) => (userId ? (names.get(userId) ?? (userId === op.user.id ? op.user.name : "Usuario del panel")) : null);

  const order = dispatch.production_orders;
  const origin =
    order?.kind === "contract" && order.contracts
      ? `Encomienda #${order.contracts.number}`
      : order
        ? `Pedido #${order.number}`
        : /* A torta redecorada é o sinal confiável; a nota pode ganhar texto da recepção. */
          cakes.some((c) => c.redecorated) || dispatch.notes?.startsWith("Redecoración")
          ? "Redecoración"
          : "Sin pedido";

  const byStatus = cakes.reduce<Record<string, number>>((acc, c) => ({ ...acc, [c.status]: (acc[c.status] ?? 0) + 1 }), {});

  return (
    <div className="space-y-6">
      <Link href="/admin/taller" className="inline-flex h-11 items-center text-sm font-medium text-cacao-500 underline underline-offset-4 hover:text-cacao">
        ← Volver al taller
      </Link>

      <PageHeader
        title={`Despacho #${dispatch.number}`}
        description={
          <>
            Para <strong className="text-cacao">{shortStoreName(dispatch.stores?.name)}</strong> · {origin} · código{" "}
            <span className="font-mono">{dispatch.code}</span>
          </>
        }
        actions={
          <Link
            href={`/admin/etiquetas/${dispatch.id}`}
            className="inline-flex h-12 items-center justify-center rounded-full bg-dorado px-6 font-semibold text-cacao transition-colors hover:bg-dorado-600"
          >
            Imprimir etiquetas
          </Link>
        }
      />

      <section className="card grid gap-4 p-5 sm:grid-cols-3">
        <div>
          <p className="text-[12px] font-bold uppercase tracking-[0.12em] text-cacao-300">Estado</p>
          <div className="mt-1.5">
            <StatusPill status={dispatch.status} map={DISPATCH_STATUS} />
          </div>
        </div>
        <div>
          <p className="text-[12px] font-bold uppercase tracking-[0.12em] text-cacao-300">Despachado</p>
          <p className="mt-1 text-sm text-cacao">{limaDateTime(dispatch.dispatched_at)}</p>
          {who(dispatch.dispatched_by) && <p className="text-[13px] text-cacao-500">por {who(dispatch.dispatched_by)}</p>}
        </div>
        <div>
          <p className="text-[12px] font-bold uppercase tracking-[0.12em] text-cacao-300">Recibido</p>
          {dispatch.received_at ? (
            <>
              <p className="mt-1 text-sm text-cacao">{limaDateTime(dispatch.received_at)}</p>
              {who(dispatch.received_by) && <p className="text-[13px] text-cacao-500">por {who(dispatch.received_by)}</p>}
            </>
          ) : (
            <p className="mt-1 text-sm text-cacao-500">Todavía en camino</p>
          )}
        </div>
        {dispatch.notes && (
          <p className="whitespace-pre-line rounded-xl bg-crema-100 px-3 py-2 text-[13px] text-cacao-700 sm:col-span-3">{dispatch.notes}</p>
        )}
      </section>

      <Section
        title={`Tortas (${cakes.length})`}
        aside={
          cakes.length
            ? Object.entries(byStatus)
                .map(([s, n]) => `${n} ${(CAKE_STATUS[s]?.label ?? s).toLowerCase()}`)
                .join(" · ")
            : undefined
        }
      >
        {cakes.length === 0 ? (
          <EmptyState>Este despacho no lleva tortas con serie.</EmptyState>
        ) : (
          <ul className="divide-y divide-crema-200">
            {cakes.map((c) => (
              <li key={c.id} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-4 py-3 sm:px-5">
                <div className="min-w-0">
                  <p className="font-mono text-[15px] font-semibold tracking-wide text-cacao">{c.serial}</p>
                  <p className="text-sm text-cacao-700">{c.products?.name ?? "Torta"}</p>
                  <p className="text-[13px] text-cacao-500">
                    {[c.flavors?.name ?? "Sin sabor", c.decorators?.name && `decora ${c.decorators.name}`, c.cake_types?.name].filter(Boolean).join(" · ")}
                  </p>
                  <p className={cx("text-[13px]", c.redecorated ? "font-semibold text-cacao-700" : "text-cacao-500")}>
                    {c.redecorated && `Redecorada${c.origin ? ` de ${c.origin.serial}` : ""} · `}
                    Prod. {formatDateShort(c.produced_on)} · Vence {formatDateShort(c.expires_on)}
                  </p>
                </div>
                <StatusPill status={c.status} map={CAKE_STATUS} />
              </li>
            ))}
          </ul>
        )}
      </Section>

      {lines.length > 0 && (
        <Section title={`Ítems sin serie (${lines.length})`}>
          <ul className="divide-y divide-crema-200">
            {lines.map((l) => {
              const qty = Number(l.quantity);
              const got = l.received_quantity === null ? null : Number(l.received_quantity);
              return (
                <li key={l.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3 sm:px-5">
                  <span className="min-w-0 text-sm">
                    <span className="font-medium text-cacao">{l.products?.name ?? "Producto"}</span>
                    {l.products?.sku && <span className="ml-1.5 text-[12px] text-cacao-300">{l.products.sku}</span>}
                  </span>
                  <span className="text-sm tabular-nums">
                    <span className="font-semibold text-cacao">{qty}</span>
                    <span className="text-cacao-500"> enviados · </span>
                    {got === null ? (
                      <span className="text-cacao-500">sin recibir</span>
                    ) : (
                      <span className={cx("font-semibold", got < qty ? "text-terracota-700" : "text-verde")}>{got} recibidos</span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </Section>
      )}
    </div>
  );
}
