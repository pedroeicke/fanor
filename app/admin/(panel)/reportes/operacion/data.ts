import "server-only";
import { getSetting, runOp, shortStoreName, type Operator } from "@/lib/gestion/server";
import { addDays, limaDay, limaToday } from "@/lib/gestion/dates";

/**
 * Números do relatório de operação, lidos uma vez e usados pela tela e pela
 * exportação — a planilha tem de bater com o que o Joseka viu na tela.
 *
 * Três fontes:
 *   · `report_cakes` — o que ACONTECEU no período (despachou, vendeu,
 *     devolveu), dia a dia. Base de "mais produzidas" e "mais vendidas";
 *   · `cake_units` nascidas no período — o DESTINO de cada torta despachada.
 *     É daqui que sai a sobra: contar eventos somaria duas vezes a torta que
 *     voltou ao taller e depois foi descartada;
 *   · `sales` pagas — dinheiro, forma de pagamento, faturamento por produto.
 */

export const MAX_RANGE_DAYS = 92;
export const DEFAULT_RANGE_DAYS = 7;

export type Grouping = "dia" | "semana";

export type ReportFilters = {
  from: string;
  to: string;
  storeId: string | null;
  group: Grouping;
  /** O período pedido passava do máximo e foi cortado. */
  clamped: boolean;
};

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGE = 1000;

function validDay(value: string | null | undefined) {
  if (!value || !DAY_RE.test(value)) return null;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d ? value : null;
}

