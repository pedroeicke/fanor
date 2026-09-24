import "server-only";

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { isRecipePreviewData, type RecipePreviewData } from "@/components/admin/recetas/types";

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
