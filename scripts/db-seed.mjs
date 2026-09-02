/**
 * Importa data/catalog.json para o Supabase.
 *
 * Idempotente: roda quantas vezes quiser. Casa os produtos por `slug`, e
 * substitui tamanhos, sabores, imagens e categorias de cada um.
 *
 * Os produtos entram como `active` porque são exatamente os que estão no ar
 * hoje. Se forem 52 e não 59, a Joseka desativa os 7 pelo painel — é mais
 * seguro do que eu adivinhar quais sumiram.
 *
 * Uso:
 *   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run db:seed
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createClient } from "@supabase/supabase-js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const catalog = JSON.parse(readFileSync(join(root, "data/catalog.json"), "utf8"));

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error(
    "Faltam NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.\n" +
      "Pegue as duas em Supabase → Project Settings → API.",
  );
  process.exit(1);
}

const db = createClient(url, key, { auth: { persistSession: false } });

/** Ocasiões do catálogo → slugs da tabela `categories`. */
const OCCASION_MAP = {
  cumpleanos: "cumpleanos",
  infantil: "infantil",
  romance: "romance",
  "para-compartir": "para-compartir",
  personalizadas: "personalizadas",
  navidad: "fechas-especiales",
  "dia-del-padre": "fechas-especiales",
};

/** Categorias do WooCommerce → slugs de tipo. Fora daqui, ignoradas. */
const TYPE_MAP = {
  redondas: "redondas",
  rectangulares: "rectangulares",
  altezas: "altezas",
  "semi-frios": "semi-frios",
  fototortas: "fototortas",
  fototopper: "fototopper",
  corazones: "corazones",
  "tortas-3-sabores": "tres-sabores",
};

async function main() {
  const { data: categories, error: catError } = await db.from("categories").select("id, slug");
  if (catError) throw catError;

  const categoryId = new Map(categories.map((c) => [c.slug, c.id]));
  if (!categoryId.size) {
    throw new Error("Nenhuma categoria no banco. Rode a migração 0002 antes deste script.");
  }

  let created = 0;
  let updated = 0;

  for (const p of catalog) {
    const { data: existing } = await db
      .from("products")
      .select("id")
      .eq("slug", p.slug)
      .maybeSingle();

    const row = {
      slug: p.slug,
      name: p.name,
      short_description: p.description,
      kind: p.sizes.length ? "variable" : p.acceptsPhoto ? "custom" : "simple",
      status: "active",
      base_price: p.sizes.length ? null : p.price,
      /* O catálogo atual é "até N sabores". A regra "exatamente 3 entre 9"
         chega com o CSV da Joseka: é min = max = 3 e nove linhas de sabor. */
      min_flavors: p.flavors.length ? 1 : 0,
      max_flavors: p.maxFlavors,
      lead_time_hours: p.leadTimeHours,
      accepts_photo: p.acceptsPhoto,
      accepts_message: true,
      message_limit: 80,
      default_serves: p.defaultServes,
      max_servings: p.maxServings,
      featured: p.featured,
      seo_title: p.name,
      seo_description: p.description?.slice(0, 160) ?? null,
    };

    let productId;
    if (existing) {
      const { error } = await db.from("products").update(row).eq("id", existing.id);
      if (error) throw error;
      productId = existing.id;
      updated++;
    } else {
      const { data, error } = await db.from("products").insert(row).select("id").single();
      if (error) throw error;
      productId = data.id;
      created++;
    }

    /* Substituição total dos filhos: mais simples e previsível que reconciliar,
       e o volume é pequeno. */
    await db.from("product_sizes").delete().eq("product_id", productId);
    if (p.sizes.length) {
      const { error } = await db.from("product_sizes").insert(
        p.sizes.map((s, i) => ({
          product_id: productId,
          slug: s.slug,
          label: s.label,
          serves: s.serves,
          price: s.price,
          sort_order: i,
        })),
      );
      if (error) throw error;
    }

    await db.from("product_flavors").delete().eq("product_id", productId);
    if (p.flavors.length) {
      const { error } = await db.from("product_flavors").insert(
        p.flavors.map((f, i) => ({
          product_id: productId,
          slug: f.slug,
          label: f.label,
          sort_order: i,
        })),
      );
      if (error) throw error;
    }

    await db.from("product_images").delete().eq("product_id", productId);
    const { error: imgError } = await db.from("product_images").insert(
      p.images.map((img, i) => ({
        product_id: productId,
        url: img.src,
        alt: img.alt,
        kind: "gallery",
        width: img.w,
        height: img.h,
        sort_order: i,
      })),
    );
    if (imgError) throw imgError;

    const slugs = [
      ...p.occasions.map((o) => OCCASION_MAP[o]),
      ...p.categories.map((c) => TYPE_MAP[c.slug]),
    ].filter(Boolean);

    await db.from("product_categories").delete().eq("product_id", productId);
    const links = [...new Set(slugs)]
      .map((slug) => categoryId.get(slug))
      .filter(Boolean)
      .map((category_id) => ({ product_id: productId, category_id }));

    if (links.length) {
      const { error } = await db.from("product_categories").insert(links);
      if (error) throw error;
    }
  }

  console.log(`✓ ${created} criados, ${updated} atualizados (${catalog.length} no total)`);
  console.log("  Produtos entraram como 'active'. Desative pelo painel os que saíram de linha.");
}

main().catch((error) => {
  console.error("✗ falhou:", error.message ?? error);
  process.exit(1);
});
