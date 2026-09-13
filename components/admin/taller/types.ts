/**
 * Tipos do taller que cruzam servidor → navegador. Fora dos arquivos
 * "use server", que só podem exportar funções assíncronas.
 */

export type NamedOption = { id: string; name: string };

/** Linha da OP como o taller a vê na hora de montar o despacho. */
export type DispatchOrderLine = {
  id: string;
  productId: string;
  productName: string;
  sku: string | null;
  tracksSerial: boolean;
  quantity: number;
  produced: number;
  /* Encomenda chega com sabor, decoradora e tipo escolhidos pelo cliente. */
  flavorId: string | null;
  decoratorId: string | null;
  cakeTypeId: string | null;
  flavorName: string | null;
  decoratorName: string | null;
  cakeTypeName: string | null;
  message: string | null;
};

export type DispatchOrder = {
  id: string;
  number: number;
  kind: "restock" | "contract";
  contractNumber: number | null;
  storeId: string;
  storeName: string;
  forDate: string;
  deliverAt: string | null;
  notes: string | null;
  lines: DispatchOrderLine[];
};

export type DispatchCakeInput = {
  productId: string;
  quantity: number;
  flavorId: string | null;
  decoratorId: string | null;
  lineId: string | null;
};

export type DispatchItemInput = { productId: string; quantity: number; lineId: string | null };

export type CreateDispatchInput = {
  /** Null = despacho sem pedido; aí vale `storeId`. Com pedido, a loja é a do pedido. */
  orderId: string | null;
  storeId: string | null;
  cakes: DispatchCakeInput[];
  items: DispatchItemInput[];
  notes: string;
};

export type RedecorateInput = { serial: string; storeId: string; decoratorId: string | null; notes: string };

/* Limites da tela, repetidos no servidor. Os da torta são os da função do
   banco (1..200 por entrada); o total evita um zero a mais virar 2.000
   etiquetas impressas. */
export const CAKES_PER_ENTRY_MAX = 200;
export const CAKES_TOTAL_MAX = 400;
export const ENTRIES_MAX = 120;
export const ITEM_QTY_MAX = 5000;
