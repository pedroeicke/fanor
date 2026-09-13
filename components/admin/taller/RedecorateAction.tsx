"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { redecorateCake } from "@/app/admin/(panel)/taller/actions";
import { inputClass, labelClass } from "@/components/admin/ui";
import type { StoreOption } from "@/components/admin/pedidos-tienda/types";
import type { NamedOption } from "./types";

/**
 * Redecorar uma torta devolvida: escolher para qual loja vai e quem decora.
 *
 * O banco cria a torta nova (série nova, validade curta) já dentro de um
 * despacho próprio; daqui a pessoa cai direto nas etiquetas para imprimir,
 * porque a torta não sai do taller sem a etiqueta nova colada.
 */
export function RedecorateAction({
  serial,
  stores,
  decorators,
  defaultStoreId,
  defaultDecoratorId,
}: {
  serial: string;
  stores: StoreOption[];
  decorators: NamedOption[];
  defaultStoreId: string | null;
  defaultDecoratorId: string | null;
}) {
  const router = useRouter();
  const storeField = useId();
  const decoratorField = useId();
  const notesField = useId();
  const [open, setOpen] = useState(false);
  const [storeId, setStoreId] = useState(defaultStoreId && stores.some((s) => s.id === defaultStoreId) ? defaultStoreId : (stores[0]?.id ?? ""));
  const [decoratorId, setDecoratorId] = useState(defaultDecoratorId && decorators.some((d) => d.id === defaultDecoratorId) ? defaultDecoratorId : "");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();
  const busy = pending || done;

  function submit() {
    if (busy || !storeId) return;
    setError(null);
    startTransition(async () => {
      const result = await redecorateCake({ serial, storeId, decoratorId: decoratorId || null, notes });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setDone(true);
      router.push(`/admin/etiquetas/${result.data.dispatchId}`);
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-11 items-center justify-center rounded-full bg-dorado px-5 text-sm font-semibold text-cacao transition-colors hover:bg-dorado-600"
      >
        Redecorar
      </button>
    );
  }

  return (
    <div className="w-full space-y-3 rounded-2xl border border-dorado-600/40 bg-dorado-100 p-4">
      <p className="text-sm font-semibold text-cacao">Redecorar {serial}</p>
      <p className="text-[13px] text-cacao-700">Sale como torta nueva, con otra serie y validez corta, en un despacho a la tienda.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={storeField} className={labelClass}>
            Tienda de destino
          </label>
          <select id={storeField} value={storeId} onChange={(e) => setStoreId(e.target.value)} disabled={busy} className={inputClass}>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={decoratorField} className={labelClass}>
            Decoradora
          </label>
          <select id={decoratorField} value={decoratorId} onChange={(e) => setDecoratorId(e.target.value)} disabled={busy} className={inputClass}>
            <option value="">{decorators.length ? "Sin decoradora" : "No hay decoradoras registradas"}</option>
            {decorators.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label htmlFor={notesField} className={labelClass}>
          Observación (opcional)
        </label>
        <input id={notesField} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={200} disabled={busy} className={inputClass} />
      </div>
      {error && (
        <p role="alert" className="text-sm font-medium text-terracota-700">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={busy || !storeId}
          className="inline-flex h-11 flex-1 items-center justify-center rounded-full bg-cacao px-5 text-sm font-semibold text-crema transition-colors hover:bg-cacao-700 disabled:cursor-not-allowed disabled:opacity-45 sm:flex-none"
        >
          {busy ? "Creando despacho…" : "Redecorar e imprimir etiqueta"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          disabled={busy}
          className="inline-flex h-11 items-center justify-center rounded-full border border-crema-300 bg-white px-5 text-sm font-medium text-cacao-700 disabled:opacity-45"
        >
          Volver
        </button>
      </div>
    </div>
  );
}
