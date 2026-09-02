"use client";

import { ProductCard } from "@/components/product/ProductCard";
import { ButtonLink } from "@/components/ui/primitives";
import { IconHeart } from "@/components/ui/icons";
import { useWishlist } from "@/lib/wishlist";
import { useHydrated } from "@/lib/use-hydrated";
import { ProductGridSkeleton } from "@/components/ui/Skeleton";
import type { CardProduct } from "@/lib/catalog";

export function FavoritesList({ products }: { products: CardProduct[] }) {
  const ids = useWishlist((s) => s.ids);
  const clear = useWishlist((s) => s.clear);
  const mounted = useHydrated();

  /* Os favoritos vivem no localStorage: antes de hidratar não há o que
     mostrar, e um esqueleto evita o salto de layout. */
  if (!mounted) return <ProductGridSkeleton count={4} />;

  const saved = products.filter((p) => ids.includes(p.id));

  if (saved.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-crema-300 px-6 py-16 text-center">
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-crema-100 text-cacao-300">
          <IconHeart className="h-7 w-7" />
        </span>
        <h2 className="mt-4 text-xl">Todavía no guardaste ninguna torta</h2>
        <p className="mx-auto mt-2 max-w-sm text-cacao-500">
          Toca el corazón en cualquier torta y la encontrarás aquí para decidir después.
        </p>
        <ButtonLink href="/tortas" size="lg" className="mt-6">
          Ver todas las tortas
        </ButtonLink>
      </div>
    );
  }

  return (
    <>
      <p className="mb-5 flex flex-wrap items-center gap-3 text-sm text-cacao-500">
        {saved.length} {saved.length === 1 ? "torta guardada" : "tortas guardadas"}
        <button
          type="button"
          onClick={clear}
          className="text-terracota underline underline-offset-4 hover:text-terracota-700"
        >
          Vaciar la lista
        </button>
      </p>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {saved.map((p, i) => (
          <ProductCard key={p.id} product={p} priority={i < 4} />
        ))}
      </div>
    </>
  );
}
