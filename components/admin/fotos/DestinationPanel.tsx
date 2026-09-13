"use client";

import Image from "next/image";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { findCake, searchProducts } from "@/app/admin/(panel)/fotos/actions";
import { cx } from "@/lib/format";
import { CAKE_STATUS } from "@/lib/gestion/labels";
import type { ParsedQr } from "@/lib/gestion/qr";
import type { CakeOption, ProductOption } from "@/lib/photo/types";
import { QrScanner } from "@/components/admin/QrScanner";
import { Notice, StatusPill, inputClass } from "@/components/admin/ui";
import { PRODUCT_STATUS, thumbnailSrc } from "./shared";

export type DestinationMode = "product" | "cake";

const OFFLINE = "Sin conexión. Revisa tu internet e inténtalo de nuevo.";

/**
 * Onde a foto vai parar: na galeria de um produto do site ou numa torta
 * física da vitrina (pela série da etiqueta).
 *
 * As duas escolhas ficam guardadas ao trocar de aba — quem abre a aba errada
 * por engano não perde o produto que já tinha achado.
 */
export function DestinationPanel({
  mode,
  onModeChange,
  product,
  onProductChange,
  cake,
  onCakeChange,
  disabled,
}: {
  mode: DestinationMode;
  onModeChange: (mode: DestinationMode) => void;
  product: ProductOption | null;
  onProductChange: (product: ProductOption | null) => void;
  cake: CakeOption | null;
  onCakeChange: (cake: CakeOption | null) => void;
  disabled: boolean;
}) {
  const tabs: { id: DestinationMode; label: string }[] = [
    { id: "product", label: "Producto del sitio" },
    { id: "cake", label: "Torta de la vitrina" },
  ];

  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="Destino de la foto" className="grid grid-cols-2 gap-1 rounded-full bg-crema-100 p-1">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={mode === tab.id}
            onClick={() => onModeChange(tab.id)}
            className={cx(
              "min-h-11 rounded-full px-2 py-1 text-[13px] font-semibold leading-tight transition-colors sm:text-[14px]",
              mode === tab.id ? "bg-cacao text-crema shadow-card" : "text-cacao-500 hover:text-cacao",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {mode === "product" ? (
        product ? (
          <SelectedProduct product={product} onClear={() => onProductChange(null)} disabled={disabled} />
        ) : (
          <ProductPicker onSelect={onProductChange} />
        )
      ) : cake ? (
        <SelectedCake cake={cake} onClear={() => onCakeChange(null)} disabled={disabled} />
      ) : (
        <CakePicker onSelect={onCakeChange} />
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Produto                                                                   */
/* -------------------------------------------------------------------------- */

function ProductPicker({ onSelect }: { onSelect: (product: ProductOption) => void }) {
  const inputId = useId();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ProductOption[]>([]);
  const [answered, setAnswered] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const timer = useRef<number | undefined>(undefined);
  const sequence = useRef(0);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  /* Espera a vendedora parar de digitar: ação de servidor roda uma por vez,
     e uma busca por letra enfileiraria respostas velhas. */
  function onQuery(value: string) {
    setQuery(value);
    window.clearTimeout(timer.current);
    const text = value.trim();
    if (text.length < 2) {
      sequence.current++;
      setResults([]);
      setAnswered("");
      setError(null);
      return;
    }
    timer.current = window.setTimeout(() => {
      const id = ++sequence.current;
      startTransition(async () => {
        /* Sem rede a ação lança em vez de devolver erro; sem o catch, o
           React derrubaria a tela inteira com a foto já tratada. */
        const result = await searchProducts(text).catch(() => null);
        if (id !== sequence.current) return;
        if (!result || !result.ok) {
          setError(result?.error ?? OFFLINE);
          return;
        }
        setError(null);
        setResults(result.data);
        setAnswered(text);
      });
    }, 300);
  }

  const text = query.trim();

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
          onChange={(e) => onQuery(e.target.value)}
          placeholder="Buscar por nombre o código (ej. Selva Negra, T26)"
          className={cx(inputClass, "h-12 pr-12")}
        />
        {query && (
          <button
            type="button"
            onClick={() => onQuery("")}
            aria-label="Limpiar búsqueda"
            className="absolute right-1 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full text-lg text-cacao-300 hover:text-cacao"
          >
            ×
          </button>
        )}
      </div>

      {pending && <p className="text-[13px] text-cacao-300" role="status">Buscando…</p>}
      {error && <Notice tone="bad">{error}</Notice>}

      {text.length >= 2 && !pending && answered === text && results.length === 0 && !error && (
        <p className="rounded-xl bg-crema-100 px-4 py-3 text-sm text-cacao-500">
          Ningún producto con “{text}”. Prueba con otra palabra o el código.
        </p>
      )}
      {text.length < 2 && (
        <p className="text-[13px] text-cacao-300">Escribe al menos dos letras. Aparecen publicados y borradores.</p>
      )}

      {results.length > 0 && (
        <ul className="grid gap-2">
          {results.map((product) => (
            <li key={product.id}>
              <button
                type="button"
                onClick={() => onSelect(product)}
                className="flex min-h-14 w-full items-center gap-3 rounded-xl border border-crema-300 bg-white px-2.5 py-2 text-left transition-colors hover:border-cacao/35"
              >
                <Thumb url={product.cover} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-medium text-cacao">{product.name}</span>
                  <span className="block text-[12px] text-cacao-300">
                    {product.sku ?? "Sin código"} · {PRODUCT_STATUS[product.status]?.label ?? product.status}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SelectedProduct({ product, onClear, disabled }: { product: ProductOption; onClear: () => void; disabled: boolean }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-dorado bg-dorado-100 p-3">
      <Thumb url={product.cover} large />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-cacao">{product.name}</p>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-cacao-500">
          {product.sku && <span>{product.sku}</span>}
          <StatusPill status={product.status} map={PRODUCT_STATUS} />
        </p>
      </div>
      <button
        type="button"
        onClick={onClear}
        disabled={disabled}
        className="h-11 shrink-0 rounded-full border border-cacao/25 bg-white px-4 text-sm font-semibold text-cacao disabled:opacity-50"
      >
        Cambiar
      </button>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Torta                                                                     */
/* -------------------------------------------------------------------------- */

function CakePicker({ onSelect }: { onSelect: (cake: CakeOption) => void }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function lookup(parsed: ParsedQr) {
    if (parsed.type !== "cake") {
      setError("Ese es el QR de la guía de despacho. Escanea la etiqueta de la torta.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await findCake(parsed.serial).catch(() => null);
      if (!result || !result.ok) {
        setError(result?.error ?? OFFLINE);
        return;
      }
      onSelect(result.data);
    });
  }

  return (
    <div className="space-y-3">
      <QrScanner onScan={lookup} label="Escanear etiqueta de la torta" />
      {pending && <p className="text-[13px] text-cacao-300" role="status">Buscando la torta…</p>}
      {error && <Notice tone="bad">{error}</Notice>}
    </div>
  );
}

function SelectedCake({ cake, onClear, disabled }: { cake: CakeOption; onClear: () => void; disabled: boolean }) {
  return (
    <div className="space-y-3">
      <div className={cx("flex items-center gap-3 rounded-2xl border p-3", cake.blockedReason ? "border-crema-300 bg-crema-100" : "border-dorado bg-dorado-100")}>
        <Thumb url={cake.photoUrl} large />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-cacao">{cake.productName}</p>
          <p className="font-mono text-[13px] text-cacao-700">{cake.serial}</p>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-cacao-500">
            <StatusPill status={cake.status} map={CAKE_STATUS} />
            <span>
              {cake.storeName} · vence {cake.expiresLabel}
            </span>
          </p>
        </div>
        <button
          type="button"
          onClick={onClear}
          disabled={disabled}
          className="h-11 shrink-0 rounded-full border border-cacao/25 bg-white px-4 text-sm font-semibold text-cacao disabled:opacity-50"
        >
          Cambiar
        </button>
      </div>
      {cake.blockedReason && <Notice tone="bad">{cake.blockedReason}</Notice>}
      {!cake.blockedReason && cake.photoUrl && (
        <p className="text-[13px] text-cacao-500">Esta torta ya tiene foto; la nueva la reemplaza en la vitrina.</p>
      )}
    </div>
  );
}

function Thumb({ url, large = false }: { url: string | null; large?: boolean }) {
  const src = thumbnailSrc(url, large ? 128 : 96);
  return (
    <span
      className={cx(
        "relative block shrink-0 overflow-hidden rounded-lg bg-crema-200",
        large ? "h-16 w-14" : "h-12 w-10",
      )}
    >
      {src && <Image src={src} alt="" fill sizes={large ? "56px" : "40px"} className="object-cover" />}
    </span>
  );
}
