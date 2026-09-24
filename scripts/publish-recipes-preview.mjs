/**
 * Publica a prévia validada no banco, sob RLS de administrador. Não cria
 * artigos, fórmulas operacionais, estoque nem custos.
 *
 * Uso: node --env-file=.env.local scripts/publish-recipes-preview.mjs [arquivo.json] [--apply]
 * Sem --apply, apenas verifica e resume o arquivo.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";

const key = "production_recipes_preview";
const source = process.argv.find((arg, index) => index > 1 && !arg.startsWith("--"))
  ?? join("materiais-cliente", "josekazuo-2026-09-24", "preview-importacao.json");
const apply = process.argv.includes("--apply");
const preview = JSON.parse(readFileSync(source, "utf8"));

if (
  !Array.isArray(preview.catalog) ||
  !Array.isArray(preview.recipes) ||
  !Array.isArray(preview.issues) ||
  preview.summary?.catalog_items !== preview.catalog.length ||
  preview.summary?.recipes !== preview.recipes.length ||
  preview.summary?.ingredient_lines !== preview.recipes.reduce((total, recipe) => total + recipe.ingredients.length, 0)
) {
  throw new Error("Prévia inválida ou contagens inconsistentes.");
}

console.log(`Prévia: ${preview.summary.catalog_items} códigos, ${preview.summary.recipes} fórmulas, ${preview.summary.ingredient_lines} insumos.`);
console.log(`Revisão: ${preview.summary.blockers} bloqueio(s), ${preview.summary.reviews} aviso(s).`);
if (!apply) {
  console.log("Verificação concluída. Use --apply para publicar somente a prévia de leitura.");
  process.exit(0);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) throw new Error("Faltam variáveis de conexão com o Supabase.");

const db = createClient(url, serviceKey, { auth: { persistSession: false } });
const { error } = await db.from("system_settings").upsert({ key, value: preview, updated_at: new Date().toISOString() });
if (error) throw new Error(`Falha ao publicar prévia: ${error.code} ${error.message}`);
console.log("Prévia de leitura publicada para administradores.");
