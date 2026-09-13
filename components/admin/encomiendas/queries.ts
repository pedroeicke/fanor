import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolvePhotoUrl } from "@/lib/storage";
import { round2, type DeliverableCake } from "./shared";

/**
 * Leitura da encomenda completa: contrato, linhas, pagamentos, produção e
 * tortas. O detalhe e o comprovante impresso mostram a mesma coisa — uma
 * consulta só, para os dois nunca discordarem do saldo.
 *
 * Sempre com o cliente da sessão (RLS). Nada aqui usa a chave de serviço,
 * exceto a URL assinada da foto, que é o que `resolvePhotoUrl` faz.
 */

type Named = { name: string } | null;

type ContractRow = {
  id: string;
  number: number;
  status: string;
  deliver_on: string;
  deliver_at: string | null;
  deliver_place: string | null;
  total: string | number;
  notes: string | null;
  created_at: string;
  closed_at: string | null;
  store_id: string;
  stores: { name: string; address: string | null; phone: string | null } | null;
  sellers: Named;
  customers: {
    id: string; name: string; phone: string | null; phone_norm: string | null; email: string | null;
    doc_type: string; doc_number: string | null;
  } | null;
  contract_lines: {
    id: string; description: string; quantity: string | number; unit_price: string | number; total: string | number;
    cake_message: string | null; photo_url: string | null; sort_order: number; product_id: string | null;
    products: { sku: string | null; name: string; product_families: { tracks_serial: boolean } | null } | null;
    flavors: Named; decorators: Named; cake_types: Named;
  }[];
};

type SaleRow = {
  id: string; number: number; kind: string; status: string; total: string | number; sold_at: string;
  sale_payments: { method: string; amount: string | number; reference: string | null }[];
};

type OrderRow = {
  id: string; number: number; status: string; for_date: string;
  production_order_lines: { id: string; quantity: string | number; produced_quantity: string | number; products: Named }[];
};

type CakeRow = {
  id: string; serial: string; status: string; expires_on: string; dispatch_id: string | null; product_id: string;
  products: Named; flavors: Named; decorators: Named;
};

type DispatchRow = {
  id: string; number: number; code: string; status: string; dispatched_at: string; received_at: string | null;
};

export type ContractDetail = Awaited<ReturnType<typeof loadContract>>;

