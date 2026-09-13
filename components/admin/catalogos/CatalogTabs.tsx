import Link from "next/link";
import { cx } from "@/lib/format";
import { CATALOG_TABS, type CatalogTab } from "./config";

/**
 * Abas por link (`?t=`), não por estado: a vendedora que recarrega a página
 * ou compartilha o endereço cai na mesma aba, e cada aba só busca os dados
 * dela no servidor.
 */
export function CatalogTabs({ active }: { active: CatalogTab }) {
  return (
    <nav className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:px-0" aria-label="Catálogos">
      {CATALOG_TABS.map((tab) => {
        const current = tab.key === active;
        return (
          <Link
            key={tab.key}
            href={`/admin/catalogos?t=${tab.key}`}
            aria-current={current ? "page" : undefined}
            scroll={false}
            className={cx(
              "inline-flex h-11 shrink-0 items-center rounded-full border px-5 text-sm font-medium transition-colors",
              current ? "border-cacao bg-cacao text-crema" : "border-crema-300 bg-white text-cacao-700 hover:border-cacao/35",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
