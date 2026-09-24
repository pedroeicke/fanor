export type PreviewIssue = {
  severity: "blocker" | "review";
  kind: string;
  sheet: string;
  row: number;
  message: string;
};

export type PreviewCatalogItem = {
  row: number;
  old_code: string | null;
  code: string;
  description: string;
  unit: string;
};

export type PreviewIngredient = {
  row: number;
  source_code: string | null;
  code: string | null;
  quantity: number | null;
  unit: string | null;
};

export type PreviewRecipe = {
  row: number;
  source_code: string;
  code: string | null;
  yield_quantity: number | null;
  yield_unit: string | null;
  ingredients: PreviewIngredient[];
};

export type RecipePreviewData = {
  source_file: string;
  summary: {
    catalog_items: number;
    items_with_old_code: number;
    recipes: number;
    ingredient_lines: number;
    blockers: number;
    reviews: number;
  };
  issues: PreviewIssue[];
  catalog: PreviewCatalogItem[];
  recipes: PreviewRecipe[];
};

export function isRecipePreviewData(value: unknown): value is RecipePreviewData {
  if (!value || typeof value !== "object") return false;
  const data = value as Partial<RecipePreviewData>;
  return (
    typeof data.source_file === "string" &&
    !!data.summary &&
    Array.isArray(data.issues) &&
    Array.isArray(data.catalog) &&
    Array.isArray(data.recipes) &&
    data.recipes.every((recipe) => (typeof recipe.code === "string" || recipe.code === null) && Array.isArray(recipe.ingredients))
  );
}
