"use server";

import { revalidatePath } from "next/cache";
import { getOperator, runOp, type ActionResult } from "@/lib/gestion/server";
import { buildPlan, isCountableOutput, missingToRework, withoutCore, type PlanGraph, type PlanResult } from "@/lib/produccion/plan";
import { closeStageAsPlanned, loadFreeBalances, loadPlanGraph, tasksForDb } from "@/lib/produccion/server";
import { cleanText, isUuid } from "@/components/admin/pedidos-tienda/catalog";
import {
  NOTES_MAX,
  QUANTITY_MAX,
  REASON_MAX,
  SEARCH_MIN,
  TARGETS_MAX,
  type ArticleOption,
  type BatidaFormat,
  type CheckoutTaskInput,
  type OrderInput,
  type PlanPreview,
} from "@/components/admin/produccion/types";

/**
 * Ações da produção. O plano é sempre recalculado aqui, a partir do banco: o
 * navegador só diz o que quer produzir, nunca quanto de cada insumo.
 */

const SESSION_EXPIRED = "Sesión expirada. Vuelve a entrar.";
const LOAD_FAILED = "No se pudo calcular. Inténtalo de nuevo.";

function revalidateFlow(batchId?: string) {
  revalidatePath("/admin/produccion");
  if (batchId) revalidatePath(`/admin/produccion/${batchId}`);
}

type Target = { code: string; quantity: number };

function cleanTargets(raw: unknown): Target[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > TARGETS_MAX) return null;
  const merged = new Map<string, number>();
  for (const item of raw as { code?: unknown; quantity?: unknown }[]) {
    const quantity = Number(item?.quantity);
    if (typeof item?.code !== "string" || !Number.isFinite(quantity) || quantity <= 0 || quantity > QUANTITY_MAX) return null;
    merged.set(item.code, (merged.get(item.code) ?? 0) + quantity);
  }
  return [...merged].map(([code, quantity]) => ({ code, quantity }));
}

async function computePlan(db: Parameters<typeof loadPlanGraph>[0], targets: Target[], useStock: boolean, fullBatchPreparados: boolean) {
  const graph = await loadPlanGraph(db, targets.map((t) => t.code));
  const balances = useStock ? await loadFreeBalances(db, [...graph.formulas.keys()]) : new Map<string, number>();
  return { graph, plan: buildPlan(graph, targets, balances, { fullBatchPreparados }) };
}

function toPreview(graph: PlanGraph, plan: PlanResult): PlanPreview {
  const named = (code: string) => graph.articles.get(code);
  return {
    tasks: plan.tasks.map((task) => ({
      code: task.articleCode,
      description: named(task.articleCode)?.description ?? task.articleCode,
      stage: task.stage,
      quantity: task.plannedQuantity,
      unit: named(task.articleCode)?.recipeUnit ?? null,
      factor: task.formulaFactor,
      inputs: task.inputs.map((input) => ({
        code: input.articleCode,
        description: named(input.articleCode)?.description ?? input.articleCode,
        quantity: input.plannedQuantity / input.displayFactor,
        unit: input.displayUnit,
      })),
    })),
    rawMaterials: plan.rawMaterials.map(({ articleCode, quantity }) => {
      const article = named(articleCode);
      const factor = article?.conversionFactor;
      /* O almacén conta ovo por unidade mesmo quando a receita pesa. */
      const counted = article?.stockUnit === "un." && article.recipeUnit !== "un." && factor;
      return {
        code: articleCode,
        description: article?.description ?? articleCode,
        quantity,
        unit: article?.recipeUnit ?? null,
        stockHint: counted ? `≈ ${Math.ceil(quantity / factor)} un.` : null,
      };
    }),
    fromStock: plan.fromStock.map(({ articleCode, quantity }) => ({
      code: articleCode,
      description: named(articleCode)?.description ?? articleCode,
      quantity,
      unit: named(articleCode)?.recipeUnit ?? null,
    })),
    warnings: plan.warnings,
  };
}

