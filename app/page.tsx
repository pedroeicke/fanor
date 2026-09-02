import Image from "next/image";
import { Hero } from "@/components/home/Hero";
import { OccasionTiles } from "@/components/home/OccasionTiles";
import { TrustStrip } from "@/components/home/TrustStrip";
import { HowItWorks } from "@/components/home/HowItWorks";
import { Reviews } from "@/components/home/Reviews";
import { ProductCard } from "@/components/product/ProductCard";
import { ButtonLink, SectionHeading } from "@/components/ui/primitives";
import { IconArrowRight } from "@/components/ui/icons";
import { toCard } from "@/lib/catalog";
import { getBestSellers, getProducts, getProductsBySlug } from "@/lib/catalog-db";
import { cdnImage } from "@/lib/format";
import { getDeliveryConfig } from "@/lib/delivery-db";
import { soles } from "@/lib/format";

export const revalidate = 300;

/* Capas fixas da home. Slugs num só lugar para uma única ida ao banco. */
const COVER_SLUGS = [
  "delicia-de-fresa",
  "alteza-del-dulce-romance",
  "alteza-ambar",
  "fototorta",
];

export default async function HomePage() {
  const [bestSellers, covers, deliveryConfig, catalog] = await Promise.all([
    getBestSellers(),
    getProductsBySlug(COVER_SLUGS),
    getDeliveryConfig(),
    /* `getProducts` é cacheado por render: as quatro leituras batem no banco
       uma vez só. A contagem vem daqui para o botão não mentir quando o
       painel publica ou despublica uma torta. */
    getProducts(),
  ]);
  const FREE_DELIVERY_FROM = deliveryConfig.freeFrom;
  const featured = covers.fototorta;

  return (
    <>
      <Hero />
      <OccasionTiles covers={covers} />
      <TrustStrip />

      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <SectionHeading
          title="Los más pedidos"
          subtitle="Las que más salen de nuestro horno, semana tras semana."
        />
        <div className="mt-10 grid grid-cols-2 gap-4 lg:grid-cols-4">
          {bestSellers.slice(0, 8).map(toCard).map((p, i) => (
            <ProductCard key={p.id} product={p} priority={i < 2} />
          ))}
        </div>
        <div className="mt-10 text-center">
          <ButtonLink href="/tortas" variant="outline" size="lg">
            Ver las {catalog.length} tortas
            <IconArrowRight className="h-[18px] w-[18px]" />
          </ButtonLink>
        </div>
      </section>

      <HowItWorks />

      {/* Personalização: o produto de maior margem e o que o site antigo
          simplesmente não vendia — a "FotoTorta" não tinha nem campo de foto. */}
      <section className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid overflow-hidden rounded-[24px] bg-cacao text-crema lg:grid-cols-2">
          <div className="flex flex-col justify-center p-8 sm:p-12 lg:p-14">
            <p className="font-sans text-xs font-bold uppercase tracking-[0.18em] text-dorado">
              Tortas personalizadas
            </p>
            <h2 className="mt-3 text-3xl text-crema sm:text-4xl">
              Tu foto, tu mensaje,
              <br /> tu diseño
            </h2>
            <p className="mt-4 max-w-md leading-relaxed text-crema/75">
              Sube tu imagen y escribe el texto directamente aquí. Lo imprimimos en calidad
              fotográfica comestible y lo horneamos para la fecha que elijas.
            </p>
            <div className="mt-8">
              <ButtonLink href="/personalizadas" size="lg">
                Personalizar mi torta
                <IconArrowRight className="h-[18px] w-[18px]" />
              </ButtonLink>
            </div>
          </div>

          <div className="relative min-h-[280px] lg:min-h-[420px]">
            {featured && (
              <Image
                src={cdnImage(featured.images[0].src, 900)}
                alt="FotoTorta con imagen impresa en calidad fotográfica"
                fill
                sizes="(min-width:1024px) 600px, 100vw"
                className="object-cover"
              />
            )}
          </div>
        </div>
      </section>

      <div className="mt-16">
        <Reviews />
      </div>

      <section className="mx-auto max-w-7xl px-4 py-16 text-center sm:px-6 lg:px-8">
        <SectionHeading
          title="¿Aún no sabes cuál elegir?"
          subtitle={`Cuéntanos de tu celebración y te recomendamos. Delivery de cortesía en pedidos desde ${soles(FREE_DELIVERY_FROM)}.`}
        />
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <ButtonLink href="/tortas" size="lg">
            Explorar el catálogo
          </ButtonLink>
          <ButtonLink href="/ocasiones/cumpleanos" size="lg" variant="outline">
            Ver tortas de cumpleaños
          </ButtonLink>
        </div>
      </section>
    </>
  );
}