export async function loadContract(db: SupabaseClient, id: string, opts: { photos?: boolean } = {}) {
  const { data, error } = await db
    .from("contracts")
    .select(
      "id, number, status, deliver_on, deliver_at, deliver_place, total, notes, created_at, closed_at, store_id, " +
        "stores(name, address, phone), sellers(name), " +
        "customers(id, name, phone, phone_norm, email, doc_type, doc_number), " +
        "contract_lines(id, description, quantity, unit_price, total, cake_message, photo_url, sort_order, product_id, " +
        "products(sku, name, product_families(tracks_serial)), flavors(name), decorators(name), cake_types(name))",
    )
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(`contracts: ${error.message}`);
  if (!data) return null;
  const c = data as unknown as ContractRow;

  const [
    { data: sales, error: salesError },
    { data: orders, error: ordersError },
    { data: cakes, error: cakesError },
  ] = await Promise.all([
    db.from("sales")
      .select("id, number, kind, status, total, sold_at, sale_payments(method, amount, reference)")
      .eq("contract_id", id)
      .order("sold_at"),
    db.from("production_orders")
      .select("id, number, status, for_date, production_order_lines(id, quantity, produced_quantity, products(name))")
      .eq("contract_id", id)
      .order("created_at"),
    db.from("cake_units")
      .select("id, serial, status, expires_on, dispatch_id, product_id, products(name), flavors(name), decorators(name)")
      .eq("contract_id", id)
      .eq("source", "native")
      .order("serial"),
  ]);

  /* Pagamento que não carregou não pode virar "saldo = total": a vendedora
     cobraria de novo o que já entrou. Melhor a tela falhar. */
  const failed = salesError ?? ordersError ?? cakesError;
  if (failed) throw new Error(`contracts detail: ${failed.message}`);

  const orderRows = (orders ?? []) as unknown as OrderRow[];
  const cakeRows = (cakes ?? []) as unknown as CakeRow[];

  /* Despachos: os da OP e os que trouxeram alguma torta que acabou nesta
     encomenda (a da vitrine entregue no lugar veio por outro despacho). */
  const orderIds = orderRows.map((o) => o.id);
  const dispatchIds = [...new Set(cakeRows.map((u) => u.dispatch_id).filter((v): v is string => Boolean(v)))];
  const dispatchMap = new Map<string, DispatchRow>();
  const select = "id, number, code, status, dispatched_at, received_at";
  const [byOrder, byId] = await Promise.all([
    orderIds.length ? db.from("dispatches").select(select).in("production_order_id", orderIds) : Promise.resolve({ data: [] }),
    dispatchIds.length ? db.from("dispatches").select(select).in("id", dispatchIds) : Promise.resolve({ data: [] }),
  ]);
  for (const d of [...((byOrder.data ?? []) as DispatchRow[]), ...((byId.data ?? []) as DispatchRow[])]) {
    dispatchMap.set(d.id, d);
  }

  const lines = [...c.contract_lines].sort((a, b) => a.sort_order - b.sort_order);
  const photoUrls = new Map<string, string>();
  if (opts.photos) {
    await Promise.all(
      lines
        .filter((l) => l.photo_url)
        .map(async (l) => {
          const url = await resolvePhotoUrl(l.photo_url);
          if (url) photoUrls.set(l.id, url);
        }),
    );
  }

  const saleRows = (sales ?? []) as unknown as SaleRow[];
  const paid = round2(saleRows.filter((s) => s.status === "paid").reduce((sum, s) => sum + Number(s.total), 0));
  const total = Number(c.total);

  return {
    id: c.id,
    number: c.number,
    status: c.status,
    deliverOn: c.deliver_on,
    deliverAt: c.deliver_at,
    deliverPlace: c.deliver_place,
    total,
    notes: c.notes,
    createdAt: c.created_at,
    closedAt: c.closed_at,
    store: {
      id: c.store_id,
      name: c.stores?.name ?? "",
      address: c.stores?.address ?? null,
      phone: c.stores?.phone ?? null,
    },
    seller: c.sellers?.name ?? null,
    customer: c.customers
      ? {
          id: c.customers.id,
          name: c.customers.name,
          phone: c.customers.phone,
          phoneNorm: c.customers.phone_norm,
          email: c.customers.email,
          docType: c.customers.doc_type,
          docNumber: c.customers.doc_number,
        }
      : null,
    lines: lines.map((l) => ({
      id: l.id,
      productId: l.product_id,
      description: l.description,
      sku: l.products?.sku ?? null,
      quantity: Number(l.quantity),
      unitPrice: Number(l.unit_price),
      total: Number(l.total),
      flavor: l.flavors?.name ?? null,
      decorator: l.decorators?.name ?? null,
      cakeType: l.cake_types?.name ?? null,
      message: l.cake_message,
      hasPhoto: Boolean(l.photo_url),
      photoUrl: photoUrls.get(l.id) ?? null,
      isCake: Boolean(l.products?.product_families?.tracks_serial),
    })),
    payments: saleRows.map((s) => ({
      id: s.id,
      number: s.number,
      kind: s.kind,
      status: s.status,
      total: Number(s.total),
      soldAt: s.sold_at,
      methods: s.sale_payments.map((p) => ({ method: p.method, amount: Number(p.amount), reference: p.reference })),
    })),
    paid,
    /* Nunca negativo na tela: pago a mais só acontece por vuelto, que já foi
       descontado do pagamento em dinheiro. */
    balance: Math.max(0, round2(total - paid)),
    orders: orderRows.map((o) => ({
      id: o.id,
      number: o.number,
      status: o.status,
      forDate: o.for_date,
      lines: o.production_order_lines.map((l) => ({
        id: l.id,
        product: l.products?.name ?? "Producto",
        quantity: Number(l.quantity),
        produced: Number(l.produced_quantity),
      })),
    })),
    cakes: cakeRows.map((u) => ({
      id: u.id,
      serial: u.serial,
      status: u.status,
      productId: u.product_id,
      product: u.products?.name ?? "Torta",
      flavor: u.flavors?.name ?? null,
      decorator: u.decorators?.name ?? null,
      expiresOn: u.expires_on,
      dispatchId: u.dispatch_id,
    })),
    dispatches: [...dispatchMap.values()].sort((a, b) => a.number - b.number).map((d) => ({
      id: d.id,
      number: d.number,
      code: d.code,
      status: d.status,
      dispatchedAt: d.dispatched_at,
      receivedAt: d.received_at,
    })),
    expectedCakes: lines
      .filter((l) => l.products?.product_families?.tracks_serial)
      .reduce((n, l) => n + Number(l.quantity), 0),
  };
}

type VitrineRow = {
  serial: string; expires_on: string; product_id: string; products: Named; flavors: Named;
};

/**
 * Tortas da vitrine da loja que podem sair no lugar da reservada. Vencida
 * não entra: a vitrine calar é melhor que entregar torta velha.
 */
export async function loadVitrine(db: SupabaseClient, storeId: string, today: string): Promise<DeliverableCake[]> {
  const { data } = await db
    .from("cake_units")
    .select("serial, expires_on, product_id, products(name), flavors(name)")
    .eq("store_id", storeId)
    .eq("source", "native")
    .eq("status", "in_stock")
    .gte("expires_on", today)
    .order("expires_on")
    .order("serial")
    .limit(300);

  return ((data ?? []) as unknown as VitrineRow[]).map((u) => ({
    serial: u.serial,
    productId: u.product_id,
    product: u.products?.name ?? "Torta",
    flavor: u.flavors?.name ?? null,
    expiresOn: u.expires_on,
    reserved: false,
  }));
}
