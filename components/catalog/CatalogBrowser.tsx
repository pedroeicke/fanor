"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ProductCard } from "@/components/product/ProductCard";
import { Button, Chip, Select } from "@/components/ui/primitives";
import { IconSearch } from "@/components/ui/icons";
import {
  FLAVOR_FILTERS,
  GUEST_FILTERS,
  OCCASIONS,
  displayPrice,
  type CardProduct,
} from "@/lib/catalog";
import { cx } from "@/lib/format";

type Sort = "popular" | "precio-asc" | "precio-desc" | "porciones";

const SORTS: { value: Sort; label: string }[] = [
  { value: "popular", label: "Más populares" },
  { value: "precio-asc", label: "Menor precio" },
  { value: "precio-desc", label: "Mayor precio" },
  { value: "porciones", label: "Más porciones" },
];

const normalize = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

export function CatalogBrowser({
  products,
  initialQuery = "",
  initialFlavor = null,
  /** Quando a página já é de uma ocasião, os chips de ocasião somem. */
  lockedOccasion = null,
}: {
  products: CardProduct[];
  initialQuery?: string;
  initialFlavor?: string | null;
  lockedOccasion?: string | null;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [occasion, setOccasion] = useState<string | null>(null);
  const [flavor, setFlavor] = useState<string | null>(initialFlavor);
  const [guests, setGuests] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>("popular");

  const results = useMemo(() => {
    const q = normalize(query.trim());
    const guestFilter = GUEST_FILTERS.find((g) => g.slug === guests);

    const filtered = products.filter((p) => {
      if (occasion && !p.occasions.includes(occasion)) return false;
      if (flavor && !p.tags.includes(flavor)) return false;
      if (guestFilter && !guestFilter.test(p)) return false;
      if (q && !normalize(`${p.name} ${p.description}`).includes(q)) return false;
      return true;
    });

    const sorted = [...filtered];
    if (sort === "precio-asc") sorted.sort((a, b) => displayPrice(a) - displayPrice(b));
    else if (sort === "precio-desc") sorted.sort((a, b) => displayPrice(b) - displayPrice(a));
    else if (sort === "porciones") sorted.sort((a, b) => b.maxServings - a.maxServings);
    else sorted.sort((a, b) => Number(b.featured) - Number(a.featured));

    return sorted;
  }, [products, query, occasion, flavor, guests, sort]);

  const hasFilters = Boolean(occasion || flavor || guests || query);

  function clearAll() {
    setOccasion(null);
    setFlavor(null);
    setGuests(null);
    setQuery("");
  }

  return (
    <>
      <div className="sticky top-[76px] z-20 -mx-4 border-b border-crema-200 bg-crema/95 px-4 py-4 backdrop-blur-sm sm:-mx-6 sm:px-6 lg:static lg:mx-0 lg:border-0 lg:bg-transparent lg:px-0 lg:backdrop-blur-none">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 sm:-mx-6 sm:px-6 lg:mx-0 lg:flex-wrap lg:overflow-visible lg:px-0">
            <Chip active={!hasFilters} onClick={clearAll}>
              Todas
            </Chip>
            {!lockedOccasion &&
              OCCASIONS.map((o) => (
                <Chip
                  key={o.slug}
                  active={occasion === o.slug}
                  onClick={() => setOccasion(occasion === o.slug ? null : o.slug)}
                >
                  {o.name}
                </Chip>
              ))}
            {FLAVOR_FILTERS.map((f) => (
              <Chip
                key={f.slug}
                active={flavor === f.slug}
                onClick={() => setFlavor(flavor === f.slug ? null : f.slug)}
              >
                {f.name}
              </Chip>
            ))}
          </div>

          {/* Empilhado no celular: a ordenação tem largura própria e o campo de
              busca, com o min-width 0 do reset global, encolhia até sobrar só
              o ícone por cima do texto do select. */}
          <div className="flex flex-col gap-2 sm:flex-row lg:ml-auto lg:shrink-0">
            <label className="relative flex h-11 items-center sm:flex-1 lg:w-56 lg:flex-none">
              <IconSearch className="pointer-events-none absolute left-3.5 h-4 w-4 text-cacao-300" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar tortas..."
                className="h-full w-full rounded-full border border-crema-300 bg-white pl-10 pr-4 text-sm placeholder:text-cacao-300 focus:border-dorado-600"
              />
            </label>
            <Select
              value={sort}
              onChange={(e) => setSort(e.target.value as Sort)}
              aria-label="Ordenar resultados"
              className="h-11 w-full rounded-full text-sm sm:w-auto lg:w-48"
            >
              {SORTS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </Select>
          </div>
        </div>

        {/* Convidados é a pergunta real por trás do tamanho da torta. */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-sm text-cacao-500">¿Para cuántas personas?</span>
          {GUEST_FILTERS.map((g) => (
            <button
              key={g.slug}
              type="button"
              aria-pressed={guests === g.slug}
              onClick={() => setGuests(guests === g.slug ? null : g.slug)}
              className={cx(
                "h-8 rounded-full border px-3.5 text-[13px] font-medium transition-colors",
                guests === g.slug
                  ? "border-cacao bg-cacao text-crema"
                  : "border-crema-300 bg-white text-cacao-700 hover:border-cacao/35",
              )}
            >
              {g.name}
            </button>
          ))}
        </div>
      </div>

      <p className="mt-6 text-sm text-cacao-500" role="status" aria-live="polite">
        {results.length} {results.length === 1 ? "torta" : "tortas"}
        {hasFilters && (
          <button onClick={clearAll} className="ml-3 text-terracota underline underline-offset-4">
            Limpiar filtros
          </button>
        )}
      </p>

      {results.length > 0 ? (
        <div className="mt-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
          {results.map((p, i) => (
            <ProductCard key={p.id} product={p} priority={i < 4} />
          ))}
        </div>
      ) : (
        <div className="mt-10 rounded-2xl border border-dashed border-crema-300 px-6 py-16 text-center">
          <h3 className="text-xl">No encontramos tortas con esos filtros</h3>
          <p className="mx-auto mt-2 max-w-sm text-cacao-500">
            Prueba quitando alguno, o escríbenos y te armamos algo a medida.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Button onClick={clearAll}>Ver todas las tortas</Button>
            <Link
              href="/personalizadas"
              className="inline-flex h-12 items-center rounded-full border border-cacao/25 px-6 text-[15px] font-semibold hover:bg-crema-100"
            >
              Personalizar una torta
            </Link>
          </div>
        </div>
      )}
    </>
  );
}
