import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { limaToday } from "@/lib/gestion/dates";
import { friendlyDbError } from "@/lib/gestion/server";
import {
  BIRTHDAY_WINDOW_DAYS,
  INACTIVE_DAYS,
  NEW_DAYS,
  RECURRENT_MIN_PURCHASES,
  VIP_MIN_SPENT,
  daysUntilBirthday,
  isSegment,
  normalizeTag,
  type Segment,
} from "@/components/admin/clientes/rules";

/**
 * Busca e segmentos da lista de clientes.
 *
 * A lista e o CSV passam pela mesma consulta: o que o Joseka exporta tem de
 * ser exatamente o que ele está vendo na tela, com a mesma busca e o mesmo
 * segmento.
 */

export const PAGE_SIZE = 50;

/** Teto do CSV e da varredura de aniversários. Bem acima da base atual; evita que um filtro vazio trave a função. */
const MAX_ROWS = 50_000;
const BATCH = 1000;
const DAY_MS = 86_400_000;

export const LIST_COLUMNS =
  "id, name, phone, phone_norm, email, doc_type, doc_number, birthday, tags, source, first_seen_at, last_purchase_at, orders_count, total_spent, marketing_opt_in";

export type CustomerRow = {
  id: string;
  name: string;
  phone: string | null;
  phone_norm: string | null;
  email: string | null;
  doc_type: string;
  doc_number: string | null;
  birthday: string | null;
  tags: string[] | null;
  source: string | null;
  first_seen_at: string;
  last_purchase_at: string | null;
  orders_count: number;
  total_spent: number | string;
  marketing_opt_in: boolean;
};

export type CustomerFilters = { q: string; segment: Segment; tag: string | null; page: number };

type Params = Record<string, string | string[] | undefined>;

export function parseFilters(params: Params): CustomerFilters {
  const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";
  const segment = one(params.s);
  const tag = normalizeTag(one(params.tag).slice(0, 60));
  const page = Number(one(params.p));
  return {
    q: one(params.q).replace(/\s+/g, " ").trim().slice(0, 80),
    segment: isSegment(segment) ? segment : "todos",
    tag: tag || null,
    page: Number.isInteger(page) && page >= 1 && page <= 10_000 ? page : 1,
  };
}

/** Query string só com o que difere do padrão, para links curtos e compartilháveis. */
export function filtersSearch(filters: CustomerFilters, overrides: Partial<CustomerFilters> = {}) {
  const f = { ...filters, ...overrides };
  const params = new URLSearchParams();
  if (f.q) params.set("q", f.q);
  if (f.segment !== "todos") params.set("s", f.segment);
  if (f.tag) params.set("tag", f.tag);
  if (f.page > 1) params.set("p", String(f.page));
  const search = params.toString();
  return search ? `?${search}` : "";
}

/**
 * Filtro `or` do PostgREST para a busca.
 *
 * Tira do termo os caracteres que têm significado na sintaxe do filtro
 * (vírgula, parênteses, aspas, curinga): digitar "Pérez, Ana" não pode
 * quebrar a consulta nem virar outro filtro. Nome casa palavra por palavra,
 * em qualquer ordem — "Torres Ana" acha "Ana Torres". Celular casa pelos
 * dígitos, sem o 51, do mesmo jeito que o banco guarda.
 */
