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
  type?: string;
  stock_unit?: string;
  conversion_factor?: number | null;
  cost?: number | null;
  minimum_lot?: number | null;
};

export type PreviewIngredient = {
  row: number;
  source_code: string | null;
  code: string | null;
  quantity: number | null;
  unit: string | null;
  source_quantity?: number | null;
  source_unit?: string | null;
  conversion_factor?: number | null;
  source_calculation?: string | number | null;
};

export type PreviewRecipe = {
  row: number;
  source_code: string;
  code: string | null;
  yield_quantity: number | null;
  yield_unit: string | null;
  source_weight?: number | null;
  ingredients: PreviewIngredient[];
};

export type RecipePreviewData = {
  source_file: string;
  source_sha256?: string;
  recipe_sheet?: string;
  summary: {
    catalog_items: number;
    items_with_old_code: number;
    recipes: number;
    ingredient_lines: number;
    converted_ingredient_lines?: number;
    items_without_cost?: number;
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
