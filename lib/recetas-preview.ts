import "server-only";

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isRecipePreviewData, type RecipePreviewData } from "@/components/admin/recetas/types";

export const RECIPE_PREVIEW_KEY = "production_recipes_preview";

/** Prévia protegida por RLS: só a sessão de administrador pode ler. */
export async function readPublishedRecipePreview(db: SupabaseClient): Promise<RecipePreviewData | null> {
  const { data, error } = await db.from("system_settings").select("value").eq("key", RECIPE_PREVIEW_KEY).maybeSingle();
  if (error) {
    console.error("[recetas-preview]", error.code, error.message);
    return null;
  }
  return isRecipePreviewData(data?.value) ? data.value : null;
}

/** Arquivo derivado do Excel, ignorado pelo Git. Nunca é embutido no bundle público. */
export async function readLocalRecipePreview(): Promise<RecipePreviewData | null> {
  if (process.env.NODE_ENV !== "development") return null;
  const path = join(process.cwd(), "materiais-cliente", "josekazuo-2026-09-24", "preview-importacao.json");
  try {
    const data: unknown = JSON.parse(await readFile(path, "utf8"));
    return isRecipePreviewData(data) ? data : null;
  } catch {
    return null;
  }
}
