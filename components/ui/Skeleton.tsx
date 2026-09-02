import { cx } from "@/lib/format";

/**
 * Bloco cinza pulsante para o carregamento.
 *
 * O esqueleto imita a forma real do que vem: assim a página não salta quando
 * o conteúdo chega, e a espera parece mais curta do que uma tela em branco.
 */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cx("animate-pulse rounded-lg bg-crema-200", className)} />;
}

export function ProductGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4" aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="card overflow-hidden">
          <Skeleton className="aspect-square rounded-none" />
          <div className="space-y-2 p-4">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
            <Skeleton className="mt-4 h-11 w-full rounded-full" />
          </div>
        </div>
      ))}
    </div>
  );
}
