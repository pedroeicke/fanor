import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { suggestedDisplayQuantity, type PlanArticle, type PlanFormula, type PlanGraph, type Stage } from "@/lib/produccion/plan";

/* `.in()` vai na URL: lista longa estoura o limite do servidor. */
const CHUNK = 150;

function chunks<T>(items: T[]) {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += CHUNK) out.push(items.slice(i, i + CHUNK));
  return out;
}

type FormulaRow = {
  id: string;
  output_code: string;
  stage: Stage;
  batch_yield: number;
  byproduct_code: string | null;
  byproduct_quantity: number | null;
  formula_lines: {
    article_code: string;
    quantity: number;
    source_quantity: number;
    source_unit: string | null;
    count_on_execution: boolean;
  }[];
};

type ArticleRow = {
  code: string;
  type: string;
  description: string;
  stock_unit: string | null;
  recipe_unit: string | null;
  conversion_factor: number | null;
  cost: number | null;
};

/**
 * Carrega só as fórmulas alcançáveis a partir dos códigos pedidos, descendo
 * nível a nível. São 1.000 fórmulas e 6.000 linhas no total; uma torta usa
 * algumas dezenas, e o PostgREST corta a resposta em 1.000 linhas de qualquer forma.
 */
export async function loadPlanGraph(db: SupabaseClient, roots: string[]): Promise<PlanGraph> {
  const formulas = new Map<string, PlanFormula>();
  const seen = new Set<string>(roots);
  let frontier = [...seen];

  while (frontier.length > 0) {
    const next = new Set<string>();
    for (const part of chunks(frontier)) {
      const { data, error } = await db
        .from("formulas")
        .select("id, output_code, stage, batch_yield, byproduct_code, byproduct_quantity, formula_lines(article_code, quantity, source_quantity, source_unit, count_on_execution)")
        .eq("active", true)
        .in("output_code", part);
      if (error) throw new Error(`[produccion] fórmulas: ${error.message}`);
      for (const row of (data ?? []) as unknown as FormulaRow[]) {
        formulas.set(row.output_code, {
          id: row.id,
          outputCode: row.output_code,
          stage: row.stage,
          batchYield: Number(row.batch_yield),
          byproductCode: row.byproduct_code,
          byproductQuantity: row.byproduct_quantity === null ? null : Number(row.byproduct_quantity),
          lines: row.formula_lines.map((line) => ({
            articleCode: line.article_code,
            quantity: Number(line.quantity),
            sourceQuantity: Number(line.source_quantity),
            sourceUnit: line.source_unit,
            countOnExecution: line.count_on_execution,
          })),
        });
        for (const line of row.formula_lines) {
          if (!seen.has(line.article_code)) {
            seen.add(line.article_code);
            next.add(line.article_code);
          }
        }
        /* A saída conjunta precisa estar no grafo para a tela mostrar o nome. */
        if (row.byproduct_code) seen.add(row.byproduct_code);
      }
    }
    frontier = [...next];
  }

  const articles = new Map<string, PlanArticle>();
  for (const part of chunks([...seen])) {
    const { data, error } = await db
      .from("articles")
      .select("code, type, description, stock_unit, recipe_unit, conversion_factor, cost")
      .in("code", part);
    if (error) throw new Error(`[produccion] artículos: ${error.message}`);
    for (const row of (data ?? []) as ArticleRow[]) {
      articles.set(row.code, {
        code: row.code,
        type: row.type,
        description: row.description,
        stockUnit: row.stock_unit,
        recipeUnit: row.recipe_unit,
        conversionFactor: row.conversion_factor === null ? null : Number(row.conversion_factor),
        cost: row.cost === null ? null : Number(row.cost),
      });
    }
  }

  return { articles, formulas };
}

/** Saldo no taller (`store_id` nulo). Sem inventário inicial, quase tudo está em zero. */
export async function loadWorkshopBalances(db: SupabaseClient, codes: string[]) {
  const balances = new Map<string, number>();
  for (const part of chunks(codes)) {
    const { data, error } = await db
      .from("article_balances")
      .select("article_code, quantity")
      .is("store_id", null)
      .in("article_code", part);
    if (error) throw new Error(`[produccion] saldos: ${error.message}`);
    for (const row of data ?? []) balances.set(row.article_code as string, Number(row.quantity));
  }
  return balances;
}

/** Saldo e última contagem ou compra num lugar. `storeId` nulo é o taller. */
export async function loadStockAt(db: SupabaseClient, codes: string[], storeId: string | null) {
  const balances = new Map<string, number>();
  const counted = new Map<string, string>();
  for (const part of chunks(codes)) {
    const balance = db.from("article_balances").select("article_code, quantity").in("article_code", part);
    const last = db.from("article_counted").select("article_code, last_at").in("article_code", part);
    const [balanceRes, lastRes] = await Promise.all([
      storeId ? balance.eq("store_id", storeId) : balance.is("store_id", null),
      storeId ? last.eq("store_id", storeId) : last.is("store_id", null),
    ]);
    if (balanceRes.error) throw new Error(`[insumos] saldos: ${balanceRes.error.message}`);
    if (lastRes.error) throw new Error(`[insumos] contagens: ${lastRes.error.message}`);
    for (const row of balanceRes.data ?? []) balances.set(row.article_code as string, Number(row.quantity));
    for (const row of lastRes.data ?? []) counted.set(row.article_code as string, row.last_at as string);
  }
  return { balances, counted };
}

export type ReadyCake = {
  code: string;
  description: string;
  /** Prontas e dentro do prazo: é o que o despacho pode levar. */
  quantity: number;
  /** Passaram do prazo no taller: só resta dar baixa. */
  expired: number;
  /** Validade mais próxima entre as que ainda valem. */
  expiresOn: string | null;
};

