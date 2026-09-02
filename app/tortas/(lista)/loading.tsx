/**
 * Esqueleto da vitrine.
 *
 * Vive num grupo de rota, não em `app/tortas/`, de propósito: um `loading.tsx`
 * no nível do segmento envolveria também `[slug]`, e a fronteira de Suspense
 * faz o Next enviar o status 200 antes de a página resolver — um produto
 * inexistente respondia 200 em vez de 404, e o Google indexaria páginas
 * "não encontrada" como válidas.
 */
import { ProductGridSkeleton } from "@/components/ui/Skeleton";
import { SectionHeading } from "@/components/ui/primitives";

export default function Loading() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
      <SectionHeading
        as="h1"
        title="Encuentra la torta perfecta"
        subtitle="Elige por sabor, ocasión o número de invitados."
      />
      <div className="mt-16">
        <ProductGridSkeleton />
      </div>
    </div>
  );
}
