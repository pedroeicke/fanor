import type { Metadata } from "next";
import Link from "next/link";
import { getOperator, listStores, shortStoreName } from "@/lib/gestion/server";
import { formatDateShort } from "@/lib/delivery";
import { Notice, PageHeader } from "@/components/admin/ui";
import { isUuid, loadCatalog } from "@/components/admin/pedidos-tienda/catalog";
import { DispatchBuilder } from "@/components/admin/taller/DispatchBuilder";
import type { DispatchOrder, NamedOption } from "@/components/admin/taller/types";

export const metadata: Metadata = { title: "Armar despacho" };
export const dynamic = "force-dynamic";

/**
 * Montar o despacho de um pedido (`?pedido=<id>`) ou mandar tortas sem
 * pedido (sem parâmetro; `?tienda=<id>` pré-escolhe a loja).
 *
 * Tela própria, e não um painel aberto dentro da fila: a fila se recarrega a
 * cada 10 s, e o taller não pode perder os sabores que estava digitando.
 */

type OrderRow = {
  id: string;
  number: number;
  kind: "restock" | "contract";
  status: string;
  for_date: string;
  notes: string | null;
  store_id: string;
  stores: { name: string } | null;
  contracts: { number: number; status: string; deliver_at: string | null } | null;
  production_order_lines: {
    id: string;
    product_id: string;
    quantity: number;
    produced_quantity: number;
    flavor_id: string | null;
    decorator_id: string | null;
    cake_type_id: string | null;
    products: { name: string; sku: string | null; product_families: { tracks_serial: boolean } | null } | null;
    flavors: { name: string } | null;
    decorators: { name: string } | null;
    cake_types: { name: string } | null;
    contract_lines: {
      description: string | null;
      cake_message: string | null;
      flavor_id: string | null;
      decorator_id: string | null;
      cake_type_id: string | null;
      flavors: { name: string } | null;
      decorators: { name: string } | null;
      cake_types: { name: string } | null;
    } | null;
  }[];
};

function BackLink() {
  return (
    <Link href="/admin/taller" className="inline-flex h-11 items-center text-sm font-medium text-cacao-500 underline underline-offset-4 hover:text-cacao">
      ← Volver al taller
    </Link>
  );
}

/** Sabor/decoradora da encomenda pode ter sido desativado depois; continua aparecendo no select. */
function withExtra(options: NamedOption[], extra: (NamedOption | null)[]) {
  const result = [...options];
  const ids = new Set(options.map((o) => o.id));
  for (const option of extra) {
    if (!option || ids.has(option.id)) continue;
    ids.add(option.id);
    result.push(option);
  }
  return result;
}

