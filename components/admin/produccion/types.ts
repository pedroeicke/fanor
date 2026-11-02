export const TARGETS_MAX = 40;
export const QUANTITY_MAX = 5000;
export const NOTES_MAX = 500;
export const REASON_MAX = 200;
export const SEARCH_MIN = 2;

export const STAGE_LABEL: Record<string, string> = {
  preparados: "Preparados",
  batidas: "Batidas",
  horno: "Horno",
  empate: "Empate",
  decoracion: "Decoración",
  porcion: "Porciones",
};

export type ArticleOption = {
  code: string;
  description: string;
  unit: string | null;
  stage: string;
};

/** Um formato que a batida pode virar: 1 batida rinde 12 cakes de 26. */
export type BatidaFormat = ArticleOption & { perBatida: number };

export type TargetDraft = ArticleOption & { quantity: number };

export type DemandOrder = {
  id: string;
  number: number;
  store: string;
  forDate: string;
  lines: { name: string; pending: number }[];
};

export type PreviewInput = {
  code: string;
  description: string;
  quantity: number;
  unit: string | null;
};

export type PreviewTask = {
  code: string;
  description: string;
  stage: string;
  quantity: number;
  unit: string | null;
  /** Fração da fórmula inteira. Na batida, é o que a tela mostra. */
  factor: number;
  inputs: PreviewInput[];
};

export type PlanPreview = {
  tasks: PreviewTask[];
  rawMaterials: (PreviewInput & { stockHint: string | null })[];
  fromStock: PreviewInput[];
  warnings: string[];
};

export type OrderInput = {
  targets: { code: string; quantity: number }[];
  useStock: boolean;
  fullBatchPreparados: boolean;
  forDate: string;
  notes: string;
  demandOrderIds: string[];
};

export type CheckoutTaskInput = {
  taskId: string;
  approved: number;
  rejected: number;
  reason: string;
  notes: string;
  rework: boolean;
  /** Decoração reprovada: decora de novo a mesma torta, sem refazer empate e cake. */
  sameCore: boolean;
  /** Quantidade na unidade mostrada na tela; a ação converte. */
  inputs: { id: string; actual: number; justification: string }[];
};
