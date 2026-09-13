/**
 * Tipos que atravessam a fronteira servidor → navegador nas telas de pedido
 * e despacho. Ficam fora dos arquivos "use server", que só podem exportar
 * funções assíncronas.
 */

/** Produto que se pede ao taller ou se despacha. Serviço (adiantamento, saldo) nunca entra. */
export type CatalogProduct = {
  id: string;
  sku: string | null;
  name: string;
  familyCode: string;
  familyName: string;
  /** Família com série (tortas): cada unidade vira uma etiqueta. */
  tracksSerial: boolean;
};

export type StoreOption = { id: string; name: string };

export type RequestLineInput = { productId: string; quantity: number };

export type CreateRequestInput = {
  storeId: string;
  lines: RequestLineInput[];
  notes: string;
};

/** Limites da tela, repetidos na validação do servidor. */
export const REQUEST_MAX_QTY = 200;
export const REQUEST_MAX_LINES = 60;
export const NOTES_MAX = 300;
export const REASON_MAX = 200;
