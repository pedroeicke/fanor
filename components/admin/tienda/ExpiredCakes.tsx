"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { returnCakes } from "@/app/admin/(panel)/tienda/actions";
import { Section, inputClass, labelClass } from "@/components/admin/ui";
import { TONE_CLASS } from "@/lib/gestion/labels";
import { cx } from "@/lib/format";

export type ExpiredCake = {
  serial: string;
  product: string;
  flavor: string | null;
  redecorated: boolean;
  /** "Venció Dom 13 set · hace 2 días", já formatado no servidor (fuso de Lima). */
  expiredLabel: string;
};

/**
 * Vencidas: selecionar e devolver ao taller.
 *
 * Fica sempre montado na página, mesmo sem vencidas: depois de devolver a
 * última, a confirmação continua na tela em vez de sumir junto com a lista.
 *
 * Nada vem marcado de saída. A vendedora confere na prateleira qual torta
 * está mesmo ali — marcar tudo sem olhar devolveria no sistema uma torta que
 * talvez tenha sido vendida sem registro, e o taller esperaria por ela.
 */
export function ExpiredCakes({ cakes }: { cakes: ExpiredCake[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  /* A tela se atualiza sozinha: uma torta devolvida por outro celular some da
     lista, e não pode continuar selecionada por baixo. */
  const available = new Set(cakes.map((c) => c.serial));
  const chosen = selected.filter((s) => available.has(s));
  const allChosen = cakes.length > 0 && chosen.length === cakes.length;

  function toggle(serial: string) {
    setError(null);
    setSuccess(null);
    setConfirming(false);
    setSelected((prev) => (prev.includes(serial) ? prev.filter((s) => s !== serial) : [...prev, serial]));
  }

  function toggleAll() {
    setError(null);
    setSuccess(null);
    setConfirming(false);
    setSelected(allChosen ? [] : cakes.map((c) => c.serial));
  }

  function submit() {
    const serials = chosen;
    if (!serials.length) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await returnCakes({ serials, notes });
        if (!result.ok) {
          setError(result.error);
          setConfirming(false);
          return;
        }
        const n = result.data.returned;
        setSuccess(`${n} ${n === 1 ? "torta devuelta" : "tortas devueltas"} al taller.`);
        setSelected([]);
        setNotes("");
        setConfirming(false);
        router.refresh();
      } catch {
        setError("No se pudo conectar. Revisa la señal e inténtalo de nuevo.");
        setConfirming(false);
      }
    });
  }

  const successNotice = success && (
    <p role="status" className={cx("rounded-2xl border px-4 py-3 text-sm", TONE_CLASS.ok)}>
      {success}
    </p>
  );

  if (!cakes.length) return successNotice || null;

  return (
    <Section
      title={<span className="text-terracota">Vencidas · devolver al taller</span>}
      aside={<span className="font-semibold text-terracota">{cakes.length}</span>}
      className="border-2 border-terracota/40"
    >
      <div id="vencidas" className="scroll-mt-4">
        {success && <div className="px-4 pt-4 sm:px-5">{successNotice}</div>}
        <div className="flex items-center justify-between gap-3 px-4 pt-4 sm:px-5">
          <p className="text-sm text-cacao-700">
            {chosen.length ? `${chosen.length} de ${cakes.length} seleccionadas` : "Marca las que tienes en la mano."}
          </p>
          <button
            type="button"
            onClick={toggleAll}
            disabled={pending}
            className="h-11 shrink-0 rounded-full border border-cacao/25 px-4 text-sm font-semibold text-cacao disabled:opacity-50"
          >
            {allChosen ? "Quitar todas" : "Todas"}
          </button>
        </div>

        <ul className="space-y-2 p-4 sm:px-5">
          {cakes.map((cake) => {
            const isChosen = chosen.includes(cake.serial);
            return (
              <li key={cake.serial}>
                <label
                  className={cx(
                    "flex min-h-16 cursor-pointer items-center gap-3 rounded-2xl border px-4 py-3 transition-colors",
                    isChosen ? "border-terracota/50 bg-terracota/10" : "border-terracota/25 bg-white",
                    pending && "pointer-events-none opacity-60",
                  )}
                >
                  <input
                    type="checkbox"
                    checked={isChosen}
                    onChange={() => toggle(cake.serial)}
                    disabled={pending}
                    className="size-6 shrink-0 accent-terracota"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block font-mono text-[15px] font-semibold text-cacao">{cake.serial}</span>
                    <span className="block text-sm text-cacao-700">
                      {cake.product} · {cake.flavor ?? "Sin sabor"}
                      {cake.redecorated && <span className="font-semibold"> · REDECORADA</span>}
                    </span>
                    <span className="block text-[13px] font-medium text-terracota">{cake.expiredLabel}</span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>

        <div className="space-y-3 border-t border-crema-200 p-4 sm:px-5">
          <div>
            <label htmlFor="return-notes" className={labelClass}>
              Nota para el taller (opcional)
            </label>
            <input
              id="return-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value.slice(0, 500))}
              maxLength={500}
              disabled={pending}
              placeholder="Ej.: en buen estado para redecorar"
              className={inputClass}
            />
          </div>

          {error && (
            <p role="alert" className={cx("rounded-2xl border px-4 py-3 text-sm", TONE_CLASS.bad)}>
              {error}
            </p>
          )}

          {confirming ? (
            <div role="alert" className="rounded-2xl border-2 border-terracota/40 bg-white p-4">
              <p className="font-semibold text-cacao">
                ¿Devolver {chosen.length} {chosen.length === 1 ? "torta" : "tortas"} al taller?
              </p>
              <p className="mt-1 text-sm text-cacao-700">Salen de la tienda ahora. Entrégalas con el próximo traslado.</p>
              <div className="mt-3 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  disabled={pending}
                  className="h-12 rounded-full border border-cacao/25 px-5 font-semibold text-cacao disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={submit}
                  disabled={pending || chosen.length === 0}
                  className="h-12 rounded-full bg-terracota px-5 font-semibold text-white hover:bg-terracota-700 disabled:opacity-60"
                >
                  {pending ? "Devolviendo…" : "Sí, devolver"}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => {
                setError(null);
                setSuccess(null);
                setConfirming(true);
              }}
              disabled={pending || chosen.length === 0}
              className="h-14 w-full rounded-full bg-terracota text-base font-semibold text-white hover:bg-terracota-700 disabled:opacity-50"
            >
              Devolver al taller{chosen.length ? ` (${chosen.length})` : ""}
            </button>
          )}
        </div>
      </div>
    </Section>
  );
}
