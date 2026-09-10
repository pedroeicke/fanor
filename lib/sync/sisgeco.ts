import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Aplica um lote do leitor do Sisgeco às tabelas de gestão.
 *
 * Idempotente por construção: cada movimento tem `source_number` (o Nº
 * Interno do Sisgeco) com índice único, cada torta tem série única, cada
 * produto tem `sku` único. Reenviar um lote inteiro não cria nada em dobro —
 * e o leitor VAI reenviar, porque internet cai no meio.
 *
 * Em conjunto, não linha a linha. A primeira versão fazia três chamadas ao
 * banco por linha: 55 tortas levaram mais de 25 s, e o leitor desistia antes
 * da resposta. Aqui um lote inteiro custa oito chamadas, tenha 3 movimentos
 * ou 300.
 *
 * O que entra e para onde:
 *   artigos           → products (só-balcão nasce como `draft`, invisível no site)
 *   I004 ingresso     → stock_movements(production) + cake_units(in_stock) ou stock_levels(+)
 *   S003 saída venda  → stock_movements(sale)       + cake_units(sold)     ou stock_levels(−)
 *   outros tipos      → stock_movements(adjustment) + o mesmo ajuste de estoque
 */

export type SisgecoLine = {
  linea: number; codigo: string; des: string; serie: string | null; lote: string | null;
  vence: string | null; cantidad: number; valor: number; total: number; comprobante: string | null;
};
export type SisgecoMovement = {
  numero: number; almacen: string; tipo: string; fecha: string; numguia?: string | null;
  numdocref?: string | null; vendedor?: string | null; observacion?: string | null; lines: SisgecoLine[];
};
export type SisgecoArticle = {
  codigo: string; des: string; familia: string | null; unidad: string | null; usaSerie: boolean;
  usaLote: boolean; precio: number; codigoSunat: string | null; stockMin: number | null;
};
export type SisgecoBatch = {
  source: "sisgeco"; agent?: string; cursorFrom?: number; cursorTo?: number;
  movements?: SisgecoMovement[]; articles?: SisgecoArticle[];
};

type Db = SupabaseClient;
type Family = { id: string; code: string; tracks_serial: boolean; shelf_life_days: number | null };

/* Tipos de movimento do Sisgeco (kardex/guias). O que não se conhece vira
   ajuste — nunca é descartado, para o estoque não divergir em silêncio. */
const KIND: Record<string, "production" | "sale" | "adjustment"> = { I004: "production", S003: "sale" };

/* Almacén 1 = PERU FANOR (séries G), 2 = EE.UU. FANOR (séries D), como nas
   guias de ingresso. Casa pelo prefixo de série da loja. */
const ALMACEN_PREFIX: Record<string, string> = { "1": "G", "2": "D" };

/**
 * "T20 FOTO / DIBUJO / CT 2754" → "T20 FOTO / DIBUJO".
 *
 * Na guia de ingresso a torta de encomenda leva o número do contrato colado
 * na descrição. Isso é da torta, não do produto: sem tirar, cada encomenda
 * criaria um produto novo com nome diferente.
 */
