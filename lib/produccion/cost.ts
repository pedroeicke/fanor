/**
 * Custo direto: fórmula × custo dos insumos, sem acesso ao banco.
 *
 * Matéria-prima custa o preço de estoque dividido pelo fator: um balde de 20.000 ml
 * a S/ 180 são S/ 0,009 por ml. O que tem fórmula custa a soma das linhas dividida
 * pelo que a fórmula rende.
 *
 * Separar o ovo gera gema e clara na mesma fórmula, então a divisão entra pelo peso
 * das duas saídas. O rateio 45/55 da conversa com o Joseka ainda não foi confirmado.
 *
 * Insumo sem custo soma zero e fica listado: mostrar um total parcial como se fosse
 * o custo real seria pior que não mostrar nada.
 */

import type { PlanArticle, PlanGraph } from "@/lib/produccion/plan";

export type CostLine = {
  code: string;
  description: string;
  quantity: number;
  unit: string | null;
  /** Soles por unidade de receita. Null quando falta custo. */
  unitCost: number | null;
  total: number;
  /** Algum insumo abaixo desta linha está sem custo. */
  incomplete: boolean;
};

export type DirectCost = {
  code: string;
  /** Soles por unidade de receita da saída. */
  unitCost: number;
  yield: number;
  lines: CostLine[];
  /** Matérias-primas sem custo em qualquer nível da fórmula. */
  missing: { code: string; description: string }[];
  complete: boolean;
  /** Parte do custo foi dividida com um subproduto. */
  jointWith: string | null;
};

type Node = { unitCost: number; missing: Map<string, string> };

function leafCost(article: PlanArticle | undefined) {
  /* Zero vale: a água não custa nada. Só o vazio é falta de custo. */
  if (article?.cost === null || article?.cost === undefined) return null;
  return article.cost / (article.conversionFactor && article.conversionFactor > 0 ? article.conversionFactor : 1);
}

function nodeCost(graph: PlanGraph, code: string, memo: Map<string, Node>, open: Set<string>): Node {
  const known = memo.get(code);
  if (known) return known;

  const article = graph.articles.get(code);
  const formula = graph.formulas.get(code);
  const missing = new Map<string, string>();

  /* Fórmula em ciclo não tem custo possível: fica como faltante, sem travar a conta. */
  if (!formula || open.has(code)) {
    const unitCost = leafCost(article);
    if (unitCost === null) missing.set(code, article?.description ?? code);
    const node = { unitCost: unitCost ?? 0, missing };
    if (!open.has(code)) memo.set(code, node);
    return node;
  }

  open.add(code);
  let total = 0;
  for (const line of formula.lines) {
    const child = nodeCost(graph, line.articleCode, memo, open);
    total += child.unitCost * line.quantity;
    for (const [key, value] of child.missing) missing.set(key, value);
  }
  open.delete(code);

  const node = { unitCost: total / (formula.batchYield + (formula.byproductQuantity ?? 0)), missing };
  memo.set(code, node);
  return node;
}

/** Null quando o artigo não tem fórmula. */
export function directCost(graph: PlanGraph, code: string): DirectCost | null {
  const formula = graph.formulas.get(code);
  if (!formula) return null;

  const memo = new Map<string, Node>();
  const root = nodeCost(graph, code, memo, new Set());
  const lines: CostLine[] = formula.lines.map((line) => {
    const child = nodeCost(graph, line.articleCode, memo, new Set());
    const article = graph.articles.get(line.articleCode);
    return {
      code: line.articleCode,
      description: article?.description ?? line.articleCode,
      quantity: line.quantity,
      unit: article?.recipeUnit ?? null,
      unitCost: child.missing.has(line.articleCode) ? null : child.unitCost,
      total: child.unitCost * line.quantity,
      incomplete: child.missing.size > 0,
    };
  });

  return {
    code,
    unitCost: root.unitCost,
    yield: formula.batchYield,
    lines: lines.sort((a, b) => b.total - a.total),
    missing: [...root.missing].map(([key, description]) => ({ code: key, description })).sort((a, b) => a.description.localeCompare(b.description, "es")),
    complete: root.missing.size === 0,
    jointWith: formula.byproductCode,
  };
}
