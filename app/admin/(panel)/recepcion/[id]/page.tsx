import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EmptyState, Notice, PageHeader, Section, StatCard, StatusPill } from "@/components/admin/ui";
import { ReceiveChecklist } from "@/components/admin/recepcion/ReceiveChecklist";
import type { ChecklistCake, ChecklistLine } from "@/components/admin/recepcion/types";
import { getOperator, shortStoreName, type Operator } from "@/lib/gestion/server";
import { formatDuration, limaDateTime, minutesBetween } from "@/lib/gestion/dates";
import { isSerial } from "@/lib/gestion/qr";
import { CAKE_STATUS, DISPATCH_STATUS, TONE_CLASS } from "@/lib/gestion/labels";
import { cx } from "@/lib/format";

export const metadata: Metadata = { title: "Recibir despacho" };
export const dynamic = "force-dynamic";

/**
 * Um despacho: conferir (se está a caminho) ou ver como chegou.
 *
 * Depois de confirmado, a mesma URL vira o resumo — é o que a vendedora
 * reabre quando o taller pergunta "chegou tudo?", e o link que as faltantes
 * de "Mi vitrina" apontam.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Dispatch = {
  id: string;
  number: number;
  code: string;
  status: string;
  store_id: string;
  dispatched_at: string;
  dispatched_by: string | null;
  received_at: string | null;
  received_by: string | null;
  notes: string | null;
  stores: { name: string } | null;
  production_orders: { number: number; kind: string; contracts: { number: number } | null } | null;
};

type CakeRow = {
  id: string;
  serial: string;
  status: string;
  redecorated: boolean;
  products: { name: string; sku: string | null } | null;
  flavors: { name: string } | null;
  decorators: { name: string } | null;
  cake_types: { name: string } | null;
  contracts: { number: number } | null;
};

type LineRow = {
  id: string;
  quantity: number | string;
  received_quantity: number | string | null;
  products: { name: string; sku: string | null } | null;
};

/** Relógio lido uma vez, fora do componente: render tem de ser puro. */
function clock() {
  return new Date();
}

function formatQty(n: number) {
  return n.toLocaleString("es-PE", { maximumFractionDigits: 3 });
}

/**
 * Nome de quem despachou/recebeu. `auth.users` não é legível pelo painel e
 * `admins` só mostra a própria linha (RLS) — então vale a vendedora ligada ao
 * login, ou o próprio nome quando foi quem está olhando. Sem nenhum dos
 * dois, a tela omite o "por" em vez de inventar.
 */