const productName = (des: string) => des.replace(/\s*\/\s*CT\s*\d+\s*$/i, "").trim();
const slugFor = (code: string) => `sisgeco-${code.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
const familyCode = (code: string) => code.match(/^[A-Z]+/)?.[0] ?? "";

/** "03/09/2026" → "2026-09-03". O Sisgeco grava o lote como texto dd/mm/aaaa. */
function isoFromLote(lote: string | null) {
  const m = lote?.match(/^(\d\d)\/(\d\d)\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}
const isoDate = (v: string | null | undefined) => (v ? new Date(v).toISOString().slice(0, 10) : null);

function fail(where: string, error: { message: string } | null) {
  if (error) throw new Error(`${where}: ${error.message}`);
}

export async function readCursor(db: Db, source: string) {
  const { data } = await db.from("sync_state").select("value").eq("key", `${source}:guias`).maybeSingle();
  return Number((data?.value as { cursor?: number } | null)?.cursor ?? 0);
}

export async function applySisgecoBatch(db: Db, batch: SisgecoBatch, agent: string) {
  const started = new Date().toISOString();
  const counts = { movements: 0, cake_units: 0, products: 0 };
  const cursorBefore = await readCursor(db, "sisgeco");
  let cursor = cursorBefore;

  try {
    const [stores, families] = await Promise.all([loadStores(db), loadFamilies(db)]);

    if (batch.articles?.length) counts.products = await upsertArticles(db, batch.articles, families);

    /* Só o que ainda não foi aplicado, em ordem. */
    const pending = [...(batch.movements ?? [])].filter((m) => m.numero > cursor).sort((a, b) => a.numero - b.numero);
    if (pending.length) {
      const applied = await applyMovements(db, pending, stores, families);
      counts.movements = applied.movements;
      counts.cake_units = applied.cakeUnits;
      cursor = pending[pending.length - 1].numero;
      fail("sync_state", (await db.from("sync_state").upsert({ key: "sisgeco:guias", value: { cursor }, updated_at: new Date().toISOString() })).error);
    }

    await db.from("sync_runs").insert({
      source: "sisgeco", cursor_from: cursorBefore, cursor_to: cursor, ...counts, agent, started_at: started, finished_at: new Date().toISOString(),
    });
    return { cursor, ...counts };
  } catch (error) {
    await db.from("sync_runs").insert({
      source: "sisgeco", cursor_from: cursorBefore, cursor_to: cursor, ...counts, agent,
      error: error instanceof Error ? error.message : String(error), started_at: started, finished_at: new Date().toISOString(),
    });
    throw error;
  }
}

/* -------------------------------------------------------------------------- */

async function loadStores(db: Db) {
  const { data, error } = await db.from("stores").select("id, serial_prefix");
  fail("stores", error);
  const byPrefix = new Map<string, string>();
  for (const s of data ?? []) if (s.serial_prefix) byPrefix.set(s.serial_prefix as string, s.id as string);
  return byPrefix;
}

async function loadFamilies(db: Db) {
  const { data, error } = await db.from("product_families").select("id, code, tracks_serial, shelf_life_days");
  fail("product_families", error);
  return new Map((data ?? []).map((f) => [f.code as string, f as Family]));
}

function storeFor(almacen: string, serie: string | null, stores: Map<string, string>) {
  const prefix = serie?.[0] ?? ALMACEN_PREFIX[almacen];
  const id = prefix ? stores.get(prefix) : undefined;
  if (!id) throw new Error(`Almacén "${almacen}" (série ${serie ?? "—"}) sem loja correspondente em stores.serial_prefix`);
  return id;
}

/** Mapa sku → id para os códigos pedidos, criando como `draft` os que faltam. */
async function ensureProducts(db: Db, wanted: Map<string, string>, families: Map<string, Family>) {
  const codes = [...wanted.keys()];
  if (!codes.length) return new Map<string, string>();

  const { data: existing, error } = await db.from("products").select("id, sku").in("sku", codes);
  fail("products", error);
  const ids = new Map((existing ?? []).map((p) => [p.sku as string, p.id as string]));

  const missing = codes.filter((c) => !ids.has(c));
  if (missing.length) {
    /* Movimento de artigo que ainda não veio no catálogo: cria o mínimo, como
       draft, em vez de perder o movimento. */
    const rows = missing.map((code) => {
      const family = families.get(familyCode(code));
      return {
        slug: slugFor(code), sku: code, name: productName(wanted.get(code) ?? "") || code, status: "draft", kind: "simple",
        sold_online: false, sold_at_counter: true, family_id: family?.id ?? null, tracks_serial: family?.tracks_serial ?? false,
        shelf_life_days: family?.shelf_life_days ?? null,
      };
    });
    const { data: created, error: e } = await db.from("products").insert(rows).select("id, sku");
    fail("products(insert)", e);
    for (const p of created ?? []) ids.set(p.sku as string, p.id as string);
  }
  return ids;
}

async function upsertArticles(db: Db, articles: SisgecoArticle[], families: Map<string, Family>) {
  const valid = articles.filter((a) => a.codigo);
  if (!valid.length) return 0;

  const { data: existing, error } = await db.from("products").select("id, sku").in("sku", valid.map((a) => a.codigo));
  fail("products", error);
  const ids = new Map((existing ?? []).map((p) => [p.sku as string, p.id as string]));

  /* Produto que o site já cura: o Sisgeco manda só o operacional. Nome,
     descrição e preço do site continuam do site. Um UPDATE por produto
     existente — são poucos e cada um tem valores próprios. */
  await Promise.all(
    valid.filter((a) => ids.has(a.codigo)).map((a) => {
      const family = families.get(a.familia ?? familyCode(a.codigo));
      return db.from("products").update({
        family_id: family?.id ?? null, tracks_serial: a.usaSerie, sunat_code: a.codigoSunat, stock_min: a.stockMin,
      }).eq("id", ids.get(a.codigo)!).then(({ error: e }) => fail(`products(${a.codigo})`, e));
    }),
  );

  /* Novos, só balcão: nascem `draft` — o site só mostra `active`. Um INSERT. */
  const rows = valid.filter((a) => !ids.has(a.codigo)).map((a) => {
    const family = families.get(a.familia ?? familyCode(a.codigo));
    return {
      slug: slugFor(a.codigo), sku: a.codigo, name: productName(a.des) || a.codigo, status: "draft", kind: "simple",
      base_price: a.precio > 0 ? a.precio : null, sold_online: false, sold_at_counter: true,
      family_id: family?.id ?? null, tracks_serial: a.usaSerie, sunat_code: a.codigoSunat, stock_min: a.stockMin,
      shelf_life_days: family?.shelf_life_days ?? null,
      unit: a.unidad === "NIU" || a.unidad === "UND" || !a.unidad ? "UNIDAD_BIENES" : a.unidad,
    };
  });
  if (rows.length) fail("products(insert)", (await db.from("products").insert(rows)).error);
  return valid.length;
}

async function applyMovements(db: Db, movements: SisgecoMovement[], stores: Map<string, string>, families: Map<string, Family>) {
  /* 1. Descarta o que já está gravado (tentativa anterior que caiu antes do cursor). */
  const numbers = movements.map((m) => m.numero);
  const { data: seen, error: e0 } = await db.from("stock_movements").select("source_number").in("source_number", numbers);
  fail("stock_movements", e0);
  const done = new Set((seen ?? []).map((s) => Number(s.source_number)));
  const fresh = movements.filter((m) => !done.has(m.numero));
  if (!fresh.length) return { movements: 0, cakeUnits: 0 };

  /* 2. Produtos de todas as linhas, de uma vez. */
  const wanted = new Map<string, string>();
  for (const m of fresh) for (const l of m.lines) if (l.codigo && !wanted.has(l.codigo)) wanted.set(l.codigo, l.des);
  const productIds = await ensureProducts(db, wanted, families);

  /* 3. Cabeçalhos. */
  const heads = fresh.map((m) => {
    const kind = KIND[m.tipo] ?? "adjustment";
    const firstSerie = m.lines.find((l) => l.serie)?.serie ?? null;
    return {
      source_number: m.numero, kind, store_id: storeFor(m.almacen, firstSerie, stores),
      reference: [m.tipo, m.numguia, m.numdocref].filter(Boolean).join(" · ") || null,
      notes: m.observacion || null, created_at: m.fecha ? new Date(m.fecha).toISOString() : new Date().toISOString(),
    };
  });
  const { data: inserted, error: e1 } = await db.from("stock_movements").insert(heads).select("id, source_number");
  fail("stock_movements(insert)", e1);
  const movementId = new Map((inserted ?? []).map((r) => [Number(r.source_number), r.id as string]));

  /* 4. Tortas (com série) e saldos (sem série), acumulados por lote. */
  type CakeRow = { serial: string; product_id: string; store_id: string; produced_on: string; expires_on: string; status: string };
  const cakes = new Map<string, CakeRow>();
  const levelDelta = new Map<string, { store_id: string; product_id: string; delta: number }>();
  const lineRows: { movement_id: string; product_id: string; quantity: number; cake_unit_serial: string | null; lot_date: string | null; unit_cost: number | null }[] = [];

  for (const m of fresh) {
    const kind = KIND[m.tipo] ?? "adjustment";
    const sign = kind === "production" ? 1 : kind === "sale" ? -1 : 0;
    const headStore = storeFor(m.almacen, m.lines.find((l) => l.serie)?.serie ?? null, stores);

    for (const l of m.lines) {
      const productId = productIds.get(l.codigo);
      if (!productId) throw new Error(`Produto ${l.codigo} não resolvido`);

      if (l.serie) {
        const produced = isoFromLote(l.lote) ?? isoDate(m.fecha) ?? new Date().toISOString().slice(0, 10);
        /* A mesma série pode entrar e sair no mesmo lote: o último movimento
           manda no estado. */
        cakes.set(l.serie, {
          serial: l.serie, product_id: productId, store_id: storeFor(m.almacen, l.serie, stores),
          produced_on: produced, expires_on: isoDate(l.vence) ?? produced,
          status: kind === "sale" ? "sold" : kind === "production" ? "in_stock" : "discarded",
        });
      } else if (sign !== 0) {
        const key = `${headStore}|${productId}`;
        const acc = levelDelta.get(key) ?? { store_id: headStore, product_id: productId, delta: 0 };
        acc.delta += sign * l.cantidad;
        levelDelta.set(key, acc);
      }

      lineRows.push({
        movement_id: movementId.get(m.numero)!, product_id: productId, quantity: l.cantidad,
        cake_unit_serial: l.serie, lot_date: isoFromLote(l.lote), unit_cost: l.valor || null,
      });
    }
  }

  let cakeUnitId = new Map<string, string>();
  if (cakes.size) {
    const { data: units, error: e2 } = await db.from("cake_units").upsert([...cakes.values()], { onConflict: "serial" }).select("id, serial");
    fail("cake_units", e2);
    cakeUnitId = new Map((units ?? []).map((u) => [u.serial as string, u.id as string]));
  }

  if (levelDelta.size) {
    const keys = [...levelDelta.values()];
    const { data: current, error: e3 } = await db.from("stock_levels").select("store_id, product_id, quantity")
      .in("product_id", [...new Set(keys.map((k) => k.product_id))]);
    fail("stock_levels", e3);
    const now = new Map((current ?? []).map((c) => [`${c.store_id}|${c.product_id}`, Number(c.quantity)]));
    const rows = keys.map((k) => ({ store_id: k.store_id, product_id: k.product_id, quantity: (now.get(`${k.store_id}|${k.product_id}`) ?? 0) + k.delta }));
    fail("stock_levels(upsert)", (await db.from("stock_levels").upsert(rows, { onConflict: "store_id,product_id" })).error);
  }

  /* 5. Linhas, já com o id da torta. */
  const lines = lineRows.map(({ cake_unit_serial, ...rest }) => ({ ...rest, cake_unit_id: cake_unit_serial ? cakeUnitId.get(cake_unit_serial) ?? null : null }));
  fail("stock_movement_lines", (await db.from("stock_movement_lines").insert(lines)).error);

  return { movements: fresh.length, cakeUnits: cakes.size };
}
