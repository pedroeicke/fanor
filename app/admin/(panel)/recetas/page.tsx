import type { Metadata } from "next";
import { RecipePreview } from "@/components/admin/recetas/RecipePreview";
import { Notice } from "@/components/admin/ui";
import { getOperator } from "@/lib/gestion/server";
import { readLocalRecipePreview, readPublishedRecipePreview } from "@/lib/recetas-preview";

export const metadata: Metadata = { title: "Recetas de producción" };
export const dynamic = "force-dynamic";

export default async function RecetasPage() {
  const op = await getOperator();
  if (!op) return <Notice tone="bad">Sesión expirada. Vuelve a entrar.</Notice>;
  const data = (await readPublishedRecipePreview(op.db)) ?? (await readLocalRecipePreview());
  return <RecipePreview initialData={data} />;
}
