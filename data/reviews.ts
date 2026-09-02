/**
 * ⚠️  CONTEÚDO DE PREENCHIMENTO — SUBSTITUIR ANTES DE PUBLICAR.
 *
 * Estas reseñas são de exemplo. Elas existem para que o layout de prova social
 * possa ser construído e avaliado, não para serem publicadas como se fossem
 * de clientes reais — isso seria propaganda enganosa e, no Peru, infração ao
 * Código de Protección al Consumidor.
 *
 * Como preencher de verdade, em ordem de esforço:
 *   1. Exportar as avaliações reais do Facebook (a página tem ~15 mil seguidores).
 *   2. Disparar um pedido de avaliação por WhatsApp 1 dia após cada entrega.
 *   3. Ligar um provedor verificado (Judge.me, Loox, Trustpilot) e ler daqui.
 *
 * Enquanto isso: `SHOW_REVIEWS = false` esconde a seção do site inteiro.
 * Prefira uma página sem reseñas a uma página com reseñas inventadas — e a
 * qualquer coisa parecida com o "Sin valoración todavía" que o site atual
 * imprime 59 vezes.
 */

/* Desligado: o checklist manda não exibir prova social até existirem
   avaliações reais. Ligar assim que REVIEWS abaixo for substituído. */
export const SHOW_REVIEWS: boolean = false;

export type Review = {
  id: string;
  author: string;
  rating: number;
  date: string;
  text: string;
  /** Slug do produto avaliado, quando aplicável. */
  product?: string;
};

export const REVIEWS: Review[] = [
  {
    id: "r1",
    author: "María P.",
    rating: 5,
    date: "2026-07-14",
    text: "Deliciosa, súper húmeda y con el sabor de moca perfecto. A todos les encantó.",
    product: "3-leches-de-moca",
  },
  {
    id: "r2",
    author: "Carlos G.",
    rating: 5,
    date: "2026-07-02",
    text: "Llegó a la hora exacta que elegí y en perfecto estado. La presentación es hermosa.",
    product: "alteza-del-bosque",
  },
  {
    id: "r3",
    author: "Lucía V.",
    rating: 5,
    date: "2026-06-21",
    text: "Nuestra favorita siempre. Pedí el mensaje personalizado y quedó tal cual lo escribí.",
    product: "delicia-de-fresa",
  },
  {
    id: "r4",
    author: "Andrea R.",
    rating: 5,
    date: "2026-06-08",
    text: "Pedí para 25 personas y alcanzó perfecto. El proceso de compra fue rapidísimo.",
    product: "alteza-ambar",
  },
  {
    id: "r5",
    author: "Jorge M.",
    rating: 4,
    date: "2026-05-30",
    text: "Muy buena torta y buen precio. La entrega se adelantó media hora, sin problema.",
    product: "torta-de-chocolate",
  },
];

export function reviewsForProduct(slug: string) {
  return REVIEWS.filter((r) => r.product === slug);
}