export default async function DispatchBuilderPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const op = await getOperator();
  if (!op) return <Notice tone="bad">Sesión expirada. Vuelve a entrar.</Notice>;

  const sp = await searchParams;
  const orderId = typeof sp.pedido === "string" ? sp.pedido : null;
  const wantedStore = typeof sp.tienda === "string" ? sp.tienda : null;

  const [{ data: flavorRows }, { data: decoratorRows }] = await Promise.all([
    op.db.from("flavors").select("id, name").eq("active", true).order("sort_order").order("name"),
    op.db.from("decorators").select("id, name").eq("active", true).order("name"),
  ]);
  let flavors = (flavorRows ?? []) as NamedOption[];
  let decorators = (decoratorRows ?? []) as NamedOption[];

  const catalogHint =
    flavors.length === 0 || decorators.length === 0 ? (
      <Notice tone="info">
        {flavors.length === 0 && decorators.length === 0
          ? "Todavía no hay sabores ni decoradoras registrados"
          : flavors.length === 0
            ? "Todavía no hay sabores registrados"
            : "Todavía no hay decoradoras registradas"}
        . Puedes despachar igual; para que salgan en la etiqueta, regístralos en{" "}
        <Link href="/admin/catalogos" className="font-semibold underline underline-offset-2">
          Catálogos
        </Link>
        .
      </Notice>
    ) : null;

  if (orderId !== null) {
    if (!isUuid(orderId)) {
      return (
        <div className="space-y-4">
          <BackLink />
          <Notice tone="bad">El enlace del pedido no es válido.</Notice>
        </div>
      );
    }

    const { data } = await op.db
      .from("production_orders")
      .select(
        "id, number, kind, status, for_date, notes, store_id, stores(name), contracts(number, status, deliver_at), production_order_lines(id, product_id, quantity, produced_quantity, flavor_id, decorator_id, cake_type_id, products(name, sku, product_families(tracks_serial)), flavors(name), decorators(name), cake_types(name), contract_lines(description, cake_message, flavor_id, decorator_id, cake_type_id, flavors(name), decorators(name), cake_types(name)))",
      )
      .eq("id", orderId)
      .maybeSingle();
    const row = data as unknown as OrderRow | null;

    if (!row) {
      return (
        <div className="space-y-4">
          <BackLink />
          <Notice tone="bad">Pedido no encontrado.</Notice>
        </div>
      );
    }
    if (row.status !== "planned" && row.status !== "in_progress") {
      return (
        <div className="space-y-4">
          <BackLink />
          <Notice tone="warn">Este pedido ya fue atendido, cerrado o cancelado. No admite más despachos.</Notice>
        </div>
      );
    }
    /* A OP segue aberta depois da entrega ou do cancelamento da encomenda;
       torta mandada agora ficaria reservada a um contrato encerrado. */
    if (row.contracts?.status === "delivered" || row.contracts?.status === "cancelled") {
      return (
        <div className="space-y-4">
          <BackLink />
          <Notice tone="warn">
            La encomienda #{row.contracts.number} ya fue {row.contracts.status === "delivered" ? "entregada" : "cancelada"}. No despaches
            más tortas: cierra el pedido desde el taller.
          </Notice>
        </div>
      );
    }

    const lines = [...row.production_order_lines].sort((a, b) => (a.products?.name ?? "").localeCompare(b.products?.name ?? "", "es"));
    const order: DispatchOrder = {
      id: row.id,
      number: row.number,
      kind: row.kind,
      contractNumber: row.contracts?.number ?? null,
      storeId: row.store_id,
      storeName: shortStoreName(row.stores?.name),
      forDate: row.for_date,
      deliverAt: row.contracts?.deliver_at ?? null,
      notes: row.notes,
      lines: lines.map((l) => {
        /* Encomenda: vale o que está no contrato; a cópia na OP é reserva. */
        const cl = l.contract_lines;
        const flavorId = cl?.flavor_id ?? l.flavor_id;
        const decoratorId = cl?.decorator_id ?? l.decorator_id;
        const cakeTypeId = cl?.cake_type_id ?? l.cake_type_id;
        return {
          id: l.id,
          productId: l.product_id,
          productName: cl?.description || l.products?.name || "Producto",
          sku: l.products?.sku ?? null,
          tracksSerial: Boolean(l.products?.product_families?.tracks_serial),
          quantity: Number(l.quantity),
          produced: Number(l.produced_quantity),
          flavorId,
          decoratorId,
          cakeTypeId,
          flavorName: (cl?.flavor_id ? cl.flavors?.name : l.flavors?.name) ?? null,
          decoratorName: (cl?.decorator_id ? cl.decorators?.name : l.decorators?.name) ?? null,
          cakeTypeName: (cl?.cake_type_id ? cl.cake_types?.name : l.cake_types?.name) ?? null,
          message: cl?.cake_message ?? null,
        };
      }),
    };

    flavors = withExtra(flavors, order.lines.map((l) => (l.flavorId && l.flavorName ? { id: l.flavorId, name: l.flavorName } : null)));
    decorators = withExtra(decorators, order.lines.map((l) => (l.decoratorId && l.decoratorName ? { id: l.decoratorId, name: l.decoratorName } : null)));

    const title = order.kind === "contract" && order.contractNumber !== null ? `Despacho · Encomienda #${order.contractNumber}` : `Despacho · Pedido #${order.number}`;
    const when =
      order.kind === "contract"
        ? `Entrega ${formatDateShort(order.forDate)}${order.deliverAt ? `, ${order.deliverAt.slice(0, 5)}` : ""}`
        : null;

    return (
      <div className="mx-auto max-w-3xl space-y-5">
        <BackLink />
        <PageHeader
          title={title}
          description={
            <>
              Para <strong className="text-cacao">{order.storeName}</strong>
              {when && ` · ${when}`}. Divide cada torta en sabores; lo que no mandes ahora queda pendiente en el pedido.
            </>
          }
        />
        {order.notes && <p className="whitespace-pre-line rounded-xl bg-crema-100 px-4 py-3 text-sm text-cacao-700">{order.notes}</p>}
        {catalogHint}
        {order.lines.length === 0 ? (
          <Notice tone="warn">Este pedido no tiene líneas para despachar.</Notice>
        ) : (
          <DispatchBuilder order={order} flavors={flavors} decorators={decorators} />
        )}
      </div>
    );
  }

  const [stores, catalog] = await Promise.all([listStores(op.db), loadCatalog(op.db)]);
  const options = stores.map((s) => ({ id: s.id, name: shortStoreName(s.name) }));
  const defaultStoreId = stores.find((s) => s.id === wantedStore)?.id ?? null;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <BackLink />
      <PageHeader
        title="Despacho sin pedido"
        description="Para mandar tortas o productos que ninguna tienda pidió: elige la tienda, agrega los productos y divide las tortas en sabores."
      />
      {catalogHint}
      <DispatchBuilder order={null} stores={options} defaultStoreId={defaultStoreId} products={catalog} flavors={flavors} decorators={decorators} />
    </div>
  );
}