function searchFilter(q: string) {
  if (!q) return null;
  const term = q.normalize("NFC").replace(/[,()"'\\*%:;{}[\]]/g, " ").replace(/\s+/g, " ").trim();
  /* Busca só com símbolos ("(((") não pode virar "todos os clientes": não casa ninguém. */
  if (!term) return "id.is.null";

  const like = (column: string, value: string) => `${column}.ilike."*${value}*"`;
  const words = term.split(" ").slice(0, 5);
  const compact = term.replace(/\s/g, "");
  const parts = [
    words.length === 1 ? like("name", words[0]) : `and(${words.map((w) => like("name", w)).join(",")})`,
    like("email", compact),
    like("doc_number", compact),
  ];

  let digits = term.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("51")) digits = digits.slice(2);
  /* Os dígitos só viram busca por celular quando o termo é um número ("987 654",
     "DNI 12345678"). Em "ana1990@gmail.com" o 1990 traria todo celular com 1990. */
  const numeric = !/\p{L}/u.test(term) || (!term.includes("@") && digits.length >= 6);
  if (numeric && digits.length >= 3) {
    parts.push(like("phone_norm", digits));
    if (digits !== compact) parts.push(like("doc_number", digits));
  }
  return parts.join(",");
}

function baseQuery(db: SupabaseClient, columns: string, filters: CustomerFilters, options?: { count: "exact"; head?: boolean }) {
  /* `!inner` transforma a reclamação em filtro: só volta cliente que tem pelo menos uma. */
  const select = filters.segment === "reclamo" ? `${columns}, complaints!inner(code)` : columns;
  let query = db.from("customers").select(select, options);

  const search = searchFilter(filters.q);
  if (search) query = query.or(search);
  /* Etiqueta já normalizada (sem aspas nem vírgula): pode ir entre aspas no literal de array. */
  if (filters.tag) query = query.contains("tags", `{"${filters.tag}"}`);

  const now = Date.now();
  switch (filters.segment) {
    case "nuevos":
      query = query.gte("first_seen_at", new Date(now - NEW_DAYS * DAY_MS).toISOString());
      break;
    case "recurrentes":
      query = query.gte("orders_count", RECURRENT_MIN_PURCHASES);
      break;
    case "vip":
      query = query.gte("total_spent", VIP_MIN_SPENT);
      break;
    case "inactivos":
      /* `lt` já deixa de fora quem nunca comprou (null): inativo é quem comprou e parou. */
      query = query.lt("last_purchase_at", new Date(now - INACTIVE_DAYS * DAY_MS).toISOString());
      break;
    case "cumpleanos":
      query = query.not("birthday", "is", null);
      break;
  }
  return query;
}

type CustomerQuery = ReturnType<typeof baseQuery>;

/** Cada segmento abre na ordem que responde a pergunta dele. `id` no fim deixa a paginação estável. */
function withOrder(query: CustomerQuery, segment: Segment): CustomerQuery {
  switch (segment) {
    case "nuevos":
      query = query.order("first_seen_at", { ascending: false });
      break;
    case "recurrentes":
      query = query.order("orders_count", { ascending: false }).order("total_spent", { ascending: false });
      break;
    case "vip":
      query = query.order("total_spent", { ascending: false });
      break;
    default:
      /* Quem comprou mais recentemente primeiro; em "Inactivos", quem parou há menos tempo — o mais fácil de recuperar. */
      query = query.order("last_purchase_at", { ascending: false, nullsFirst: false }).order("first_seen_at", { ascending: false });
  }
  return query.order("id", { ascending: true });
}

type BirthdayMatch = { id: string; name: string; days: number };

/**
 * Aniversário cai nos próximos N dias?
 *
 * O PostgREST não compara mês e dia de uma data, então a pergunta é feita
 * aqui: busca só id e aniversário de quem tem a data (poucos bytes por
 * linha), calcula a distância no calendário de Lima e ordena do mais
 * próximo. As linhas completas vêm depois, só as da página.
 */
async function birthdayMatches(db: SupabaseClient, filters: CustomerFilters) {
  const today = limaToday();
  const matches: BirthdayMatch[] = [];
  for (let from = 0; from < MAX_ROWS; from += BATCH) {
    const { data, error } = await baseQuery(db, "id, name, birthday", filters).order("id").range(from, from + BATCH - 1);
    if (error) return { error: friendlyDbError(error) };
    const rows = (data ?? []) as unknown as { id: string; name: string; birthday: string }[];
    for (const row of rows) {
      const days = daysUntilBirthday(row.birthday, today);
      if (days <= BIRTHDAY_WINDOW_DAYS) matches.push({ id: row.id, name: row.name, days });
    }
    if (rows.length < BATCH) break;
  }
  matches.sort((a, b) => a.days - b.days || a.name.localeCompare(b.name, "es"));
  return { matches };
}

async function rowsByIds(db: SupabaseClient, ids: string[]) {
  const byId = new Map<string, CustomerRow>();
  /* Lotes de 100 ids: a lista vai na URL, e URL longa demais volta erro. */
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await db.from("customers").select(LIST_COLUMNS).in("id", ids.slice(i, i + 100));
    if (error) return { error: friendlyDbError(error) };
    for (const row of (data ?? []) as unknown as CustomerRow[]) byId.set(row.id, row);
  }
  return { rows: ids.map((id) => byId.get(id)).filter((r): r is CustomerRow => Boolean(r)) };
}

