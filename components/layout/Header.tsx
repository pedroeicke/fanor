"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { Logo } from "./Logo";
import { useCart } from "@/lib/cart";
import { useWishlist } from "@/lib/wishlist";
import { OCCASIONS } from "@/lib/catalog";
import { cx, soles } from "@/lib/format";
import {
  IconCart,
  IconChevronDown,
  IconClose,
  IconHeart,
  IconMenu,
  IconSearch,
  IconTruck,
} from "@/components/ui/icons";
import { brand } from "@/lib/config";
import { useHydrated } from "@/lib/use-hydrated";

const NAV = [
  { href: "/", label: "Inicio" },
  { href: "/tortas", label: "Tortas" },
  { href: "/ocasiones", label: "Ocasiones", children: OCCASIONS },
  { href: "/personalizadas", label: "Personalizadas" },
  { href: "/nosotros", label: "Nosotros" },
];

export function TopBar() {
  return (
    <div className="bg-dorado text-cacao">
      <p className="mx-auto flex max-w-7xl items-center justify-center gap-2.5 px-4 py-2.5 text-[13px] sm:text-sm font-semibold">
        <IconTruck className="h-[1.15em] w-[1.15em]" />
        {/* Texto do próprio site atual — não inventar cidade aqui. */}
        Contamos con servicio de delivery express
      </p>
    </div>
  );
}

