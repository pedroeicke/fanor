import type { Metadata } from "next";
import Link from "next/link";
import { canAccess } from "@/lib/gestion/access";
import { limaDateTime } from "@/lib/gestion/dates";
import { getOperator, listStores, shortStoreName } from "@/lib/gestion/server";
import { loadStockAt } from "@/lib/produccion/server";
import { cx } from "@/lib/format";
import { EmptyState, Notice, PageHeader, Section, StatCard, inputClass } from "@/components/admin/ui";
import { PackagingRows, type PackagingRow } from "@/components/admin/insumos/PackagingRows";
import { StockRows, type StockRow } from "@/components/admin/insumos/StockRows";

export const metadata: Metadata = { title: "Insumos" };
export const dynamic = "force-dynamic";

/**
 * Inventário do taller e das lojas: contar, registrar compra e ver o saldo.
 *
 * Contar uma vez cada item é o inventário inicial. Até lá o saldo só reflete o que
 * a produção consumiu, por isso fica negativo e a tela mostra o que falta contar.
 */

const TYPES = [
  { key: "MP", label: "Materia prima" },
  { key: "NV", label: "Empaques y reventa" },
  { key: "CS", label: "Consumibles" },
  { key: "PI", label: "Intermedios" },
] as const;

const KIND_LABEL: Record<string, string> = {
  production_input: "Consumo",
  production_output: "Producción",
  byproduct: "Subproducto",
  purchase: "Compra",
  adjustment: "Conteo",
  loss: "Pérdida",
  dispatch: "Despacho",
  sale: "Venta",
};

type ArticleRow = {
  code: string;
  description: string;
  type: string;
  stock_unit: string | null;
  recipe_unit: string | null;
  conversion_factor: number | null;
  cost: number | null;
};

type MovementRow = {
  id: string;
  kind: string;
  quantity: number;
  notes: string | null;
  document: string | null;
  created_at: string;
  article_code: string;
  articles: { description: string; recipe_unit: string | null } | null;
};

const movementFormat = new Intl.NumberFormat("es-PE", { maximumFractionDigits: 3, signDisplay: "always" });

function pick(value: string | string[] | undefined) {
  return typeof value === "string" ? value : "";
}

