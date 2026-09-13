"use client";

import { useState } from "react";
import { saveRedecoratedShelfLife } from "@/app/admin/(panel)/ajustes/actions";
import { Section } from "@/components/admin/ui";
import { ActionFeedback, buttonClass, useActionRunner } from "@/components/admin/catalogos/useActionRunner";
import { addDays } from "@/lib/gestion/dates";
import { cx } from "@/lib/format";
import { REDECORATED_MAX, describeRedecorated } from "./config";

const OPTIONS = Array.from({ length: REDECORATED_MAX + 1 }, (_, days) => days);

/** "2026-09-14" → "14/09". */
function dayMonth(iso: string) {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
}

/**
 * Validade da torta redecorada. "Um único dia" pode ser o mesmo dia ou o
 * seguinte (pauta, pergunta 7): a tela mostra a data concreta para quem
 * decide não precisar fazer a conta.
 */
export function RedecoratedForm({ value, today, canEdit }: { value: number; today: string; canEdit: boolean }) {
  const { pending, busyKey, feedbackFor, run } = useActionRunner();
  const [choice, setChoice] = useState<number | null>(null);
  const selected = canEdit && choice !== null ? choice : value;
  const changed = selected !== value;

  return (
    <Section title="Validez de la torta redecorada">
      <div className="space-y-4 px-5 py-4">
        <p className="text-sm text-cacao-500">
          Cuando una torta vuelve al taller y se redecora, sale con serie nueva y esta validez. Solo afecta a las que se redecoren desde ahora.
        </p>

        <div className="flex flex-wrap gap-2" role="group" aria-label="Días de validez">
          {OPTIONS.map((days) => (
            <button
              key={days}
              type="button"
              aria-pressed={selected === days}
              disabled={!canEdit || pending}
              onClick={() => setChoice(days === value ? null : days)}
              className={cx(
                "inline-flex h-11 min-w-24 items-center justify-center rounded-full border px-4 text-sm font-semibold transition-colors disabled:cursor-default",
                selected === days ? "border-dorado bg-dorado text-cacao" : "border-crema-300 bg-white text-cacao-700 enabled:hover:border-cacao/35",
              )}
            >
              {days} {days === 1 ? "día" : "días"}
            </button>
          ))}
        </div>

        <p className="text-sm text-cacao-700">
          {describeRedecorated(selected)} Si se redecora hoy ({dayMonth(today)}), vence el {dayMonth(addDays(today, selected))}.
        </p>

        {canEdit && changed && (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={buttonClass.primary}
              disabled={pending}
              onClick={() =>
                run("redecorated", () => saveRedecoratedShelfLife(selected), {
                  success: `Guardado: ${describeRedecorated(selected).toLowerCase()}`,
                  onSuccess: () => setChoice(null),
                })
              }
            >
              {busyKey === "redecorated" ? "Guardando…" : "Guardar validez"}
            </button>
            <button type="button" className={buttonClass.outline} disabled={pending} onClick={() => setChoice(null)}>
              Deshacer
            </button>
          </div>
        )}
        <ActionFeedback feedback={feedbackFor()} />
      </div>
    </Section>
  );
}
