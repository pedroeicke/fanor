/**
 * Troca as fotos de galeria dos produtos pelas que estão em
 * public/assets/produtos/<slug>/.
 *
 * Uma pasta por produto, com o slug do banco como nome. A ordem da galeria é
 * a ordem alfabética dos arquivos — por isso os nomes começam com 01_, 02_…
 * A primeira vira a capa em toda a loja.
 *
 * Idempotente: substitui o conjunto inteiro de kind = 'gallery' de cada
 * produto que tiver pasta. Produtos sem pasta ficam como estão (CDN antigo).
 * Os quadros 360° (kind = 'spin360') não são tocados.
 *
 * Uso:
 *   npm run db:photos              # todos os produtos com pasta
 *   npm run db:photos -- red-velvet  # só um
 */
import { readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";

const ROOT = join(process.cwd(), "public", "assets", "produtos");
const URL_BASE = "/assets/produtos";
const IMAGE = /\.(jpe?g|png|webp|avif)$/i;

const only = process.argv[2];

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Faltam NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}
if (!existsSync(ROOT)) {
  console.error(`Pasta não encontrada: ${ROOT}`);
  process.exit(1);
}

const db = createClient(url, key, { auth: { persistSession: false } });

/** Extrai dimensões do nome quando vêm no padrão 1080x1080px; senão assume quadrado. */
function dimensions(file) {
  const m = /(\d{3,4})x(\d{3,4})/.exec(file);
  return m ? { width: Number(m[1]), height: Number(m[2]) } : { width: 1080, height: 1080 };
}

const folders = readdirSync(ROOT)
  .filter((name) => statSync(join(ROOT, name)).isDirectory())
  .filter((name) => !only || name === only)
  .sort();

if (!folders.length) {
  console.error(only ? `Sem pasta para "${only}".` : "Nenhuma pasta de produto.");
  process.exit(1);
}

let updated = 0;
let photos = 0;
const missing = [];

for (const slug of folders) {
  const files = readdirSync(join(ROOT, slug))
    .filter((f) => IMAGE.test(f) && statSync(join(ROOT, slug, f)).isFile())
    .sort((a, b) => a.localeCompare(b, "en", { numeric: true }));

  if (!files.length) continue;

  const { data: product } = await db
    .from("products")
    .select("id, name")
    .eq("slug", slug)
    .maybeSingle();

  if (!product) {
    missing.push(slug);
    continue;
  }

  /* Substituição total da galeria: reimportar não duplica. */
  const { error: delError } = await db
    .from("product_images")
    .delete()
    .eq("product_id", product.id)
    .eq("kind", "gallery");
  if (delError) {
    console.error(`  ✗ ${slug}: falha ao limpar galeria — ${delError.message}`);
    continue;
  }

  const rows = files.map((file, i) => ({
    product_id: product.id,
    url: `${URL_BASE}/${slug}/${file}`,
    /* Só a capa leva o nome; as demais são a mesma torta de outro ângulo. */
    alt: i === 0 ? product.name : null,
    kind: "gallery",
    ...dimensions(file),
    sort_order: i,
  }));

  const { error: insError } = await db.from("product_images").insert(rows);
  if (insError) {
    console.error(`  ✗ ${slug}: falha ao inserir — ${insError.message}`);
    continue;
  }

  updated++;
  photos += rows.length;
  console.log(`  ✓ ${slug.padEnd(28)} ${rows.length} foto(s)`);
}

console.log(`\n✓ ${updated} produto(s), ${photos} foto(s) apontando para ${URL_BASE}/`);
if (missing.length) {
  console.log(`  pastas sem produto correspondente no banco: ${missing.join(", ")}`);
}
