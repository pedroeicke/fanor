/**
 * Leva a prévia validada da planilha para as tabelas operacionais `articles`,
 * `formulas` e `formula_lines`. Não toca em estoque nem em ordens de produção.
 *
 * Fórmula com pendência fica de fora e é listada: importar rendimento vazio ou
 * ingrediente sem cadastro faria a produção calcular quantidade errada.
 *
 * Uso: node --env-file=.env.local scripts/import-production-base.mjs arquivo.json [--apply]
 * Sem --apply, apenas valida e resume.
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const source = process.argv.find((arg, index) => index > 1 && !arg.startsWith("--"));
if (!source) throw new Error("Informe o JSON gerado por preview-recetas-fanor2026.py.");
const apply = process.argv.includes("--apply");
const preview = JSON.parse(readFileSync(source, "utf8"));

const EGG = "MPP-100100";
/* Separar um ovo gera as duas partes. Clara e gema vêm como fórmulas separadas
   na planilha; cada uma registra a outra como saída conjunta, e o ovo baixa uma vez. */
const EGG_SPLIT = { "MPP-100YEM": { code: "MPP-100CLA", quantity: 35 }, "MPP-100CLA": { code: "MPP-100YEM", quantity: 25 } };

function stageOf(code) {
  if (code.startsWith("BAT-")) return "batidas";
  if (/^TP\d/.test(code)) return "porcion";
  if (/^(CAKE-|CK\d|C\d|COR-|GUA-)/.test(code)) return "horno";
  if (/^(IN\d|MP)/.test(code)) return "preparados";
  if (/^E[A-Z0-9]/.test(code)) return "empate";
  return "decoracion";
}

const catalog = preview.catalog.filter((item) => item.code);
const known = new Map(catalog.map((item) => [item.code, item]));

const articles = catalog.map((item) => ({
  code: item.code,
  type: item.type,
  description: item.description,
  stock_unit: item.stock_unit || null,
  conversion_factor: item.conversion_factor ?? null,
  recipe_unit: item.unit || null,
  cost: item.cost ?? null,
  minimum_lot: item.minimum_lot ?? null,
  active: true,
  source_row: item.row,
}));

const skipped = [];
const formulas = [];
const linesByOutput = new Map();
for (const recipe of preview.recipes) {
  const reason =
    !known.has(recipe.source_code) ? "saída fora do cadastro"
    : !recipe.yield_quantity ? "sem rendimento"
    : recipe.ingredients.length === 0 ? "sem ingredientes"
    : recipe.ingredients.some((line) => !known.has(line.source_code)) ? "ingrediente fora do cadastro"
    : recipe.ingredients.some((line) => !line.quantity) ? "ingrediente sem quantidade"
    : null;
  if (reason) {
    skipped.push({ code: recipe.source_code, row: recipe.row, reason });
    continue;
  }
  const byproduct = EGG_SPLIT[recipe.source_code];
  formulas.push({
    output_code: recipe.source_code,
    stage: stageOf(recipe.source_code),
    /* Na batida o número da planilha é peso; os cakes pedem frações da batida inteira. */
    batch_yield: recipe.source_code.startsWith("BAT-") ? 1 : recipe.yield_quantity,
    source_yield: recipe.yield_quantity,
    source_weight: typeof recipe.source_weight === "number" ? recipe.source_weight : null,
    byproduct_code: byproduct?.code ?? null,
    byproduct_quantity: byproduct?.quantity ?? null,
    active: true,
    source_row: recipe.row,
  });
  linesByOutput.set(recipe.source_code, recipe.ingredients.map((line) => ({
    article_code: line.source_code,
    quantity: line.quantity,
    source_quantity: line.source_quantity ?? line.quantity,
    source_unit: line.source_unit,
    count_on_execution: line.source_code === EGG && line.source_unit === known.get(EGG).unit,
    source_row: line.row,
  })));
}

/* Ciclo aqui travaria o cálculo de insumos em laço. */
const adjacency = new Map([...linesByOutput].map(([code, lines]) => [code, lines.map((line) => line.article_code)]));
const state = new Map();
function visit(code, path) {
  if (state.get(code) === "done" || !adjacency.has(code)) return;
  if (state.get(code) === "open") throw new Error(`Ciclo nas fórmulas: ${[...path, code].join(" → ")}`);
  state.set(code, "open");
  for (const next of adjacency.get(code)) visit(next, [...path, code]);
  state.set(code, "done");
}
for (const code of adjacency.keys()) visit(code, []);

const lineCount = [...linesByOutput.values()].reduce((total, lines) => total + lines.length, 0);
console.log(`Artigos: ${articles.length}. Fórmulas: ${formulas.length}. Linhas: ${lineCount}.`);
console.log(`Por etapa: ${JSON.stringify(formulas.reduce((acc, f) => ({ ...acc, [f.stage]: (acc[f.stage] ?? 0) + 1 }), {}))}`);
console.log(`Fórmulas fora (${skipped.length}):`);
for (const item of skipped) console.log(`  linha ${item.row}: ${item.code} — ${item.reason}`);
if (!apply) {
  console.log("Verificação concluída. Use --apply para gravar.");
  process.exit(0);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) throw new Error("Faltam variáveis de conexão com o Supabase.");
const db = createClient(url, serviceKey, { auth: { persistSession: false } });

async function inChunks(rows, size, fn) {
  for (let i = 0; i < rows.length; i += size) await fn(rows.slice(i, i + size));
}
function must({ error }, what) {
  if (error) throw new Error(`Falha em ${what}: ${error.code} ${error.message}`);
}

await inChunks(articles, 500, async (chunk) => must(await db.from("articles").upsert(chunk, { onConflict: "code" }), "artigos"));
await inChunks(formulas, 300, async (chunk) => must(await db.from("formulas").upsert(chunk, { onConflict: "output_code" }), "fórmulas"));

/* O que saiu da planilha fica inativo, não apagado: ordens antigas apontam para ele. */
async function allRows(table, columns) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(table).select(columns).range(from, from + 999);
    if (error) throw new Error(`Falha lendo ${table}: ${error.message}`);
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}
const existingArticles = await allRows("articles", "code");
const goneArticles = existingArticles.map((row) => row.code).filter((code) => !known.has(code));
if (goneArticles.length) must(await db.from("articles").update({ active: false }).in("code", goneArticles), "desativar artigos");

const existingFormulas = await allRows("formulas", "id, output_code");
const goneFormulas = existingFormulas.filter((row) => !linesByOutput.has(row.output_code)).map((row) => row.id);
if (goneFormulas.length) must(await db.from("formulas").update({ active: false }).in("id", goneFormulas), "desativar fórmulas");

const ids = new Map(existingFormulas.map((row) => [row.output_code, row.id]));
const rows = [...linesByOutput].flatMap(([code, lines]) => lines.map((line) => ({ ...line, formula_id: ids.get(code) })));
await inChunks([...ids.values()], 300, async (chunk) => must(await db.from("formula_lines").delete().in("formula_id", chunk), "limpar linhas"));
await inChunks(rows, 500, async (chunk) => must(await db.from("formula_lines").insert(chunk), "linhas"));

console.log(`Gravado. Inativados: ${goneArticles.length} artigo(s), ${goneFormulas.length} fórmula(s).`);
