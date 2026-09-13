"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { runBackupNow } from "@/app/admin/(panel)/respaldos/actions";
import { Notice } from "@/components/admin/ui";
import { formatBytes, formatCount } from "./format";

/**
 * "Hacer respaldo ahora", antes de uma mudança grande (virar a vitrine para o
 * sistema novo, importar catálogo) — para não depender do respaldo das 03:30.
 *
 * Leva de segundos a um par de minutos. O botão fica travado até terminar:
 * dois cliques gerariam dois arquivos iguais.
 */
export function RunBackupButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  function run() {
    setMessage(null);
    startTransition(async () => {
      const result = await runBackupNow();
      if (!result.ok) {
        setMessage({ tone: "bad", text: result.error });
      } else {
        const { tables, rows, bytes, skipped } = result.data;
        setMessage({
          tone: "ok",
          text:
            `Respaldo listo: ${tables} tablas, ${formatCount(rows)} filas, ${formatBytes(bytes)}.` +
            (skipped.length ? ` Tablas que no existen en esta base: ${skipped.join(", ")}.` : ""),
        });
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={run}
        disabled={pending}
        className="inline-flex h-11 w-full items-center justify-center rounded-full bg-dorado px-6 text-sm font-semibold text-cacao transition-colors hover:bg-dorado-600 disabled:cursor-wait disabled:opacity-60 sm:w-auto"
      >
        {pending ? "Generando respaldo…" : "Hacer respaldo ahora"}
      </button>
      {pending && <p className="text-[13px] text-cacao-500">Puede tardar un par de minutos. No cierres esta página.</p>}
      {message && (
        <div role={message.tone === "bad" ? "alert" : "status"}>
          <Notice tone={message.tone}>{message.text}</Notice>
        </div>
      )}
    </div>
  );
}
