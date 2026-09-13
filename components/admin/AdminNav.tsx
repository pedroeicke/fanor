"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { cx } from "@/lib/format";

/**
 * Menu do painel, em três grupos.
 *
 * Eram seis telas numa fila; com a operação da loja passaram a ser vinte.
 * Uma fila de vinte botões no celular é rolar até achar. Os grupos seguem
 * quem usa: a vendedora e o taller vivem em "Operación", o Joseka em
 * "Comercial", e o cadastro fica em "Gestión".
 */

type NavLink = { href: string; label: string };
type Group = { id: string; label: string; links: NavLink[] };

const GROUPS: Group[] = [
  {
    id: "operacion",
    label: "Operación",
    links: [
      { href: "/admin", label: "Resumen" },
      { href: "/admin/tienda", label: "Mi vitrina" },
      { href: "/admin/recepcion", label: "Recepción" },
      { href: "/admin/venta", label: "Vender" },
      { href: "/admin/pedidos-tienda", label: "Pedir al taller" },
      { href: "/admin/taller", label: "Taller" },
      { href: "/admin/encomiendas", label: "Encomiendas" },
      { href: "/admin/fotos", label: "Fotos" },
    ],
  },
  {
    id: "comercial",
    label: "Comercial",
    links: [
      { href: "/admin/leads", label: "Leads" },
      { href: "/admin/clientes", label: "Clientes" },
      { href: "/admin/pedidos", label: "Pedidos web" },
      { href: "/admin/ventas", label: "Ventas" },
      { href: "/admin/alertas", label: "Alertas" },
    ],
  },
  {
    id: "gestion",
    label: "Gestión",
    links: [
      { href: "/admin/productos", label: "Productos" },
      { href: "/admin/catalogos", label: "Catálogos" },
      { href: "/admin/estoque", label: "Inventario Sisgeco" },
      { href: "/admin/reportes", label: "Reportes" },
      { href: "/admin/entrega", label: "Entrega" },
      { href: "/admin/respaldos", label: "Respaldos" },
      { href: "/admin/ajustes", label: "Ajustes" },
    ],
  },
];

/** Link ativo = o de caminho mais longo que casa por segmento inteiro.
    Sem isso, "/admin/pedidos" acenderia junto em "/admin/pedidos-tienda". */
function activeHref(pathname: string) {
  let best: string | null = null;
  for (const group of GROUPS) {
    for (const { href } of group.links) {
      const hit = href === "/admin" ? pathname === "/admin" : pathname === href || pathname.startsWith(`${href}/`);
      if (hit && (!best || href.length > best.length)) best = href;
    }
  }
  return best;
}

export function AdminNav() {
  const pathname = usePathname();
  const current = activeHref(pathname);
  const currentGroup = GROUPS.find((g) => g.links.some((l) => l.href === current))?.id ?? "operacion";
  /* O grupo escolhido à mão só vale até a próxima navegação: ao abrir uma
     tela, o menu mostra o grupo dela. */
  const [picked, setPicked] = useState<{ group: string; at: string } | null>(null);
  const openGroup = picked && picked.at === pathname ? picked.group : currentGroup;
  const group = GROUPS.find((g) => g.id === openGroup) ?? GROUPS[0];

  return (
    <nav className="mt-5 space-y-2" aria-label="Secciones del panel">
      <div className="flex gap-1 rounded-full border border-crema-300 bg-crema-100 p-1 sm:inline-flex" role="tablist">
        {GROUPS.map((g) => (
          <button
            key={g.id}
            type="button"
            role="tab"
            aria-selected={g.id === openGroup}
            onClick={() => setPicked({ group: g.id, at: pathname })}
            className={cx(
              "h-10 flex-1 rounded-full px-4 text-sm font-semibold transition-colors sm:flex-none",
              g.id === openGroup ? "bg-white text-cacao shadow-[0_1px_2px_rgb(59_35_20/0.1)]" : "text-cacao-500 hover:text-cacao",
            )}
          >
            {g.label}
          </button>
        ))}
      </div>

      <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1">
        {group.links.map((link) => {
          const active = link.href === current;
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
      </div>
    </nav>
  );
}
