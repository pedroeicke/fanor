/**
 * Cálculo de uma ordem de produção, sem acesso ao banco.
 *
 * A produção diz o que quer ("1 torta 26 e 2 pranchas") e a conta desce pelas
 * fórmulas até a matéria-prima: torta → empate → cake → batida → ovo, farinha.
 * Cada formato pede uma fração da mesma batida; as frações somam, e os
 * ingredientes da batida são multiplicados pelo total.
 *
 * A ordem do percurso importa: um artigo só é calculado depois de todos os que
 * o consomem, senão dois cakes pedindo a mesma batida gerariam duas batidas.
 */

export const STAGES = ["preparados", "batidas", "horno", "empate", "decoracion"] as const;
export type Stage = (typeof STAGES)[number] | "porcion";

export type PlanArticle = {
  code: string;
  type: string;
  description: string;
  stockUnit: string | null;
  recipeUnit: string | null;
  conversionFactor: number | null;
};

export type PlanLine = {
  articleCode: string;
  quantity: number;
  sourceQuantity: number;
  sourceUnit: string | null;
  countOnExecution: boolean;
};

export type PlanFormula = {
  id: string;
  outputCode: string;
  stage: Stage;
  batchYield: number;
  byproductCode: string | null;
  byproductQuantity: number | null;
  lines: PlanLine[];
};

export type PlanGraph = {
  articles: Map<string, PlanArticle>;
  formulas: Map<string, PlanFormula>;
};

export type PlanTarget = { code: string; quantity: number };

export type PlanInput = {
  articleCode: string;
  plannedQuantity: number;
  displayUnit: string | null;
  displayFactor: number;
  countOnExecution: boolean;
};

export type PlanTask = {
  articleCode: string;
  formulaId: string;
  stage: Stage;
  plannedQuantity: number;
  /** Fração da fórmula inteira: 0,4167 batida. */
  formulaFactor: number;
  requires: string[];
  inputs: PlanInput[];
};

export type PlanResult = {
  tasks: PlanTask[];
  /** Soma do que sai do almacén, na unidade de receita. */
  rawMaterials: { articleCode: string; quantity: number }[];
  /** Intermediário aproveitado do saldo, sem produzir de novo. */
  fromStock: { articleCode: string; quantity: number }[];
  warnings: string[];
};

/* Folga para ruído de ponto flutuante: 0,08333333 × 12 não pode virar 2 cakes. */
const EPSILON = 1e-6;

/* Abaixo disto é sobra de arredondamento, não material que alguém possa usar. */
export const STOCK_MIN = 0.001;
/* Digitar 0,99 em vez de 1 não é perda: não vale uma refação. */
const REWORK_MIN_SHARE = 0.02;

/** Batida e preparado por peso aceitam fração; cake, empate e torta saem inteiros. */
export function isCountableOutput(stage: string, recipeUnit: string | null) {
  return stage !== "batidas" && recipeUnit === "un.";
}

function isCountable(formula: PlanFormula, article: PlanArticle) {
  return isCountableOutput(formula.stage, article.recipeUnit);
}

/** Quanto falta de verdade para refazer. Zero quando a diferença é só digitação. */
export function missingToRework(planned: number, approved: number) {
  const missing = planned - approved;
  return missing > planned * REWORK_MIN_SHARE ? missing : 0;
}

/** O que a tela sugere em "salió bien": a conta dá 966,666667 e ninguém mede isso. */
export function suggestedOutput(planned: number) {
  const scale = Math.abs(planned) < 1 ? 10_000 : 100;
  return Math.round(planned * scale) / scale;
}

type GateTask = { id: string; article_code: string; status: string; requires: string[]; rework_of: string | null };

/**
 * O que ainda segura esta tarefa. A mesma regra de `op_production_checkout`: uma
 * refação só segura a própria refação e, quando repõe o artigo que se perdeu,
 * quem depende dele. A batida refeita para uma prancha não segura o outro cake.
 */
export function blockersOf<T extends GateTask>(task: GateTask, tasks: T[]) {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  return tasks.filter(
    (q) =>
      q.status === "pending" &&
      task.requires.includes(q.article_code) &&
      (!q.rework_of || q.rework_of === task.rework_of || byId.get(q.rework_of)?.article_code === q.article_code),
  );
}