export function Header() {
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");

  const itemCount = useCart((s) =>
    s.items.reduce((n, i) => n + i.qty, 0) + s.addons.reduce((n, a) => n + a.qty, 0),
  );
  /* O site atual mostra o valor ao lado do carrinho, não só a contagem — é o
     número que a pessoa quer conferir antes de decidir continuar comprando. */
  const cartTotal = useCart((s) =>
    s.items.reduce((sum, i) => sum + i.unitPrice * i.qty, 0) +
    s.addons.reduce((sum, a) => sum + a.unitPrice * a.qty, 0),
  );
  const openDrawer = useCart((s) => s.openDrawer);
  const savedCount = useWishlist((w) => w.ids.length);

  /* O contador só é confiável depois da hidratação — evita mismatch de SSR. */
  const mounted = useHydrated();

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  function submitSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    router.push(`/tortas?q=${encodeURIComponent(query.trim())}`);
    setSearchOpen(false);
  }

  return (
    <header className="sticky top-0 z-40 border-b border-crema-200 bg-crema/95 backdrop-blur-sm">
      <div className="mx-auto flex h-[76px] max-w-7xl items-center gap-4 px-4 sm:px-6 lg:px-8">
        <button
          type="button"
          onClick={() => setMenuOpen(true)}
          className="-ml-2 grid h-11 w-11 place-items-center lg:hidden"
          aria-label="Abrir menú"
        >
          <IconMenu className="h-6 w-6" />
        </button>

        <Link href="/" className="shrink-0" aria-label={`${brand.name} — inicio`}>
          <Logo priority className="h-11 sm:h-12 lg:h-14" />
        </Link>

        <nav className="ml-auto hidden items-center gap-8 lg:flex" aria-label="Principal">
          {NAV.map((item) => (
            <div key={item.href} className="group relative">
              <Link
                href={item.href}
                className={cx(
                  "relative flex items-center gap-1 py-6 text-[15px] font-medium transition-colors",
                  isActive(item.href) ? "text-cacao" : "text-cacao-700 hover:text-cacao",
                )}
              >
                {item.label}
                {item.children && <IconChevronDown className="h-3.5 w-3.5 opacity-60" />}
                <span
                  className={cx(
                    "absolute inset-x-0 bottom-4 h-0.5 rounded-full bg-dorado transition-opacity",
                    isActive(item.href) ? "opacity-100" : "opacity-0",
                  )}
                />
              </Link>

              {item.children && (
                <div className="invisible absolute left-1/2 top-full w-60 -translate-x-1/2 pt-1 opacity-0 transition-all group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100">
                  <ul className="card overflow-hidden p-1.5">
                    {item.children.map((c) => (
                      <li key={c.slug}>
                        <Link
                          href={`/ocasiones/${c.slug}`}
                          className="block rounded-lg px-3.5 py-2.5 text-[15px] text-cacao-700 hover:bg-crema-100 hover:text-cacao"
                        >
                          {c.name}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-1 lg:ml-6">
          <form onSubmit={submitSearch} className="hidden xl:block">
            <label className="relative flex h-11 w-56 items-center">
              <IconSearch className="pointer-events-none absolute left-3.5 h-4 w-4 text-cacao-300" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar tortas..."
                className="h-full w-full rounded-full border border-crema-300 bg-white pl-10 pr-4 text-sm placeholder:text-cacao-300 focus:border-dorado-600"
              />
            </label>
          </form>

          <button
            type="button"
            onClick={() => setSearchOpen((v) => !v)}
            className="grid h-11 w-11 place-items-center text-cacao-700 hover:text-cacao xl:hidden"
            aria-label="Buscar"
            aria-expanded={searchOpen}
          >
            <IconSearch className="h-[22px] w-[22px]" />
          </button>

          <Link
            href="/favoritos"
            className="relative hidden p-2.5 text-cacao-700 hover:text-cacao sm:block"
            aria-label={`Mi lista de deseos, ${mounted ? savedCount : 0} tortas`}
          >
            <IconHeart className="h-[22px] w-[22px]" />
            {mounted && savedCount > 0 && (
              <span className="absolute -right-0.5 -top-0.5 grid h-[19px] min-w-[19px] place-items-center rounded-full bg-terracota px-1 text-[11px] font-bold tabular-nums text-white">
                {savedCount}
              </span>
            )}
          </Link>

          <button
            type="button"
            onClick={openDrawer}
            className="relative flex min-h-11 min-w-11 items-center justify-center gap-2 px-2.5 text-cacao-700 hover:text-cacao"
            aria-label={`Carrito, ${mounted ? itemCount : 0} artículos, ${soles(mounted ? cartTotal : 0)}`}
          >
            {mounted && itemCount > 0 && (
              <span className="hidden text-sm font-semibold tabular-nums sm:block">
                {soles(cartTotal)}
              </span>
            )}
            <span className="relative">
              <IconCart className="h-[22px] w-[22px]" />
              <span
                className={cx(
                  "absolute -right-1.5 -top-1.5 grid h-[19px] min-w-[19px] place-items-center rounded-full px-1 text-[11px] font-bold tabular-nums transition-colors",
                  mounted && itemCount > 0 ? "bg-terracota text-white" : "bg-crema-300 text-cacao-700",
                )}
              >
                {mounted ? itemCount : 0}
              </span>
            </span>
          </button>
        </div>
      </div>

      {searchOpen && (
        <form onSubmit={submitSearch} className="border-t border-crema-200 px-4 py-3 xl:hidden">
          <label className="relative flex h-12 items-center">
            <IconSearch className="pointer-events-none absolute left-4 h-[18px] w-[18px] text-cacao-300" />
            <input
              autoFocus
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar tortas..."
              className="h-full w-full rounded-full border border-crema-300 bg-white pl-11 pr-4 text-[15px] placeholder:text-cacao-300 focus:border-dorado-600"
            />
          </label>
        </form>
      )}

      {menuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            className="absolute inset-0 bg-cacao/40"
            onClick={() => setMenuOpen(false)}
            aria-label="Cerrar menú"
          />
          <nav className="absolute inset-y-0 left-0 flex w-[84%] max-w-sm flex-col bg-crema shadow-lift">
            <div className="flex items-center justify-between border-b border-crema-200 px-5 py-4">
              <Logo className="h-11" />
              <button onClick={() => setMenuOpen(false)} className="p-2" aria-label="Cerrar menú">
                <IconClose className="h-6 w-6" />
              </button>
            </div>
            <ul className="flex-1 overflow-y-auto px-3 py-4">
              {NAV.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={() => setMenuOpen(false)}
                    className={cx(
                      "block rounded-xl px-4 py-3 text-lg font-medium",
                      isActive(item.href) ? "bg-dorado-100 text-cacao" : "text-cacao-700",
                    )}
                  >
                    {item.label}
                  </Link>
                  {item.children && (
                    <ul className="mb-2 ml-4 border-l border-crema-300 pl-3">
                      {item.children.map((c) => (
                        <li key={c.slug}>
                          <Link
                            href={`/ocasiones/${c.slug}`}
                            onClick={() => setMenuOpen(false)}
                            className="block rounded-lg px-3 py-2 text-[15px] text-cacao-500"
                          >
                            {c.name}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </nav>
        </div>
      )}
    </header>
  );
}