/**
 * Tortas decoradas que ainda não saíram do taller, por artigo. O saldo limita a
 * conta: torta que virou ingrediente de outra continua "aprovada" na etapa dela.
 */
export async function loadReadyCakes(db: SupabaseClient, today: string): Promise<ReadyCake[]> {
  const { data, error } = await db
    .from("production_ready")
    .select("article_code, description, quantity, expires_on")
    .order("expires_on")
    .limit(1000);
  if (error) throw new Error(`[produccion] listas: ${error.message}`);

  const groups = new Map<string, ReadyCake>();
  for (const row of data ?? []) {
    const code = row.article_code as string;
    const group = groups.get(code) ?? { code, description: row.description as string, quantity: 0, expired: 0, expiresOn: null };
    const quantity = Number(row.quantity);
    const expiresOn = row.expires_on as string;
    if (expiresOn < today) {
      group.expired += quantity;
    } else {
      group.quantity += quantity;
      if (!group.expiresOn || expiresOn < group.expiresOn) group.expiresOn = expiresOn;
    }
    groups.set(code, group);
  }

  const balances = await loadWorkshopBalances(db, [...groups.keys()]);
  const ready: ReadyCake[] = [];
  for (const group of groups.values()) {
    const balance = Math.max(0, Math.floor(balances.get(group.code) ?? 0));
    const quantity = Math.min(group.quantity, balance);
    const expired = Math.min(group.expired, balance - quantity);
    if (quantity + expired > 0) ready.push({ ...group, quantity, expired });
  }
  return ready.sort((a, b) => a.description.localeCompare(b.description, "es"));
}

/**
 * Saldo que ninguém prometeu ainda: o que está no taller menos o que as etapas
 * pendentes vão consumir. Sem isto, a batida feita para os cakes de hoje parecia
 * "sobra", e a refação ou outra ordem contava com a mesma massa.
 *
 * `exceptTask` é a etapa em checkout: o consumo dela entra pelo valor real.
 */
export async function loadFreeBalances(db: SupabaseClient, codes: string[], exceptTask?: string) {
  const free = await loadWorkshopBalances(db, codes);
  for (const part of chunks(codes)) {
    let request = db
      .from("production_task_inputs")
      .select("article_code, planned_quantity, production_tasks!inner(status)")
      .eq("production_tasks.status", "pending")
      .in("article_code", part);
    if (exceptTask) request = request.neq("task_id", exceptTask);
    const { data, error } = await request;
    if (error) throw new Error(`[produccion] reservas: ${error.message}`);
    for (const row of data ?? []) {
      const code = row.article_code as string;
      free.set(code, (free.get(code) ?? 0) - Number(row.planned_quantity));
    }
  }
  return free;
}

type PendingStageTask = {
  id: string;
  article_code: string;
  planned_quantity: number;
  requires: string[];
  production_task_inputs: {
    id: string;
    planned_quantity: number;
    display_unit: string | null;
    display_factor: number;
    count_on_execution: boolean;
    articles: { type: string } | null;
  }[];
};

/**
 * "Salió todo como estaba previsto": fecha de uma vez as etapas de uma área. Num
 * dia cheio são 58 etapas; fechar cake por cake sem nenhuma novidade não ajuda
 * ninguém. Fica de fora o que depende de quem executa: ovo contado, etapa ainda
 * travada e consumo sem saldo.
 */
export async function closeStageAsPlanned(db: SupabaseClient, batchId: string, stage: string) {
  let closed = 0;
  let skipped = 0;
  /* Dentro dos preparados um depende do outro: outra volta libera o seguinte. */
  for (let round = 0; round < 8; round++) {
    const { data, error } = await db
      .from("production_tasks")
      .select("id, article_code, planned_quantity, requires, production_task_inputs(id, planned_quantity, display_unit, display_factor, count_on_execution, articles(type))")
      .eq("batch_id", batchId)
      .eq("stage", stage)
      .eq("status", "pending");
    if (error) throw new Error(`[produccion] etapa: ${error.message}`);
    const pending = (data ?? []) as unknown as PendingStageTask[];
    skipped = 0;
    let moved = false;
    for (const task of pending) {
      if (task.production_task_inputs.some((input) => input.count_on_execution)) {
        skipped += 1;
        continue;
      }
      const inputs = task.production_task_inputs.map((input) => {
        const shown = suggestedDisplayQuantity(
          { plannedQuantity: Number(input.planned_quantity), displayUnit: input.display_unit, displayFactor: Number(input.display_factor) },
          input.articles?.type,
        );
        return { id: input.id, actual_quantity: shown * Number(input.display_factor), justification: null };
      });
      const { error: closeError } = await db.rpc("op_production_checkout", {
        p_task: task.id,
        p_approved: Number(task.planned_quantity),
        p_rejected: 0,
        p_reason: null,
        p_notes: null,
        p_inputs: inputs,
        p_rework: [],
      });
      if (closeError) {
        skipped += 1;
      } else {
        closed += 1;
        moved = true;
      }
    }
    if (!moved) break;
  }
  return { closed, skipped };
}

/** Tarefas do plano no formato que `op_production_create` e o checkout recebem. */
export function tasksForDb(tasks: import("@/lib/produccion/plan").PlanTask[]) {
  return tasks.map((task) => ({
    stage: task.stage,
    article_code: task.articleCode,
    formula_id: task.formulaId,
    planned_quantity: task.plannedQuantity,
    requires: task.requires,
    inputs: task.inputs.map((input) => ({
      article_code: input.articleCode,
      planned_quantity: input.plannedQuantity,
      display_unit: input.displayUnit,
      display_factor: input.displayFactor,
      count_on_execution: input.countOnExecution,
    })),
  }));
}
