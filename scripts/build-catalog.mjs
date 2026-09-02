/**
 * Transforma o dump da Store API do WooCommerce (data/_raw-woo.json)
 * no catálogo tipado que a aplicação consome (data/catalog.json).
 *
 * Rode com: npm run catalog
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const raw = JSON.parse(readFileSync(join(root, "data/_raw-woo.json"), "utf8"));

/**
 * Preço por variação, buscado à parte (scripts/fetch-variations.mjs).
 * A Store API só entrega o preço de cada tamanho no endpoint individual,
 * e a associação tamanho→id vem do array `variations` do produto pai.
 */
const variationPrices = JSON.parse(readFileSync(join(root, "scripts/_variations.json"), "utf8"));

/** Produtos que não devem ir para a loja. */
const EXCLUDE = new Set(["Producto Demo"]);

/**
 * Porções por tamanho. O site atual vende tamanho em centímetros, o que não
 * responde a pergunta real do cliente ("dá pra quantas pessoas?"). Aqui cada
 * tamanho carrega a contagem de porções, que é o que aparece na interface.
 */
const SIZES = {
  "20 cm de diámetro": { label: "20 cm", serves: "10–12 porciones", order: 2 },
  "24 cm de diámetro": { label: "24 cm", serves: "15–18 porciones", order: 3 },
  "26 cm de diámetro": { label: "26 cm", serves: "18–20 porciones", order: 4 },
  "2½": { label: "Torta 2½", serves: "20–25 porciones", order: 5 },
  "3½": { label: "Torta 3½", serves: "30–35 porciones", order: 6 },
  Pequeña: { label: "Pequeña", serves: "8–10 porciones", order: 1 },
  Mediana: { label: "Mediana", serves: "12–15 porciones", order: 3 },
  Grande: { label: "Grande", serves: "20–25 porciones", order: 5 },
  Brazo: { label: "Brazo", serves: "10–12 porciones", order: 2 },
};

/** Altezas têm seis capas: o mesmo diâmetro rende muito mais porções. */
const ALTEZA_SIZES = {
  "20 cm de diámetro": { label: "20 cm · 6 capas", serves: "30 porciones", order: 2 },
};