function utcMs(day: string) {
  const [y, m, d] = day.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

/** Dias do período contando as duas pontas. */
export function daySpan(from: string, to: string) {
  return Math.round((utcMs(to) - utcMs(from)) / 86_400_000) + 1;
}

/**
 * Filtros vindos da URL, sempre válidos.
 *
 * Padrão: últimos 7 dias de Lima. Data inválida volta ao padrão, período
 * invertido é desvirado e o que passar de 92 dias é cortado a partir do fim
 * — ler três meses de venda já é o teto do que a página aguenta sem demorar.
 */
export function parseFilters(get: (key: string) => string | null | undefined, today = limaToday()): ReportFilters {
  let to = validDay(get("hasta")) ?? today;
  let from = validDay(get("desde")) ?? addDays(to > today ? today : to, -(DEFAULT_RANGE_DAYS - 1));
  if (from > to) [from, to] = [to, from];
  /* Futuro não tem dado. Cortar depois de desvirar: "desde" no ano que vem
     com "hasta" vazio viraria um período inteiro depois de hoje. */
  if (to > today) to = today;
  if (from > today) from = today;

  let clamped = false;
  if (daySpan(from, to) > MAX_RANGE_DAYS) {
    from = addDays(to, -(MAX_RANGE_DAYS - 1));
    clamped = true;
  }

  const store = get("tienda");
  return {
    from,
    to,
    storeId: store && UUID_RE.test(store) ? store.toLowerCase() : null,
    group: get("agrupar") === "semana" ? "semana" : "dia",
    clamped,
  };
}

/**
 * Início do dia de Lima como instante.
 *
 * O Peru não tem horário de verão desde 1994: o dia de Lima começa sempre às
 * 05:00 UTC. É a mesma conta que `lima_today()` faz no banco.
 */
function limaDayStart(day: string) {
  return `${day}T00:00:00-05:00`;
}

/** Segunda-feira da semana do dia (semana de loja, segunda a domingo). */
export function weekStart(day: string) {
  const dow = new Date(utcMs(day)).getUTCDay();
  return addDays(day, -((dow + 6) % 7));
}

export function bucketOf(day: string, group: Grouping) {
  return group === "semana" ? weekStart(day) : day;
}

/** "13 sep" — sem fuso, a data já é de Lima. */
export function shortDay(day: string) {
  return new Date(utcMs(day) + 12 * 3_600_000).toLocaleDateString("es-PE", { day: "numeric", month: "short", timeZone: "UTC" }).replace(".", "");
}

export function bucketLabel(bucket: string, group: Grouping) {
  return group === "semana" ? `Sem. ${shortDay(bucket)}` : shortDay(bucket);
}

/** Todos os baldes do período, inclusive os vazios: dia sem venda também é informação. */
export function bucketsInRange(from: string, to: string, group: Grouping) {
  const out: string[] = [];
  const step = group === "semana" ? 7 : 1;
  for (let b = bucketOf(from, group); b <= to; b = addDays(b, step)) out.push(b);
  return out;
}

// ---------------------------------------------------------------------------
// Tipos do resultado
// ---------------------------------------------------------------------------

export type CakeCounts = {
  dispatched: number;
  received: number;
  sold: number;
  staffSold: number;
  returned: number;
  redecorated: number;
  discarded: number;
  missing: number;
};

export type CakeReportRow = CakeCounts & {
  day: string;
  storeId: string | null;
  productId: string;
  flavorId: string | null;
};

export type Ranked = { key: string; label: string; sublabel?: string; value: number; context?: string };

export type LeftoverRow = {
  key: string;
  product: string;
  sku: string | null;
  flavor: string;
  dispatched: number;
  sold: number;
  /** returned + discarded + missing. */
  leftover: number;
  returned: number;
  discarded: number;
  missing: number;
  pending: number;
};

export type SalesBucket = { bucket: string; revenue: number; count: number };

export type StorePayments = { storeId: string; storeName: string; total: number; count: number; methods: Record<string, number> };

export type OperationReport = {
  filters: ReportFilters;
  stores: { id: string; name: string }[];
  storeName: (id: string | null) => string;
  productName: (id: string) => { name: string; sku: string | null };
  flavorName: (id: string | null) => string;
  stockSource: string;
  cakeRows: CakeReportRow[];
  cakes: CakeCounts;
  /** Tortas despachadas no período (sem as redecoradas) e onde estão hoje. */
  cohort: { total: number; sold: number; returned: number; discarded: number; missing: number; pending: number };
  producedByProduct: Ranked[];
  soldByProduct: Ranked[];
  soldByFlavor: Ranked[];
  leftovers: LeftoverRow[];
  redecorated: { total: number; sold: number; staff: number; discarded: number; inStock: number; other: number };
  sales: {
    count: number;
    revenue: number;
    byKind: Record<string, { count: number; revenue: number }>;
    buckets: SalesBucket[];
    byStore: StorePayments[];
    methodTotals: Record<string, number>;
    revenueByProduct: Ranked[];
    /** Balde × loja, para a planilha. */
    table: { bucket: string; storeId: string; count: number; revenue: number; byKind: Record<string, number>; methods: Record<string, number> }[];
  };
};

export const PAYMENT_ORDER = ["cash", "card", "yape", "plin", "transfer", "deposit", "credit"] as const;
export const SALE_KIND_ORDER = ["counter", "staff", "contract_advance", "contract_balance"] as const;

type PgError = { message: string; code?: string };
type Page<T> = { data: T[] | null; error: PgError | null; count?: number | null };

class ReportError extends Error {}

/**
 * Lê todas as páginas de uma consulta. A primeira traz a contagem; as outras
 * saem em paralelo, quatro por vez — três meses de venda são dezenas de
 * páginas, e em fila a tela levaria o dobro.
 */
async function fetchAll<T>(what: string, page: (from: number, to: number, withCount: boolean) => PromiseLike<Page<T>>): Promise<T[]> {
  const first = await page(0, PAGE - 1, true);
  if (first.error) {
    console.error("[reporte operación]", what, first.error.code, first.error.message);
    throw new ReportError(`No se pudo leer ${what}.`);
  }
  const rows = [...(first.data ?? [])];
  const total = first.count ?? rows.length;
  const offsets: number[] = [];
  for (let offset = PAGE; offset < total; offset += PAGE) offsets.push(offset);
  for (let i = 0; i < offsets.length; i += 4) {
    const pages = await Promise.all(offsets.slice(i, i + 4).map((offset) => page(offset, offset + PAGE - 1, false)));
    for (const p of pages) {
      if (p.error) {
        console.error("[reporte operación]", what, p.error.code, p.error.message);
        throw new ReportError(`No se pudo leer ${what}.`);
      }
      rows.push(...(p.data ?? []));
    }
  }
  return rows;
}

/** Busca por lista de ids em lotes: uma URL com 400 uuids passa do limite do servidor. */
async function fetchByIds<T>(op: Operator, table: string, columns: string, ids: string[]): Promise<T[]> {
  const unique = [...new Set(ids)];
  const chunks: string[][] = [];
  for (let i = 0; i < unique.length; i += 150) chunks.push(unique.slice(i, i + 150));
  const results = await Promise.all(chunks.map((chunk) => op.db.from(table).select(columns).in("id", chunk)));
  const rows: T[] = [];
  for (const r of results) {
    if (r.error) {
      console.error("[reporte operación]", table, r.error.code, r.error.message);
      throw new ReportError(`No se pudo leer ${table}.`);
    }
    rows.push(...((r.data ?? []) as T[]));
  }
  return rows;
}

function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function roundValues(record: Record<string, number>) {
  for (const key of Object.keys(record)) record[key] = round2(record[key]);
}

const EMPTY_COUNTS: CakeCounts = { dispatched: 0, received: 0, sold: 0, staffSold: 0, returned: 0, redecorated: 0, discarded: 0, missing: 0 };

function addCounts(target: CakeCounts, row: CakeCounts) {
  target.dispatched += row.dispatched;
  target.received += row.received;
  target.sold += row.sold;
  target.staffSold += row.staffSold;
  target.returned += row.returned;
  target.redecorated += row.redecorated;
  target.discarded += row.discarded;
  target.missing += row.missing;
}

function sortRanked(map: Map<string, Ranked>, limit: number) {
  return [...map.values()]
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label, "es"))
    .slice(0, limit);
}