/** Busca o que pode ser produzido. Cada palavra precisa aparecer no código ou na descrição. */
export async function searchProducible(query: string): Promise<ActionResult<ArticleOption[]>> {
  const op = await getOperator();
  if (!op) return { ok: false, error: SESSION_EXPIRED };

  /* Vírgula e parêntese têm significado no filtro `or` do PostgREST. */
  const words = String(query ?? "").replace(/[%,()*"\\]/g, " ").trim().split(/\s+/).filter(Boolean).slice(0, 5);
  if (words.join("").length < SEARCH_MIN) return { ok: true, data: [] };

  let request = op.db
    .from("formulas")
    .select("stage, articles!formulas_output_code_fkey!inner(code, description, recipe_unit)")
    .eq("active", true)
    .neq("stage", "porcion");
  for (const word of words) {
    request = request.or(`code.ilike.%${word}%,description.ilike.%${word}%`, { referencedTable: "articles" });
  }
  const { data, error } = await request.limit(25);
  if (error) {
    console.error("[produccion] busca", error.message);
    return { ok: false, error: "No se pudo buscar. Inténtalo de nuevo." };
  }
  type Row = { stage: string; articles: { code: string; description: string; recipe_unit: string | null } };
  return {
    ok: true,
    data: ((data ?? []) as unknown as Row[]).map((row) => ({
      code: row.articles.code,
      description: row.articles.description,
      unit: row.articles.recipe_unit,
      stage: row.stage,
    })),
  };
}

/** Formatos de uma batida, com quantos rende cada um. */
export async function listBatidaFormats(batidaCode: string): Promise<ActionResult<BatidaFormat[]>> {
  const op = await getOperator();
  if (!op) return { ok: false, error: SESSION_EXPIRED };

  const { data, error } = await op.db
    .from("formula_lines")
    .select("quantity, formulas!inner(stage, active, batch_yield, articles!formulas_output_code_fkey(code, description, recipe_unit))")
    .eq("article_code", batidaCode)
    .eq("formulas.active", true);
  if (error) {
    console.error("[produccion] formatos", error.message);
    return { ok: false, error: "No se pudo cargar los formatos." };
  }
  type Row = {
    quantity: number;
    formulas: { stage: string; batch_yield: number; articles: { code: string; description: string; recipe_unit: string | null } };
  };
  const formats = ((data ?? []) as unknown as Row[])
    .map((row) => ({
      code: row.formulas.articles.code,
      description: row.formulas.articles.description,
      unit: row.formulas.articles.recipe_unit,
      stage: row.formulas.stage,
      perBatida: Number(row.formulas.batch_yield) / Number(row.quantity),
    }))
    .sort((a, b) => a.description.localeCompare(b.description));
  return { ok: true, data: formats };
}

export async function previewPlan(input: { targets: Target[]; useStock: boolean; fullBatchPreparados: boolean }): Promise<ActionResult<PlanPreview>> {
  const op = await getOperator();
  if (!op) return { ok: false, error: SESSION_EXPIRED };
  const targets = cleanTargets(input?.targets);
  if (!targets) return { ok: false, error: "Revisa las cantidades." };
  try {
    const { graph, plan } = await computePlan(op.db, targets, input.useStock === true, input.fullBatchPreparados === true);
    return { ok: true, data: toPreview(graph, plan) };
  } catch (error) {
    console.error(error);
    return { ok: false, error: LOAD_FAILED };
  }
}

export async function createOrder(input: OrderInput): Promise<ActionResult<{ id: string; number: number }>> {
  const op = await getOperator();
  if (!op) return { ok: false, error: SESSION_EXPIRED };

  const targets = cleanTargets(input?.targets);
  if (!targets) return { ok: false, error: "Revisa las cantidades de la orden." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(input.forDate))) return { ok: false, error: "Fecha inválida." };
  const demand = Array.isArray(input.demandOrderIds) ? input.demandOrderIds : [];
  if (!demand.every(isUuid)) return { ok: false, error: "Hay un pedido inválido." };

  let plan: PlanResult;
  try {
    ({ plan } = await computePlan(op.db, targets, input.useStock === true, input.fullBatchPreparados === true));
  } catch (error) {
    console.error(error);
    return { ok: false, error: LOAD_FAILED };
  }
  if (plan.tasks.length === 0) return { ok: false, error: "Nada de esta lista tiene fórmula para producir." };
  if (plan.tasks.some((task) => task.stage === "porcion")) return { ok: false, error: "Las porciones se generan en la tienda, no aquí." };

  const result = await runOp<{ id: string; number: number }>("op_production_create", {
    p_for_date: input.forDate,
    p_notes: cleanText(input.notes, NOTES_MAX),
    p_demand: demand,
    p_targets: targets.map((t) => ({ article_code: t.code, quantity: t.quantity })),
    p_tasks: tasksForDb(plan.tasks),
  });
  if (!result.ok) return result;

  revalidateFlow();
  return { ok: true, data: { id: result.data.id, number: Number(result.data.number) } };
}

export async function checkoutTask(input: CheckoutTaskInput): Promise<ActionResult<{ reworkTasks: number; batchDone: boolean }>> {
  const op = await getOperator();
  if (!op) return { ok: false, error: SESSION_EXPIRED };
  if (!isUuid(input?.taskId)) return { ok: false, error: "Tarea inválida." };

  const approved = Number(input.approved);
  const rejected = Number(input.rejected);
  if (!Number.isFinite(approved) || !Number.isFinite(rejected) || approved < 0 || rejected < 0 || approved > QUANTITY_MAX * 1000 || rejected > QUANTITY_MAX * 1000) {
    return { ok: false, error: "Revisa las cantidades." };
  }

  const { data: taskRow, error: taskError } = await op.db
    .from("production_tasks")
    .select("id, batch_id, stage, article_code, planned_quantity, formula_id, articles(recipe_unit), production_task_inputs(id, article_code, display_factor), formulas(batch_yield, byproduct_code, byproduct_quantity)")
    .eq("id", input.taskId)
    .maybeSingle();
  if (taskError || !taskRow) return { ok: false, error: "Tarea no encontrada." };
  const task = taskRow as unknown as {
    id: string;
    batch_id: string;
    stage: string;
    article_code: string;
    planned_quantity: number;
    articles: { recipe_unit: string | null } | null;
    production_task_inputs: { id: string; article_code: string; display_factor: number }[];
    formulas: { batch_yield: number; byproduct_code: string | null; byproduct_quantity: number | null } | null;
  };

  if (isCountableOutput(task.stage, task.articles?.recipe_unit ?? null) && (!Number.isInteger(approved) || !Number.isInteger(rejected))) {
    return { ok: false, error: "Este producto se cuenta entero: no puede salir una fracción." };
  }

  const sent = new Map((Array.isArray(input.inputs) ? input.inputs : []).map((row) => [row?.id, row]));
  const inputs: { id: string; actual_quantity: number; justification: string | null }[] = [];
  const consumed = new Map<string, number>();
  for (const row of task.production_task_inputs) {
    const value = Number(sent.get(row.id)?.actual);
    if (!Number.isFinite(value) || value < 0) return { ok: false, error: "Falta confirmar lo que se usó." };
    /* A tela fala em ovos; o razão guarda gramas. */
    const actual = value * Number(row.display_factor);
    inputs.push({ id: row.id, actual_quantity: actual, justification: cleanText(sent.get(row.id)?.justification, REASON_MAX) });
    consumed.set(row.article_code, (consumed.get(row.article_code) ?? 0) + actual);
  }

  /* A refação desce pelas fórmulas e aproveita o que sobrou no taller. Por isso
     o saldo aqui já desconta o que este checkout vai gravar. */
  const missing = missingToRework(Number(task.planned_quantity), approved);
  let rework: ReturnType<typeof tasksForDb> = [];
  if (input.rework === true && missing > 0) {
    try {
      const full = await loadPlanGraph(op.db, [task.article_code]);
      const graph = input.sameCore === true && task.stage === "decoracion" ? withoutCore(full, task.article_code) : full;
      const balances = await loadFreeBalances(op.db, [...full.formulas.keys()], task.id);
      for (const [code, used] of consumed) balances.set(code, (balances.get(code) ?? 0) - used);
      balances.set(task.article_code, (balances.get(task.article_code) ?? 0) + approved);
      const by = task.formulas;
      if (by?.byproduct_code && by.byproduct_quantity) {
        balances.set(by.byproduct_code, (balances.get(by.byproduct_code) ?? 0) + (approved * Number(by.byproduct_quantity)) / Number(by.batch_yield));
      }
      rework = tasksForDb(buildPlan(graph, [{ code: task.article_code, quantity: missing }], balances).tasks);
    } catch (error) {
      console.error(error);
      return { ok: false, error: "No se pudo calcular lo que hay que rehacer. Inténtalo de nuevo." };
    }
  }

  const result = await runOp<{ rework_tasks: number; batch_done: boolean }>("op_production_checkout", {
    p_task: task.id,
    p_approved: approved,
    p_rejected: rejected,
    p_reason: cleanText(input.reason, REASON_MAX),
    p_notes: cleanText(input.notes, NOTES_MAX),
    p_inputs: inputs,
    p_rework: rework,
  });
  if (!result.ok) return result;

  revalidateFlow(task.batch_id);
  return { ok: true, data: { reworkTasks: Number(result.data.rework_tasks), batchDone: result.data.batch_done === true } };
}

/** Fecha as etapas de uma área como previstas. O texto de confirmação não é usado. */
export async function closeStage(batchId: string, stage: string): Promise<ActionResult<{ closed: number; skipped: number }>> {
  const op = await getOperator();
  if (!op) return { ok: false, error: SESSION_EXPIRED };
  if (!isUuid(batchId) || typeof stage !== "string") return { ok: false, error: "Orden inválida." };

  try {
    const result = await closeStageAsPlanned(op.db, batchId, stage);
    revalidateFlow(batchId);
    if (result.closed === 0) return { ok: false, error: "Ninguna etapa se pudo cerrar así. Ciérralas una por una." };
    return { ok: true, data: result };
  } catch (error) {
    console.error(error);
    return { ok: false, error: "No se pudo cerrar. Inténtalo de nuevo." };
  }
}

export async function cancelOrder(batchId: string, reason: string): Promise<ActionResult> {
  const op = await getOperator();
  if (!op) return { ok: false, error: SESSION_EXPIRED };
  if (!isUuid(batchId)) return { ok: false, error: "Orden inválida." };
  const why = cleanText(reason, REASON_MAX);
  if (!why || why.length < 3) return { ok: false, error: "Indica por qué se cancela la orden." };

  const result = await runOp("op_production_cancel", { p_batch: batchId, p_reason: why });
  if (!result.ok) return result;

  revalidateFlow(batchId);
  return { ok: true, data: undefined };
}
