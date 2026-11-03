import type { Metadata } from "next";
import Link from "next/link";
import { getOperator } from "@/lib/gestion/server";
import { directCost } from "@/lib/produccion/cost";
import { loadPlanGraph } from "@/lib/produccion/server";
import { cx } from "@/lib/format";
import { EmptyState, Notice, PageHeader, Section, StatCard, inputClass } from "@/components/admin/ui";

export const metadata: Metadata = { title: "Costos" };
export const dynamic = "force-dynamic";

/**
 * Custo direto de um artigo: fórmula × custo dos insumos. Enquanto a matéria-prima
 * não tiver custo, a tela diz o que falta em vez de mostrar um número menor que o real.
 */

const moneyFormat = new Intl.NumberFormat("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
const quantityFormat = new Intl.NumberFormat("es-PE", { maximumFractionDigits: 4 });
const money = (value: number) => `S/ ${moneyFormat.format(value)}`;

type Match = { articles: { code: string; description: string } };

export default async function CostsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const op = await getOperator();
  if (!op) return <Notice tone="bad">Sesión expirada. Vuelve a entrar.</Notice>;
  const { db } = op;

  const sp = await searchParams;
  const query = (typeof sp.q === "string" ? sp.q : "").trim().slice(0, 60);
  const code = typeof sp.c === "string" ? sp.c : "";

  const [totalRes, costedRes] = await Promise.all([
    db.from("articles").select("code", { count: "exact", head: true }).eq("type", "MP").eq("active", true),
    db.from("articles").select("code", { count: "exact", head: true }).eq("type", "MP").eq("active", true).not("cost", "is", null),
  ]);
  const totalMaterials = totalRes.count ?? 0;
  const costedMaterials = costedRes.count ?? 0;

  let matches: Match["articles"][] = [];
  const words = query.replace(/[%,()*"\\]/g, " ").split(/\s+/).filter(Boolean).slice(0, 5);
  if (words.length > 0) {
    let request = db.from("formulas").select("articles!formulas_output_code_fkey!inner(code, description)").eq("active", true);
    for (const word of words) request = request.or(`code.ilike.%${word}%,description.ilike.%${word}%`, { referencedTable: "articles" });
    const { data } = await request.limit(25);
    matches = ((data ?? []) as unknown as Match[]).map((row) => row.articles);
  }

  const graph = code ? await loadPlanGraph(db, [code]) : null;
  const result = graph ? directCost(graph, code) : null;
  const article = graph?.articles.get(code);

  return (
    <div className="space-y-6">
      <PageHeader title="Costos" description="Costo directo por fórmula. Los costos de cada insumo se cargan en Insumos o al registrar una compra." />

      <ul className="grid grid-cols-2 gap-3">
        <StatCard label="Materia prima con costo" value={`${costedMaterials} de ${totalMaterials}`} tone={costedMaterials < totalMaterials ? "warn" : "ok"} />
        <StatCard label="Sin costo" value={totalMaterials - costedMaterials} tone={costedMaterials < totalMaterials ? "warn" : undefined} />
      </ul>

      <form action="/admin/costos" className="flex flex-wrap gap-2">
        <input name="q" defaultValue={query} aria-label="Buscar" placeholder="Buscar torta o preparado" className={cx(inputClass, "min-w-0 flex-1")} />
        <button type="submit" className="inline-flex h-11 items-center rounded-full border border-crema-300 bg-white px-5 text-sm font-semibold text-cacao-700 hover:border-cacao/35">
          Buscar
        </button>
      </form>

      {query && (
        <Section title="Resultados">
          {matches.length === 0 ? (
            <EmptyState>Nada coincide con la búsqueda.</EmptyState>
          ) : (
            <ul className="divide-y divide-crema-200">
              {matches.map((match) => (
                <li key={match.code}>
                  <Link href={`/admin/costos?c=${encodeURIComponent(match.code)}`} className="block px-4 py-3 text-sm transition-colors hover:bg-crema-100 sm:px-5">
                    <span className="font-medium text-cacao">{match.description}</span>
                    <span className="ml-2 text-cacao-300">{match.code}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}

      {code && !result && <Notice tone="warn">Este artículo no tiene fórmula.</Notice>}

      {result && (
        <>
          {!result.complete && (
            <Notice tone="warn">
              Costo incompleto: faltan {result.missing.length} {result.missing.length === 1 ? "insumo" : "insumos"}. El valor de abajo es menor que el real.
            </Notice>
          )}
          {result.jointWith && <Notice>Esta fórmula genera dos productos. El costo se divide por peso hasta que se defina el reparto.</Notice>}

          <Section
            title={article?.description ?? code}
            aside={
              <span className={cx("font-semibold tabular-nums", result.complete ? "text-cacao" : "text-terracota-700")}>
                {money(result.unitCost)} por {article?.recipeUnit ?? "un."}
              </span>
            }
          >
            <ul className="divide-y divide-crema-200">
              {result.lines.map((line) => (
                <li key={line.code} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 px-4 py-2.5 text-sm sm:px-5">
                  <span className="min-w-0">
                    <span className="text-cacao">{line.description}</span>
                    <span className="block text-[13px] text-cacao-500">
                      {quantityFormat.format(line.quantity)} {line.unit}
                      {line.unitCost !== null && ` × ${money(line.unitCost)}`}
                    </span>
                  </span>
                  <span className={cx("shrink-0 tabular-nums", line.incomplete ? "font-medium text-terracota-700" : "text-cacao")}>
                    {line.unitCost === null ? "Sin costo" : money(line.total)}
                    {line.unitCost !== null && line.incomplete && " · parcial"}
                  </span>
                </li>
              ))}
            </ul>
          </Section>

          {result.missing.length > 0 && (
            <Section title="Insumos sin costo" aside={`${result.missing.length}`}>
              <ul className="divide-y divide-crema-200">
                {result.missing.map((item) => (
                  <li key={item.code}>
                    <Link href={`/admin/insumos?q=${encodeURIComponent(item.code)}`} className="flex justify-between gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-crema-100 sm:px-5">
                      <span className="text-cacao-700">{item.description}</span>
                      <span className="shrink-0 text-cacao-300">{item.code}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </>
      )}
    </div>
  );
}
