/**
 * Busca o preço de cada variação (tamanho) na Store API do WooCommerce.
 *
 * A listagem de produtos só traz a faixa de preço; o valor de cada tamanho
 * está no endpoint individual da variação. A associação tamanho→id vem do
 * array `variations` do produto pai, em data/_raw-woo.json.
 *
 * Rode com: npm run catalog:fetch
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = "https://tortasfanor.com/wp-json/wc/store/v1";

console.log("→ baixando catálogo…");
const products = await (await fetch(`${SOURCE}/products?per_page=100`)).json();
writeFileSync(join(root, "data/_raw-woo.json"), JSON.stringify(products, null, 1) + "\n");
console.log(`  ${products.length} produtos`);

const ids = products.flatMap((p) => (p.variations ?? []).map((v) => v.id));
console.log(`→ baixando ${ids.length} variações…`);

const prices = {};
for (const id of ids) {
  const res = await fetch(`${SOURCE}/products/${id}`);
  if (!res.ok) {
    console.warn(`  ! variação ${id} respondeu ${res.status}, ignorada`);
    continue;
  }
  const variation = await res.json();
  prices[id] = {
    price: Number(variation.prices.price) / 10 ** variation.prices.currency_minor_unit,
    name: variation.name,
  };
}

writeFileSync(join(root, "scripts/_variations.json"), JSON.stringify(prices, null, 1) + "\n");
console.log(`✓ ${Object.keys(prices).length} preços → scripts/_variations.json`);
console.log("  agora rode: npm run catalog");