export type CustomerPage = {
  rows: CustomerRow[];
  total: number;
  pages: number;
  /** Dias até o aniversário, só no segmento de aniversários. */
  birthdays: Record<string, number>;
  outOfRange: boolean;
  error: string | null;
};

export async function listCustomerPage(db: SupabaseClient, filters: CustomerFilters): Promise<CustomerPage> {
  const empty = { rows: [], total: 0, pages: 1, birthdays: {}, outOfRange: false };
  const from = (filters.page - 1) * PAGE_SIZE;

  if (filters.segment === "cumpleanos") {
    const found = await birthdayMatches(db, filters);
    if ("error" in found) return { ...empty, error: found.error ?? null };
    const total = found.matches.length;
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const slice = found.matches.slice(from, from + PAGE_SIZE);
    const loaded = await rowsByIds(db, slice.map((m) => m.id));
    if ("error" in loaded) return { ...empty, error: loaded.error ?? null };
    return {
      rows: loaded.rows,
      total,
      pages,
      birthdays: Object.fromEntries(slice.map((m) => [m.id, m.days])),
      outOfRange: filters.page > pages,
      error: null,
    };
  }

  const { data, count, error } = await withOrder(baseQuery(db, LIST_COLUMNS, filters, { count: "exact" }), filters.segment)
    .range(from, from + PAGE_SIZE - 1);

  if (error) {
    /* Página além do fim (link velho, filtro que encolheu): o PostgREST responde 416. */
    if (error.code === "PGRST103") {
      const { count: total } = await baseQuery(db, "id", filters, { count: "exact", head: true });
      return { ...empty, total: total ?? 0, pages: Math.max(1, Math.ceil((total ?? 0) / PAGE_SIZE)), outOfRange: true, error: null };
    }
    return { ...empty, error: friendlyDbError(error) };
  }

  const total = count ?? 0;
  const rows = (data ?? []) as unknown as CustomerRow[];
  return {
    rows,
    total,
    pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    birthdays: {},
    outOfRange: rows.length === 0 && filters.page > 1,
    error: null,
  };
}

/** Todas as linhas do filtro, para o CSV. */
export async function listAllCustomers(
  db: SupabaseClient,
  filters: CustomerFilters,
): Promise<{ rows: CustomerRow[]; birthdays: Record<string, number>; truncated: boolean } | { error: string }> {
  if (filters.segment === "cumpleanos") {
    const found = await birthdayMatches(db, filters);
    if ("error" in found) return { error: found.error ?? "No se pudo leer los clientes." };
    const loaded = await rowsByIds(db, found.matches.map((m) => m.id));
    if ("error" in loaded) return { error: loaded.error ?? "No se pudo leer los clientes." };
    return {
      rows: loaded.rows,
      birthdays: Object.fromEntries(found.matches.map((m) => [m.id, m.days])),
      truncated: false,
    };
  }

  const rows: CustomerRow[] = [];
  for (let from = 0; from < MAX_ROWS; from += BATCH) {
    const { data, error } = await withOrder(baseQuery(db, LIST_COLUMNS, filters), filters.segment).range(from, from + BATCH - 1);
    if (error) return { error: friendlyDbError(error) };
    const batch = (data ?? []) as unknown as CustomerRow[];
    rows.push(...batch);
    if (batch.length < BATCH) return { rows, birthdays: {}, truncated: false };
  }
  return { rows, birthdays: {}, truncated: true };
}

