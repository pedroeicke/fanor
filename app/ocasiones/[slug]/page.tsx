import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CatalogBrowser } from "@/components/catalog/CatalogBrowser";
import { ButtonLink, SectionHeading } from "@/components/ui/primitives";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { OCCASIONS, getOccasion, toCard } from "@/lib/catalog";
import { getProductsByOccasion } from "@/lib/catalog-db";
import { brand } from "@/lib/config";

export function generateStaticParams() {
  return OCCASIONS.map((o) => ({ slug: o.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const occasion = getOccasion(slug);
  if (!occasion) return {};

  const count = (await getProductsByOccasion(slug)).length;
  return {
    title: occasion.headline,
    /* "0 opciones" na descrição de busca afastaria o clique. */
    description:
      count > 0
        ? `${occasion.blurb} ${count} opciones con entrega programada en ${brand.city}: eliges día y horario al comprar.`
        : `${occasion.blurb} Tortas a medida con entrega programada en ${brand.city}: eliges día y horario al comprar.`,
    alternates: { canonical: `/ocasiones/${occasion.slug}` },
  };
}

export default async function OccasionPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const occasion = getOccasion(slug);
  if (!occasion) notFound();

  const list = (await getProductsByOccasion(slug)).map(toCard);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <Breadcrumbs
        items={[
          { label: "Inicio", href: "/" },
          { label: "Ocasiones", href: "/ocasiones" },
          { label: occasion.name },
        ]}
      />

      <div className="mt-8">
        <SectionHeading as="h1" title={occasion.headline} subtitle={occasion.blurb} />
      </div>

      <div className="mt-10">
        {list.length > 0 ? (
          <CatalogBrowser products={list} lockedOccasion={occasion.slug} />
        ) : (
          /* Sem produto vinculado, o filtro diria "no encontramos tortas con
             esos filtros" — e não há filtro nenhum. A saída útil é a torta a
             medida, que serve a qualquer ocasião. */
          <div className="rounded-2xl border border-dashed border-crema-300 px-6 py-16 text-center">
            <h2 className="text-xl">Todavía no tenemos tortas publicadas para esta ocasión</h2>
            <p className="mx-auto mt-2 max-w-md text-cacao-500">
              Arma la tuya paso a paso con precio cerrado, o escríbenos y te recomendamos una del
              catálogo.
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <ButtonLink href="/personalizadas" size="lg">
                Personalizar una torta
              </ButtonLink>
              <ButtonLink href="/tortas" size="lg" variant="outline">
                Ver todas las tortas
              </ButtonLink>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