function roundUp(value: number) {
  return Math.ceil(value - EPSILON);
}

/** Unidade em que a tela pergunta o consumo. Por peso de artigo contado, pergunta quantos ovos. */
function displayOf(line: PlanLine, article: PlanArticle | undefined) {
  if (line.countOnExecution && article?.conversionFactor) {
    return { displayUnit: article.stockUnit, displayFactor: article.conversionFactor };
  }
  const factor = line.sourceQuantity > 0 ? line.quantity / line.sourceQuantity : 1;
  return { displayUnit: line.sourceUnit ?? article?.recipeUnit ?? null, displayFactor: factor };
}

/** Ordem em que quem consome vem antes de quem é consumido. */
function consumersFirst(graph: PlanGraph, roots: string[]) {
  const seen = new Set<string>();
  const order: string[] = [];
  const open = new Set<string>();
  const visit = (code: string) => {
    if (seen.has(code)) return;
    if (open.has(code)) throw new Error(`Ciclo en las fórmulas: ${code}`);
    open.add(code);
    for (const line of graph.formulas.get(code)?.lines ?? []) visit(line.articleCode);
    open.delete(code);
    seen.add(code);
    order.push(code);
  };
  roots.forEach(visit);
  return order.reverse();
}

export function buildPlan(
  graph: PlanGraph,
  targets: PlanTarget[],
  /** Saldo livre de intermediários por código. Vazio para produzir tudo do zero. */
  available: Map<string, number> = new Map(),
  /** Preparado feito em lote inteiro: a sobra fica guardada para as próximas ordens. */
  options: { fullBatchPreparados?: boolean } = {},
): PlanResult {
  const warnings: string[] = [];
  const asked = new Map<string, number>();
  for (const target of targets) {
    if (!graph.formulas.has(target.code)) {
      warnings.push(`${graph.articles.get(target.code)?.description ?? target.code} no tiene fórmula.`);
      continue;
    }
    asked.set(target.code, (asked.get(target.code) ?? 0) + target.quantity);
  }

  const order = consumersFirst(graph, [...asked.keys()]);
  const needs = new Map<string, number>();
  const stock = new Map([...available].map(([code, quantity]) => [code, Math.max(0, quantity)]));
  const made = new Map<string, PlanTask>();
  const rawTotals = new Map<string, number>();
  const usedStock = new Map<string, number>();

  for (const code of order) {
    const formula = graph.formulas.get(code);
    const article = graph.articles.get(code);
    const need = needs.get(code) ?? 0;

    if (!formula || !article) {
      if (need > 0) {
        rawTotals.set(code, need);
        const description = article?.description ?? code;
        if (article?.type === "PI") warnings.push(`${description} es intermedio pero no tiene fórmula: sale del saldo.`);
        if (article?.type === "MP" && !article.recipeUnit) warnings.push(`${description} no tiene unidad.`);
      }
      continue;
    }

    /* O que a ordem pediu se produz sempre. Só o que uma etapa consome pode vir
       do saldo: se alguém pediu 3 cakes, são 3 cakes novos. */
    const inStock = stock.get(code) ?? 0;
    const taken = Math.min(inStock, need);
    if (taken > STOCK_MIN) {
      usedStock.set(code, taken);
      stock.set(code, inStock - taken);
    }
    let quantity = (asked.get(code) ?? 0) + Math.max(0, need - (taken > STOCK_MIN ? taken : 0));
    if (quantity <= STOCK_MIN) continue;
    if (options.fullBatchPreparados && formula.stage === "preparados") {
      quantity = roundUp(quantity / formula.batchYield) * formula.batchYield;
    } else if (isCountable(formula, article)) {
      quantity = roundUp(quantity);
    }

    const factor = quantity / formula.batchYield;
    const task: PlanTask = {
      articleCode: code,
      formulaId: formula.id,
      stage: formula.stage,
      plannedQuantity: quantity,
      formulaFactor: factor,
      requires: [],
      inputs: formula.lines.map((line) => {
        const child = graph.articles.get(line.articleCode);
        const planned = line.quantity * factor;
        needs.set(line.articleCode, (needs.get(line.articleCode) ?? 0) + planned);
        return { articleCode: line.articleCode, plannedQuantity: planned, countOnExecution: line.countOnExecution, ...displayOf(line, child) };
      }),
    };
    made.set(code, task);

    /* Separar ovo para a gema já gera a clara: quem precisar dela consome isso. */
    if (formula.byproductCode && formula.byproductQuantity) {
      stock.set(formula.byproductCode, (stock.get(formula.byproductCode) ?? 0) + formula.byproductQuantity * factor);
    }
  }

  const tasks = [...made.values()];
  /* Clara que vem da separação feita para a gema: quem usa a clara espera essa separação. */
  const byproductSource = new Map<string, string>();
  for (const task of tasks) {
    const by = graph.formulas.get(task.articleCode)?.byproductCode;
    if (by && !made.has(by)) byproductSource.set(by, task.articleCode);
  }
  for (const task of tasks) {
    const codes = task.inputs.map((input) => byproductSource.get(input.articleCode) ?? input.articleCode);
    task.requires = [...new Set(codes)].filter((child) => made.has(child));
  }
  /* Da primeira etapa do taller para a última, como a tela mostra. */
  const rank = (stage: Stage) => (STAGES as readonly string[]).indexOf(stage);
  const ordered = tasks.map((task, index) => ({ task, index })).sort((a, b) => rank(a.task.stage) - rank(b.task.stage) || a.index - b.index).map(({ task }) => task);

  return {
    tasks: ordered,
    rawMaterials: [...rawTotals].map(([articleCode, quantity]) => ({ articleCode, quantity })).sort((a, b) => a.articleCode.localeCompare(b.articleCode)),
    fromStock: [...usedStock].map(([articleCode, quantity]) => ({ articleCode, quantity })),
    warnings,
  };
}

