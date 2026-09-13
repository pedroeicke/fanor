import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CatalogProduct } from "./types";

/**
 * Catálogo de produção: o que a loja pode pedir e o taller pode mandar.
 *
 * Só produto com família. Os ~100 produtos sem família são do site (torta
 * personalizada, combos) e não existem no balcão; e família de serviço
 * (ADL, REIN) é dinheiro de encomenda, não coisa que sai do forno.
 *
 * Carregado inteiro (são ~320 linhas) para a busca rodar no celular sem ida
 * e volta ao servidor a cada letra digitada.
 */

type Row = {
  id: string;
  sku: string | null;
  name: string;
  product_families: { code: string; name: string; sort_order: number; tracks_serial: boolean; is_service: boolean } | null;
};

export async function loadCatalog(db: SupabaseClient): Promise<CatalogProduct[]> {
  const { data } = await db
    .from("products")
    .select("id, sku, name, product_families!inner(code, name, sort_order, tracks_serial, is_service)")
    .eq("product_families.is_service", false)
    .limit(2000);

  const rows = ((data ?? []) as unknown as Row[]).filter((r) => r.product_families);

  /* Tortas primeiro: é o que se pede todo dia. Depois a ordem das famílias
     e, dentro delas, o código em ordem natural (T2 antes de T14). */
  rows.sort((a, b) => {
    const fa = a.product_families!, fb = b.product_families!;
    const ta = fa.tracks_serial ? 0 : 1, tb = fb.tracks_serial ? 0 : 1;
    if (ta !== tb) return ta - tb;
    if (fa.sort_order !== fb.sort_order) return fa.sort_order - fb.sort_order;
    return (a.sku ?? a.name).localeCompare(b.sku ?? b.name, "es", { numeric: true });
  });

  return rows.map((r) => ({
    id: r.id,
    sku: r.sku,
    name: r.name.trim(),
    familyCode: r.product_families!.code,
    familyName: r.product_families!.name,
    tracksSerial: r.product_families!.tracks_serial,
  }));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

/** Texto livre do formulário: aparado, cortado no limite, vazio vira null. */
export function cleanText(value: unknown, max: number) {
  if (typeof value !== "string") return null;
  const text = value.trim().slice(0, max);
  return text || null;
}
