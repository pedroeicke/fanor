import rawCatalog from "@/data/catalog.json";

/**
 * Tipos e regras do catálogo.
 *
 * Este módulo é puro: não busca dados. Serve tanto ao servidor quanto ao
 * cliente. A leitura do Supabase vive em `lib/catalog-db.ts`, que é
 * server-only; o arquivo `data/catalog.json` continua aqui como fallback,
 * para o site subir mesmo sem banco configurado.
 */

export type ProductImage = { src: string; alt: string; w: number; h: number };

export type ProductSize = {
  slug: string;
  label: string;
  serves: string;
  order: number;
  price: number;
};

export type ProductFlavor = { slug: string; label: string };

export type Product = {
  /** uuid no banco; no fallback, o id numérico do WooCommerce virado string. */
  id: string;
  slug: string;
  name: string;
  description: string;
  price: number;
  priceRange: { min: number; max: number } | null;
  images: ProductImage[];
  /** Quadros do giro 360°, quando existirem. */
  spinFrames: ProductImage[];
  categories: { slug: string; name: string }[];
  occasions: string[];
  tags: string[];
  sizes: ProductSize[];
  defaultServes: string;
  maxServings: number;
  flavors: ProductFlavor[];
  /** Quantidade de sabores exigida. min = max significa "exatamente N". */
  minFlavors: number;
  maxFlavors: number;
  acceptsPhoto: boolean;
  leadTimeHours: number;
  featured: boolean;
};

/* -------------------------------------------------------------------------- */
/*  Sabores usados como filtro rápido                                         */
/*                                                                            */
/*  Derivados do texto do produto, não armazenados. A regra vive aqui para    */
/*  que o importador e a leitura do banco cheguem sempre ao mesmo resultado.  */
/* -------------------------------------------------------------------------- */

const TAG_RULES: { tag: string; re: RegExp }[] = [
  { tag: "tres-leches", re: /3 leches|tres leches/i },
  { tag: "chocolate", re: /chocolat|choco|selva negra|oreo|moca|sublime|tronqu|domin|brownie|fudge/i },
  { tag: "frutales", re: /fresa|mango|durazno|tropical|sauco|pasi[óo]n|naranja|l[úu]cuma|frut|piña|guind/i },
  { tag: "semifrio", re: /semi.?fr[íi]o|helada|mousse|cheesecake/i },
];

export function deriveTags(name: string, description: string) {
  const haystack = `${name} ${description}`;
  return TAG_RULES.filter((r) => r.re.test(haystack)).map((r) => r.tag);
}

/* -------------------------------------------------------------------------- */
/*  Fallback em arquivo                                                       */
/* -------------------------------------------------------------------------- */

type RawProduct = Omit<Product, "id" | "spinFrames"> & { id: number };

/** Catálogo estático. Só é usado quando o Supabase não está configurado. */
export const fallbackProducts: Product[] = (rawCatalog as RawProduct[]).map((p) => ({
  ...p,
  id: String(p.id),
  spinFrames: [],
}));

/* -------------------------------------------------------------------------- */
/*  Produto enxuto para listagens                                             */
/* -------------------------------------------------------------------------- */

/**
 * O que a vitrine realmente precisa.
 *
 * A listagem é um componente de cliente — os dados atravessam a rede
 * serializados. Mandar o `Product` inteiro fazia viajar as 125 imagens do
 * catálogo para uma tela que mostra 59, mais sabores, antecedência de produção
 * e campos que nenhum card lê. Aqui vai só o que o card desenha e o filtro
 * consulta.
 */
export type CardProduct = {
  id: string;
  slug: string;
  name: string;
  /** Só para a busca por texto; o card não exibe. */
  description: string;
  price: number;
  priceRange: { min: number; max: number } | null;
  image: ProductImage;
  sizeCount: number;
  serves: string;
  occasions: string[];
  tags: string[];
  maxServings: number;
  featured: boolean;
};

export function toCard(p: Product): CardProduct {
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    description: p.description,
    price: p.price,
    priceRange: p.priceRange,
    image: p.images[0],
    sizeCount: p.sizes.length,
    serves: p.sizes[0]?.serves ?? p.defaultServes,
    occasions: p.occasions,
    tags: p.tags,
    maxServings: p.maxServings,
    featured: p.featured,
  };
}

/* -------------------------------------------------------------------------- */
/*  Ocasiões                                                                  */
/*                                                                            */
/*  O site antigo organizava o catálogo por geometria — "Redondas",           */
/*  "Rectangulares", "Semi-Fríos". Ninguém procura um retângulo: procura um   */
/*  aniversário. Esta é a taxonomia que corresponde à intenção de compra.     */
/* -------------------------------------------------------------------------- */

