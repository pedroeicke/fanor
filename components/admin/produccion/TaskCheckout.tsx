"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/lib/gestion/server";
import { consumptionMargin, formatQuantity, isCountableOutput, isOutOfTolerance, missingToRework, suggestedDisplayQuantity, suggestedOutput } from "@/lib/produccion/plan";
import { cx } from "@/lib/format";
import { Notice, inputClass, labelClass } from "@/components/admin/ui";
import { NOTES_MAX, REASON_MAX, type CheckoutTaskInput } from "@/components/admin/produccion/types";

export type CheckoutInputRow = {
  id: string;
  articleCode: string;
  articleType: string | null;
  description: string;
  plannedQuantity: number;
  displayUnit: string | null;
  displayFactor: number;
  countOnExecution: boolean;
  /** Saldo no taller, só para o que o taller produz. Nulo quando o saldo não diz nada. */
  available: number | null;
};

const REASONS = ["Se quemó", "Se cayó", "Error de receta", "No quedó bien"];

/**
 * Checkout de uma etapa.
 *
 * A pergunta principal é quanto saiu bem. O consumo já vem preenchido pela
 * receita e só abre quando houve diferença: um checklist por ingrediente em toda
 * fornada viraria confirmação automática. A exceção é o ovo pesado, em que só
 * quem quebrou sabe quantos foram.
 */
