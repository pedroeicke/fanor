"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createStoreRequest } from "@/app/admin/(panel)/pedidos-tienda/actions";
import { cx } from "@/lib/format";
import { Notice, inputClass, labelClass } from "@/components/admin/ui";
import { ProductSearch } from "./ProductSearch";
import { QuantityStepper } from "./QuantityStepper";
import { NOTES_MAX, REQUEST_MAX_LINES, REQUEST_MAX_QTY, type CatalogProduct } from "./types";

/**
 * "Preciso destas tortas": a vendedora monta o pedido no celular.
 *
 * Só tamanho e quantidade — o sabor é decisão do taller. A lista fica neste
 * aparelho até enviar; se a tela recarregar sozinha, nada se perde, porque o
 * estado é do componente e o `router.refresh()` preserva o estado do cliente.
 */

type Line = { product: CatalogProduct; quantity: number };

export function StoreRequestForm({
  storeId,
  storeName,
  products,
  shortcuts,
}: {
  storeId: string;
  storeName: string;
  products: CatalogProduct[];
  shortcuts: CatalogProduct[];
}) {
  const router = useRouter();
  const [lines, setLines] = useState<Line[]>([]);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ number: number; units: number; storeName: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const picked = useMemo(() => Object.fromEntries(lines.map((l) => [l.product.id, l.quantity])), [lines]);
  const units = lines.reduce((sum, l) => sum + l.quantity, 0);

  function add(product: CatalogProduct) {
    setSent(null);
    if (lines.length >= REQUEST_MAX_LINES && !lines.some((l) => l.product.id === product.id)) {
      setError(`Máximo ${REQUEST_MAX_LINES} productos por pedido. Envía este y haz otro.`);
      return;
    }
    setError(null);
    setLines((current) => {
      const found = current.find((l) => l.product.id === product.id);
      if (found) {
        return current.map((l) => (l.product.id === product.id ? { ...l, quantity: Math.min(REQUEST_MAX_QTY, l.quantity + 1) } : l));
      }
      if (current.length >= REQUEST_MAX_LINES) return current;
      return [...current, { product, quantity: 1 }];
    });
  }

  function setQuantity(productId: string, quantity: number) {
    setLines((current) => current.map((l) => (l.product.id === productId ? { ...l, quantity } : l)));
  }

  function remove(productId: string) {
    setLines((current) => current.filter((l) => l.product.id !== productId));
  }

  function submit() {
    if (pending || lines.length === 0) return;
    setError(null);
    startTransition(async () => {
      const result = await createStoreRequest({
        storeId,
        lines: lines.map((l) => ({ productId: l.product.id, quantity: l.quantity })),
        notes,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSent({ number: result.data.number, units, storeName });
      setLines([]);
      setNotes("");
      router.refresh();
    });
  }

  return (
    <div className="space-y-5">
      {sent && (
        <Notice tone="ok">
          <p className="font-semibold">Pedido #{sent.number} enviado al taller</p>
          <p className="mt-0.5">
            {sent.units} {sent.units === 1 ? "unidad" : "unidades"} para {sent.storeName}. Lo ves abajo en “Pedidos recientes”.
          </p>
        </Notice>
      )}

      <ProductSearch products={products} onPick={add} picked={picked} shortcuts={shortcuts} />

      <div>
        <p className={labelClass}>Tu pedido</p>
        {lines.length === 0 ? (
          <p className="rounded-xl border border-dashed border-crema-300 px-4 py-5 text-center text-sm text-cacao-500">
            Busca o toca un producto para agregarlo.
          </p>
        ) : (
          <ul className="divide-y divide-crema-200 rounded-xl border border-crema-300 bg-white">
            {lines.map((l) => (
              <li key={l.product.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-3">
                <div className="min-w-0 flex-1 basis-40">
                  <p className="text-[15px] font-medium leading-snug text-cacao">{l.product.name}</p>
                  <p className="text-[12px] text-cacao-300">{l.product.sku ?? l.product.familyName}</p>
                </div>
                <div className="flex items-center gap-1">
                  <QuantityStepper
                    value={l.quantity}
                    onChange={(q) => setQuantity(l.product.id, q)}
                    max={REQUEST_MAX_QTY}
                    label={l.product.name}
                    disabled={pending}
                  />
                  <button
                    type="button"
                    onClick={() => remove(l.product.id)}
                    disabled={pending}
                    className="h-11 rounded-full px-3 text-sm font-medium text-terracota-700 hover:bg-terracota/10 disabled:opacity-45"
                  >
                    Quitar
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <label htmlFor="request-notes" className={labelClass}>
          Observación (opcional)
        </label>
        <textarea
          id="request-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          maxLength={NOTES_MAX}
          rows={2}
          placeholder="Ej. para mañana temprano, una sin fruta"
          className={cx(inputClass, "h-auto min-h-11 py-2.5")}
        />
      </div>

      {error && (
        <p role="alert" className="rounded-xl border border-terracota/30 bg-terracota/10 px-4 py-3 text-sm font-medium text-terracota-700">
          {error}
        </p>
      )}

      {/* Fica colado no rodapé do celular: com dez produtos na lista o botão
          não some da tela. */}
      <div className="sticky bottom-3 z-10">
        <button
          type="button"
          onClick={submit}
          disabled={pending || lines.length === 0}
          className="flex h-14 w-full items-center justify-center rounded-full bg-dorado px-6 text-base font-semibold text-cacao shadow-lift transition-colors hover:bg-dorado-600 disabled:cursor-not-allowed disabled:opacity-45"
        >
          {/* A tienda no botão: quem trocou de loja no seletor sem querer vê
              antes de enviar para onde vai. */}
          {pending
            ? "Enviando…"
            : lines.length === 0
              ? `Enviar pedido a ${storeName}`
              : `Enviar a ${storeName} · ${units} unid.`}
        </button>
      </div>
    </div>
  );
}
