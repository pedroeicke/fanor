/**
 * Tipos e regras puras da tela de leads.
 *
 * Fica fora do `actions.ts` ("use server" só exporta função assíncrona) e fora
 * dos componentes de cliente, porque a página no servidor e o card no celular
 * precisam da mesma conta: o relógio do card e a métrica do relatório não
 * podem discordar sobre quanto tempo o lead esperou.
 */

export type LeadStatus = "new" | "assigned" | "contacted" | "won" | "lost";

export const OPEN_STATUSES: LeadStatus[] = ["new", "assigned", "contacted"];

export const LOST_REASONS = ["Precio", "No respondió", "Sin disponibilidad", "Compró en otro lado", "Otro"] as const;
export type LostReason = (typeof LOST_REASONS)[number];

export type StoreOption = { id: string; name: string };
export type SellerOption = { id: string; name: string; storeId: string | null };

export type LeadEventView = {
  id: number;
  kind: string;
  /** Mensagem que chegou pela Meta (nota gravada pelo webhook). */
  inbound: boolean;
  notes: string | null;
  actor: string;
  at: string;
};

export type LeadView = {
  id: string;
  number: number;
  source: string;
  name: string;
  phone: string | null;
  context: string | null;
  interest: string | null;
  wantedOn: string | null;
  status: LeadStatus;
  storeId: string | null;
  storeName: string | null;
  sellerId: string | null;
  sellerName: string | null;
  value: number | null;
  lostReason: string | null;
  createdAt: string;
  assignedAt: string | null;
  firstContactAt: string | null;
  closedAt: string | null;
  /** Datas já formatadas no servidor (fuso de Lima): o celular não refaz. */
  createdLabel: string;
  closedLabel: string | null;
  wantedLabel: string | null;
  events: LeadEventView[];
};

/* -------------------------------------------------------------------------- */
/*  Tempo até o primeiro contato                                              */
/* -------------------------------------------------------------------------- */

type Clock = { createdAt: string; assignedAt: string | null; firstContactAt: string | null };

/**
 * De onde o relógio conta: da atribuição (a vendedora não responde pelo tempo
 * que o lead ficou sem dono), ou do registro, se nunca foi atribuído.
 *
 * Reatribuir depois do contato regrava `assigned_at`; aí o início passaria do
 * fim e o tempo daria negativo. Nesse caso vale o registro.
 */
export function responseStart({ createdAt, assignedAt, firstContactAt }: Clock) {
  if (assignedAt && (!firstContactAt || assignedAt <= firstContactAt)) return assignedAt;
  return createdAt;
}

/** Minutos esperando: até o primeiro contato, ou até `nowMs` se ainda não houve. */
export function waitingMinutes(lead: Clock, nowMs: number) {
  const start = new Date(responseStart(lead)).getTime();
  const end = lead.firstContactAt ? new Date(lead.firstContactAt).getTime() : nowMs;
  return Math.max(0, Math.floor((end - start) / 60_000));
}

/** Verde dentro do prazo, âmbar até 4× (onde o alerta vira urgente), vermelho depois. */
export function slaTone(minutes: number, slaMin: number): "ok" | "warn" | "bad" {
  if (minutes < slaMin) return "ok";
  if (minutes <= slaMin * 4) return "warn";
  return "bad";
}

/* -------------------------------------------------------------------------- */
/*  Mensagem do WhatsApp                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Número para o wa.me: celular peruano (9 dígitos, começa com 9) ganha o 51;
 * número que já vem com código de outro país passa como está. Fixo ("054
 * 281118") não tem WhatsApp — devolve null e o botão explica.
 */
export function whatsappNumber(phone: string | null) {
  let digits = (phone ?? "").replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.length === 9 && digits.startsWith("9")) return `51${digits}`;
  if (digits.length === 11 && digits.startsWith("519")) return digits;
  if (digits.length >= 10 && digits.length <= 15 && !digits.startsWith("51") && !digits.startsWith("0")) return digits;
  return null;
}

/** Resumo em frase inteira: corta no último espaço antes do limite. */
export function summarize(text: string | null, max = 300) {
  const flat = (text ?? "").replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s.,;:]+$/, "")}…`;
}

/** "Cliente WhatsApp" é nome de placeholder: "Hola Cliente" soa pior que "Hola". */
function firstName(name: string) {
  if (/^cliente\b/i.test(name.trim())) return "";
  return name.trim().split(/\s+/)[0] ?? "";
}

/**
 * Preenche `lead_whatsapp_template`. O problema relatado era a vendedora
 * mandar "hola, en qué te ayudo" para quem já tinha explicado tudo no
 * Messenger — a mensagem já sai com o que foi conversado.
 */
export function buildLeadMessage(
  template: string,
  values: { name: string; seller: string; interest: string | null; context: string | null },
) {
  const filled = template
    .replaceAll("{nombre}", firstName(values.name))
    .replaceAll("{vendedora}", values.seller.trim())
    .replaceAll("{interes}", values.interest?.trim() || "nuestras tortas")
    .replaceAll("{contexto}", summarize(values.context));
  /* Placeholder vazio deixa "Hola , te escribe": arruma a pontuação. */
  return filled
    .replace(/[ \t]+([,.!?])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export function whatsappHref(phone: string | null, message: string) {
  const number = whatsappNumber(phone);
  return number ? `https://wa.me/${number}?text=${encodeURIComponent(message)}` : null;
}

/* -------------------------------------------------------------------------- */
/*  Métricas                                                                  */
/* -------------------------------------------------------------------------- */

export type MetricLead = Clock & {
  status: LeadStatus;
  storeId: string | null;
  sellerId: string | null;
  value: number | null;
  lostReason: string | null;
};

export type LeadMetrics = {
  received: number;
  contacted: number;
  medianMin: number | null;
  p90Min: number | null;
  withinSla: number;
  withinSlaPct: number | null;
  won: number;
  lost: number;
  conversionPct: number | null;
  wonValue: number;
};

/** Percentil com interpolação linear (a mediana de 4 valores é a média dos dois do meio). */
function percentile(sorted: number[], p: number) {
  if (!sorted.length) return null;
  const rank = (sorted.length - 1) * p;
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  return Math.round(sorted[low] + (sorted[high] - sorted[low]) * (rank - low));
}

export function computeMetrics(leads: MetricLead[], slaMin: number): LeadMetrics {
  const times = leads
    .filter((l) => l.firstContactAt)
    .map((l) => waitingMinutes(l, 0))
    .sort((a, b) => a - b);
  const withinSla = times.filter((t) => t < slaMin).length;
  const won = leads.filter((l) => l.status === "won");
  const lost = leads.filter((l) => l.status === "lost").length;
  const closed = won.length + lost;

  return {
    received: leads.length,
    contacted: times.length,
    medianMin: percentile(times, 0.5),
    p90Min: percentile(times, 0.9),
    withinSla,
    withinSlaPct: times.length ? Math.round((withinSla / times.length) * 100) : null,
    won: won.length,
    lost,
    conversionPct: closed ? Math.round((won.length / closed) * 100) : null,
    wonValue: won.reduce((sum, l) => sum + (l.value ?? 0), 0),
  };
}

/** Motivo gravado como "Precio" ou "Otro: texto" — agrupa pela categoria. */
export function lostReasonCategory(reason: string | null) {
  const head = (reason ?? "").split(":")[0].trim();
  return (LOST_REASONS as readonly string[]).includes(head) ? head : "Otro";
}

export function lostReasonDetail(reason: string | null) {
  const index = (reason ?? "").indexOf(":");
  return index === -1 ? null : (reason ?? "").slice(index + 1).trim() || null;
}
