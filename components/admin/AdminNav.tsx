"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/lib/format";

const LINKS = [
  { href: "/admin", label: "Resumen" },
  { href: "/admin/pedidos", label: "Pedidos" },
  { href: "/admin/reportes", label: "Reportes" },
  { href: "/admin/productos", label: "Productos" },
  { href: "/admin/entrega", label: "Entrega" },
];

export function AdminNav() {
  const pathname = usePathname();

  return (
    <nav className="no-scrollbar mt-5 flex gap-2 overflow-x-auto" aria-label="Secciones del panel">
      {LINKS.map((link) => {
        const active = link.href === "/admin" ? pathname === "/admin" : pathname.startsWith(link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={cx(
              "h-10 shrink-0 rounded-full border px-5 text-sm font-medium leading-[2.4rem] transition-colors",
              active
                ? "border-dorado bg-dorado text-cacao"
                : "border-crema-300 bg-white text-cacao-700 hover:border-cacao/35",
            )}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