export type CustomerStats = {
  total: number;
  newThisMonth: number;
  recurrent: number;
  /** Total gasto ÷ compras, só de quem já comprou. Null sem nenhuma compra. */
  averageTicket: number | null;
  buyers: number;
  /** Alguma contagem falhou: a tela avisa em vez de mostrar zero como se fosse verdade. */
  failed: boolean;
};

/** Lotes do ticket médio lidos ao mesmo tempo. Poucos: a lista abre a cada busca e não pode enfileirar o banco. */
const STATS_PARALLEL = 4;

/**
 * Soma total gasto e compras de quem já comprou.
 *
 * O banco não libera agregação pelo PostgREST, então a soma é feita aqui,
 * lendo só duas colunas numéricas. O primeiro lote traz a contagem; os
 * demais são pedidos em paralelo, senão cada busca na lista esperaria uma
 * fila de lotes. Qualquer lote com erro anula o número: média calculada
 * sobre metade da base seria um valor errado com cara de certo.
 */
async function ticketTotals(db: SupabaseClient): Promise<{ average: number | null; buyers: number; failed: boolean }> {
  const batch = (from: number, count?: "exact") =>
    db
      .from("customers")
      .select("total_spent, orders_count", count ? { count } : undefined)
      .gt("orders_count", 0)
      .order("id")
      .range(from, from + BATCH - 1);

  const first = await batch(0, "exact");
  if (first.error) return { average: null, buyers: 0, failed: true };
  const buyers = first.count ?? first.data?.length ?? 0;

  const rows = [...(first.data ?? [])];
  const starts: number[] = [];
  for (let from = BATCH; from < Math.min(buyers, MAX_ROWS * 4); from += BATCH) starts.push(from);
  for (let i = 0; i < starts.length; i += STATS_PARALLEL) {
    const results = await Promise.all(starts.slice(i, i + STATS_PARALLEL).map((from) => batch(from)));
    for (const result of results) {
      if (result.error) return { average: null, buyers, failed: true };
      rows.push(...(result.data ?? []));
    }
  }

  let spent = 0;
  let purchases = 0;
  for (const row of rows) {
    spent += Number(row.total_spent) || 0;
    purchases += Number(row.orders_count) || 0;
  }
  return { average: purchases ? spent / purchases : null, buyers, failed: false };
}

/** Números do topo da lista, sempre da base inteira (não do filtro). */
export async function customerStats(db: SupabaseClient): Promise<CustomerStats> {
  /* Peru não tem horário de verão: o mês de Lima começa sempre às 00:00 −05:00. */
  const monthStart = `${limaToday().slice(0, 7)}-01T00:00:00-05:00`;
  const head = { count: "exact" as const, head: true };

  const [total, fresh, recurrent, ticket] = await Promise.all([
    db.from("customers").select("id", head),
    db.from("customers").select("id", head).gte("first_seen_at", monthStart),
    db.from("customers").select("id", head).gte("orders_count", RECURRENT_MIN_PURCHASES),
    ticketTotals(db),
  ]);

  return {
    total: total.count ?? 0,
    newThisMonth: fresh.count ?? 0,
    recurrent: recurrent.count ?? 0,
    averageTicket: ticket.average,
    buyers: ticket.buyers,
    failed: Boolean(total.error || fresh.error || recurrent.error) || ticket.failed,
  };
}
