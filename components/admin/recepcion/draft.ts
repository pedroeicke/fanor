/**
 * Rascunho da conferência de um despacho, guardado no sessionStorage.
 *
 * A vendedora confere com o celular na mão, entre um cliente e outro. Se a
 * tela bloquear ou o navegador recarregar a aba no meio, as tortas que ela
 * já marcou não podem sumir — recomeçar a contagem é o convite para marcar
 * "tudo" sem olhar.
 *
 * O sessionStorage não pertence ao React: a leitura passa por
 * `useSyncExternalStore` (servidor e hidratação veem vazio, o cliente vê o
 * rascunho logo depois), sem `useEffect` + `setState` em cascata.
 *
 * Existe cópia em memória porque há navegador que recusa o storage (aba
 * anônima antiga do Safari): a conferência continua funcionando, só não
 * sobrevive ao recarregar.
 */

export type ReceptionDraft = {
  checked: string[];
  /** Quantidade digitada por linha, como texto — o campo pode estar vazio no meio da edição. */
  qty: Record<string, string>;
  notes: string;
};

const EMPTY_DRAFT: ReceptionDraft = { checked: [], qty: {}, notes: "" };

const memory = new Map<string, string>();
const listeners = new Set<() => void>();

export function draftKey(dispatchId: string) {
  return `fanor:recepcion:${dispatchId}`;
}

export function subscribeDraft(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function readDraftRaw(key: string) {
  const cached = memory.get(key);
  if (cached !== undefined) return cached;
  try {
    return window.sessionStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function notify() {
  listeners.forEach((listener) => listener());
}

export function writeDraft(key: string, draft: ReceptionDraft) {
  const raw = JSON.stringify(draft);
  memory.set(key, raw);
  try {
    window.sessionStorage.setItem(key, raw);
  } catch {
    /* Storage cheio ou bloqueado: a memória segura até recarregar. */
  }
  notify();
}

export function clearDraft(key: string) {
  memory.set(key, "");
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    /* Nada a limpar. */
  }
  notify();
}

/**
 * Texto guardado → rascunho válido para ESTE despacho.
 *
 * Filtra pelo que existe agora: uma série que não é do despacho, ou uma
 * linha que sumiu, não pode ir parar no envio.
 */
export function parseDraft(raw: string, serials: ReadonlySet<string>, lineIds: ReadonlySet<string>): ReceptionDraft {
  if (!raw) return EMPTY_DRAFT;
  try {
    const value = JSON.parse(raw) as Partial<ReceptionDraft> | null;
    if (!value || typeof value !== "object") return EMPTY_DRAFT;
    const checked = Array.isArray(value.checked)
      ? [...new Set(value.checked.filter((s): s is string => typeof s === "string" && serials.has(s)))]
      : [];
    const qty: Record<string, string> = {};
    if (value.qty && typeof value.qty === "object") {
      for (const [id, q] of Object.entries(value.qty)) {
        if (lineIds.has(id) && typeof q === "string") qty[id] = q.slice(0, 12);
      }
    }
    const notes = typeof value.notes === "string" ? value.notes : "";
    return { checked, qty, notes };
  } catch {
    return EMPTY_DRAFT;
  }
}
