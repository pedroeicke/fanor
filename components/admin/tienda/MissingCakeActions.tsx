"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { resolveMissingCake } from "@/app/admin/(panel)/tienda/actions";
import { inputClass } from "@/components/admin/ui";
import { TONE_CLASS } from "@/lib/gestion/labels";
import { cx } from "@/lib/format";

/**
 * "Apareció" / "Se perdió" para uma torta faltante.
 *
 * Dois toques de propósito: nenhuma das duas volta atrás pela tela. A que
 * "apareceu" entra na vitrina (ou na reserva da encomenda) e a "perdida" vira
 * descarte — um dedo escorregado no celular não pode fazer nenhuma das duas.
 */
export function MissingCakeActions({ serial, forContract }: { serial: string; forContract: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useState<"found" | "lost" | null>(null);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit(found: boolean) {
    setError(null);
    startTransition(async () => {
      try {
        const result = await resolveMissingCake({ serial, found, notes });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setMode(null);
        setNotes("");
        router.refresh();
      } catch {
        setError("No se pudo conectar. Revisa la señal e inténtalo de nuevo.");
      }
    });
  }

  if (!mode) {
    return (
      <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
        <button
          type="button"
          onClick={() => setMode("found")}
          className="h-11 rounded-full border border-verde/40 bg-verde-100 px-4 text-sm font-semibold text-verde"
        >
          Apareció
        </button>
        <button
          type="button"
          onClick={() => setMode("lost")}
          className="h-11 rounded-full border border-terracota/30 bg-white px-4 text-sm font-semibold text-terracota"
        >
          Se perdió
        </button>
      </div>
    );
  }

  const found = mode === "found";
  return (
    <div className="w-full rounded-2xl border border-crema-300 bg-crema-100 p-3">
      <p className="text-sm font-semibold text-cacao">
        {found ? `¿${serial} está en la tienda?` : `¿Dar ${serial} por perdida?`}
      </p>
      <p className="mt-0.5 text-[13px] text-cacao-700">
        {found
          ? forContract
            ? "Queda reservada para su encomienda."
            : "Sube a la vitrina de esta tienda."
          : "Queda como descartada y sale del stock."}
      </p>
      <input
        value={notes}
        onChange={(e) => setNotes(e.target.value.slice(0, 500))}
        maxLength={500}
        disabled={pending}
        aria-label="Nota (opcional)"
        placeholder={found ? "Nota (opcional): dónde estaba" : "Nota (opcional): qué pasó"}
        className={cx(inputClass, "mt-2")}
      />
      {error && (
        <p role="alert" className={cx("mt-2 rounded-xl border px-3 py-2 text-sm", TONE_CLASS.bad)}>
          {error}
        </p>
      )}
      <div className="mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button
          type="button"
          onClick={() => {
            setMode(null);
            setError(null);
          }}
          disabled={pending}
          className="h-11 rounded-full border border-cacao/25 px-4 text-sm font-semibold text-cacao disabled:opacity-50"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={() => submit(found)}
          disabled={pending}
          className={cx(
            "h-11 rounded-full px-4 text-sm font-semibold text-white disabled:opacity-60",
            found ? "bg-verde hover:bg-verde/90" : "bg-terracota hover:bg-terracota-700",
          )}
        >
          {pending ? "Guardando…" : found ? "Sí, apareció" : "Sí, se perdió"}
        </button>
      </div>
    </div>
  );
}