type RawCakeRow = {
  day: string; store_id: string | null; product_id: string; flavor_id: string | null;
  dispatched: number; received: number; sold: number; staff_sold: number;
  returned: number; redecorated: number; discarded: number; missing: number;
};
type UnitRow = { id: string; product_id: string; flavor_id: string | null; store_id: string; status: string; redecorated: boolean };
type SaleRow = {
  id: string; store_id: string; kind: string; total: string | number; sold_at: string;
  sale_lines: { product_id: string | null; description: string; quantity: string | number; total: string | number; cake_unit_id: string | null }[];
  sale_payments: { method: string; amount: string | number }[];
};

export type ReportSections = { cakes: boolean; sales: boolean };

/**
 * Monta o relatório. `sections` deixa a exportação pular o que não vai na
 * planilha pedida.
 */
export async function loadOperationReport(
  op: Operator,
  filters: ReportFilters,
  sections: ReportSections = { cakes: true, sales: true },
): Promise<{ ok: true; report: OperationReport } | { ok: false; error: string }> {
  try {
    return { ok: true, report: await build(op, filters, sections) };
  } catch (error) {
    if (error instanceof ReportError) return { ok: false, error: error.message };
    throw error;
  }
}

async function build(op: Operator, filters: ReportFilters, sections: ReportSections): Promise<OperationReport> {
  const { from, to, group } = filters;

  const [storesRes, stockSource, cakeRes, units, sales] = await Promise.all([
    op.db.from("stores").select("id, name, active, sort_order").order("sort_order"),
    getSetting<string>(op.db, "stock_source", "sisgeco"),
    sections.cakes ? runOp<RawCakeRow[]>("report_cakes", { p_from: from, p_to: to }) : Promise.resolve({ ok: true as const, data: [] as RawCakeRow[] }),
    sections.cakes
      ? fetchAll<UnitRow>("las tortas del período", (a, b, withCount) => {
          let q = op.db
            .from("cake_units")
            .select("id, product_id, flavor_id, store_id, status, redecorated", withCount ? { count: "exact" } : undefined)
            .eq("source", "native")
            .gte("produced_on", from)
            .lte("produced_on", to);
          if (filters.storeId) q = q.eq("store_id", filters.storeId);
          return q.order("id").range(a, b);
        })
      : Promise.resolve([] as UnitRow[]),
    sections.sales
      ? fetchAll<SaleRow>("las ventas", (a, b, withCount) => {
          let q = op.db
            .from("sales")
            .select(
              "id, store_id, kind, total, sold_at, sale_lines(product_id, description, quantity, total, cake_unit_id), sale_payments(method, amount)",
              withCount ? { count: "exact" } : undefined,
            )
            .eq("status", "paid")
            .gte("sold_at", limaDayStart(from))
            .lt("sold_at", limaDayStart(addDays(to, 1)));
          if (filters.storeId) q = q.eq("store_id", filters.storeId);
          return q.order("sold_at").order("id").range(a, b);
        })
      : Promise.resolve([] as SaleRow[]),
  ]);

  if (storesRes.error) throw new ReportError("No se pudo leer las tiendas.");
  if (!cakeRes.ok) throw new ReportError(cakeRes.error);

  const storeRows = (storesRes.data ?? []) as { id: string; name: string; active: boolean }[];
  const storeMap = new Map(storeRows.map((s) => [s.id, shortStoreName(s.name)]));
  const storeName = (id: string | null) => (id ? storeMap.get(id) ?? "Tienda eliminada" : "Sin tienda");

  // --- tortas: eventos do período -------------------------------------------
  const cakeRows: CakeReportRow[] = (cakeRes.data ?? [])
    .map((r) => ({
      day: String(r.day).slice(0, 10),
      storeId: r.store_id,
      productId: r.product_id,
      flavorId: r.flavor_id,
      dispatched: Number(r.dispatched) || 0,
      received: Number(r.received) || 0,
      sold: Number(r.sold) || 0,
      staffSold: Number(r.staff_sold) || 0,
      returned: Number(r.returned) || 0,
      redecorated: Number(r.redecorated) || 0,
      discarded: Number(r.discarded) || 0,
      missing: Number(r.missing) || 0,
    }))
    .filter((r) => !filters.storeId || r.storeId === filters.storeId);

  // --- nomes ------------------------------------------------------------------
  const saleProductIds = sales.flatMap((s) => s.sale_lines.map((l) => l.product_id)).filter((id): id is string => Boolean(id));
  const productIds = [...cakeRows.map((r) => r.productId), ...units.map((u) => u.product_id), ...saleProductIds];
  const flavorIds = [...cakeRows.map((r) => r.flavorId), ...units.map((u) => u.flavor_id)].filter((id): id is string => Boolean(id));

  const [products, flavors] = await Promise.all([
    productIds.length ? fetchByIds<{ id: string; name: string; sku: string | null }>(op, "products", "id, name, sku", productIds) : Promise.resolve([]),
    flavorIds.length ? fetchByIds<{ id: string; name: string }>(op, "flavors", "id, name", flavorIds) : Promise.resolve([]),
  ]);
  const productMap = new Map(products.map((p) => [p.id, { name: p.name, sku: p.sku }]));
  const flavorMap = new Map(flavors.map((f) => [f.id, f.name]));
  const productName = (id: string) => productMap.get(id) ?? { name: "Producto eliminado", sku: null };
  const flavorName = (id: string | null) => (id ? flavorMap.get(id) ?? "Sabor eliminado" : "Sin sabor");

  const cakes: CakeCounts = { ...EMPTY_COUNTS };
  const produced = new Map<string, Ranked>();
  const soldProduct = new Map<string, Ranked>();
  const soldFlavor = new Map<string, Ranked & { dispatched: number }>();

  for (const r of cakeRows) {
    addCounts(cakes, r);
    const p = productName(r.productId);
    const sold = r.sold + r.staffSold;

    const prod = produced.get(r.productId) ?? { key: r.productId, label: p.name, sublabel: p.sku ?? undefined, value: 0 };
    prod.value += r.dispatched;
    produced.set(r.productId, prod);

    const sp = soldProduct.get(r.productId) ?? { key: r.productId, label: p.name, sublabel: p.sku ?? undefined, value: 0 };
    sp.value += sold;
    soldProduct.set(r.productId, sp);

    const fk = r.flavorId ?? "none";
    const sf = soldFlavor.get(fk) ?? { key: fk, label: flavorName(r.flavorId), value: 0, dispatched: 0 };
    sf.value += sold;
    sf.dispatched += r.dispatched;
    soldFlavor.set(fk, sf);
  }

  const soldByFlavor = [...soldFlavor.values()]
    .map((f) => ({ ...f, context: f.dispatched ? `de ${f.dispatched} despachadas` : undefined }))
    .filter((f) => f.value > 0)
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label, "es"))
    .slice(0, 15);

  // --- tortas: destino das despachadas no período -----------------------------
  const cohort = { total: 0, sold: 0, returned: 0, discarded: 0, missing: 0, pending: 0 };
  const leftoverMap = new Map<string, LeftoverRow>();
  const redecoratedUnits: UnitRow[] = [];

  for (const u of units) {
    /* A redecorada é a segunda vida de uma torta que já entrou na conta como
       devolvida: contá-la de novo inflaria o "despachado". Tem seção própria. */
    if (u.redecorated) {
      redecoratedUnits.push(u);
      continue;
    }
    cohort.total++;
    const key = `${u.product_id}|${u.flavor_id ?? "none"}`;
    const p = productName(u.product_id);
    const row = leftoverMap.get(key) ?? {
      key, product: p.name, sku: p.sku, flavor: flavorName(u.flavor_id),
      dispatched: 0, sold: 0, leftover: 0, returned: 0, discarded: 0, missing: 0, pending: 0,
    };
    row.dispatched++;
    if (u.status === "sold") {
      cohort.sold++;
      row.sold++;
    } else if (u.status === "returned" || u.status === "discarded" || u.status === "missing") {
      cohort[u.status]++;
      row[u.status]++;
      row.leftover++;
    } else {
      /* in_transit, in_stock, reserved: ainda pode vender. */
      cohort.pending++;
      row.pending++;
    }
    leftoverMap.set(key, row);
  }

  const leftovers = [...leftoverMap.values()]
    .filter((r) => r.leftover > 0)
    .sort((a, b) => b.leftover - a.leftover || b.leftover / b.dispatched - a.leftover / a.dispatched || a.product.localeCompare(b.product, "es"));

  // --- redecoradas ------------------------------------------------------------
  const redecorated = { total: redecoratedUnits.length, sold: 0, staff: 0, discarded: 0, inStock: 0, other: 0 };
  if (redecoratedUnits.length) {
    const soldIds = redecoratedUnits.filter((u) => u.status === "sold").map((u) => u.id);
    const staffIds = new Set<string>();
    for (let i = 0; i < soldIds.length; i += 150) {
      const { data, error } = await op.db.from("cake_events").select("cake_unit_id").eq("kind", "staff_sale").in("cake_unit_id", soldIds.slice(i, i + 150));
      if (error) throw new ReportError("No se pudo leer el destino de las redecoradas.");
      for (const e of data ?? []) staffIds.add(e.cake_unit_id as string);
    }
    for (const u of redecoratedUnits) {
      if (u.status === "sold") {
        if (staffIds.has(u.id)) redecorated.staff++;
        else redecorated.sold++;
      } else if (u.status === "discarded") redecorated.discarded++;
      else if (u.status === "in_stock") redecorated.inStock++;
      else redecorated.other++;
    }
  }

  // --- vendas -----------------------------------------------------------------
  const byKind: Record<string, { count: number; revenue: number }> = {};
  const bucketTotals = new Map<string, SalesBucket>();
  const byStore = new Map<string, StorePayments>();
  const methodTotals: Record<string, number> = {};
  const revenueProduct = new Map<string, Ranked & { units: number }>();
  const table = new Map<string, OperationReport["sales"]["table"][number]>();
  let revenue = 0;

  for (const b of bucketsInRange(from, to, group)) bucketTotals.set(b, { bucket: b, revenue: 0, count: 0 });

  for (const s of sales) {
    const total = Number(s.total) || 0;
    const bucket = bucketOf(limaDay(s.sold_at), group);
    revenue += total;

    const k = (byKind[s.kind] ??= { count: 0, revenue: 0 });
    k.count++;
    k.revenue += total;

    const bt = bucketTotals.get(bucket) ?? { bucket, revenue: 0, count: 0 };
    bt.revenue += total;
    bt.count++;
    bucketTotals.set(bucket, bt);

    const st = byStore.get(s.store_id) ?? { storeId: s.store_id, storeName: storeName(s.store_id), total: 0, count: 0, methods: {} };
    st.total += total;
    st.count++;
    byStore.set(s.store_id, st);

    const tk = `${bucket}|${s.store_id}`;
    const tr = table.get(tk) ?? { bucket, storeId: s.store_id, count: 0, revenue: 0, byKind: {}, methods: {} };
    tr.count++;
    tr.revenue += total;
    tr.byKind[s.kind] = (tr.byKind[s.kind] ?? 0) + total;
    table.set(tk, tr);

    for (const p of s.sale_payments) {
      const amount = Number(p.amount) || 0;
      st.methods[p.method] = (st.methods[p.method] ?? 0) + amount;
      tr.methods[p.method] = (tr.methods[p.method] ?? 0) + amount;
      methodTotals[p.method] = (methodTotals[p.method] ?? 0) + amount;
    }

    /* Adelanto e saldo de encomenda são linhas de serviço (ADL/REIN): contam
       no dinheiro, não no ranking de produto. */
    if (s.kind === "counter" || s.kind === "staff") {
      for (const l of s.sale_lines) {
        const key = l.product_id ?? `desc:${l.description.trim().toLowerCase()}`;
        const p = l.product_id ? productName(l.product_id) : { name: l.description, sku: null };
        const r = revenueProduct.get(key) ?? { key, label: p.name, sublabel: p.sku ?? undefined, value: 0, units: 0 };
        r.value += Number(l.total) || 0;
        r.units += Number(l.quantity) || 0;
        revenueProduct.set(key, r);
      }
    }
  }

  const revenueByProduct = [...revenueProduct.values()]
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label, "es"))
    .slice(0, 15)
    .map((r) => ({ ...r, context: `${Number(r.units.toFixed(3))} ${r.units === 1 ? "unidad" : "unidades"}` }));

  const storeOrder = new Map(storeRows.map((s, i) => [s.id, i]));

  /* Somar milhares de valores com centavos em ponto flutuante deixa resto
     (0.1 + 0.2). Tudo que sai daqui como dinheiro sai com duas casas: a tela,
     a planilha e o caixa têm de mostrar o mesmo centavo. */
  for (const k of Object.values(byKind)) k.revenue = round2(k.revenue);
  for (const b of bucketTotals.values()) b.revenue = round2(b.revenue);
  for (const st of byStore.values()) {
    st.total = round2(st.total);
    roundValues(st.methods);
  }
  roundValues(methodTotals);
  for (const t of table.values()) {
    t.revenue = round2(t.revenue);
    roundValues(t.byKind);
    roundValues(t.methods);
  }
  for (const rp of revenueByProduct) rp.value = round2(rp.value);

  return {
    filters,
    stores: storeRows.filter((s) => s.active).map((s) => ({ id: s.id, name: shortStoreName(s.name) })),
    storeName,
    productName,
    flavorName,
    stockSource,
    cakeRows,
    cakes,
    cohort,
    producedByProduct: sortRanked(produced, 15),
    soldByProduct: sortRanked(soldProduct, 15),
    soldByFlavor,
    leftovers,
    redecorated,
    sales: {
      count: sales.length,
      revenue: round2(revenue),
      byKind,
      buckets: [...bucketTotals.values()].sort((a, b) => a.bucket.localeCompare(b.bucket)),
      byStore: [...byStore.values()].sort((a, b) => (storeOrder.get(a.storeId) ?? 99) - (storeOrder.get(b.storeId) ?? 99)),
      methodTotals,
      revenueByProduct,
      table: [...table.values()].sort((a, b) => a.bucket.localeCompare(b.bucket) || (storeOrder.get(a.storeId) ?? 99) - (storeOrder.get(b.storeId) ?? 99)),
    },
  };
}