export type Occasion = {
  slug: string;
  name: string;
  headline: string;
  blurb: string;
};

/** Espelha `categories` com kind = 'ocasion' na migração 0002. */
export const OCCASIONS: Occasion[] = [
  {
    slug: "cumpleanos",
    name: "Cumpleaños",
    headline: "Tortas de cumpleaños",
    blurb: "Clásicos que nunca fallan, con mensaje personalizado incluido.",
  },
  {
    slug: "infantil",
    name: "Infantiles",
    headline: "Tortas infantiles",
    blurb: "Temáticas y colores que a los chicos les encantan.",
  },
  {
    slug: "romance",
    name: "Aniversarios",
    headline: "Tortas para aniversarios",
    blurb: "Diseños elegantes para celebrar a dos.",
  },
  {
    slug: "quince",
    name: "Quinceañeras",
    headline: "Tortas de 15 años",
    blurb: "La torta que se recuerda toda la vida.",
  },
  {
    slug: "boda",
    name: "Bodas",
    headline: "Tortas de boda",
    blurb: "Diseños de varios pisos, decorados a mano.",
  },
  {
    slug: "bautizo",
    name: "Bautizos",
    headline: "Tortas de bautizo",
    blurb: "Delicadas y en tonos suaves, para el día del bautizo.",
  },
  {
    slug: "graduacion",
    name: "Graduaciones",
    headline: "Tortas de graduación",
    blurb: "Para cerrar la etapa con algo dulce.",
  },
  {
    slug: "para-compartir",
    name: "Para compartir",
    headline: "Tortas para grupos grandes",
    blurb: "Desde 20 hasta 35 porciones, para oficinas y reuniones familiares.",
  },
  {
    slug: "personalizadas",
    name: "Personalizadas",
    headline: "Tortas personalizadas",
    blurb: "Tu foto y tu diseño impresos en calidad fotográfica comestible.",
  },
  {
    slug: "fechas-especiales",
    name: "Fechas especiales",
    headline: "Fechas especiales",
    blurb: "Navidad, Día de la Madre, Día del Padre y más.",
  },
];

export function getOccasion(slug: string) {
  return OCCASIONS.find((o) => o.slug === slug) ?? null;
}

/* -------------------------------------------------------------------------- */
/*  Filtros                                                                   */
/* -------------------------------------------------------------------------- */

export const FLAVOR_FILTERS = [
  { slug: "chocolate", name: "Chocolate" },
  { slug: "tres-leches", name: "Tres leches" },
  { slug: "frutales", name: "Frutales" },
  { slug: "semifrio", name: "Semi-fríos" },
];

/**
 * Filtro por número de convidados. É a pergunta que a pessoa realmente tem
 * na cabeça, e que o site antigo respondia com centímetros de diâmetro.
 */
export const GUEST_FILTERS = [
  { slug: "hasta-12", name: "Hasta 12", test: (p: CardProduct) => p.maxServings <= 12 },
  { slug: "12-20", name: "12 a 20", test: (p: CardProduct) => p.maxServings > 12 && p.maxServings <= 20 },
  { slug: "20-mas", name: "Más de 20", test: (p: CardProduct) => p.maxServings > 20 },
];

/** Slugs dos mais vendidos. Vira uma coluna no painel quando houver histórico. */
export const BEST_SELLER_SLUGS = [
  "3-leches-de-moca",
  "delicia-de-fresa",
  "alteza-del-bosque",
  "dulce-pasion",
  "torta-de-chocolate",
  "selva-negra",
  "pasion-de-fresa",
  "oreochoco-sensations",
];

/** Preço mínimo exibido no card: variantes começam no menor tamanho. */
export function displayPrice(p: Pick<Product, "price" | "priceRange">) {
  return p.priceRange ? p.priceRange.min : p.price;
}

export function relatedProducts(product: Product, all: Product[], limit = 4) {
  return all
    .filter((x) => x.id !== product.id)
    .map((x) => ({
      product: x,
      score:
        x.occasions.filter((o) => product.occasions.includes(o)).length * 2 +
        x.tags.filter((t) => product.tags.includes(t)).length,
    }))
    .filter((x) => x.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        Math.abs(a.product.price - product.price) - Math.abs(b.product.price - product.price),
    )
    .slice(0, limit)
    .map((x) => x.product);
}
