"use client";

import { useMemo, useState, type ChangeEvent } from "react";
import { EmptyState, Notice, PageHeader, Section, StatCard, inputClass } from "@/components/admin/ui";
import { cx } from "@/lib/format";
import { isRecipePreviewData, type PreviewIssue, type RecipePreviewData } from "./types";

const number = new Intl.NumberFormat("es-PE", { maximumFractionDigits: 3 });

function quantity(value: number | null, unit: string | null) {
  return value === null ? "Sin rendimiento" : `${number.format(value)} ${unit ?? ""}`.trim();
}

function issueLabel(issue: PreviewIssue) {
  if (issue.kind === "old_code_in_recipe") return "Código antiguo en la fórmula";
  return issue.message;
}

export function RecipePreview({ initialData }: { initialData?: RecipePreviewData | null }) {
  const [data, setData] = useState<RecipePreviewData | null>(initialData ?? null);
  const [selectedRow, setSelectedRow] = useState(initialData?.recipes[0]?.row ?? 0);
  const [search, setSearch] = useState("");
  const [catalogSearch, setCatalogSearch] = useState("");
  const [catalogPage, setCatalogPage] = useState(0);
  const [onlyIssues, setOnlyIssues] = useState(false);
  const [loadError, setLoadError] = useState("");

  const catalog = useMemo(() => new Map(data?.catalog.map((item) => [item.code, item]) ?? []), [data]);
  const recipeIssues = useMemo(() => {
    const result = new Map<number, PreviewIssue[]>();
    if (!data) return result;
    data.recipes.forEach((recipe, index) => {
      const nextRow = data.recipes[index + 1]?.row ?? Number.POSITIVE_INFINITY;
      result.set(recipe.row, data.issues.filter((issue) => issue.sheet === (data.recipe_sheet ?? "RECETAS INTERMEDIOS TORTAS") && issue.row >= recipe.row && issue.row < nextRow));
    });
    return result;
  }, [data]);

  const visible = useMemo(() => {
    if (!data) return [];
    const term = search.trim().toLocaleLowerCase("es-PE");
    return data.recipes.filter((recipe) => {
      if (onlyIssues && !(recipeIssues.get(recipe.row)?.length)) return false;
      if (!term) return true;
      const name = catalog.get(recipe.code ?? "")?.description ?? "";
      return `${recipe.code} ${recipe.source_code} ${name}`.toLocaleLowerCase("es-PE").includes(term);
    });
  }, [catalog, data, onlyIssues, recipeIssues, search]);

  const visibleCatalog = useMemo(() => {
    const term = catalogSearch.trim().toLocaleLowerCase("es-PE");
    if (!data) return [];
    return term
      ? data.catalog.filter((item) => `${item.code} ${item.description} ${item.type ?? ""}`.toLocaleLowerCase("es-PE").includes(term))
      : data.catalog;
  }, [catalogSearch, data]);
  const catalogPageCount = Math.max(1, Math.ceil(visibleCatalog.length / 50));
  const currentCatalogPage = Math.min(catalogPage, catalogPageCount - 1);
  const catalogRows = visibleCatalog.slice(currentCatalogPage * 50, (currentCatalogPage + 1) * 50);

  const selected = visible.find((recipe) => recipe.row === selectedRow) ?? visible[0] ?? null;
  const selectedItem = selected ? catalog.get(selected.code ?? "") : null;
  const selectedIssues = selected ? recipeIssues.get(selected.row) ?? [] : [];

  async function loadFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    try {
      if (file.size > 5_000_000) throw new Error("El archivo supera 5 MB.");
      const parsed: unknown = JSON.parse(await file.text());
      if (!isRecipePreviewData(parsed)) throw new Error("El archivo no tiene el formato de vista previa.");
      setData(parsed);
      setSelectedRow(parsed.recipes[0]?.row ?? 0);
      setSearch("");
      setCatalogSearch("");
      setCatalogPage(0);
      setOnlyIssues(false);
      setLoadError("");
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "No se pudo abrir el archivo.");
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Recetas de producción"
        description="Revisión del catálogo, las conversiones y las fórmulas del Excel antes de activarlos en producción."
        actions={
          <label className="inline-flex h-11 cursor-pointer items-center rounded-full border border-crema-300 bg-white px-5 text-sm font-semibold text-cacao hover:border-cacao/35 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-dorado">
            Cargar vista previa
            <input type="file" accept=".json,application/json" onChange={loadFile} className="sr-only" aria-label="Abrir archivo de vista previa de recetas" />
          </label>
        }
      />

      <Notice tone="warn">
        Vista previa del Excel. Estas recetas todavía no generan movimientos de inventario ni costos.
      </Notice>
      {loadError && <Notice tone="bad">{loadError}</Notice>}

      {!data ? (
        <Section title="Sin archivo cargado">
          <EmptyState>Genera la vista previa con el validador del proyecto y ábrela aquí para revisar las fórmulas.</EmptyState>
        </Section>
      ) : (
        <>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5" aria-label="Resumen de la vista previa">
            <StatCard label="Códigos" value={data.summary.catalog_items} hint="Artículos del catálogo" />
            <StatCard label="Fórmulas" value={data.summary.recipes} hint="Recetas del archivo" />
            <StatCard label="Ingredientes" value={data.summary.ingredient_lines} hint="Líneas de insumos" />
            <StatCard label="Falta completar" value={data.summary.blockers} hint="Inconsistencias del Excel" tone="warn" />
            <StatCard label="Por revisar" value={data.summary.reviews} hint="Conversiones y procesos" tone="warn" />
          </ul>

          {data.summary.converted_ingredient_lines !== undefined && (
            <Notice tone="ok">
              {data.summary.converted_ingredient_lines} cantidades convertidas con el factor explícito de su código, conservando la cantidad y unidad originales.
            </Notice>
          )}
          {!!data.summary.items_without_cost && (
            <Notice tone="warn">{data.summary.items_without_cost} códigos sin costo en este archivo. La vista previa no calcula costos de producción.</Notice>
          )}

          {data.issues.length > 0 && (
            <Section title="Pendientes del archivo" aside={`${data.issues.length} observaciones`}>
              <ul className="divide-y divide-crema-200">
                {data.issues.map((issue) => (
                  <li key={`${issue.sheet}-${issue.row}-${issue.kind}`} className="flex flex-wrap items-start gap-x-4 gap-y-1 px-5 py-3 text-sm">
                    <span className={cx("min-w-24 font-bold", issue.severity === "blocker" ? "text-terracota" : "text-cacao-500")}>
                      {issue.severity === "blocker" ? "Completar" : "Revisar"}
                    </span>
                    <span className="min-w-0 flex-1 text-cacao">{issueLabel(issue)}</span>
                    <span className="text-xs text-cacao-500">{issue.sheet}, fila {issue.row}</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <div className="grid gap-5 lg:grid-cols-[minmax(18rem,0.95fr)_minmax(0,1.7fr)]">
            <Section title="Fórmulas" aside={`${visible.length} de ${data.recipes.length}`}>
              <div className="space-y-3 border-b border-crema-200 p-4">
                <label htmlFor="recetas-search" className="sr-only">Buscar receta por código o nombre</label>
                <input
                  id="recetas-search"
                  type="search"
                  placeholder="Buscar por código o nombre"
                  className={inputClass}
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
                <label className="flex items-center gap-2 text-sm text-cacao-700">
                  <input type="checkbox" checked={onlyIssues} onChange={(event) => setOnlyIssues(event.target.checked)} className="accent-dorado-600" />
                  Solo pendientes de revisión
                </label>
              </div>
              <div className="max-h-[35rem] overflow-y-auto">
                {visible.length === 0 ? (
                  <EmptyState>No hay fórmulas que coincidan con la búsqueda.</EmptyState>
                ) : (
                  <ul className="divide-y divide-crema-200">
                    {visible.map((recipe) => {
                      const item = catalog.get(recipe.code ?? "");
                      const flagged = (recipeIssues.get(recipe.row)?.length ?? 0) > 0;
                      return (
                        <li key={`${recipe.row}-${recipe.code}`}>
                          <button
                            type="button"
                            onClick={() => setSelectedRow(recipe.row)}
                            aria-current={selected?.row === recipe.row ? "true" : undefined}
                            className={cx(
                              "w-full px-5 py-3 text-left transition-colors hover:bg-crema-100 focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-dorado",
                              selected?.row === recipe.row && "bg-dorado-100",
                            )}
                          >
                            <span className="flex items-start justify-between gap-3">
                              <span className="min-w-0">
                                <span className="block font-mono text-xs font-bold text-cacao-500">{recipe.code ?? recipe.source_code}</span>
                                <span className="mt-0.5 block truncate text-sm font-semibold text-cacao">{item?.description ?? "Sin descripción"}</span>
                              </span>
                              {flagged && <span className="shrink-0 rounded-full bg-terracota/10 px-2 py-1 text-[11px] font-semibold text-terracota">Revisar</span>}
                            </span>
                            <span className="mt-1 block text-xs text-cacao-500">Rendimiento: {quantity(recipe.yield_quantity, recipe.yield_unit)}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </Section>

            {selected && (
              <Section title={selectedItem?.description ?? selected.code ?? selected.source_code} aside={<span className="font-mono text-xs">{selected.code ?? selected.source_code}</span>}>
                <div className="space-y-5 p-5">
                  <div className="flex flex-wrap gap-4 rounded-xl bg-crema-100 px-4 py-3 text-sm">
                    <div><span className="block text-xs font-semibold uppercase tracking-wide text-cacao-300">Rendimiento</span><strong className="text-cacao">{quantity(selected.yield_quantity, selected.yield_unit)}</strong></div>
                    <div><span className="block text-xs font-semibold uppercase tracking-wide text-cacao-300">Ingredientes</span><strong className="text-cacao">{selected.ingredients.length}</strong></div>
                    <div><span className="block text-xs font-semibold uppercase tracking-wide text-cacao-300">Origen</span><strong className="text-cacao">Fila {selected.row} del Excel</strong></div>
                  </div>
                  {selected.source_code !== selected.code && (
                    <Notice tone="warn">El Excel usa el código antiguo {selected.source_code}; corresponde a {selected.code} en el catálogo nuevo.</Notice>
                  )}
                  {selectedIssues.map((issue) => (
                    <Notice key={`${issue.kind}-${issue.row}`} tone={issue.severity === "blocker" ? "bad" : "warn"}>
                      {issueLabel(issue)} · fila {issue.row}
                    </Notice>
                  ))}
                  <div>
                    <h4 className="mb-3 text-sm font-bold text-cacao">Ingredientes de la fórmula</h4>
                    <div className="overflow-x-auto rounded-xl border border-crema-200">
                      <table className="w-full min-w-[30rem] text-sm">
                        <thead className="bg-crema-100 text-left text-xs font-bold uppercase tracking-wide text-cacao-500">
                          <tr><th scope="col" className="px-4 py-3">Código</th><th scope="col" className="px-4 py-3">Insumo</th><th scope="col" className="px-4 py-3 text-right">Cantidad</th></tr>
                        </thead>
                        <tbody className="divide-y divide-crema-200">
                          {selected.ingredients.map((ingredient) => (
                            <tr key={ingredient.row}>
                              <td className="px-4 py-3 font-mono text-xs text-cacao-500">{ingredient.code ?? ingredient.source_code}</td>
                              <td className="px-4 py-3 text-cacao">{catalog.get(ingredient.code ?? "")?.description ?? "Sin descripción"}</td>
                              <td className="whitespace-nowrap px-4 py-3 text-right font-semibold text-cacao">
                                {quantity(ingredient.quantity, ingredient.unit)}
                                {ingredient.conversion_factor && (
                                  <span className="block text-xs font-normal text-cacao-500">
                                    Desde {quantity(ingredient.source_quantity ?? null, ingredient.source_unit ?? null)} × {number.format(ingredient.conversion_factor)}
                                  </span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </Section>
            )}
          </div>

          <Section title="Catálogo de códigos" aside={`${visibleCatalog.length} de ${data.catalog.length}`}>
            <div className="border-b border-crema-200 p-4">
              <label htmlFor="catalog-search" className="sr-only">Buscar código, descripción o tipo</label>
              <input
                id="catalog-search"
                type="search"
                placeholder="Buscar código, descripción o tipo"
                className={inputClass}
                value={catalogSearch}
                onChange={(event) => { setCatalogSearch(event.target.value); setCatalogPage(0); }}
              />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[44rem] text-sm">
                <thead className="bg-crema-100 text-left text-xs font-bold uppercase tracking-wide text-cacao-500">
                  <tr>
                    <th scope="col" className="px-4 py-3">Código</th>
                    <th scope="col" className="px-4 py-3">Descripción</th>
                    <th scope="col" className="px-4 py-3">Tipo</th>
                    <th scope="col" className="px-4 py-3">Unidad de stock</th>
                    <th scope="col" className="px-4 py-3">Unidad de receta</th>
                    <th scope="col" className="px-4 py-3 text-right">Factor</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-crema-200">
                  {catalogRows.map((item) => (
                    <tr key={item.code}>
                      <td className="px-4 py-3 font-mono text-xs font-semibold text-cacao">{item.code}</td>
                      <td className="px-4 py-3 text-cacao">{item.description}</td>
                      <td className="px-4 py-3 text-cacao-500">{item.type ?? "—"}</td>
                      <td className="px-4 py-3 text-cacao-500">{item.stock_unit ?? item.unit}</td>
                      <td className="px-4 py-3 text-cacao-500">{item.unit}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-cacao">{item.conversion_factor == null ? "—" : number.format(item.conversion_factor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {visibleCatalog.length === 0 && <EmptyState>No hay códigos que coincidan con la búsqueda.</EmptyState>}
            </div>
            {visibleCatalog.length > 50 && (
              <div className="flex items-center justify-between gap-3 border-t border-crema-200 px-4 py-3 text-sm text-cacao-500">
                <button type="button" className="font-semibold text-cacao disabled:opacity-40" disabled={currentCatalogPage === 0} onClick={() => setCatalogPage(currentCatalogPage - 1)}>Anterior</button>
                <span>Página {currentCatalogPage + 1} de {catalogPageCount}</span>
                <button type="button" className="font-semibold text-cacao disabled:opacity-40" disabled={currentCatalogPage + 1 >= catalogPageCount} onClick={() => setCatalogPage(currentCatalogPage + 1)}>Siguiente</button>
              </div>
            )}
          </Section>
          <p className="text-xs text-cacao-500">Fuente: {data.source_file}. Código, descripción y unidades se toman del catálogo; el factor convierte de unidad de stock a unidad de receta.</p>
        </>
      )}
    </div>
  );
}