async function resolveNames(op: Operator, ids: (string | null)[]) {
  const wanted = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  const names = new Map<string, string>();
  if (!wanted.length) return names;
  const { data } = await op.db.from("sellers").select("user_id, name").in("user_id", wanted);
  for (const row of (data ?? []) as { user_id: string; name: string }[]) names.set(row.user_id, row.name);
  if (wanted.includes(op.user.id) && !names.has(op.user.id)) names.set(op.user.id, op.user.name);
  return names;
}

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ReceptionDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ serie?: string | string[]; confirmado?: string | string[] }>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  if (!UUID.test(id)) notFound();

  const op = await getOperator();
  if (!op) return <Notice tone="bad">Sesión expirada. Vuelve a entrar.</Notice>;

  const { data: dispatchData, error: dispatchError } = await op.db
    .from("dispatches")
    .select(
      "id, number, code, status, store_id, dispatched_at, dispatched_by, received_at, received_by, notes, stores(name), production_orders(number, kind, contracts(number))",
    )
    .eq("id", id)
    .maybeSingle();

  if (dispatchError) return <Notice tone="bad">No se pudo cargar el despacho. Inténtalo de nuevo en unos segundos.</Notice>;
  if (!dispatchData) notFound();
  const dispatch = dispatchData as unknown as Dispatch;

  const [
    { data: cakeData, error: cakeError },
    { data: lineData, error: lineError },
    { data: eventData, error: eventError },
    names,
  ] = await Promise.all([
    op.db
      .from("cake_units")
      .select("id, serial, status, redecorated, products(name, sku), flavors(name), decorators(name), cake_types(name), contracts(number)")
      .eq("dispatch_id", dispatch.id)
      .order("serial", { ascending: true }),
    op.db.from("dispatch_lines").select("id, quantity, received_quantity, products(name, sku)").eq("dispatch_id", dispatch.id),
    /* Como cada torta chegou fica no diário, não no estado atual: a que chegou
       pode já ter sido vendida, e a faltante pode ter aparecido depois. */
    dispatch.status === "in_transit"
      ? Promise.resolve({ data: [] as { cake_unit_id: string; kind: string }[], error: null })
      : op.db.from("cake_events").select("cake_unit_id, kind").eq("ref_id", dispatch.id).in("kind", ["received", "missing"]),
    resolveNames(op, [dispatch.dispatched_by, dispatch.received_by]),
  ]);

  const now = clock();
  const cakes = (cakeData ?? []) as unknown as CakeRow[];
  const lines = ((lineData ?? []) as unknown as LineRow[]).sort((a, b) =>
    (a.products?.name ?? "").localeCompare(b.products?.name ?? "", "es"),
  );
  const storeName = shortStoreName(dispatch.stores?.name);
  const backHref = `/admin/recepcion?tienda=${dispatch.store_id}`;
  const otherStore = op.seller?.storeId && op.seller.storeId !== dispatch.store_id;
  const origin = dispatch.production_orders
    ? dispatch.production_orders.kind === "contract"
      ? `Para la encomienda #${dispatch.production_orders.contracts?.number ?? "—"}`
      : `Pedido de tienda #${dispatch.production_orders.number}`
    : null;

  const header = (
    <>
      <PageHeader
        title={`Despacho #${dispatch.number}`}
        description={`${storeName} · guía ${dispatch.code}`}
        actions={
          <>
            <StatusPill status={dispatch.status} map={DISPATCH_STATUS} />
            <Link
              href={backHref}
              className="inline-flex h-11 items-center rounded-full border border-crema-300 px-4 text-sm font-medium text-cacao-700 hover:border-cacao/35"
            >
              ← Recepción
            </Link>
          </>
        }
      />

      <div className="card space-y-1.5 p-4 text-sm sm:p-5">
        <p className="text-cacao-700">
          <span className="font-semibold text-cacao">Salió del taller:</span> {limaDateTime(dispatch.dispatched_at)}
          {dispatch.status === "in_transit" && (
            <span className="text-cacao-500"> · hace {formatDuration(minutesBetween(dispatch.dispatched_at, now))}</span>
          )}
          {dispatch.dispatched_by && names.get(dispatch.dispatched_by) && (
            <span className="text-cacao-500"> · por {names.get(dispatch.dispatched_by)}</span>
          )}
        </p>
        {origin && <p className="text-cacao-700">{origin}</p>}
        {dispatch.notes && (
          <p className="whitespace-pre-line text-cacao-700">
            <span className="font-semibold text-cacao">Observación:</span> {dispatch.notes}
          </p>
        )}
      </div>
    </>
  );

  /* Lista vazia por erro de leitura não pode virar checklist: confirmar
     mandaria "nenhuma conferida" e o banco daria o despacho inteiro por faltante. */
  if (cakeError || lineError || eventError) {
    return (
      <div className="mx-auto max-w-2xl space-y-5">
        {header}
        <Notice tone="bad">
          No se pudo cargar el contenido del despacho. Actualiza la página en unos segundos
          {dispatch.status === "in_transit" ? " antes de conferir." : "."}
        </Notice>
      </div>
    );
  }

  if (dispatch.status === "in_transit") {
    const checklistCakes: ChecklistCake[] = cakes
      .filter((c) => c.status === "in_transit")
      .map((c) => ({
        serial: c.serial,
        product: c.products?.name ?? "Torta",
        sku: c.products?.sku ?? null,
        flavor: c.flavors?.name ?? null,
        decorator: c.decorators?.name ?? null,
        cakeType: c.cake_types?.name ?? null,
        redecorated: c.redecorated,
        contractNumber: c.contracts?.number ?? null,
      }));
    const checklistLines: ChecklistLine[] = lines.map((l) => ({
      id: l.id,
      product: l.products?.name ?? "Producto",
      sku: l.products?.sku ?? null,
      quantity: Number(l.quantity),
    }));
    const serie = firstParam(query.serie)?.trim().toUpperCase() ?? "";

    return (
      <div className="mx-auto max-w-2xl space-y-5">
        {header}
        {otherStore && (
          <Notice tone="warn">Este despacho es para {storeName}, no para tu tienda. Confírmalo solo si llegó aquí.</Notice>
        )}
        <ReceiveChecklist
          dispatchId={dispatch.id}
          code={dispatch.code}
          cakes={checklistCakes}
          lines={checklistLines}
          initialSerial={isSerial(serie) ? serie : null}
        />
      </div>
    );
  }

  /* ---------------------------------------------------------------------- */
  /*  Resumo: já recebido (ou anulado)                                       */
  /* ---------------------------------------------------------------------- */

  const outcome = new Map<string, string>();
  for (const e of (eventData ?? []) as { cake_unit_id: string; kind: string }[]) outcome.set(e.cake_unit_id, e.kind);

  const receivedCount = cakes.filter((c) => outcome.get(c.id) === "received").length;
  const missingCount = cakes.filter((c) => outcome.get(c.id) === "missing").length;
  const stillMissing = cakes.filter((c) => c.status === "missing").length;
  const shortLines = lines.filter((l) => l.received_quantity !== null && Number(l.received_quantity) < Number(l.quantity));
  const justConfirmed = firstParam(query.confirmado) === "1";
  const receiver = dispatch.received_by ? names.get(dispatch.received_by) : null;

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      {header}

      {dispatch.status === "cancelled" ? (
        <Notice tone="info">Este despacho fue anulado. No hay nada que recibir.</Notice>
      ) : (
        <>
          {justConfirmed && (
            <Notice tone={missingCount || shortLines.length ? "warn" : "ok"}>
              <span className="font-semibold">Recepción confirmada.</span>{" "}
              {missingCount || shortLines.length
                ? "Quedó registrado lo que no llegó."
                : "Todo llegó completo."}
            </Notice>
          )}

          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <StatCard label="Recibidas" value={receivedCount} tone={receivedCount ? "ok" : undefined} />
            <StatCard label="Faltantes" value={missingCount} tone={missingCount ? "warn" : undefined} />
            {lines.length > 0 && (
              <StatCard label="Ítems con diferencia" value={shortLines.length} tone={shortLines.length ? "warn" : undefined} />
            )}
          </ul>

          {dispatch.received_at && (
            <p className="text-sm text-cacao-700">
              Recibido el {limaDateTime(dispatch.received_at)}
              {receiver && ` por ${receiver}`}.
            </p>
          )}

          {stillMissing > 0 && (
            <Notice tone="bad">
              {stillMissing === 1 ? "Una torta sigue" : `${stillMissing} tortas siguen`} como faltante. Se aclaran en{" "}
              <Link href={`/admin/tienda?tienda=${dispatch.store_id}#faltantes`} className="font-semibold underline underline-offset-4">
                Mi vitrina
              </Link>
              .
            </Notice>
          )}
        </>
      )}

      {cakes.length > 0 && (
        <Section title="Tortas" aside={`${cakes.length}`}>
          <ul className="divide-y divide-crema-200">
            {cakes.map((c) => {
              const kind = outcome.get(c.id);
              return (
                <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3 sm:px-5">
                  <span
                    aria-hidden
                    className={cx(
                      "grid size-7 shrink-0 place-items-center rounded-full border text-sm font-bold",
                      kind === "received" ? TONE_CLASS.ok : kind === "missing" ? TONE_CLASS.bad : TONE_CLASS.muted,
                    )}
                  >
                    {kind === "received" ? "✓" : kind === "missing" ? "✗" : "·"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-[14px] font-semibold text-cacao">{c.serial}</p>
                    <p className="text-[13px] text-cacao-500">
                      {c.products?.name ?? "Torta"} · {c.flavors?.name ?? "Sin sabor"}
                      {c.redecorated && " · REDECORADA"}
                      {c.contracts && ` · Encomienda #${c.contracts.number}`}
                    </p>
                    <p className="sr-only">{kind === "received" ? "Llegó" : kind === "missing" ? "No llegó" : "Sin conferir"}</p>
                  </div>
                  <StatusPill status={c.status} map={CAKE_STATUS} />
                </li>
              );
            })}
          </ul>
        </Section>
      )}

      {lines.length > 0 && (
        <Section title="Ítems sin serie">
          <ul className="divide-y divide-crema-200 text-sm">
            {lines.map((l) => {
              const sent = Number(l.quantity);
              const got = l.received_quantity === null ? null : Number(l.received_quantity);
              return (
                <li key={l.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3 sm:px-5">
                  <span className="font-medium text-cacao">
                    {l.products?.name ?? "Producto"}
                    {l.products?.sku && <span className="ml-1.5 text-[13px] font-normal text-cacao-300">{l.products.sku}</span>}
                  </span>
                  <span className={cx("tabular-nums", got !== null && got < sent ? "font-semibold text-terracota" : "text-cacao-700")}>
                    {got === null ? "—" : formatQty(got)} de {formatQty(sent)}
                  </span>
                </li>
              );
            })}
          </ul>
        </Section>
      )}

      {!cakes.length && !lines.length && <EmptyState>Este despacho no tiene tortas ni ítems.</EmptyState>}

      <div className="flex flex-col gap-2 sm:flex-row">
        <Link
          href={`/admin/tienda?tienda=${dispatch.store_id}`}
          className="inline-flex h-12 flex-1 items-center justify-center rounded-full bg-dorado px-5 font-semibold text-cacao hover:bg-dorado-600"
        >
          Ver mi vitrina
        </Link>
        <Link
          href={backHref}
          className="inline-flex h-12 flex-1 items-center justify-center rounded-full border border-cacao/25 px-5 font-semibold text-cacao"
        >
          Volver a recepción
        </Link>
      </div>
    </div>
  );
}
