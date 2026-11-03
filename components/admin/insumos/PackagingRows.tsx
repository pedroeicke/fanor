"use client";

import { savePackaging } from "@/app/admin/(panel)/insumos/actions";
import { ActionFeedback, useActionRunner } from "@/components/admin/catalogos/useActionRunner";
import { inputClass } from "@/components/admin/ui";

/** Um formato, uma caixa. Escolher já grava: são poucas linhas e nada que precise de revisão. */

export type PackagingRow = { format: string; models: number; example: string; boxCode: string | null };

export function PackagingRows({ rows, boxes }: { rows: PackagingRow[]; boxes: { code: string; description: string }[] }) {
  const { pending, feedbackFor, run } = useActionRunner();

  return (
    <ul className="divide-y divide-crema-200">
      {rows.map((row) => (
        <li key={row.format} className="grid gap-2 px-4 py-3 sm:grid-cols-2 sm:items-center sm:px-5">
          <div className="min-w-0">
            <p className="font-medium text-cacao">
              {row.format}
              <span className="ml-2 text-[13px] font-normal text-cacao-500">
                {row.models} {row.models === 1 ? "modelo" : "modelos"}
              </span>
            </p>
            <p className="truncate text-[13px] text-cacao-500">{row.example}</p>
          </div>
          <div className="space-y-2">
            <select
              aria-label={`Caja de ${row.format}`}
              className={inputClass}
              disabled={pending}
              value={row.boxCode ?? ""}
              onChange={(e) => run(`box:${row.format}`, () => savePackaging(row.format, e.target.value), { success: "Caja guardada." })}
            >
              <option value="">Sin caja</option>
              {boxes.map((box) => (
                <option key={box.code} value={box.code}>
                  {box.description}
                </option>
              ))}
            </select>
            <ActionFeedback feedback={feedbackFor(row.format)} />
          </div>
        </li>
      ))}
    </ul>
  );
}