export default async function SuppliesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const op = await getOperator();
  if (!op) return <Notice tone="bad">Sesión expirada. Vuelve a entrar.</Notice>;
  const { db } = op;

  const sp = await searchParams;
  const stores = await listStores(db);
  const placeParam = pick(sp.lugar);
  const storeId = stores.some((s) => s.id === placeParam) ? placeParam : null;
  const type = TYPES.find((t) => t.key === pick(sp.tipo))?.key ?? (storeId ? "NV" : "MP");
  const query = pick(sp.q).trim().slice(0, 60);
  const boxesTab = pick(sp.t) === "cajas";

  const href = (changes: Record<string, string | null>) => {
    const params = new URLSearchParams();
    const merged = { lugar: storeId, tipo: type, q: query || null, t: boxesTab ? "cajas" : null, ...changes };
    for (const [key, value] of Object.entries(merged)) if (value) params.set(key, value);
    const search = params.toString();
    return `/admin/insumos${search ? `?${search}` : ""}`;
  };

  const tabs = (
    <div className="flex flex-wrap gap-2">
      {[
        { label: "Saldo", active: !boxesTab, to: href({ t: null }) },
        { label: "Cajas por formato", active: boxesTab, to: href({ t: "cajas" }) },
      ].map((tab) => (
        <Link
          key={tab.label}
          href={tab.to}
          className={cx(
            "inline-flex h-11 items-center rounded-full border px-5 text-sm font-semibold transition-colors",
            tab.active ? "border-dorado bg-dorado text-cacao" : "border-crema-300 bg-white text-cacao-700 hover:border-cacao/35",
          )}
        >
          {tab.label}
        </Link>
      ))}
    </div>
  );

  if (boxesTab) {
    const [{ data: formats, error: formatsError }, { data: boxes }] = await Promise.all([
      db.from("packaging_formats").select("format, models, example, box_code").order("format"),
      db.from("articles").select("code, description").eq("type", "NV").eq("active", true).order("description"),
    ]);
    const rows: PackagingRow[] = (formats ?? []).map((row) => ({
      format: row.format as string,
      models: Number(row.models),
      example: row.example as string,
      boxCode: row.box_code as string | null,
    }));
    const missing = rows.filter((row) => !row.boxCode).length;
    /* São 52 artigos de embalagem e revenda: as caixas vêm primeiro na lista. */
    const isBox = (box: { description: string }) => /^cajas?\b/i.test(box.description);
    const boxOptions = ((boxes ?? []) as { code: string; description: string }[]).sort((a, b) => Number(isBox(b)) - Number(isBox(a)));
    return (
      <div className="space-y-6">
        <PageHeader title="Insumos" description="Cada formato de torta usa una caja. Al venderse la torta, esa caja sale del saldo de la tienda." />
        {tabs}
        {formatsError && <Notice tone="bad">No se pudo cargar. Recarga la página.</Notice>}
        {missing > 0 && (
          <Notice tone="warn">
            {missing} de {rows.length} formatos sin caja: sus ventas todavía no descuentan ninguna caja.
          </Notice>
        )}
        <Section title="Cajas por formato">
          <PackagingRows rows={rows} boxes={boxOptions} />
        </Section>
      </div>
    );
  }

  let request = db
    .from("articles")
    .select("code, type, description, stock_unit, recipe_unit, conversion_factor, cost")
    .eq("active", true)
    .eq("type", type)
    .order("description")
    .limit(400);
  const words = query.replace(/[%,()*"\\]/g, " ").split(/\s+/).filter(Boolean).slice(0, 5);
  for (const word of words) request = request.or(`code.ilike.%${word}%,description.ilike.%${word}%`);

  const movementsRequest = db
    .from("article_movements")
    .select("id, kind, quantity, notes, document, created_at, article_code, articles(description, recipe_unit)")
    .order("created_at", { ascending: false })
    .limit(15);

  const [articlesRes, movementsRes] = await Promise.all([request, storeId ? movementsRequest.eq("store_id", storeId) : movementsRequest.is("store_id", null)]);
  const articles = (articlesRes.data ?? []) as ArticleRow[];
  const movements = (movementsRes.data ?? []) as unknown as MovementRow[];
  const { balances, counted } = await loadStockAt(db, articles.map((a) => a.code), storeId);

  const rows: StockRow[] = articles.map((article) => {
    const factor = article.conversion_factor && article.conversion_factor > 0 ? Number(article.conversion_factor) : 1;
    const unit = article.stock_unit ?? article.recipe_unit ?? "un.";
    const last = counted.get(article.code);
    return {
      code: article.code,
      description: article.description,
      type: article.type,
      quantity: (balances.get(article.code) ?? 0) / factor,
      unit,
      conversion: factor !== 1 && article.recipe_unit ? `1 ${unit} = ${factor.toLocaleString("es-PE")} ${article.recipe_unit}` : null,
      cost: article.cost === null ? null : Number(article.cost),
      lastCount: last ? limaDateTime(last) : null,
    };
  });
  const notCounted = rows.filter((row) => !row.lastCount).length;
  const negative = rows.filter((row) => row.quantity < 0).length;

  const places = [{ id: null as string | null, name: "Taller" }, ...stores.map((s) => ({ id: s.id as string | null, name: shortStoreName(s.name) }))];

  return (
    <div className="space-y-6">
      <PageHeader title="Insumos" description="Saldo del taller y de cada tienda. Cuenta cada artículo una vez para el inventario inicial y registra las compras." />
      {tabs}

      <div className="flex flex-wrap gap-2" aria-label="Lugar">
        {places.map((p) => (
          <Link
            key={p.id ?? "taller"}
            href={href({ lugar: p.id, tipo: null })}
            aria-current={p.id === storeId ? "page" : undefined}
            className={cx(
              "inline-flex h-11 items-center rounded-full border px-5 text-sm font-medium transition-colors",
              p.id === storeId ? "border-cacao bg-cacao text-crema" : "border-crema-300 bg-white text-cacao-700 hover:border-cacao/35",
            )}
          >
            {p.name}
          </Link>
        ))}
      </div>

      <div className="flex flex-wrap gap-2" aria-label="Tipo">
        {TYPES.map((t) => (
          <Link
            key={t.key}
            href={href({ tipo: t.key })}
            aria-current={t.key === type ? "page" : undefined}
            className={cx(
              "inline-flex h-10 items-center rounded-full border px-4 text-sm font-medium transition-colors",
              t.key === type ? "border-dorado bg-dorado-100 text-cacao" : "border-crema-300 bg-white text-cacao-700 hover:border-cacao/35",
            )}
          >
            {t.label}
          </Link>
        ))}
      </div>

      <ul className="grid grid-cols-3 gap-3">
        <StatCard label="Artículos" value={rows.length} />
        <StatCard label="Sin contar" value={notCounted} tone={notCounted ? "warn" : undefined} />
        <StatCard label="Saldo negativo" value={negative} tone={negative ? "warn" : undefined} />
      </ul>

      <form action="/admin/insumos" className="flex flex-wrap gap-2">
        {storeId && <input type="hidden" name="lugar" value={storeId} />}
        <input type="hidden" name="tipo" value={type} />
        <input name="q" defaultValue={query} aria-label="Buscar" placeholder="Buscar por nombre o código" className={cx(inputClass, "min-w-0 flex-1")} />
        <button type="submit" className="inline-flex h-11 items-center rounded-full border border-crema-300 bg-white px-5 text-sm font-semibold text-cacao-700 hover:border-cacao/35">
          Buscar
        </button>
      </form>

      {articlesRes.error && <Notice tone="bad">No se pudo cargar. Recarga la página.</Notice>}

      <Section title={TYPES.find((t) => t.key === type)?.label ?? "Artículos"} aside={`${rows.length} ${rows.length === 1 ? "artículo" : "artículos"}`}>
        {rows.length === 0 ? <EmptyState>Nada coincide con la búsqueda.</EmptyState> : <StockRows rows={rows} storeId={storeId} canCost={canAccess(op.profile, "/admin/costos")} />}
      </Section>

      <Section title="Últimos movimientos" aside="Últimos 15">
        {movements.length === 0 ? (
          <EmptyState>Todavía no hay movimientos aquí.</EmptyState>
        ) : (
          <ul className="divide-y divide-crema-200">
            {movements.map((move) => (
              <li key={move.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 px-4 py-2.5 text-sm sm:px-5">
                <span className="min-w-0">
                  <span className="font-medium text-cacao">{KIND_LABEL[move.kind] ?? move.kind}</span>
                  <span className="text-cacao-700"> · {move.articles?.description ?? move.article_code}</span>
                  {(move.document || (move.notes && move.notes !== KIND_LABEL[move.kind])) && (
                    <span className="text-cacao-500"> · {[move.document, move.notes === KIND_LABEL[move.kind] ? null : move.notes].filter(Boolean).join(" · ")}</span>
                  )}
                </span>
                <span className="shrink-0 tabular-nums text-cacao-700">
                  {movementFormat.format(Number(move.quantity))} {move.articles?.recipe_unit}
                  <span className="ml-2 text-[12px] text-cacao-300">{limaDateTime(move.created_at)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
