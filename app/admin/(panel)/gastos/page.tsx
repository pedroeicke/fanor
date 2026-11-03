import type { Metadata } from "next";
import Link from "next/link";
import { addDays, limaToday } from "@/lib/gestion/dates";
import { getOperator, shortStoreName } from "@/lib/gestion/server";
import { formatDateShort } from "@/lib/delivery";
import { soles } from "@/lib/format";
import { EmptyState, Notice, PageHeader, Section, StatCard } from "@/components/admin/ui";
import { ExpenseBoard, type ExpenseRow } from "@/components/admin/gastos/ExpenseBoard";

export const metadata: Metadata = { title: "Gastos" };
export const dynamic = "force-dynamic";

/**
 * Gastos administrativos, de uma usuária só. Serve para lançar todo dia e ver se
 * está em dia. Se isto alimenta o rateio de custos ainda é dúvida com o Joseka.
 */

type Row = {
  id: string;
  spent_on: string;
  article_code: string;
  amount: number;
  store_id: string | null;
  document: string | null;
  notes: string | null;
  voided_at: string | null;
  void_reason: string | null;
  articles: { description: string } | null;
  stores: { name: string } | null;
};

const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

function shiftMonth(month: string, delta: number) {
  const [year, m] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, m - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function clock() {
  return limaToday();
}

export default async function ExpensesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const op = await getOperator();
  if (!op) return <Notice tone="bad">Sesión expirada. Vuelve a entrar.</Notice>;
  const { db } = op;

  const today = clock();
  const current = today.slice(0, 7);
  const asked = (await searchParams).mes;
  const month = typeof asked === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(asked) && asked <= current ? asked : current;
  const from = `${month}-01`;
  const until = `${shiftMonth(month, 1)}-01`;
  const weekAgo = addDays(today, -6);

  const [monthRes, conceptsRes, storesRes, weekRes, lastRes] = await Promise.all([
    db
      .from("expenses")
      .select("id, spent_on, article_code, amount, store_id, document, notes, voided_at, void_reason, articles(description), stores(name)")
      .gte("spent_on", from)
      .lt("spent_on", until)
      .order("spent_on", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1000),
    db.from("articles").select("code, description, type").in("type", ["CS", "SV"]).eq("active", true).order("description"),
    db.from("stores").select("id, name").eq("active", true).order("sort_order"),
    db.from("expenses").select("spent_on").is("voided_at", null).gte("spent_on", weekAgo).lte("spent_on", today),
    db.from("expenses").select("spent_on").is("voided_at", null).order("spent_on", { ascending: false }).limit(1).maybeSingle(),
  ]);

  const data = (monthRes.data ?? []) as unknown as Row[];
  const rows: ExpenseRow[] = data.map((row) => ({
    id: row.id,
    spentOn: row.spent_on,
    code: row.article_code,
    concept: row.articles?.description ?? row.article_code,
    amount: Number(row.amount),
    storeId: row.store_id ?? "",
    storeName: row.stores ? shortStoreName(row.stores.name) : null,
    document: row.document ?? "",
    notes: row.notes ?? "",
    voided: Boolean(row.voided_at),
    voidReason: row.void_reason,
  }));

  const live = rows.filter((row) => !row.voided);
  const total = live.reduce((sum, row) => sum + row.amount, 0);
  const days = new Set((weekRes.data ?? []).map((row) => row.spent_on as string));
  const missingDays = Array.from({ length: 7 }, (_, i) => addDays(today, -i)).filter((day) => !days.has(day)).length;
  const lastDay = (lastRes.data?.spent_on as string | undefined) ?? null;

  const byConcept = new Map<string, { concept: string; amount: number; count: number }>();
  for (const row of live) {
    const group = byConcept.get(row.code) ?? { concept: row.concept, amount: 0, count: 0 };
    group.amount += row.amount;
    group.count += 1;
    byConcept.set(row.code, group);
  }
  const summary = [...byConcept.values()].sort((a, b) => b.amount - a.amount);

  const [year, monthNumber] = month.split("-").map(Number);
  const monthName = `${MONTHS[monthNumber - 1]} ${year}`;
  const stores = (storesRes.data ?? []).map((s) => ({ id: s.id as string, name: shortStoreName(s.name as string) }));

  return (
    <div className="space-y-6">
      <PageHeader title="Gastos" description="Registra los gastos de cada día y corrígelos cuando haga falta. Solo esta cuenta y el dueño los ven." />

      {(monthRes.error || conceptsRes.error) && <Notice tone="bad">No se pudo cargar. Recarga la página.</Notice>}

      <div className="flex flex-wrap items-center gap-3">
        <Link href={`/admin/gastos?mes=${shiftMonth(month, -1)}`} className="inline-flex h-11 items-center rounded-full border border-crema-300 bg-white px-4 text-sm font-medium text-cacao-700 hover:border-cacao/35">
          ← Anterior
        </Link>
        <p className="font-semibold capitalize text-cacao">{monthName}</p>
        {month < current && (
          <Link href={`/admin/gastos?mes=${shiftMonth(month, 1)}`} className="inline-flex h-11 items-center rounded-full border border-crema-300 bg-white px-4 text-sm font-medium text-cacao-700 hover:border-cacao/35">
            Siguiente →
          </Link>
        )}
      </div>

      <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Total del mes" value={soles(total)} />
        <StatCard label="Registros" value={live.length} />
        <StatCard label="Último registro" value={lastDay ? formatDateShort(lastDay) : "Ninguno"} />
        <StatCard label="Días sin registro" value={missingDays} hint="Últimos 7 días" tone={missingDays ? "warn" : "ok"} />
      </ul>

      <ExpenseBoard rows={rows} concepts={(conceptsRes.data ?? []) as { code: string; description: string; type: string }[]} stores={stores} today={today} />

      <Section title="Por concepto" aside={monthName}>
        {summary.length === 0 ? (
          <EmptyState>Sin gastos para resumir.</EmptyState>
        ) : (
          <ul className="divide-y divide-crema-200">
            {summary.map((group) => (
              <li key={group.concept} className="flex justify-between gap-3 px-4 py-2.5 text-sm sm:px-5">
                <span className="min-w-0 text-cacao-700">
                  {group.concept}
                  <span className="text-cacao-300"> · {group.count}</span>
                </span>
                <span className="shrink-0 font-medium tabular-nums text-cacao">{soles(group.amount)}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
