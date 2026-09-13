/**
 * Formato público de `/api/vitrina`.
 *
 * Fica fora do `route.ts` porque o selo da página de produto (componente de
 * cliente) também lê este contrato. Nada de id interno aqui: nem da loja, nem
 * do produto, nem série — só o que a vitrine mostra.
 */

export type VitrinaApiItem = {
  name: string;
  /** Produto publicado no site; null quando a torta ainda não foi vinculada. */
  slug: string | null;
  flavor: string | null;
  quantity: number;
  /** Preço do produto publicado (IGV incluido). Null quando não há preço confiável. */
  price: number | null;
  /** Foto real da torta, senão a do catálogo. */
  image: string | null;
  producedToday: boolean;
};

export type VitrinaApiStore = {
  /** "Calle Perú" — sem a marca na frente. */
  name: string;
  address: string | null;
  district: string | null;
  /** Unidades somadas dos itens desta resposta. */
  quantity: number;
  items: VitrinaApiItem[];
};

export type VitrinaApiResponse = {
  /** Falso quando não dá para confirmar o estoque: quem lê não deve inventar. */
  fresh: boolean;
  total: number;
  stores: VitrinaApiStore[];
  generatedAt: string;
};
