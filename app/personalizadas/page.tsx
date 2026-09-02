import type { Metadata } from "next";
import { CakeBuilder } from "@/components/custom/CakeBuilder";
import { SectionHeading } from "@/components/ui/primitives";
import { CUSTOM_FROM_PRICE, CUSTOM_STYLES } from "@/lib/custom-cake";
import { getProductsBySlug } from "@/lib/catalog-db";
import { soles } from "@/lib/format";
import { brand } from "@/lib/config";

export const metadata: Metadata = {
  title: "Tortas personalizadas",
  description: `Arma tu torta paso a paso: tamaño, estilo, sabores, tu foto y tu mensaje. Precio cerrado desde ${soles(
    CUSTOM_FROM_PRICE,
  )} y entrega programada en ${brand.city}.`,
  alternates: { canonical: "/personalizadas" },
};

export const revalidate = 300;

export default async function PersonalizadasPage() {
  const covers = await getProductsBySlug(CUSTOM_STYLES.map((s) => s.cover));
  return (
    <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
      <SectionHeading
        as="h1"
        title={
          <>
            Crea una torta tan única
            <br className="hidden sm:block" /> como tu celebración
          </>
        }
        subtitle="Personalízala paso a paso y ve el precio final mientras la armas. Sin cotizaciones por chat."
      />

      <div className="mt-12">
        <CakeBuilder covers={covers} />
      </div>
    </div>
  );
}