type DisplayedInput = Pick<PlanInput, "plannedQuantity" | "displayUnit" | "displayFactor">;

/** Só matéria-prima contada arredonda: ninguém quebra dois terços de ovo, mas meio cake existe. */
function isWholeUnit(input: DisplayedInput, articleType: string | null | undefined) {
  return input.displayUnit === "un." && articleType === "MP";
}

/** Consumo pré-preenchido na unidade que a tela mostra. */
export function suggestedDisplayQuantity(input: DisplayedInput, articleType: string | null | undefined) {
  const shown = input.plannedQuantity / input.displayFactor;
  return isWholeUnit(input, articleType) ? roundUp(shown) : Math.round(shown * 10000) / 10000;
}

/** A mesma margem que `op_production_checkout` aplica; lá é onde vale. */
export function consumptionMargin(input: DisplayedInput, articleType: string | null | undefined, tolerancePct: number) {
  return Math.max(input.plannedQuantity * (tolerancePct / 100), isWholeUnit(input, articleType) ? input.displayFactor : 0);
}

export function isOutOfTolerance(input: DisplayedInput, articleType: string | null | undefined, actual: number, tolerancePct: number) {
  return Math.abs(actual - input.plannedQuantity) > consumptionMargin(input, articleType, tolerancePct) + EPSILON;
}

/**
 * Torta com decoração reprovada: limpa e decora de novo, sem refazer o miolo.
 * O empate já foi baixado no primeiro checkout e continua lá, então sai da fórmula.
 */
export function withoutCore(graph: PlanGraph, code: string): PlanGraph {
  const formula = graph.formulas.get(code);
  if (!formula) return graph;
  const lines = formula.lines.filter((line) => graph.formulas.get(line.articleCode)?.stage !== "empate");
  return { ...graph, formulas: new Map(graph.formulas).set(code, { ...formula, lines }) };
}

const quantityFormat = new Intl.NumberFormat("es-PE", { maximumFractionDigits: 2 });
const smallFormat = new Intl.NumberFormat("es-PE", { maximumFractionDigits: 4 });

export function formatQuantity(value: number) {
  return (Math.abs(value) < 1 ? smallFormat : quantityFormat).format(value);
}
