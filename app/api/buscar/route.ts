import { NextResponse } from "next/server";
import { getProducts } from "@/lib/catalog-db";

/**
 * Sugestões da busca do cabeçalho.
 *
 * Filtra o catálogo já carregado em memória em vez de consultar o banco a
 * cada tecla: são 59 produtos, o `cache()` de `getProducts` os mantém por
 * requisição, e uma varredura sobre isso custa menos que a ida ao Postgres —
 * sem contar que digitação incremental multiplicaria essas idas por cinco.
 *
 * Casa sem acento e por pedaço de palavra, porque quem procura "tres leches"
 * não digita "Tres Leches" e quem procura "choco" não termina a palavra.
 */

export type SearchHit = {
  slug: string;
  name: string;
  image: string | null;
  price: number;
  /** "Desde S/ 95" quando há tamanhos com preços diferentes. */
  fromPrice: boolean;
};

/** Sem acento e em minúsculas, para "limon" casar com "Limón". */
function fold(text: string) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (query.length < 2) return NextResponse.json({ results: [] });

  const term = fold(query);
  const words = term.split(/\s+/).filter(Boolean);
  const products = await getProducts();

  const scored = products
    .map((product) => {
      const name = fold(product.name);
      /* Categoria e sabor entram na busca: "chocolate" tem de achar a torta
         de chocolate mesmo quando a palavra não está no nome dela. */
      const haystack = fold(
        [product.name, ...product.categories.map((c) => c.name), ...product.tags].join(" "),
      );

      let score: number;
      if (name.startsWith(term)) score = 0;
      else if (name.split(/\s+/).some((w) => w.startsWith(term))) score = 1;
      else if (name.includes(term)) score = 2;
      else if (words.every((w) => haystack.includes(w))) score = 3;
      else return null;

      return { product, score };
    })
    .filter((hit): hit is { product: (typeof products)[number]; score: number } => hit !== null)
    .sort((a, b) => a.score - b.score || a.product.name.localeCompare(b.product.name))
    .slice(0, 6);

  const results: SearchHit[] = scored.map(({ product }) => ({
    slug: product.slug,
    name: product.name,
    image: product.images[0]?.src ?? null,
    price: product.priceRange?.min ?? product.price,
    fromPrice: Boolean(product.priceRange && product.priceRange.min !== product.priceRange.max),
  }));

  return NextResponse.json({ results });
}
