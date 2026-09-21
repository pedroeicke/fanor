import type { CounterMethod } from "./money";

/**
 * Formas trocadas entre a tela do balcão e as ações do servidor.
 *
 * Arquivo à parte porque `actions.ts` é "use server" e só pode exportar
 * funções assíncronas.
 */

export type SaleKind = "counter" | "staff";

export type StoreOption = { id: string; name: string };
export type SellerOption = { id: string; name: string; storeId: string | null };

/** Torta lida pelo QR e já conferida no servidor (disponível nesta loja). */
export type CakeLookup = {
  serial: string;
  productId: string;
  name: string;
  sku: string | null;
  flavor: string | null;
  expiresOn: string;
  /** Vencida = `expires_on` antes de hoje em Lima. */
  expired: boolean;
  /** Dias desde o vencimento (0 = vence hoje, negativo = ainda vale). */
  daysExpired: number;
  suggestedCents: number | null;
};

export type ProductHit = {
  id: string;
  name: string;
  sku: string | null;
  family: string;
  suggestedCents: number | null;
};

export type CustomerRef = {
  id: string;
  name: string;
  phone: string | null;
  docType: string;
  docNumber: string | null;
};

/* Linhas do carrinho guardam o que a vendedora digitou (texto), não o
   número: "12," no meio da digitação não pode virar 12 e pular o cursor. */
export type CakeLine = {
  key: string;
  kind: "cake";
  serial: string;
  productId: string;
  name: string;
  sku: string | null;
  flavor: string | null;
  expiresOn: string;
  expiredAccepted: boolean;
  price: string;
  discount: string;
};

export type ItemLine = {
  key: string;
  kind: "item";
  productId: string;
  name: string;
  sku: string | null;
  quantity: string;
  price: string;
  discount: string;
};

export type CartLine = CakeLine | ItemLine;

export type PaymentLine = {
  key: string;
  method: CounterMethod;
  amount: string;
  reference: string;
  /** Acompanha o que falta até alguém digitar o valor. */
  auto: boolean;
};

export type RegisterSaleInput = {
  /** Chave do carrinho: cobrar duas vezes com ela devolve a mesma venda. */
  clientRef: string;
  storeId: string;
  sellerId: string | null;
  customerId: string | null;
  kind: SaleKind;
  notes: string;
  lines: (
    | { kind: "cake"; serial: string; priceCents: number; discountCents: number; expiredAccepted: boolean }
    | { kind: "item"; productId: string; quantity: number; priceCents: number; discountCents: number }
  )[];
  payments: { method: CounterMethod; amountCents: number; reference: string }[];
};

/** O que a tela de sucesso mostra. Guardado no rascunho para sobreviver a um F5. */
export type SaleReceipt = {
  id: string;
  number: number;
  totalCents: number;
  changeCents: number;
  kind: SaleKind;
  customerName: string | null;
  payments: { method: CounterMethod; amountCents: number }[];
  /** A cobrança anterior ficou sem resposta e a venda já estava gravada: não se cobrou de novo. */
  recovered?: boolean;
};
