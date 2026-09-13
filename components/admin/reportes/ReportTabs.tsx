import Link from "next/link";
import { cx } from "@/lib/format";

/**
 * Abas dos relatórios: vendas do site e operação das lojas.
 *
 * O menu tem um link só, "Reportes"; as abas evitam dois itens quase iguais
 * no menu e deixam claro que são números de fontes diferentes.
 */
const TABS = [
  { id: "web", href: "/admin/reportes", label: "Ventas web" },
  { id: "operacion", href: "/admin/reportes/operacion", label: "Operación" },
] as const;

export function ReportTabs({ active }: { active: (typeof TABS)[number]["id"] }) {
  return (
    <nav aria-label="Tipo de reporte" className="flex gap-1 rounded-full border border-crema-300 bg-crema-100 p-1 sm:inline-flex">
      {TABS.map((tab) => (
        <Link
          key={tab.id}
          href={tab.href}
          aria-current={tab.id === active ? "page" : undefined}
          className={cx(
            "flex h-11 flex-1 items-center justify-center rounded-full px-5 text-sm font-semibold transition-colors sm:flex-none",
            tab.id === active ? "bg-white text-cacao shadow-[0_1px_2px_rgb(59_35_20/0.1)]" : "text-cacao-500 hover:text-cacao",
          )}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
