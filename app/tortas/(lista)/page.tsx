import type { Metadata } from "next";
import { CatalogBrowser } from "@/components/catalog/CatalogBrowser";
import { SectionHeading } from "@/components/ui/primitives";
import { toCard } from "@/lib/catalog";
import { getProducts } from "@/lib/catalog-db";
import { brand } from "@/lib/config";

/* Revalida a cada 5 min: edição no painel aparece sem novo deploy. */
export const revalidate = 300;

export async function generateMetadata(): Promise<Metadata> {
  const products = await getProducts();
  return {
    title: "Todas las tortas",
    description: `Las ${products.length} tortas de ${brand.name}: filtra por sabor, ocasión o número de invitados, elige la fecha de entrega y recíbela fresca en ${brand.city}.`,
    alternates: { canonical: "/tortas" },
  };
}

export default async function TortasPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; filtro?: string }>;
}) {
  const { q, filtro } = await searchParams;
  /* Só o necessário para o card atravessa a rede — ver CardProduct. */
  const products = (await getProducts()).map(toCard);

  return (
    <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
      <SectionHeading
        as="h1"
        title="Encuentra la torta perfecta"
        subtitle="Elige por sabor, ocasión o número de invitados."
      />

      <div className="mt-10">
        {/* `key` remonta o navegador quando a busca do cabeçalho ou um link do
            rodapé muda a URL estando já em /tortas: sem isso o estado inicial
            ficava preso na primeira consulta e a nova busca não fazia nada. */}
        <CatalogBrowser
          key={`${q ?? ""}|${filtro ?? ""}`}
          products={products}
          initialQuery={q ?? ""}
          initialFlavor={filtro ?? null}
        />
      </div>
    </div>
  );
}
