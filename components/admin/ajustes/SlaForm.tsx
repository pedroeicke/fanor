"use client";

import { useState, type FormEvent } from "react";
import { saveSla } from "@/app/admin/(panel)/ajustes/actions";
import { Section, labelClass } from "@/components/admin/ui";
import { ActionFeedback, buttonClass, useActionRunner } from "@/components/admin/catalogos/useActionRunner";
import { cx } from "@/lib/format";
import { SLA_FIELDS, slaFieldError, type SlaKey, type SlaValues } from "./config";

type Drafts = Record<SlaKey, string>;

function toDrafts(values: SlaValues): Drafts {
  return Object.fromEntries(SLA_FIELDS.map((f) => [f.key, String(values[f.key])])) as Drafts;
}

/**
 * Quanto tempo um atraso espera antes de virar alerta. Os números vieram de
 * um chute inicial (pauta, pergunta 9); esta tela existe para o dono ajustar
 * sem programador depois de ver os alertas na prática.
 */
export function SlaForm({ values, canEdit }: { values: SlaValues; canEdit: boolean }) {
  const { pending, busyKey, feedbackFor, run } = useActionRunner();
  const [drafts, setDrafts] = useState<Drafts | null>(null);
  const shown = drafts ?? toDrafts(values);

  const parsed = Object.fromEntries(SLA_FIELDS.map((f) => [f.key, shown[f.key].trim() === "" ? NaN : Number(shown[f.key])])) as SlaValues;
  const errors = SLA_FIELDS.map((f) => [f.key, slaFieldError(f, parsed[f.key])] as const);
  const invalid = errors.some(([, e]) => e);
  const changed = SLA_FIELDS.some((f) => parsed[f.key] !== values[f.key]);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!canEdit || invalid || !changed) return;
    run("sla", () => saveSla(parsed), {
      success: "Plazos guardados. Las alertas se recalculan con estos valores.",
      onSuccess: () => setDrafts(null),
    });
  }

  return (
    <Section title="Plazos de las alertas">
      <form onSubmit={submit} className="space-y-4 px-5 py-4">
        <ul className="grid gap-4 md:grid-cols-2">
          {SLA_FIELDS.map((field) => {
            const error = errors.find(([key]) => key === field.key)?.[1];
            return (
              <li key={field.key}>
                <label className="block">
                  <span className={labelClass}>{field.label}</span>
                  <span className="flex items-center gap-2">
                    <input
                      className={cx(
                        "h-11 w-24 rounded-xl border bg-white px-3 text-center text-[15px] tabular-nums text-cacao focus:border-dorado-600 focus:outline-none disabled:bg-crema-100 disabled:text-cacao-500",
                        error ? "border-terracota" : "border-crema-300",
                      )}
                      type="number"
                      inputMode="numeric"
                      min={field.min}
                      max={field.max}
                      step={1}
                      value={shown[field.key]}
                      disabled={!canEdit || pending}
                      aria-invalid={Boolean(error)}
                      onChange={(e) => setDrafts({ ...shown, [field.key]: e.target.value })}
                    />
                    <span className="text-sm text-cacao-500">{field.unit}</span>
                    <span className="text-[12px] text-cacao-300">
                      ({field.min}–{field.max})
                    </span>
                  </span>
                </label>
                <p className={cx("mt-1 text-[13px]", error ? "text-terracota-700" : "text-cacao-500")}>{error ?? field.help}</p>
              </li>
            );
          })}
        </ul>

        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <button type="submit" className={buttonClass.primary} disabled={pending || invalid || !changed}>
              {busyKey === "sla" ? "Guardando…" : "Guardar plazos"}
            </button>
            {changed && (
              <button type="button" className={buttonClass.outline} disabled={pending} onClick={() => setDrafts(null)}>
                Deshacer
              </button>
            )}
          </div>
        )}
        <ActionFeedback feedback={feedbackFor()} />
      </form>
    </Section>
  );
}
