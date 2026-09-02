import "server-only";
import { cache } from "react";
import { getSupabaseAdmin } from "./supabase-admin";
import {
  BEST_SELLER_SLUGS,
  deriveTags,
  fallbackProducts,
  type Product,
  type ProductImage,
} from "./catalog";

/**
 * Leitura do catálogo.
 *
 * Vem do Supabase quando há credenciais; cai para `data/catalog.json` quando
 * não há. O fallback não é elegância: é o que permite rodar o projeto recém
 * clonado, e o que evita que uma indisponibilidade do banco derrube a loja
 * inteira em vez de só o painel.
 *
 * `cache()` do React deduplica as chamadas dentro do mesmo render — a home
 * pede o catálogo em três lugares e o banco é consultado uma vez só.
 */

type Row = {
  id: string;
  slug: string;
  name: string;
  short_description: string | null;
  base_price: string | null;
  default_serves: string | null;
  max_servings: number | null;
  min_flavors: number;
  max_flavors: number;
  accepts_photo: boolean;
  lead_time_hours: number;
  featured: boolean;
  product_sizes: {
    slug: string;
    label: string;
    serves: string | null;
    price: string;
    sort_order: number;
  }[];
  product_flavors: { slug: string; label: string; sort_order: number }[];
  product_images: {
    url: string;
    alt: string | null;
    kind: string;
    width: number | null;
    height: number | null;
    sort_order: number;
  }[];
  product_categories: { categories: { slug: string; name: string; kind: string } | null }[];
};

const SELECT = `
  id, slug, name, short_description, base_price, default_serves, max_servings,
  min_flavors, max_flavors, accepts_photo, lead_time_hours, featured,
  product_sizes ( slug, label, serves, price, sort_order ),
  product_flavors ( slug, label, sort_order ),
  product_images ( url, alt, kind, width, height, sort_order ),
  product_categories ( categories ( slug, name, kind ) )
`;

function toImage(i: Row["product_images"][number]): ProductImage {
  return { src: i.url, alt: i.alt ?? "", w: i.width ?? 1080, h: i.height ?? 1080 };
}

function mapRow(row: Row): Product {
  const sizes = [...row.product_sizes]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((s, i) => ({
      slug: s.slug,
      label: s.label,
      serves: s.serves ?? "",
      order: i,
      price: Number(s.price),
    }));

  const images = row.product_images
    .filter((i) => i.kind === "gallery")
    .sort((a, b) => a.sort_order - b.sort_order)
    .map(toImage);

  const spinFrames = row.product_images
    .filter((i) => i.kind === "spin360")
    .sort((a, b) => a.sort_order - b.sort_order)
    .map(toImage);

  const linked = row.product_categories.map((pc) => pc.categories).filter(Boolean) as {
    slug: string;
    name: string;
    kind: string;
  }[];

  const prices = sizes.map((s) => s.price);
  const base = Number(row.base_price ?? 0);
  const description = row.short_description ?? "";

  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description,
    price: prices.length ? Math.min(...prices) : base,
    priceRange:
      prices.length && Math.min(...prices) !== Math.max(...prices)
        ? { min: Math.min(...prices), max: Math.max(...prices) }
        : null,
    images: images.length ? images : [{ src: "", alt: row.name, w: 1080, h: 1080 }],
    spinFrames,
    categories: linked.filter((c) => c.kind === "tipo").map((c) => ({ slug: c.slug, name: c.name })),
    occasions: linked.filter((c) => c.kind === "ocasion").map((c) => c.slug),
    tags: deriveTags(row.name, description),
    sizes,
    defaultServes: row.default_serves ?? "",
    maxServings: row.max_servings ?? 12,
    flavors: [...row.product_flavors]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((f) => ({ slug: f.slug, label: f.label })),
    minFlavors: row.min_flavors,
    maxFlavors: row.max_flavors,
    acceptsPhoto: row.accepts_photo,
    leadTimeHours: row.lead_time_hours,
    featured: row.featured,
  };
}

/** Todos os produtos publicados, do mais barato ao mais caro. */
export const getProducts = cache(async (): Promise<Product[]> => {
  const db = getSupabaseAdmin();
  if (!db) return fallbackProducts;

  const { data, error } = await db
    .from("products")
    .select(SELECT)
    .eq("status", "active")
    .order("sort_order", { ascending: true });

  if (error) {
    /* Banco fora do ar não pode significar loja fora do ar. */
    console.error("[catalog] falha ao ler do Supabase, usando fallback:", error.message);
    return fallbackProducts;
  }

  return (data as unknown as Row[]).map(mapRow).sort((a, b) => a.price - b.price);
});

export async function getProduct(slug: string) {
  const all = await getProducts();
  return all.find((p) => p.slug === slug) ?? null;
}

export async function getProductsByOccasion(slug: string) {
  const all = await getProducts();
  return all.filter((p) => p.occasions.includes(slug));
}

export async function getBestSellers() {
  const all = await getProducts();
  return BEST_SELLER_SLUGS.map((slug) => all.find((p) => p.slug === slug)).filter(
    (p): p is Product => Boolean(p),
  );
}

/** Vários produtos por slug numa chamada — usado nas capas da home. */
export async function getProductsBySlug(slugs: string[]) {
  const all = await getProducts();
  const bySlug = new Map(all.map((p) => [p.slug, p]));
  return Object.fromEntries(
    slugs.map((slug) => [slug, bySlug.get(slug) ?? null]),
  ) as Record<string, Product | null>;
}
