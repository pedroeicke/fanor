"use client";

import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/primitives";
import type { GeoResult } from "@/app/api/geo/route";
import type { DeliveryCoordinates } from "./DeliveryLocationPicker";

/**
 * Campo de endereço que sugere enquanto se digita.
 *
 * Um campo, não dois: antes havia a caixa "Dirección" e, dentro do mapa,
 * outra caixa de busca. Escrever o endereço duas vezes é trabalho à toa, e a
 * segunda caixa fazia parecer que a primeira não servia para nada.
 *
 * Escolher uma sugestão preenche o texto e marca o ponto no mapa de uma vez.
 * Escrever à mão continua valendo: o pedido não depende da sugestão existir —
 * endereço novo, condomínio recém-construído e apelido de bairro não estão no
 * OpenStreetMap, e quem mora lá não pode ficar impedido de comprar.
 */
export function AddressAutocomplete({
  value,
  onChange,
  onSelect,
  invalid,
  placeholder = "Av. Ejército 1234, dpto. 502",
}: {
  value: string;
  onChange: (address: string) => void;
  onSelect: (place: DeliveryCoordinates & { address: string }) => void;
  invalid?: boolean;
  placeholder?: string;
}) {
  const [results, setResults] = useState<GeoResult[]>([]);
  const [searching, setSearching] = useState(false);
  /**
   * Motivo de a lista estar vazia.
   *
   * Vazio calado é o pior estado possível aqui: quem digita conclui que o
   * campo não funciona e vai embora. Serviço fora do ar, limite atingido e
   * "esse endereço não está no mapa" são três coisas diferentes, e cada uma
   * pede uma reação diferente de quem está comprando.
   */
  const [notice, setNotice] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);

  const boxRef = useRef<HTMLDivElement>(null);
  /* O texto que veio de uma sugestão. Enquanto o campo for igual a ele, não
     há o que buscar de novo — senão escolher um endereço dispara a busca
     desse mesmo endereço e a lista reabre sozinha em cima do mapa. */
  const chosen = useRef<string | null>(null);

  useEffect(() => {
    const term = value.trim();
    /* Três letras já valem uma sugestão: "Mer" tem de trazer Mercaderes. Com
       quatro, quem digita devagar chega a achar que o campo não faz nada. */
    if (term.length < 3 || term === chosen.current) return;

    const controller = new AbortController();
    /* 350 ms: rápido o bastante para a lista acompanhar quem digita, lento o
       bastante para não virar uma chamada por tecla. Photon e Nominatim são
       serviços públicos mantidos por doação. */
    const timer = window.setTimeout(async () => {
      setSearching(true);
      try {
        const response = await fetch(`/api/geo?q=${encodeURIComponent(term)}`, {
          signal: controller.signal,
        });
        const data = (await response.json()) as {
          results?: GeoResult[];
          error?: string;
          unavailable?: boolean;
        };

        if (response.status === 429) {
          setResults([]);
          setNotice(data.error ?? "Demasiadas búsquedas. Espera un momento.");
        } else if (data.unavailable) {
          setResults([]);
          setNotice("La búsqueda no está disponible. Escribe tu dirección y marca el punto en el mapa.");
        } else {
          const found = data.results ?? [];
          setResults(found);
          setNotice(
            found.length
              ? null
              : "No encontramos esa dirección. Escríbela completa y marca el punto en el mapa.",
          );
          setOpen(true);
          setHighlight(-1);
        }
      } catch (error) {
        /* `abort` é o cancelamento da própria digitação, não uma falha. */
        if ((error as Error)?.name !== "AbortError") {
          setNotice("No pudimos buscar ahora. Escribe tu dirección normalmente.");
        }
      } finally {
        setSearching(false);
      }
    }, 350);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [value]);

  /* Fecha ao clicar fora. Sem isto a lista fica aberta cobrindo o mapa. */
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  function choose(result: GeoResult) {
    const text = [result.label, result.detail].filter(Boolean).join(", ");
    chosen.current = text;
    setNotice(null);
    onChange(text);
    onSelect({ lat: result.lat, lng: result.lng, address: text });
    setOpen(false);
    setResults([]);
  }

  const visible = open && results.length > 0 ? results : [];

  return (
    <div ref={boxRef} className="relative">
      <Input
        value={value}
        onChange={(e) => {
          chosen.current = null;
          setNotice(null);
          onChange(e.target.value);
        }}
        onFocus={() => results.length > 0 && setOpen(true)}
        onKeyDown={(e) => {
          if (!visible.length) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setHighlight((i) => (i + 1) % visible.length);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHighlight((i) => (i <= 0 ? visible.length - 1 : i - 1));
          } else if (e.key === "Enter" && highlight >= 0) {
            /* Só intercepta o Enter com item destacado; sem isso, quem digita
               à mão e aperta Enter não conseguiria enviar o formulário. */
            e.preventDefault();
            choose(visible[highlight]);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        placeholder={placeholder}
        /* `off`, e não `street-address`: o preenchimento do navegador abriria
           a lista dele por cima da nossa. */
        autoComplete="off"
        aria-invalid={invalid}
        aria-autocomplete="list"
        aria-expanded={visible.length > 0}
        role="combobox"
        aria-controls="lista-direcciones"
      />

      {searching && (
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-cacao-300">
          Buscando…
        </span>
      )}

      {notice && (
        <p className="mt-1.5 text-[12px] leading-relaxed text-cacao-500">{notice}</p>
      )}

      {visible.length > 0 && (
        <ul
          id="lista-direcciones"
          role="listbox"
          className="absolute inset-x-0 top-full z-20 mt-1 max-h-56 overflow-auto rounded-xl border border-crema-300 bg-white py-1 shadow-lift"
        >
          {visible.map((result, i) => (
            <li key={`${result.lat},${result.lng}`} role="option" aria-selected={i === highlight}>
              <button
                type="button"
                /* `mousedown`, não `click`: o clique só chega depois do blur,
                   e o blur já teria fechado a lista debaixo do cursor. */
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(result);
                }}
                onMouseEnter={() => setHighlight(i)}
                className={`block w-full px-4 py-2.5 text-left transition-colors ${
                  i === highlight ? "bg-crema-100" : ""
                }`}
              >
                <span className="block text-sm font-medium text-cacao">{result.label}</span>
                {result.detail && (
                  <span className="block text-[12px] text-cacao-500">{result.detail}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
