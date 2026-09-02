"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { IconSearch } from "@/components/ui/icons";
import { cdnImage, soles } from "@/lib/format";
import type { SearchHit } from "@/app/api/buscar/route";

/**
 * Busca do cabeçalho com a torta aparecendo enquanto se digita.
 *
 * Uma lista de nomes não resolveria: quem procura torta reconhece pela foto,
 * não pelo nome — metade do catálogo se chama "Delicia de…" ou "Pasión de…".
 * Com miniatura e preço, dá para decidir sem abrir a página e voltar.
 *
 * Enter sem escolher nada continua indo para `/tortas?q=`, que é a busca
 * completa: a sugestão é atalho para os seis primeiros, não substituta da
 * lista inteira.
 */
export function SearchSuggest({
  className,
  variant = "desktop",
  autoFocus = false,
}: {
  className?: string;
  /** No celular o campo ocupa a largura toda e a lista desce colada nele. */
  variant?: "desktop" | "mobile";
  autoFocus?: boolean;
}) {
  const mobile = variant === "mobile";
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchHit[]>([]);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) return;

    const controller = new AbortController();
    /* 200 ms. Bem menor que a espera da busca de endereço porque aqui não há
       serviço de terceiro do outro lado — é o nosso catálogo em memória. */
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/buscar?q=${encodeURIComponent(term)}`, {
          signal: controller.signal,
        });
        const data = (await response.json()) as { results?: SearchHit[] };
        setResults(data.results ?? []);
        setOpen(true);
        setHighlight(-1);
      } catch {
        /* Abortado pela tecla seguinte, ou rede fora: o Enter ainda leva à
           busca completa. */
      }
    }, 200);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  /* Derivado: some sozinho quando a busca encurta, sem `setState` em efeito. */
  const visible = open && query.trim().length >= 2 ? results : [];

  function go(hit: SearchHit) {
    setOpen(false);
    setQuery("");
    router.push(`/tortas/${hit.slug}`);
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const term = query.trim();
    if (!term) return;
    if (highlight >= 0 && visible[highlight]) {
      go(visible[highlight]);
      return;
    }
    setOpen(false);
    router.push(`/tortas?q=${encodeURIComponent(term)}`);
  }

  return (
    <div ref={boxRef} className={className}>
      <form onSubmit={submit} className="relative">
        <label
          className={`relative flex items-center ${mobile ? "h-12 w-full" : "h-11 w-56"}`}
        >
          <IconSearch
            className={`pointer-events-none absolute text-cacao-300 ${
              mobile ? "left-4 h-[18px] w-[18px]" : "left-3.5 h-4 w-4"
            }`}
          />
          <input
            /* `text`, não `search`: o tipo `search` faz o navegador abrir o
               histórico dele por cima da nossa lista. */
            type="text"
            autoFocus={autoFocus}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => results.length > 0 && setOpen(true)}
            onKeyDown={(e) => {
              if (!visible.length) return;
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setHighlight((i) => (i + 1) % visible.length);
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setHighlight((i) => (i <= 0 ? visible.length - 1 : i - 1));
              } else if (e.key === "Escape") {
                setOpen(false);
              }
            }}
            placeholder="Buscar tortas..."
            autoComplete="off"
            role="combobox"
            aria-expanded={visible.length > 0}
            aria-controls="sugerencias-tortas"
            aria-autocomplete="list"
            className={`h-full w-full rounded-full border border-crema-300 bg-white pr-4 placeholder:text-cacao-300 focus:border-dorado-600 ${
              mobile ? "pl-11 text-[15px]" : "pl-10 text-sm"
            }`}
          />
        </label>

        {visible.length > 0 && (
          <ul
            id="sugerencias-tortas"
            role="listbox"
            className={`absolute top-full z-50 mt-2 overflow-hidden rounded-2xl border border-crema-300 bg-white py-1.5 shadow-lift ${
              mobile ? "inset-x-0" : "right-0 w-80"
            }`}
          >
            {visible.map((hit, i) => (
              <li key={hit.slug} role="option" aria-selected={i === highlight}>
                <button
                  type="button"
                  /* `mousedown`: o `click` só chega depois do blur, e o blur
                     já teria fechado a lista debaixo do cursor. */
                  onMouseDown={(e) => {
                    e.preventDefault();
                    go(hit);
                  }}
                  onMouseEnter={() => setHighlight(i)}
                  className={`flex w-full items-center gap-3 px-3 py-2 text-left transition-colors ${
                    i === highlight ? "bg-crema-100" : ""
                  }`}
                >
                  <span className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-crema-100">
                    {hit.image && (
                      <Image
                        src={cdnImage(hit.image, 96)}
                        alt=""
                        fill
                        sizes="48px"
                        /* `eager`: a lista já está na tela quando aparece, e
                           cada miniatura pesa menos de 1 KB. Com `lazy`, o
                           padrão do next/image, o navegador adia a decisão e
                           a pessoa vê seis quadrados vazios justamente no
                           momento em que está escolhendo pela foto. */
                        loading="eager"
                        className="object-cover"
                      />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-cacao">
                      {hit.name}
                    </span>
                    <span className="block text-[12px] text-cacao-500">
                      {hit.fromPrice ? `Desde ${soles(hit.price)}` : soles(hit.price)}
                    </span>
                  </span>
                </button>
              </li>
            ))}

            <li className="border-t border-crema-200 pt-1">
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  setOpen(false);
                  router.push(`/tortas?q=${encodeURIComponent(query.trim())}`);
                }}
                className="block w-full px-3 py-2 text-left text-[13px] font-medium text-terracota hover:bg-crema-100"
              >
                Ver todos los resultados de “{query.trim()}”
              </button>
            </li>
          </ul>
        )}
      </form>
    </div>
  );
}