const stripHtml = (html) =>
  (html || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&aacute;/g, "á")
    .replace(/&eacute;/g, "é")
    .replace(/&iacute;/g, "í")
    .replace(/&oacute;/g, "ó")
    .replace(/&uacute;/g, "ú")
    .replace(/&ntilde;/g, "ñ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

const slugify = (s) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/** Sabores usados como filtro rápido na vitrine. */
const FLAVOR_RULES = [
  { tag: "tres-leches", re: /3 leches|tres leches/i },
  { tag: "chocolate", re: /chocolat|choco|selva negra|oreo|moca|sublime|tronqu|domin|brownie|fudge/i },
  { tag: "frutales", re: /fresa|mango|durazno|tropical|sauco|pasi[óo]n|naranja|l[úu]cuma|frut|piña|guind/i },
  { tag: "semifrio", re: /semi.?fr[íi]o|helada|mousse|cheesecake/i },
];

const OCCASION_RULES = [
  { tag: "navidad", test: (p) => p.cats.includes("Navidad") },
  { tag: "dia-del-padre", test: (p) => /^pap[áa]/i.test(p.name) },
  {
    tag: "romance",
    test: (p) =>
      p.cats.includes("Corazones") ||
      /romance|eterno|pasi[óo]n|red velvet|peon[íi]as|violeta|coraz[óo]n/i.test(p.name),
  },
  { tag: "infantil", test: (p) => /homero|princesa|encanto marino|guagua|fantas[íi]a/i.test(p.name) },
  {
    tag: "personalizadas",
    test: (p) => p.cats.includes("FotoTortas") || p.cats.includes("FotoTopper"),
  },
  {
    tag: "para-compartir",
    test: (p) => p.cats.includes("Altezas") || p.cats.includes("Rectangulares"),
  },
];

const products = raw
  .filter((p) => !EXCLUDE.has(p.name) && p.type !== "variation")
  .map((p) => {
    const cats = p.categories.map((c) => c.name);
    const isAlteza = cats.includes("Altezas");
    const description = stripHtml(p.short_description) || stripHtml(p.description);
    const haystack = `${p.name} ${description}`;

    const sizeAttr = p.attributes.find((a) => a.name === "Tamaño");
    const flavorAttr = p.attributes.find((a) => a.name === "Sabores");

    /* tamanho (slug) → preço, cruzando as variações do pai com os preços. */
    const priceBySize = {};
    for (const v of p.variations ?? []) {
      const sizeValue = v.attributes?.find((a) => a.name === "Tamaño")?.value;
      const price = variationPrices[v.id]?.price;
      if (sizeValue && typeof price === "number") priceBySize[sizeValue] = price;
    }

    const sizes = (sizeAttr?.terms ?? [])
      .map((t) => {
        const meta = (isAlteza && ALTEZA_SIZES[t.name]) || SIZES[t.name];
        if (!meta) return null;
        return {
          slug: t.slug,
          label: meta.label,
          serves: meta.serves,
          order: meta.order,
          price: priceBySize[t.slug] ?? null,
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.order - b.order);

    /* Se algum tamanho ficou sem preço, o menor conhecido vira o piso — nunca
       exibimos um preço inventado. */
    const knownPrices = sizes.map((s) => s.price).filter((x) => typeof x === "number");
    const floor = knownPrices.length ? Math.min(...knownPrices) : null;
    sizes.forEach((s) => {
      if (s.price === null) s.price = floor;
    });

    const flavors = (flavorAttr?.terms ?? []).map((t) => ({ slug: t.slug, label: t.name }));

    const tags = FLAVOR_RULES.filter((r) => r.re.test(haystack)).map((r) => r.tag);
    const base = { name: p.name, cats };
    const occasions = OCCASION_RULES.filter((r) => r.test(base)).map((r) => r.tag);
    if (!occasions.length || (occasions.length === 1 && occasions[0] === "para-compartir")) {
      occasions.unshift("cumpleanos");
    }

    /**
     * Todo produto precisa responder "¿para cuántas personas alcanza?".
     * Quem tem atributo de tamanho herda de lá; o resto recebe a porção
     * padrão do seu formato. Sem isso não dá para filtrar por convidados,
     * que é como as pessoas realmente escolhem uma torta.
     */
    const FALLBACK_SERVES = [
      { re: /^torta 1½$/i, serves: "20–25 porciones" },
      { re: /^torta 2½$/i, serves: "30–35 porciones" },
      { re: /^bracito$/i, serves: "10–12 porciones" },
      { re: /^tronquito$/i, serves: "12–15 porciones" },
    ];
    const fallback =
      FALLBACK_SERVES.find((r) => r.re.test(p.name))?.serves ??
      (isAlteza ? "30 porciones" : "10–12 porciones");

    const defaultServes = sizes[0]?.serves ?? fallback;
    const maxServings = Math.max(
      ...[...sizes.map((s) => s.serves), fallback].map((s) => {
        const nums = String(s).match(/\d+/g) ?? ["10"];
        return Number(nums[nums.length - 1]);
      }),
    );

    const price = Number(p.prices.price) / 10 ** p.prices.currency_minor_unit;
    const min = Number(p.prices.price_range?.min_amount ?? p.prices.price) / 100;
    const max = Number(p.prices.price_range?.max_amount ?? p.prices.price) / 100;

    return {
      id: p.id,
      /* O WooCommerce guarda "torta-1%c2%bd" para "Torta 1½". Slug derivado do
         nome, que é legível e não precisa de encoding na URL. */
      slug: slugify(p.name),
      name: p.name,
      description,
      price,
      priceRange: min === max ? null : { min, max },
      images: p.images.map((i) => ({
        src: i.src,
        alt: i.alt || p.name,
        w: 1080,
        h: 1080,
      })),
      categories: cats.map((c) => ({ slug: slugify(c), name: c })),
      occasions: [...new Set(occasions)],
      tags: [...new Set(tags)],
      sizes,
      defaultServes,
      maxServings,
      flavors,
      /**
       * Quantidade de sabores exigida.
       *
       * A regra comercial é "escolher exatamente 3 entre 9". Quando o produto
       * oferece 9 ou mais sabores, min = max = 3 e a escolha é obrigatória.
       * Nos demais, é livre até o total disponível. Nenhum produto do catálogo
       * atual tem 9 sabores — a regra passa a valer com o CSV novo.
       */
      minFlavors: flavors.length >= 9 ? 3 : flavors.length ? 1 : 0,
      maxFlavors: flavors.length >= 9 ? 3 : flavors.length,
      /** Só FotoTortas/FotoTopper aceitam imagem do cliente. */
      acceptsPhoto: cats.includes("FotoTortas") || cats.includes("FotoTopper"),
      /** Peças elaboradas precisam de mais antecedência na produção. */
      leadTimeHours: isAlteza || cats.includes("FotoTortas") || cats.includes("FotoTopper") ? 48 : 24,
      featured: cats.includes("Destaques"),
    };
  })
  .sort((a, b) => a.price - b.price);

writeFileSync(join(root, "data/catalog.json"), JSON.stringify(products, null, 2) + "\n");

const stats = products.reduce((acc, p) => {
  p.occasions.forEach((o) => (acc[o] = (acc[o] || 0) + 1));
  return acc;
}, {});
console.log(`✓ ${products.length} produtos → data/catalog.json`);
console.log("  ocasiões:", stats);
console.log(
  "  sabores :",
  products.reduce((acc, p) => {
    p.tags.forEach((t) => (acc[t] = (acc[t] || 0) + 1));
    return acc;
  }, {}),
);
