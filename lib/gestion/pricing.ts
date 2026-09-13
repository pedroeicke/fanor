/**
 * Preço sugerido no balcão e na encomenda, sempre com IGV.
 *
 * O preço que veio do Sisgeco (`Articulo.precio1`, produto com código ainda
 * não publicado no site) é sem IGV: a T26 a 49,15 é a torta de S/ 58, o
 * suspiro a 3,39 é o de S/ 4. Venda e boleta gravam com IGV incluído, então a
 * sugestão tem de vir com ele — senão a vendedora cobra 18 % a menos sem
 * perceber. Produto publicado tem o preço do site, que já é com IGV.
 */

export const IGV_RATE = 0.18;

type PricedProduct = {
  base_price: number | string | null | undefined;
  sku?: string | null;
  status?: string | null;
};

/** Preço com IGV em soles (2 casas), ou null se o produto não tem preço. */
export function suggestedPrice(product: PricedProduct | null | undefined): number | null {
  if (!product || product.base_price === null || product.base_price === undefined || product.base_price === "") return null;
  const base = Number(product.base_price);
  if (!Number.isFinite(base)) return null;
  const fromSisgeco = Boolean(product.sku) && product.status !== "active";
  const price = fromSisgeco ? base * (1 + IGV_RATE) : base;
  return Math.round(price * 100) / 100;
}
