import type { Metadata } from "next";
import { SectionHeading } from "@/components/ui/primitives";
import { FavoritesList } from "@/components/product/FavoritesList";
import { toCard } from "@/lib/catalog";
import { getProducts } from "@/lib/catalog-db";
import { brand } from "@/lib/config";

export const metadata: Metadata = {
  title: "Mi lista de deseos",
  description: `Las tortas que guardaste en ${brand.name}.`,
  /* Lista pessoal: nada a indexar. */
  robots: { index: false, follow: true },
};

export const revalidate = 300;

/**
 * Lista de deseos.
 *
 * O site atual tem o mesmo recurso no cabeçalho, mas exige conta para usar —
 * o que mata o uso. Aqui vive no navegador, sem cadastro: comprar torta é
 * decisão a dois, e a pessoa salva candidatas para consultar e voltar.
 *
 * O catálogo inteiro vem do servidor e a filtragem é no cliente, porque só
 * ele sabe o que está salvo.
 */
export default async function FavoritosPage() {
  const products = (await getProducts()).map(toCard);

  return (
    <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
      <SectionHeading
        as="h1"
        title="Mi lista de deseos"
        subtitle="Las tortas que guardaste para decidir con calma."
      />
      <div className="mt-10">
        <FavoritesList products={products} />
      </div>
    </div>
  );
}
