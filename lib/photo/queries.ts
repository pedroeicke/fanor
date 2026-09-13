import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CAKE_STATUS } from "@/lib/gestion/labels";
import { shortStoreName } from "@/lib/gestion/server";
import { CAKE_PHOTO_STATUSES, type CakeOption, type ProductOption } from "./types";

/**
 * Leituras da tela de fotos, com o cliente da sessão (RLS vale).
 *
 * Ficam aqui porque a página e as ações fazem as mesmas perguntas: a página
 * pré-seleciona o destino que veio na URL, a ação confere de novo antes de
 * gravar.
 */

/** A IA só entra com a chave no ambiente; a tela avisa quando falta. */
export function isPhotoAiEnabled() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

type ProductRow = {
  id: string;
  name: string;
  sku: string | null;
  slug: string;
  status: string;
  product_images: { url: string; kind: string; sort_order: number }[] | null;
};

const PRODUCT_SELECT = "id, name, sku, slug, status, product_images(url, kind, sort_order)";

function toProductOption(row: ProductRow): ProductOption {
  const cover = (row.product_images ?? [])
    .filter((i) => i.kind === "gallery")
    .sort((a, b) => a.sort_order - b.sort_order)[0];
  return { id: row.id, name: row.name, sku: row.sku, slug: row.slug, status: row.status, cover: cover?.url ?? null };
}

export async function getProductOption(db: SupabaseClient, id: string): Promise<ProductOption | null> {
  const { data } = await db.from("products").select(PRODUCT_SELECT).eq("id", id).maybeSingle();
  return data ? toProductOption(data as ProductRow) : null;
}

/** Sem acento e em minúsculas: a vendedora digita "fantasia" e o produto é "Fantasía". */
function fold(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const STATUS_RANK: Record<string, number> = { active: 0, unavailable: 1, draft: 2 };

type ProductName = { id: string; name: string; sku: string | null; status: string };

/* O PostgREST corta cada resposta em 1000 linhas, sem erro. O espelho do
   Sisgeco cria produto novo sozinho; sem paginar, o que vier depois da
   milésima linha em ordem alfabética sumiria da busca sem ninguém notar. */
const PAGE = 1000;

async function listProductNames(db: SupabaseClient) {
  const all: ProductName[] = [];
  for (let from = 0; from < 20 * PAGE; from += PAGE) {
    const { data, error } = await db
      .from("products")
      .select("id, name, sku, status")
      .order("name")
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) {
      console.error("[fotos] busca de produtos", error);
      break;
    }
    all.push(...((data ?? []) as ProductName[]));
    if (!data || data.length < PAGE) break;
  }
  return all;
}

/**
 * Busca por nome ou SKU entre publicados, agotados e rascunhos.
 *
 * Filtra em memória em vez de `ilike`: o Postgres não ignora acento sem a
 * extensão unaccent, e o catálogo inteiro são poucas centenas de linhas de
 * três colunas. Publicado vem antes de rascunho; começo do nome antes de
 * meio do nome.
 */
export async function searchProductOptions(db: SupabaseClient, query: string): Promise<ProductOption[]> {
  const needle = fold(query);
  if (needle.length < 2) return [];

  const ranked = (await listProductNames(db))
    .map((p) => {
      const name = fold(p.name);
      const sku = p.sku ? fold(p.sku) : "";
      let score = -1;
      if (sku && sku === needle) score = 0;
      else if (name.startsWith(needle)) score = 1;
      else if (name.split(" ").some((word) => word.startsWith(needle))) score = 2;
      else if (name.includes(needle)) score = 3;
      else if (sku.includes(needle)) score = 4;
      return { p, score };
    })
    .filter((r) => r.score >= 0)
    .sort((a, b) => a.score - b.score || (STATUS_RANK[a.p.status] ?? 3) - (STATUS_RANK[b.p.status] ?? 3))
    .slice(0, 20);

  if (!ranked.length) return [];
  const { data: rows } = await db.from("products").select(PRODUCT_SELECT).in("id", ranked.map((r) => r.p.id));
  const byId = new Map(((rows ?? []) as ProductRow[]).map((row) => [row.id, toProductOption(row)]));
  return ranked.map((r) => byId.get(r.p.id)).filter((p): p is ProductOption => Boolean(p));
}

type CakeRow = {
  id: string;
  serial: string;
  status: string;
  source: string;
  expires_on: string;
  photo_url: string | null;
  store_id: string;
  products: { name: string; slug: string } | null;
  stores: { name: string } | null;
};

export async function getCakeRow(db: SupabaseClient, serial: string) {
  const { data } = await db
    .from("cake_units")
    .select("id, serial, status, source, expires_on, photo_url, store_id, product_id, products(name, slug), stores(name)")
    .eq("serial", serial)
    .maybeSingle();
  return (data as unknown as (CakeRow & { product_id: string }) | null) ?? null;
}

/** Motivo para recusar foto nesta torta, ou null. Mesma regra na tela e na ação. */
export function cakePhotoBlock(cake: { source: string; status: string; serial: string }) {
  if (cake.source !== "native") {
    return "Esta torta viene del Sisgeco. La foto solo se guarda en tortas despachadas desde el taller.";
  }
  if (!(CAKE_PHOTO_STATUSES as readonly string[]).includes(cake.status)) {
    const label = CAKE_STATUS[cake.status]?.label.toLowerCase() ?? cake.status;
    return `La torta ${cake.serial} está ${label} y ya no aparece en la vitrina.`;
  }
  return null;
}

export async function getCakeOption(db: SupabaseClient, serial: string): Promise<CakeOption | null> {
  const cake = await getCakeRow(db, serial);
  if (!cake) return null;
  return {
    id: cake.id,
    serial: cake.serial,
    status: cake.status,
    productName: cake.products?.name ?? "Torta",
    storeName: shortStoreName(cake.stores?.name),
    expiresOn: cake.expires_on,
    /* Meio-dia UTC: a data pura não pode escorregar para o dia anterior. */
    expiresLabel: new Date(`${cake.expires_on}T12:00:00Z`).toLocaleDateString("es-PE", {
      day: "2-digit",
      month: "short",
      timeZone: "UTC",
    }),
    photoUrl: cake.photo_url,
    blockedReason: cakePhotoBlock(cake),
  };
}
