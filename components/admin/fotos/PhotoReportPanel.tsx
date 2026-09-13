"use client";

import { useId } from "react";
import { cx } from "@/lib/format";
import { TONE_CLASS } from "@/lib/gestion/labels";
import { ALT_TEXT_MAX, type PhotoReport } from "@/lib/photo/types";
import { Notice, labelClass } from "@/components/admin/ui";
import { scoreTone, scoreVerdict } from "./shared";

/**
 * Nota, problemas e conselhos da foto, e o texto alternativo para revisar.
 *
 * Conselho vem no imperativo e curto ("Acércate más") porque é lido de pé,
 * com a torta na mão, antes de tirar a próxima.
 */
export function PhotoReportPanel({
  report,
  alt,
  onAltChange,
  disabled,
}: {
  report: PhotoReport;
  alt: string;
  onAltChange: (value: string) => void;
  disabled: boolean;
}) {
  const altId = useId();
  const tone = scoreTone(report.score);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <div
          className={cx("flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-2xl border", TONE_CLASS[tone])}
          aria-label={`Nota ${report.score} de 10`}
        >
          <span className="font-display text-3xl font-semibold leading-none">{report.score}</span>
          <span className="text-[11px] font-bold">/ 10</span>
        </div>
        <div className="min-w-0">
          <p className="font-display text-lg leading-tight text-cacao">{scoreVerdict(report.score)}</p>
          <p className="mt-0.5 text-[13px] text-cacao-500">
            {report.scoreSource === "ai" ? "Nota de la IA" : "Nota estimada sin IA, por luz y nitidez"}
            {report.productGuess && <> · Parece: {report.productGuess}</>}
          </p>
        </div>
      </div>

      {report.error && (
        <Notice tone="warn">
          {report.error} Se aplicó solo el ajuste automático.
        </Notice>
      )}

      {report.issues.length > 0 && (
        <div>
          <p className={labelClass}>Problemas</p>
          <ul className="space-y-1 text-sm text-cacao-700">
            {report.issues.map((issue) => (
              <li key={issue} className="flex gap-2">
                <span aria-hidden className="text-terracota">•</span>
                {issue}
              </li>
            ))}
          </ul>
        </div>
      )}

      {report.suggestions.length > 0 && (
        <div>
          <p className={labelClass}>Para la próxima foto</p>
          <ul className="space-y-1 text-sm text-cacao-700">
            {report.suggestions.map((tip) => (
              <li key={tip} className="flex gap-2">
                <span aria-hidden className="text-verde">✓</span>
                {tip}
              </li>
            ))}
          </ul>
        </div>
      )}

      {report.issues.length === 0 && report.suggestions.length === 0 && (
        <p className="text-sm text-verde">Sin problemas visibles.</p>
      )}

      <div>
        <p className={labelClass}>Ajustes aplicados</p>
        <ul className="flex flex-wrap gap-1.5">
          {report.adjustments.map((item) => (
            <li key={item} className="rounded-full border border-crema-300 bg-crema-100 px-2.5 py-1 text-[12px] text-cacao-700">
              {item}
            </li>
          ))}
        </ul>
      </div>

      <div>
        <label htmlFor={altId} className={labelClass}>
          Texto alternativo
        </label>
        <textarea
          id={altId}
          value={alt}
          onChange={(e) => onAltChange(e.target.value.replace(/\n/g, " "))}
          maxLength={ALT_TEXT_MAX}
          rows={3}
          disabled={disabled}
          className="w-full resize-none rounded-xl border border-crema-300 bg-white px-3 py-2.5 text-[15px] leading-snug text-cacao placeholder:text-cacao-300 focus:border-dorado-600 focus:outline-none disabled:opacity-60"
          placeholder="Describe la torta: tipo, colores y decoración"
        />
        <p className="mt-1 flex justify-between gap-3 text-[12px] text-cacao-300">
          <span>Lo leen quienes no ven la imagen y los buscadores.</span>
          <span className={cx("tabular-nums", alt.length >= ALT_TEXT_MAX && "text-terracota")}>
            {alt.length}/{ALT_TEXT_MAX}
          </span>
        </p>
      </div>
    </div>
  );
}
