"use client";

import { useState, useTransition } from "react";
import { getBackupDownload } from "@/app/admin/(panel)/respaldos/actions";

/**
 * Pede um link assinado na hora do clique e já abre o download.
 *
 * O link não vai pronto na página: vale 10 minutos, e a tela pode ficar
 * aberta a tarde inteira.
 */
export function DownloadBackupButton({ id, label }: { id: number; label: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function download() {
    setError(null);
    startTransition(async () => {
      const result = await getBackupDownload(id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      /* O link já traz o nome do arquivo (Content-Disposition): o navegador
         baixa em vez de tentar mostrar o conteúdo. */
      window.location.assign(result.data.url);
    });
  }

  return (
    <div className="flex flex-col items-stretch gap-1 sm:items-end">
      <button
        type="button"
        onClick={download}
        disabled={pending}
        aria-label={`Descargar respaldo del ${label}`}
        className="inline-flex h-11 items-center justify-center rounded-full border border-crema-300 bg-white px-5 text-sm font-semibold text-cacao-700 transition-colors hover:border-cacao/35 disabled:cursor-wait disabled:opacity-60"
      >
        {pending ? "Preparando…" : "Descargar"}
      </button>
      {error && (
        <p role="alert" className="max-w-xs text-[12px] text-terracota">
          {error}
        </p>
      )}
    </div>
  );
}
