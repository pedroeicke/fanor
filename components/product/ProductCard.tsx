"use client";

import Image from "next/image";
import Link from "next/link";
import type { CardProduct } from "@/lib/catalog";
import { displayPrice } from "@/lib/catalog";
import { cdnImage, cx, solesShort } from "@/lib/format";
import { IconCake, IconChevron, IconHeart } from "@/components/ui/icons";
import { useWishlist } from "@/lib/wishlist";
import { useHydrated } from "@/lib/use-hydrated";

export function ProductCard({ product, priority = false }: { product: CardProduct; priority?: boolean }) {
  const price = displayPrice(product);
  const image = product.image;
  const toggle = useWishlist((s) => s.toggle);
  const saved = useWishlist((s) => s.ids.includes(product.id));

  /* Favoritos vivem no localStorage: só valem depois da hidratação. */
  const mounted = useHydrated();

  return (
    <article className="card group relative flex flex-col overflow-hidden transition-shadow duration-200 hover:shadow-lift">
      <div className="relative aspect-square overflow-hidden bg-crema-100">
        <Link href={`/tortas/${product.slug}`} tabIndex={-1} aria-hidden="true">
          {/* Produto publicado pelo painel antes de receber foto: `src` vazio
              faz o next/image lançar erro e derrubar a vitrine inteira. O
              fundo creme fica no lugar até a imagem existir. */}
          {image.src ? (
            <Image
              src={cdnImage(image.src, 640)}
              alt={image.alt}
              fill
              sizes="(min-width:1280px) 300px, (min-width:768px) 33vw, 50vw"
              priority={priority}
              className="object-cover transition-transform duration-500 group-hover:scale-[1.04]"
            />
          ) : (
            <span className="absolute inset-0 grid place-items-center text-cacao-300">
              <IconCake className="h-10 w-10" />
            </span>
          )}
        </Link>

        <button
          type="button"
          onClick={() => toggle(product.id)}
          aria-pressed={mounted && saved}
          aria-label={saved ? `Quitar ${product.name} de favoritos` : `Guardar ${product.name} en favoritos`}
          className="absolute right-1.5 top-1.5 grid h-11 w-11 place-items-center text-cacao-700 transition-colors hover:text-terracota"
        >
          {/* O círculo branco é um filho, não o botão: assim o alvo de toque tem
              44px — mínimo recomendado — sem o selo visual inchar junto. */}
          <span className="grid h-9 w-9 place-items-center rounded-full bg-white/95 shadow-[0_2px_8px_rgb(59_35_20/0.15)]">
            <IconHeart filled={mounted && saved} className={cx("h-[18px] w-[18px]", mounted && saved && "text-terracota")} />
          </span>
        </button>

        {product.priceRange && (
          <span className="absolute left-3 top-3 rounded-full bg-cacao/85 px-2.5 py-1 text-[11px] font-semibold text-crema backdrop-blur-sm">
            {product.sizeCount} tamaños
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col p-4">
        {/* Empilhado no celular: com duas colunas de card em 375px sobram ~140px
            de texto, e nome ao lado do preço fazia "3 Leches de Moca" quebrar
            uma palavra por linha enquanto o preço invadia o nome. */}
        <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
          <h3 className="font-display text-[1rem] leading-snug sm:text-[1.05rem]">
            <Link href={`/tortas/${product.slug}`} className="after:absolute after:inset-0 after:content-['']">
              {product.name}
            </Link>
          </h3>
          <p className="shrink-0 font-display text-[1rem] font-semibold text-terracota sm:pt-0.5 sm:text-[1.05rem]">
            {product.priceRange && <span className="text-xs font-sans font-medium text-cacao-300">desde </span>}
            {solesShort(price)}
          </p>
        </div>

        <span className="mt-4 flex h-11 items-center justify-center gap-1.5 rounded-full border border-crema-300 text-sm font-medium text-cacao-700 transition-colors group-hover:border-cacao/35 group-hover:bg-crema-100">
          Ver detalles
          <IconChevron className="h-4 w-4" />
        </span>
      </div>
    </article>
  );
}
