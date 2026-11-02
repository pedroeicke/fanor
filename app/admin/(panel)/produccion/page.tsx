import type { Metadata } from "next";
import Link from "next/link";
import { getOperator } from "@/lib/gestion/server";
import { limaDateTime } from "@/lib/gestion/dates";
import { formatQuantity } from "@/lib/produccion/plan";
import { formatDateShort } from "@/lib/delivery";
import { AutoRefresh } from "@/components/admin/AutoRefresh";
import { EmptyState, Notice, PageHeader, Section, StatCard, StatusPill } from "@/components/admin/ui";

export const metadata: Metadata = { title: "Producción" };
export const dynamic = "force-dynamic";

const BATCH_STATUS = {
  open: { label: "En curso", tone: "warn" },
  done: { label: "Terminada", tone: "ok" },
  cancelled: { label: "Cancelada", tone: "muted" },
} as const;

type BatchRow = {
  id: string;
  number: number;
  for_date: string;
  status: keyof typeof BATCH_STATUS;
  created_at: string;
  closed_at: string | null;
  production_batch_targets: { quantity: number; articles: { description: string } | null }[];
  production_tasks: { status: string; rejected_quantity: number | null; rework_of: string | null }[];
};

const BATCH_SELECT =
  "id, number, for_date, status, created_at, closed_at, production_batch_targets(quantity, articles(description)), production_tasks(status, rejected_quantity, rework_of)";

export default async function ProductionPage() {
  const op = await getOperator();
  if (!op) return <Notice tone="bad">Sesión expirada. Vuelve a entrar.</Notice>;
  const { db } = op;

  const [openRes, closedRes, balanceRes] = await Promise.all([
    db.from("production_batches").select(BATCH_SELECT).eq("status", "open").order("for_date").order("number").limit(100),
    db.from("production_batches").select(BATCH_SELECT).neq("status", "open").order("closed_at", { ascending: false }).limit(15),
    db.from("article_balances").select("article_code, quantity").is("store_id", null).gt("quantity", 0).limit(500),
  ]);

  const open = (openRes.data ?? []) as unknown as BatchRow[];
  const closed = (closedRes.data ?? []) as unknown as BatchRow[];
  const pendingTasks = open.reduce((sum, b) => sum + b.production_tasks.filter((t) => t.status === "pending").length, 0);
  const reworks = open.reduce((sum, b) => sum + b.production_tasks.filter((t) => t.status === "pending" && t.rework_of).length, 0);

  /* Matéria-prima ainda não tem inventário inicial, então o saldo dela não diz
     nada. O que interessa aqui é o que o taller já fez e pode aproveitar. */
  const codes = (balanceRes.data ?? []).map((row) => row.article_code as string);
  const { data: articleRows } = codes.length
    ? await db.from("articles").select("code, description, recipe_unit").eq("type", "PI").in("code", codes.slice(0, 150))
    : { data: [] as { code: string; description: string; recipe_unit: string | null }[] };
  const quantities = new Map((balanceRes.data ?? []).map((row) => [row.article_code as string, Number(row.quantity)]));
  const leftovers = (articleRows ?? []).sort((a, b) => a.description.localeCompare(b.description));

  return (
    <div className="space-y-6">
      <AutoRefresh everyMs={15_000} />

      <PageHeader
        title="Producción"
        description="Órdenes del taller: qué falta en cada etapa, qué se perdió y qué hay que rehacer."
        actions={
          <Link href="/admin/produccion/nueva" className="inline-flex h-11 items-center justify-center rounded-full bg-dorado px-5 text-sm font-semibold text-cacao transition-colors hover:bg-dorado-600">
            Nueva orden
          </Link>
        }
      />

      {(openRes.error || closedRes.error) && <Notice tone="bad">No se pudo cargar todo. La pantalla vuelve a intentar sola en unos segundos.</Notice>}

      <ul className="grid grid-cols-3 gap-3">
        <StatCard label="Órdenes en curso" value={open.length} />
        <StatCard label="Etapas pendientes" value={pendingTasks} />
        <StatCard label="Por rehacer" value={reworks} tone={reworks ? "warn" : undefined} />
      </ul>

      <Section title="En curso">
        {open.length === 0 ? <EmptyState>No hay órdenes en curso.</EmptyState> : <BatchList batches={open} />}
      </Section>

      <Section title="Intermedios en el taller" aside="Se aprovechan en la próxima orden">
        {leftovers.length === 0 ? (
          <EmptyState>Todavía no hay intermedios guardados.</EmptyState>
        ) : (
          <ul className="divide-y divide-crema-200">
            {leftovers.map((article) => (
              <li key={article.code} className="flex justify-between gap-3 px-4 py-2 text-sm sm:px-5">
                <span className="text-cacao-700">{article.description}</span>
                <span className="shrink-0 tabular-nums font-medium text-cacao">
                  {formatQuantity(quantities.get(article.code) ?? 0)} {article.recipe_unit}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Últimas cerradas" aside="Últimas 15">
        {closed.length === 0 ? <EmptyState>Todavía no hay órdenes cerradas.</EmptyState> : <BatchList batches={closed} />}
      </Section>
    </div>
  );
}

function BatchList({ batches }: { batches: BatchRow[] }) {
  return (
    <ul className="divide-y divide-crema-200">
      {batches.map((batch) => {
        const live = batch.production_tasks.filter((t) => t.status !== "cancelled");
        const done = live.filter((t) => t.status === "done").length;
        const lost = batch.production_tasks.some((t) => Number(t.rejected_quantity ?? 0) > 0);
        const summary = batch.production_batch_targets.map((t) => `${formatQuantity(Number(t.quantity))} ${t.articles?.description ?? ""}`).join(" · ");
        return (
          <li key={batch.id}>
            <Link href={`/admin/produccion/${batch.id}`} className="block space-y-1 px-4 py-3 transition-colors hover:bg-crema-100 sm:px-5">
              <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-semibold text-cacao">Orden #{batch.number}</span>
                <span className="text-[13px] text-cacao-500">{formatDateShort(batch.for_date)}</span>
                <span className="text-[13px] text-cacao-500">
                  {done} de {live.length} etapas
                </span>
                {lost && <span className="text-[13px] font-semibold text-terracota-700">Con pérdidas</span>}
                <span className="ml-auto">
                  <StatusPill status={batch.status} map={BATCH_STATUS} />
                </span>
              </span>
              <span className="block text-sm text-cacao-700">{summary}</span>
              {batch.closed_at && <span className="block text-[12px] text-cacao-300">Cerrada {limaDateTime(batch.closed_at)}</span>}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
