"use client";

import { useId, useMemo, useState } from "react";
import { cx } from "@/lib/format";
import { inputClass } from "@/components/admin/ui";
import type { CatalogProduct } from "./types";

/**
 * Busca de produto por nome ou código do Sisgeco, feita no próprio celular.
 *
 * A vendedora conhece a torta pelo código ("T14") ou por um pedaço do nome
 * ("tres leches"); as duas coisas funcionam, sem acento e em qualquer ordem
 * de palavras. Tocar um resultado soma uma unidade — tocar de novo soma outra.
 */

const MAX_RESULTS = 12;

function normalize(value: string) {
  return value.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
}

export function ProductSearch({
  products,
  onPick,
  picked = {},
  shortcuts = [],
  shortcutsTitle = "Más pedidos",
  placeholder = "Buscar por nombre o código (ej. T26)",
}: {
  products: CatalogProduct[];
  onPick: (product: CatalogProduct) => void;
  /** Quantidade já escolhida por produto, para marcar o que já está na lista. */
  picked?: Record<string, number>;
  shortcuts?: CatalogProduct[];
  shortcutsTitle?: string;
  placeholder?: string;
}) {
  const inputId = useId();
  const [query, setQuery] = useState("");

  const index = useMemo(
    () => products.map((p) => ({ product: p, sku: normalize(p.sku ?? ""), haystack: normalize(`${p.sku ?? ""} ${p.name} ${p.familyName}`) })),
    [products],
  );

  const results = useMemo(() => {
    const q = normalize(query);
    if (!q) return [];
    const tokens = q.split(" ");
    const hits = index.filter((entry) => tokens.every((t) => entry.haystack.includes(t)));
    /* Código digitado exato vem primeiro: quem escreve "t14" quer a T14, não a T140. */
    hits.sort((a, b) => {
      const ea = a.sku === q ? 0 : a.sku.startsWith(q) ? 1 : 2;
      const eb = b.sku === q ? 0 : b.sku.startsWith(q) ? 1 : 2;
      return ea - eb;
    });
    return hits.slice(0, MAX_RESULTS).map((h) => h.product);
  }, [index, query]);

  const list = query.trim() ? results : shortcuts;

  return (
    <div className="space-y-3">
      <label htmlFor={inputId} className="sr-only">
        Buscar producto
      </label>
      <div className="relative">
        <input
          id={inputId}
          type="search"
          inputMode="search"
          autoComplete="off"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
          className={cx(inputClass, "h-12 pr-12")}
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            aria-label="Limpiar búsqueda"
            className="absolute right-1 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full text-lg text-cacao-300 hover:text-cacao"
          >
            ×
          </button>
        )}
      </div>

      {!query.trim() && shortcuts.length > 0 && (
        <p className="text-[12px] font-bold uppercase tracking-[0.1em] text-cacao-300">{shortcutsTitle}</p>
      )}

      {query.trim() && results.length === 0 && (
        <p className="rounded-xl bg-crema-100 px-4 py-3 text-sm text-cacao-500">
          Ningún producto con “{query.trim()}”. Prueba con el código (T14) o parte del nombre.
        </p>
      )}

      {list.length > 0 && (
        <ul className={cx("grid gap-2", !query.trim() && "grid-cols-1 sm:grid-cols-2")}>
          {list.map((p) => {
            const count = picked[p.id] ?? 0;
            return (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => onPick(p)}
                  className={cx(
                    "flex min-h-12 w-full items-center gap-3 rounded-xl border px-3 py-2 text-left transition-colors",
                    count ? "border-dorado bg-dorado-100" : "border-crema-300 bg-white hover:border-cacao/35",
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-medium text-cacao">{p.name}</span>
                    <span className="block text-[12px] text-cacao-300">
                      {p.sku ?? "Sin código"} · {p.familyName}
                    </span>
                  </span>
                  <span
                    aria-hidden
                    className={cx(
                      "flex h-9 min-w-9 shrink-0 items-center justify-center rounded-full px-2 text-sm font-bold",
                      count ? "bg-dorado text-cacao" : "bg-crema-200 text-cacao-500",
                    )}
                  >
                    {count ? count : "+"}
                  </span>
                  <span className="sr-only">{count ? `Agregar otro (${count} en la lista)` : "Agregar"}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
