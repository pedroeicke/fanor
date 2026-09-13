/**
 * Tipos, constantes e contas da encomenda que valem nos dois lados.
 *
 * Fora do `actions.ts` porque arquivo "use server" só pode exportar função
 * assíncrona. E a conta do vuelto precisa ser a mesma no navegador (para a
 * vendedora ver antes de confirmar) e no servidor (para validar o que chega).
 */

export const DOC_TYPES = ["NONE", "DNI", "RUC", "CE", "PASSPORT"] as const;
export type DocType = (typeof DOC_TYPES)[number];

export const DOC_LABEL: Record<DocType, string> = {
  NONE: "Sin documento",
  DNI: "DNI",
  RUC: "RUC",
  CE: "Carné de extranjería",
  PASSPORT: "Pasaporte",
};

/* Crédito fica de fora: adelanto e saldo são dinheiro que entra na hora. */
export const PAY_METHODS = ["cash", "yape", "plin", "card", "transfer", "deposit"] as const;
export type PayMethod = (typeof PAY_METHODS)[number];

export const PICKUP_PLACE = "Recojo en tienda";

export const LIMITS = {
  lines: 30,
  quantity: 100,
  price: 100_000,
  message: 120,
  place: 200,
  notes: 1000,
  reference: 80,
  reason: 500,
  serials: 100,
  payments: 6,
} as const;

export type CustomerSummary = {
  id: string;
  name: string;
  phone: string | null;
  docType: string;
  docNumber: string | null;
};

export type ProductOption = {
  id: string;
  sku: string | null;
  name: string;
  /** Preço sugerido, sempre com IGV (o do Sisgeco já chega corrigido). */
  price: number;
  /** Família com série (T): gera OP para o taller e sai por série na entrega. */
  isCake: boolean;
};

export type Option = { id: string; name: string };

export type SellerOption = { id: string; name: string; storeId: string | null };

export type PhotoRef = { path: string; url: string };

export type ContractLineInput = {
  productId: string;
  quantity: number;
  unitPrice: number;
  flavorId: string | null;
  decoratorId: string | null;
  cakeTypeId: string | null;
  message: string;
  photoPath: string | null;
};

export type CreateContractInput = {
  storeId: string;
  sellerId: string | null;
  customerId: string;
  deliverOn: string;
  deliverAt: string | null;
  deliverPlace: string;
  notes: string;
  lines: ContractLineInput[];
  advance: { amount: number; method: string; reference: string } | null;
};

export type PaymentInput = { method: string; amount: number; reference: string };

/** Torta que pode sair na entrega. */
export type DeliverableCake = {
  serial: string;
  productId: string;
  product: string;
  flavor: string | null;
  expiresOn: string;
  reserved: boolean;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

export function isTime(value: unknown): value is string {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

/**
 * "12,50" ou "12.5" → 12.5. Null se não for número.
 *
 * Aceita vírgula porque o teclado numérico de muito celular em espanhol só
 * tem vírgula — e "12,50" virando NaN seria o adiantamento sumindo calado.
 */
export function parseMoney(raw: string): number | null {
  const text = raw.trim().replace(",", ".");
  if (!text) return null;
  if (!/^\d+(\.\d{0,2})?$/.test(text)) return null;
  const value = Number(text);
  return Number.isFinite(value) ? round2(value) : null;
}

export function round2(value: number) {
  return Math.round(value * 100) / 100;
}

/** Contas em centavos: 0.1 + 0.2 não pode deixar a vendedora devendo 1 céntimo. */
function cents(value: number) {
  return Math.round(value * 100);
}

export type PaymentCheck =
  | { ok: true; paid: number; change: number }
  | { ok: false; paid: number; missing: number; error: string };

/**
 * Mesma regra do `op_sale_register`: pagar a mais só em dinheiro, e o vuelto
 * sai de UM pagamento em dinheiro que o cubra — é o que fica gravado como
 * entrada no caixa.
 */
export function checkPayments(due: number, payments: { method: string; amount: number }[]): PaymentCheck {
  const dueC = cents(due);
  const paidC = payments.reduce((sum, p) => sum + cents(p.amount), 0);
  const paid = paidC / 100;
  if (paidC < dueC) {
    return { ok: false, paid, missing: (dueC - paidC) / 100, error: `Falta cobrar ${formatSoles((dueC - paidC) / 100)}.` };
  }
  const changeC = paidC - dueC;
  if (changeC > 0 && !payments.some((p) => p.method === "cash" && cents(p.amount) >= changeC)) {
    return { ok: false, paid, missing: 0, error: "El vuelto solo aplica a pagos en efectivo." };
  }
  return { ok: true, paid, change: changeC / 100 };
}

function formatSoles(value: number) {
  return `S/ ${value.toFixed(2)}`;
}

/** Celular peruano para o wa.me: só dígitos, com o 51 na frente. */
export function whatsappNumber(phone: string | null | undefined) {
  if (!phone) return null;
  let digits = phone.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("51")) digits = digits.slice(2);
  if (digits.length < 6) return null;
  return digits.length === 9 ? `51${digits}` : digits;
}

/** "14:30:00" (time do Postgres) → "14:30". */
export function shortTime(value: string | null | undefined) {
  return value ? value.slice(0, 5) : null;
}
