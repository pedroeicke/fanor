import { soles } from "@/lib/format";

/**
 * Contas do balcão em centavos inteiros.
 *
 * 0,1 + 0,2 em ponto flutuante dá 0,30000000000000004 — e um "Falta cobrar
 * S/ 0.00" que não deixa fechar a venda. Tudo que soma dinheiro aqui é
 * inteiro; só vira soles na hora de mostrar ou de mandar ao banco.
 *
 * Sem "server-only": a tela calcula o total enquanto a vendedora digita, e a
 * ação do servidor refaz a mesma conta com a mesma função antes de cobrar.
 */

/** Teto de sanidade por valor: S/ 100 000. Erro de digitação, não venda. */
export const MAX_CENTS = 10_000_000;

/** Quantidade máxima por linha de produto sem série. */
export const MAX_QUANTITY = 999;

export const COUNTER_METHODS = ["cash", "yape", "plin", "card", "transfer"] as const;
export type CounterMethod = (typeof COUNTER_METHODS)[number];

export function isCounterMethod(value: unknown): value is CounterMethod {
  return typeof value === "string" && (COUNTER_METHODS as readonly string[]).includes(value);
}

/**
 * "12", "12.5", "12,50" → centavos. Vírgula vale como ponto: o teclado
 * numérico do celular em espanhol oferece vírgula. Null se não for valor.
 */
export function parseMoney(raw: string | null | undefined): number | null {
  const text = (raw ?? "").trim().replace(",", ".");
  if (!/^(\d{1,6}(\.\d{0,2})?|\.\d{1,2})$/.test(text)) return null;
  const cents = Math.round(Number(text) * 100);
  return Number.isSafeInteger(cents) && cents <= MAX_CENTS ? cents : null;
}

/** Quantidade inteira de 1 a 999. Null se não for. */
export function parseQuantity(raw: string | null | undefined): number | null {
  const text = (raw ?? "").trim();
  if (!/^\d{1,3}$/.test(text)) return null;
  const qty = Number(text);
  return qty >= 1 && qty <= MAX_QUANTITY ? qty : null;
}

/** Centavos → "S/ 12.50". */
export function money(cents: number) {
  return soles(cents / 100);
}

/** Centavos → "12.50", para preencher campo de valor. */
export function centsToInput(cents: number | null | undefined) {
  return cents === null || cents === undefined ? "" : (cents / 100).toFixed(2);
}

/** Soles vindos do banco (numeric chega como número ou texto) → centavos. */
export function solesToCents(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

/**
 * IGV contido num total com IGV. Mesma conta do `op_sale_register`
 * (`round(total - total / 1.18, 2)`), para a tela e a boleta baterem.
 */
export function igvIncluded(totalCents: number) {
  return Math.round(totalCents - totalCents / 1.18);
}

/** Total de uma linha: quantidade × preço − desconto. Null quando o desconto passa do preço. */
export function lineTotal(quantity: number, unitCents: number, discountCents: number) {
  const total = quantity * unitCents - discountCents;
  return total < 0 ? null : total;
}

export type PaymentAmount = { method: CounterMethod; cents: number };

export type Settlement = {
  paid: number;
  missing: number;
  change: number;
  /** Primeiro motivo que impede cobrar, pronto para mostrar. Null = pode cobrar. */
  error: string | null;
};

/**
 * Confere se os pagamentos fecham a venda, com as regras do banco:
 * pagar a mais só em dinheiro, e o vuelto sai de um pagamento em dinheiro
 * que o cubra sozinho (é desse registro que o banco desconta).
 */
export function settle(totalCents: number, payments: PaymentAmount[]): Settlement {
  const paid = payments.reduce((sum, p) => sum + p.cents, 0);
  const nonCash = payments.filter((p) => p.method !== "cash").reduce((sum, p) => sum + p.cents, 0);
  const biggestCash = Math.max(0, ...payments.filter((p) => p.method === "cash").map((p) => p.cents));
  const missing = Math.max(0, totalCents - paid);
  const change = Math.max(0, paid - totalCents);

  let error: string | null = null;
  if (nonCash > totalCents) {
    error = "Yape, Plin, tarjeta y transferencia no pueden pasar del total. El vuelto solo sale del efectivo.";
  } else if (missing > 0) {
    error = `Falta cobrar ${money(missing)}.`;
  } else if (change > biggestCash) {
    error = "El vuelto supera el pago en efectivo.";
  } else if (biggestCash > 0 && nonCash === totalCents) {
    /* O banco desconta o vuelto do efectivo e gravaria "Efectivo S/ 0.00":
       um pagamento que não existiu, contado no arqueo. */
    error = "Los otros pagos ya cubren el total. Quita el efectivo.";
  }
  return { paid, missing, change, error };
}

/**
 * Valor efetivo de cada pagamento.
 *
 * O pagamento "automático" (o último método tocado, que ninguém digitou)
 * acompanha o que falta: a vendedora toca Yape, depois lembra de uma vela, e
 * o valor do Yape sobe junto — sem ter de apagar e digitar de novo.
 */
export function resolvePayments<T extends { method: CounterMethod; amount: string; auto: boolean }>(
  totalCents: number,
  payments: T[],
): (number | null)[] {
  const fixed = payments.reduce((sum, p) => (p.auto ? sum : sum + (parseMoney(p.amount) ?? 0)), 0);
  const remaining = Math.max(0, totalCents - fixed);
  return payments.map((p) => (p.auto ? remaining : parseMoney(p.amount)));
}