export function TaskCheckout({
  taskId,
  stage,
  recipeUnit,
  plannedQuantity,
  unit,
  inputs,
  tolerancePct,
  action,
}: {
  taskId: string;
  stage: string;
  recipeUnit: string | null;
  plannedQuantity: number;
  unit: string | null;
  inputs: CheckoutInputRow[];
  tolerancePct: number;
  action: (input: CheckoutTaskInput) => Promise<ActionResult<{ reworkTasks: number; batchDone: boolean }>>;
}) {
  const router = useRouter();
  const ids = useId();
  const [approved, setApproved] = useState(String(suggestedOutput(plannedQuantity)));
  const [rejected, setRejected] = useState("0");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [rework, setRework] = useState(true);
  const [sameCore, setSameCore] = useState(true);
  const [adjusting, setAdjusting] = useState(false);
  const [actuals, setActuals] = useState<Record<string, string>>(() =>
    Object.fromEntries(inputs.map((row) => [row.id, row.countOnExecution ? "" : String(suggestedOutput(suggestedDisplayQuantity(row, row.articleType)))])),
  );
  const [justifications, setJustifications] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const approvedValue = Number(approved) || 0;
  const rejectedValue = Number(rejected) || 0;
  const missing = missingToRework(plannedQuantity, approvedValue);
  const countable = isCountableOutput(stage, recipeUnit);
  const fractionError = countable && (!Number.isInteger(approvedValue) || !Number.isInteger(rejectedValue));

  const outOfRange = (row: CheckoutInputRow) => {
    const raw = actuals[row.id];
    if (raw === "" || raw === undefined) return false;
    return isOutOfTolerance(row, row.articleType, Number(raw) * row.displayFactor, tolerancePct);
  };

  /* Etapa anterior perdida e sem refação: o material não existe. A mesma conta
     que o banco faz, para explicar antes de o botão falhar. */
  const shortage = (row: CheckoutInputRow) => {
    const raw = actuals[row.id];
    if (row.available === null || raw === "" || raw === undefined) return false;
    return Number(raw) * row.displayFactor > row.available + consumptionMargin(row, row.articleType, tolerancePct) + 0.000001;
  };
  const needsWhy = (row: CheckoutInputRow) => outOfRange(row) || shortage(row);

  const missingCount = inputs.some((row) => actuals[row.id] === "");
  const missingJustification = inputs.some((row) => needsWhy(row) && !justifications[row.id]?.trim());
  const missingReason = rejectedValue > 0 && reason.trim().length < 3;
  const hasResult = approvedValue + rejectedValue > 0;
  const blocked = pending || !hasResult || fractionError || missingCount || missingJustification || missingReason;

  /* Linha com problema ou que depende de quem executa fica sempre aberta. */
  const visible = inputs.filter((row) => adjusting || row.countOnExecution || needsWhy(row));

  function submit() {
    if (blocked) return;
    setError(null);
    startTransition(async () => {
      const result = await action({
        taskId,
        approved: approvedValue,
        rejected: rejectedValue,
        reason,
        notes,
        rework,
        sameCore,
        inputs: inputs.map((row) => ({ id: row.id, actual: Number(actuals[row.id]), justification: justifications[row.id] ?? "" })),
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-3 rounded-2xl border border-crema-300 bg-crema-100 p-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor={`${ids}-ok`} className={labelClass}>
            Salió bien {unit && `(${unit})`}
          </label>
          <input id={`${ids}-ok`} type="number" inputMode="decimal" min={0} value={approved} onChange={(e) => setApproved(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label htmlFor={`${ids}-bad`} className={labelClass}>
            Se perdió {unit && `(${unit})`}
          </label>
          <input id={`${ids}-bad`} type="number" inputMode="decimal" min={0} value={rejected} onChange={(e) => setRejected(e.target.value)} className={inputClass} />
        </div>
      </div>

      {stage === "batidas" && <p className="text-[13px] text-cacao-500">1 es la fórmula entera. Esta etapa pide {formatQuantity(plannedQuantity)}.</p>}
      {fractionError && <p role="alert" className="text-[13px] font-medium text-terracota-700">Este producto se cuenta entero: no puede salir una fracción.</p>}

      {rejectedValue > 0 && (
        <div>
          <label htmlFor={`${ids}-why`} className={labelClass}>
            Motivo de la pérdida
          </label>
          <input id={`${ids}-why`} value={reason} maxLength={REASON_MAX} onChange={(e) => setReason(e.target.value)} className={inputClass} />
          <div className="mt-2 flex flex-wrap gap-2">
            {REASONS.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setReason(r)}
                className={cx("h-11 rounded-full border px-4 text-sm transition-colors", reason === r ? "border-dorado bg-dorado-100 text-cacao" : "border-crema-300 bg-white text-cacao-700")}
              >
                {r}
              </button>
            ))}
          </div>
        </div>
      )}

      {missing > 0 && hasResult && (
        <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm text-cacao-700">
          <input type="checkbox" checked={rework} onChange={(e) => setRework(e.target.checked)} className="mt-0.5 h-5 w-5 accent-cacao" />
          <span>
            Rehacer lo que falta ({formatQuantity(missing)} {unit}). El sistema calcula los insumos.
          </span>
        </label>
      )}

      {missing > 0 && hasResult && rework && stage === "decoracion" && (
        <fieldset className="space-y-1 text-sm text-cacao-700">
          <legend className={labelClass}>¿Se aprovecha la torta?</legend>
          <label className="flex min-h-11 cursor-pointer items-center gap-3">
            <input type="radio" name={`${ids}-core`} checked={sameCore} onChange={() => setSameCore(true)} className="h-5 w-5 accent-cacao" />
            Sí: se limpia y se decora de nuevo
          </label>
          <label className="flex min-h-11 cursor-pointer items-center gap-3">
            <input type="radio" name={`${ids}-core`} checked={!sameCore} onChange={() => setSameCore(false)} className="h-5 w-5 accent-cacao" />
            No: hay que hacer la torta entera otra vez
          </label>
        </fieldset>
      )}

      {visible.length > 0 && (
        <ul className="space-y-3">
          {visible.map((row) => {
            const out = outOfRange(row);
            const short = shortage(row);
            return (
              <li key={row.id} className="rounded-xl bg-white p-3">
                <div className="flex items-center justify-between gap-3">
                  <label htmlFor={`${ids}-${row.id}`} className="min-w-0 text-sm">
                    <span className="block font-medium text-cacao">{row.description}</span>
                    <span className="block text-[12px] text-cacao-500">
                      {row.countOnExecution ? "¿Cuántos usaste de verdad? Estimado: " : "Receta: "}
                      {formatQuantity(row.plannedQuantity / row.displayFactor)} {row.displayUnit}
                    </span>
                  </label>
                  <span className="flex shrink-0 items-center gap-1.5">
                    <span className="w-24">
                      <input
                        id={`${ids}-${row.id}`}
                        type="number"
                        inputMode="decimal"
                        min={0}
                        value={actuals[row.id] ?? ""}
                        onChange={(e) => setActuals((all) => ({ ...all, [row.id]: e.target.value }))}
                        className={cx(inputClass, "text-right")}
                      />
                    </span>
                    <span className="w-6 text-[12px] text-cacao-500">{row.displayUnit}</span>
                  </span>
                </div>
                {(out || short) && (
                  <div className="mt-2">
                    <label htmlFor={`${ids}-${row.id}-j`} className="text-[13px] font-medium text-terracota-700">
                      {short
                        ? `En el taller solo hay ${formatQuantity(Math.max(0, row.available ?? 0) / row.displayFactor)} ${row.displayUnit ?? ""} ¿De dónde salió?`
                        : `Se aleja más de ${tolerancePct}% de la receta. ¿Por qué?`}
                    </label>
                    <input
                      id={`${ids}-${row.id}-j`}
                      value={justifications[row.id] ?? ""}
                      maxLength={REASON_MAX}
                      onChange={(e) => setJustifications((all) => ({ ...all, [row.id]: e.target.value }))}
                      className={cx(inputClass, "mt-1")}
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <button type="button" onClick={() => setAdjusting((v) => !v)} className="text-sm font-medium text-cacao-700 underline underline-offset-2">
        {adjusting ? "Ocultar consumo" : "El consumo fue distinto a la receta"}
      </button>

      <div>
        <label htmlFor={`${ids}-notes`} className={labelClass}>
          Notas (opcional)
        </label>
        <input id={`${ids}-notes`} value={notes} maxLength={NOTES_MAX} onChange={(e) => setNotes(e.target.value)} className={inputClass} />
      </div>

      {error && <Notice tone="bad">{error}</Notice>}

      <button
        type="button"
        onClick={submit}
        disabled={blocked}
        className="inline-flex h-12 w-full items-center justify-center rounded-full bg-dorado px-6 font-semibold text-cacao transition-colors hover:bg-dorado-600 disabled:cursor-not-allowed disabled:opacity-45 sm:w-auto"
      >
        {pending ? "Guardando…" : "Cerrar etapa"}
      </button>
    </div>
  );
}
