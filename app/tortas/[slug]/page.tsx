import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Gallery } from "@/components/product/Gallery";
import { ProductPurchase } from "@/components/product/ProductPurchase";
import { TrustBar } from "@/components/product/TrustBar";
import { ProductCard } from "@/components/product/ProductCard";
import { SectionHeading, Stars } from "@/components/ui/primitives";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { displayPrice, relatedProducts, toCard } from "@/lib/catalog";
import { getProduct, getProducts } from "@/lib/catalog-db";
import { REVIEWS, SHOW_REVIEWS, reviewsForProduct } from "@/data/reviews";
import { brand, siteUrl } from "@/lib/config";
import { cdnImage, soles } from "@/lib/format";

/**
 * Sem revalidação por tempo, de propósito.
 *
 * Com ISR ligado aqui, um slug inexistente era renderizado, cacheado e
 * devolvido com **status 200** em vez de 404 — o Google indexaria páginas
 * "não encontrada" como válidas. Toda mutação do painel já chama
 * `revalidatePath` para este caminho, então a revalidação por tempo só
 * acrescentava esse defeito.
 */
export async function generateStaticParams() {
  const products = await getProducts();
  return products.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const product = await getProduct(slug);
  if (!product) return {};

  const description = `${product.description} ${product.defaultServes}. Desde ${soles(
    displayPrice(product),
  )} con entrega programada en ${brand.city}.`;

  return {
    title: product.name,
    description,
    alternates: { canonical: `/tortas/${product.slug}` },
    openGraph: {
      type: "website",
      title: `${product.name} — ${brand.name}`,
      description,
      url: `${siteUrl}/tortas/${product.slug}`,
      /* Largura pedida ao CDN igual à declarada: as fotos são 1080 × 1080. */
      images: [{ url: cdnImage(product.images[0].src, 1080), width: 1080, height: 1080, alt: product.name }],
    },
  };
}

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const product = await getProduct(slug);
  if (!product) notFound();

  const related = relatedProducts(product, await getProducts());
  const reviews = reviewsForProduct(product.slug);
  const shown = SHOW_REVIEWS ? (reviews.length ? reviews : REVIEWS.slice(0, 3)) : [];

  /* JSON-LD com preço e disponibilidade: é o que habilita o rich result de
     produto na busca, que o site atual não tem preenchido. */
  const schema = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    description: product.description,
    image: product.images.map((i) => cdnImage(i.src, 1200)),
    brand: { "@type": "Brand", name: brand.name },
    offers: {
      "@type": "AggregateOffer",
      priceCurrency: "PEN",
      lowPrice: product.priceRange?.min ?? product.price,
      highPrice: product.priceRange?.max ?? product.price,
      offerCount: Math.max(1, product.sizes.length),
      availability: "https://schema.org/InStock",
      url: `${siteUrl}/tortas/${product.slug}`,
    },
    ...(SHOW_REVIEWS && {
      aggregateRating: {
        "@type": "AggregateRating",
        ratingValue: brand.rating,
        reviewCount: brand.reviewCount,
      },
    }),
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }} />

      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <Breadcrumbs
          items={[
            { label: "Inicio", href: "/" },
            { label: "Tortas", href: "/tortas" },
            { label: product.name },
          ]}
        />

        <div className="mt-6 grid gap-10 lg:grid-cols-2 lg:gap-14">
          {/* min-w-0: item de grid não encolhe abaixo do conteúdo por padrão,
              e qualquer mídia com largura intrínseca estoura a coluna. */}
          <div className="min-w-0 lg:sticky lg:top-[100px] lg:self-start">
            <Gallery
              images={product.images}
              spinFrames={product.spinFrames}
              name={product.name}
            />
          </div>

          <div>
            <h1 className="text-[2.25rem] leading-[1.1] sm:text-[2.75rem]">{product.name}</h1>

            {SHOW_REVIEWS && (
              <p className="mt-2.5 flex items-center gap-2 text-sm text-cacao-500">
                <Stars value={brand.rating} size={16} />
                <a href="#resenas" className="underline underline-offset-4 hover:text-cacao">
                  ({brand.reviewCount})
                </a>
              </p>
            )}

            <div className="mt-6">
              <ProductPurchase product={product} />
            </div>
          </div>
        </div>

        <div className="mt-14">
          <TrustBar />
        </div>

        {shown.length > 0 && (
          <section id="resenas" className="mt-16 scroll-mt-28 rounded-[20px] bg-crema-100 p-6 sm:p-10">
            <div className="grid gap-8 lg:grid-cols-[auto_1fr] lg:gap-12">
              <div className="lg:border-r lg:border-crema-300 lg:pr-12">
                <h2 className="text-2xl">Clientes felices</h2>
                <p className="mt-3 flex items-center gap-3">
                  <span className="font-display text-5xl font-semibold leading-none">{brand.rating}</span>
                  <span>
                    <Stars value={brand.rating} size={16} />
                    <span className="mt-1 block text-sm text-cacao-500">{brand.reviewCount} reseñas</span>
                  </span>
                </p>
              </div>
              <ul className="grid gap-4 sm:grid-cols-3">
                {shown.slice(0, 3).map((r) => (
                  <li key={r.id}>
                    <Stars value={r.rating} size={14} />
                    <blockquote className="mt-2 text-[15px] leading-relaxed text-cacao-700">{r.text}</blockquote>
                    <p className="mt-2 text-sm text-cacao-300">{r.author}</p>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        )}

        {related.length > 0 && (
          <section className="mt-16">
            <SectionHeading title="También te puede gustar" />
            <div className="mt-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
              {related.map(toCard).map((p) => (
                <ProductCard key={p.id} product={p} />
              ))}
            </div>
          </section>
        )}
      </div>
    </>
  );
}
