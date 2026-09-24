import type { Metadata } from "next";
import { RecipePreview } from "@/components/admin/recetas/RecipePreview";
import { readLocalRecipePreview } from "@/lib/recetas-preview";

export const metadata: Metadata = { title: "Recetas de producción" };
export const dynamic = "force-dynamic";

export default async function RecetasPage() {
  return <RecipePreview initialData={await readLocalRecipePreview()} />;
}
