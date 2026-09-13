import Link from "next/link";
import { cx } from "@/lib/format";
import { shortStoreName } from "@/lib/gestion/server";

/**
 * Troca de loja nas telas de recepção e vitrina.
 *
 * Links, não um <select> com JavaScript: a loja vai na URL (`?tienda=`), o
 * servidor já renderiza a certa, e o link para um despacho ou para a
 * vitrina carrega a loja junto. Com duas lojas, dois botões grandes são mais
 * rápidos no celular do que abrir uma lista.
 */

type StoreOption = { id: string; name: string; serial_prefix: string };

/** Loja da tela: a pedida na URL, senão a da vendedora do login, senão a primeira. */
export function pickStore<T extends { id: string }>(
  stores: T[],
  requested: string | string[] | undefined,
  sellerStoreId: string | null | undefined,
): T | null {
  const wanted = Array.isArray(requested) ? requested[0] : requested;
  return stores.find((s) => s.id === wanted) ?? stores.find((s) => s.id === sellerStoreId) ?? stores[0] ?? null;
}

export function StorePicker({ stores, currentId, basePath }: { stores: StoreOption[]; currentId: string; basePath: string }) {
  if (stores.length < 2) return null;
  return (
    <nav aria-label="Tienda" className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      {stores.map((s) => {
        const active = s.id === currentId;
        return (
          <Link
            key={s.id}
            href={`${basePath}?tienda=${s.id}`}
            aria-current={active ? "page" : undefined}
            className={cx(
              "inline-flex h-11 shrink-0 items-center gap-2 rounded-full border px-4 text-sm font-semibold transition-colors",
              active ? "border-cacao bg-cacao text-crema" : "border-crema-300 bg-white text-cacao-700 hover:border-cacao/35",
            )}
          >
            <span className={cx("font-mono text-xs", active ? "text-dorado" : "text-cacao-300")}>{s.serial_prefix}</span>
            {shortStoreName(s.name)}
          </Link>
        );
      })}
    </nav>
  );
}
