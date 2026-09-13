/**
 * Formas que viajam entre as telas de recepção e as ações do servidor.
 *
 * Arquivo à parte porque `actions.ts` tem "use server" e só pode exportar
 * funções assíncronas — e o componente do cliente precisa dos mesmos tipos.
 */

/** O que o QR lido aponta: sempre um despacho, e a torta quando foi etiqueta. */
export type ScanLookup = {
  dispatchId: string;
  number: number;
  code: string;
  status: string;
  storeId: string;
  storeName: string;
  cake: { serial: string; status: string } | null;
};

export type ChecklistCake = {
  serial: string;
  product: string;
  sku: string | null;
  flavor: string | null;
  decorator: string | null;
  cakeType: string | null;
  redecorated: boolean;
  /** Torta de encomenda chega reservada, não vai para a vitrine. */
  contractNumber: number | null;
};

export type ChecklistLine = {
  id: string;
  product: string;
  sku: string | null;
  quantity: number;
};

export type ReceiveInput = {
  dispatchId: string;
  /** Todas as séries que a tela mostrou. O servidor confere com o banco antes de gravar faltantes. */
  expected: string[];
  received: string[];
  items: { dispatch_line_id: string; received_quantity: number }[];
  notes: string;
};

/** Devolvido por `op_dispatch_receive`. */
export type ReceiveResult = { received: number; missing: number; short_items: boolean };
