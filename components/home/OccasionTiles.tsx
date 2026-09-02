import Image from "next/image";
import Link from "next/link";
import type { Product } from "@/lib/catalog";
import { cdnImage } from "@/lib/format";
import { IconArrowRight } from "@/components/ui/icons";

/**
 * Entrada do catálogo por ocasião.
 *
 * O site antigo entrava por forma geométrica — "Redondas", "Rectangulares",
 * "Semi-Fríos". Ninguém procura um retângulo; procura um cumpleaños.
 */
const TILES = [
  { slug: "cumpleanos", label: "Cumpleaños", cover: "delicia-de-fresa" },
  { slug: "romance", label: "Aniversarios", cover: "alteza-del-dulce-romance" },
  { slug: "para-compartir", label: "Para compartir", cover: "alteza-ambar" },
  { slug: "personalizadas", label: "Personalizadas", cover: "fototorta" },
];

export function OccasionTiles({ covers }: { covers: Record<string, Product | null> }) {
  return (
    <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
      <h2 className="sr-only">Compra por ocasión</h2>
      <ul className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {TILES.map((tile) => {
          const product = covers[tile.cover];
          return (
            <li key={tile.slug}>
              <Link
                href={`/ocasiones/${tile.slug}`}
                className="group relative block aspect-[4/3.6] overflow-hidden rounded-[18px] sm:aspect-[4/3.2]"
              >
                {product && (
                  <Image
                    src={cdnImage(product.images[0].src, 640)}
                    alt=""
                    fill
                    sizes="(min-width:1024px) 300px, 50vw"
                    className="object-cover transition-transform duration-500 group-hover:scale-105"
                  />
                )}
                <span className="absolute inset-0 bg-gradient-to-t from-cacao/80 via-cacao/25 to-transparent" />
                <span className="absolute inset-x-4 bottom-4">
                  <span className="block font-display text-xl font-semibold text-crema drop-shadow-sm sm:text-2xl">
                    {tile.label}
                  </span>
                  <span className="mt-2.5 grid h-8 w-8 place-items-center rounded-full bg-crema/95 text-cacao transition-transform group-hover:translate-x-1">
                    <IconArrowRight className="h-4 w-4" />
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
