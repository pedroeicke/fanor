/**
 * Torta personalizada montada passo a passo.
 *
 * Os preços base são os da FotoTorta real do catálogo (85 / 120 / 170 / 250),
 * e os acréscimos de estilo vêm da diferença real entre uma torta simples e
 * uma Alteza decorada. Nada aqui é preço inventado — e o total aparece na tela
 * enquanto a pessoa monta, em vez de virar um orçamento por WhatsApp.
 */

export const CUSTOM_LEAD_TIME_HOURS = 48;

export type CustomSize = { id: string; label: string; serves: string; price: number };

export const CUSTOM_SIZES: CustomSize[] = [
  { id: "20cm", label: "20 cm", serves: "10–12 porciones", price: 85 },
  { id: "26cm", label: "26 cm", serves: "18–20 porciones", price: 120 },
  { id: "2-5", label: "Torta 2½", serves: "20–25 porciones", price: 170 },
  { id: "3-5", label: "Torta 3½", serves: "30–35 porciones", price: 250 },
];

export type CustomStyle = {
  id: string;
  label: string;
  detail: string;
  surcharge: number;
  /** Slug do produto do catálogo usado como referência visual. */
  cover: string;
  requiresPhoto?: boolean;
};

export const CUSTOM_STYLES: CustomStyle[] = [
  {
    id: "clasica",
    label: "Clásica",
    detail: "Crema lisa y bordes trabajados",
    surcharge: 0,
    cover: "la-clasica",
  },
  {
    id: "chocolate",
    label: "Chocolate",
    detail: "Baño de chocolate y virutas",
    surcharge: 15,
    cover: "torta-de-chocolate",
  },
  {
    id: "floral",
    label: "Floral",
    detail: "Flores modeladas a mano",
    surcharge: 60,
    cover: "reina-de-peonias",
  },
  {
    id: "foto",
    label: "Con tu foto",
    detail: "Impresión comestible en alta definición",
    surcharge: 0,
    cover: "fototorta",
    requiresPhoto: true,
  },
];

export const CUSTOM_FLAVORS = [
  "Chocolate",
  "Vainilla",
  "Moca",
  "Naranja",
  "Pasión",
  "Chocochip",
  "Delicia",
  "Tentación",
  "Lúcuma",
  "Mango",
];

export const MAX_CUSTOM_FLAVORS = 3;

export const CUSTOM_MESSAGE_LIMIT = 40;

export function customPrice(sizeId: string, styleId: string) {
  const size = CUSTOM_SIZES.find((s) => s.id === sizeId);
  const style = CUSTOM_STYLES.find((s) => s.id === styleId);
  return (size?.price ?? 0) + (style?.surcharge ?? 0);
}

export const CUSTOM_FROM_PRICE = Math.min(...CUSTOM_SIZES.map((s) => s.price));
