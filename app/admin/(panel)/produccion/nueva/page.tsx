import type { Metadata } from "next";
import Link from "next/link";
import { getOperator, shortStoreName } from "@/lib/gestion/server";
import { limaToday } from "@/lib/gestion/dates";
import { Notice, PageHeader } from "@/components/admin/ui";
import { OrderBuilder } from "@/components/admin/produccion/OrderBuilder";
import type { ArticleOption, DemandOrder } from "@/components/admin/produccion/types";
import { createOrder, listBatidaFormats, previewPlan, searchProducible } from "../actions";

export const metadata: Metadata = { title: "Nueva orden de producción" };
export const dynamic = "force-dynamic";

type BatidaRow = { stage: string; articles: { code: string; description: string; recipe_unit: string | null } };

type DemandRow = {
  id: string;
  number: number;
  for_date: string;
  stores: { name: string } | null;
  production_order_lines: { quantity: number; produced_quantity: number; products: { name: string } | null }[];
};

export default async function NewProductionPage() {
  const op = await getOperator();
  if (!op) return <Notice tone="bad">Sesión expirada. Vuelve a entrar.</Notice>;

  const [batidaRes, demandRes] = await Promise.all([
    op.db.from("formulas").select("stage, articles!formulas_output_code_fkey(code, description, recipe_unit)").eq("active", true).eq("stage", "batidas"),
    op.db
      .from("production_orders")
      .select("id, number, for_date, stores(name), production_order_lines(quantity, produced_quantity, products(name))")
      .in("status", ["planned", "in_progress"])
      .order("for_date")
      .limit(50),
  ]);

  if (batidaRes.error) return <Notice tone="bad">No se pudo cargar las fórmulas. Recarga la página.</Notice>;

  const batidas: ArticleOption[] = ((batidaRes.data ?? []) as unknown as BatidaRow[])
    .map((row) => ({ code: row.articles.code, description: row.articles.description, unit: row.articles.recipe_unit, stage: row.stage }))
    .sort((a, b) => a.description.localeCompare(b.description));

  const demand: DemandOrder[] = ((demandRes.data ?? []) as unknown as DemandRow[]).map((order) => ({
    id: order.id,
    number: order.number,
    store: shortStoreName(order.stores?.name),
    forDate: order.for_date,
    lines: order.production_order_lines
      .map((line) => ({ name: line.products?.name ?? "Producto", pending: Number(line.quantity) - Number(line.produced_quantity) }))
      .filter((line) => line.pending > 0),
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Nueva orden de producción"
        description="Indica cuántos quieres de cada formato. El sistema suma las proporciones y calcula los insumos."
        actions={
          <Link href="/admin/produccion" className="inline-flex h-11 items-center justify-center rounded-full border border-cacao/25 bg-white px-5 text-sm font-semibold text-cacao transition-colors hover:border-cacao">
            Volver
          </Link>
        }
      />
      <OrderBuilder
        batidas={batidas}
        demand={demand}
        today={limaToday()}
        actions={{ search: searchProducible, formats: listBatidaFormats, preview: previewPlan, create: createOrder }}
      />
    </div>
  );
}
