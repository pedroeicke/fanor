"use client";

import { useRef, useState, useTransition } from "react";
import { searchProducts } from "@/app/admin/(panel)/venta/actions";
import { inputClass, labelClass } from "@/components/admin/ui";
import { money } from "./money";
import type { ProductHit } from "./types";

/**
 * Busca de tudo que não tem etiqueta: empanada, vela, gaseosa, pastel.
 *
 * Busca enquanto digita, com uma pausa curta: as ações do servidor saem uma
 * de cada vez, e uma busca por letra enfileiraria atrás da cobrança. Resposta
 * velha que chega depois da nova é descartada.
 *
 * Os resultados ficam na tela depois de tocar: três empanadas são três
 * toques no mesmo botão.
 */
export function ProductSearch({ onPick, disabled }: { onPick: (product: ProductHit) => void; disabled?: boolean }) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<ProductHit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null);
  const [searching, startSearch] = useTransition();
  const timer = useRef<number | undefined>(undefined);
  const seq = useRef(0);

  function run(value: string) {
    const id = ++seq.current;
    startSearch(async () => {
      try {
        const result = await searchProducts(value);
        if (id !== seq.current) return;
        if (result.ok) {
          setHits(result.data);
          setError(null);
        } else {
          setHits(null);
          setError(result.error);
        }
      } catch {
        if (id === seq.current) setError("Sin conexión. Vuelve a intentar.");
      }
    });
  }

  function change(value: string) {
    setQuery(value);
    setAdded(null);
    window.clearTimeout(timer.current);
    if (value.trim().length < 2) {
      seq.current++;
      setHits(null);
      setError(null);
      return;
    }
    timer.current = window.setTimeout(() => run(value), 300);
  }

  function pick(product: ProductHit) {
    onPick(product);
    setAdded(product.name);
  }

  return (
    <section className="card p-4 sm:p-5">
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          window.clearTimeout(timer.current);
          if (query.trim()) run(query);
        }}
      >
        <label htmlFor="venta-producto" className={labelClass}>Otro producto</label>
        <input
          id="venta-producto"
          type="search"
          enterKeyHint="search"
          autoComplete="off"
          placeholder="Nombre o código, ej. empanada o E3"
          value={query}
          onChange={(e) => change(e.target.value)}
          className={inputClass}
        />
      </form>

      <div aria-live="polite">
        {searching && <p className="mt-2 text-sm text-cacao-300">Buscando…</p>}
        {error && <p className="mt-2 text-sm text-terracota">{error}</p>}
        {added && <p className="mt-2 text-sm font-medium text-verde">Agregado al carrito: {added}</p>}
        {!searching && hits?.length === 0 && (
          <p className="mt-2 text-sm text-cacao-500">
            No encontramos productos con ese nombre. Las tortas se venden escaneando la etiqueta.
          </p>
        )}
      </div>

      {!!hits?.length && (
        <ul className="-mx-2 mt-2 divide-y divide-crema-200">
          {hits.map((hit) => (
            <li key={hit.id}>
              <button
                type="button"
                disabled={disabled}
                onClick={() => pick(hit)}
                className="flex min-h-14 w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-crema-100 disabled:opacity-50"
              >
                <span className="min-w-0 flex-1">
                  <span className="block font-medium leading-snug text-cacao">{hit.name}</span>
                  <span className="block text-[13px] text-cacao-300">
                    {[hit.sku, hit.family].filter(Boolean).join(" · ")}
                  </span>
                </span>
                <span className="shrink-0 text-sm tabular-nums text-cacao-700">
                  {hit.suggestedCents === null ? "Sin precio" : money(hit.suggestedCents)}
                </span>
                <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-dorado text-xl font-semibold text-cacao">
                  +
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
