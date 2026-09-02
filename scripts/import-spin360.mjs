/**
 * Cadastra um conjunto de quadros 360° em `product_images` com kind = 'spin360'.
 *
 * Os arquivos já vivem em public/, então o que falta é registrá-los no banco —
 * é de lá que o componente lê. A ordem do giro é a ordem alfabética do nome do
 * arquivo, que é por isso que os nomes têm zero à esquerda (_01 … _30).
 *
 * Uso:
 *   npm run db:spin -- red-velvet public/assets/360/red-velvet
 *                      ↑ slug do produto   ↑ pasta com os quadros
 *
 * Idempotente: apaga os quadros anteriores do produto antes de inserir.
 */
import { readdirSync, statSync } from "node:fs";
import { join, posix, relative, sep } from "node:path";
import { createClient } from "@supabase/supabase-js";

const [, , slug, folder] = process.argv;

if (!slug || !folder) {
  console.error("Uso: npm run db:spin -- <slug-do-produto> <pasta-dos-quadros>");
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error("Faltam NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

/** Só imagens, ordenadas pelo nome — é a ordem dos quadros. */
const IMAGE = /\.(jpe?g|png|webp)$/i;

const files = readdirSync(folder)
  .filter((f) => IMAGE.test(f) && statSync(join(folder, f)).isFile())
  .sort((a, b) => a.localeCompare(b, "en", { numeric: true }));

if (files.length < 8) {
  console.error(
    `Encontrei ${files.length} quadros em ${folder}. O componente exige ao menos 8 — ` +
      "abaixo disso ele degrada para galeria comum.",
  );
  process.exit(1);
}

/**
 * A pasta tem de estar dentro de public/, porque a URL gravada é o caminho
 * público servido pelo site.
 */
const fromPublic = relative(join(process.cwd(), "public"), folder);
if (fromPublic.startsWith("..")) {
  console.error(`A pasta precisa estar dentro de public/. Recebi: ${folder}`);
  process.exit(1);
}
const urlBase = "/" + fromPublic.split(sep).join(posix.sep);

const db = createClient(url, key, { auth: { persistSession: false } });

const { data: product, error: findError } = await db
  .from("products")
  .select("id, name")
  .eq("slug", slug)
  .maybeSingle();

if (findError) {
  console.error("Falha ao consultar o produto:", findError.message);
  process.exit(1);
}
if (!product) {
  console.error(`Produto não encontrado: ${slug}`);
  process.exit(1);
}

/* Substitui o conjunto inteiro: reimportar não duplica quadros. */
const { error: deleteError } = await db
  .from("product_images")
  .delete()
  .eq("product_id", product.id)
  .eq("kind", "spin360");

if (deleteError) {
  console.error("Falha ao limpar os quadros anteriores:", deleteError.message);
  process.exit(1);
}

const rows = files.map((file, i) => ({
  product_id: product.id,
  url: `${urlBase}/${file}`,
  /* Só o primeiro quadro leva texto alternativo: os outros 29 são a mesma
     torta girando, e repetir a descrição em cada um polui o leitor de tela. */
  alt: i === 0 ? `${product.name}, vista giratoria de 360 grados` : null,
  kind: "spin360",
  width: 1000,
  height: 1000,
  sort_order: i,
}));

const { error: insertError } = await db.from("product_images").insert(rows);
if (insertError) {
  console.error("Falha ao inserir os quadros:", insertError.message);
  process.exit(1);
}

console.log(`✓ ${rows.length} quadros 360° para "${product.name}"`);
console.log(`  ${rows[0].url}`);
console.log(`  … até ${rows[rows.length - 1].url}`);
