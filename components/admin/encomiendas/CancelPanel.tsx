"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { cancelContract } from "@/app/admin/(panel)/encomiendas/actions";
import { Notice, inputClass, labelClass } from "@/components/admin/ui";
import { cx, soles } from "@/lib/format";
import { LIMITS } from "./shared";

/**
 * Cancelar é irreversível e mexe em dinheiro que já entrou: fica escondido
 * atrás de um segundo passo, com motivo obrigatório e o aviso de que o
 * adelanto não volta sozinho.
 */
export function CancelPanel({
  contractId,
  number,
  paid,
  reserved,
  inTransit,
}: {
  contractId: string;
  number: number;
  paid: number;
  reserved: number;
  /** Tortas a caminho: cancelar agora as deixaria presas como reservadas ao chegar. */
  inTransit: number;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(false);
  const busy = pending || done;

  function submit() {
    setError(null);
    if (inTransit > 0) return;
    if (reason.trim().length < 3) {
      setError("Escribe el motivo de la cancelación.");
      return;
    }
    startTransition(async () => {
      try {
        const res = await cancelContract(contractId, reason);
        if (!res.ok) setError(res.error);
        else setDone(true);
      } catch {
        setError("Sin conexión. Revisa si se canceló antes de repetir.");
      }
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="h-11 rounded-full px-4 text-sm font-semibold text-terracota underline underline-offset-2"
      >
        Cancelar encomienda
      </button>
    );
  }

  return (
    <div className="space-y-3 rounded-2xl border border-terracota/30 bg-white p-4">
      <h3 className="font-display text-lg text-terracota-700">Cancelar encomienda #{number}</h3>
      <Notice tone="warn">
        {paid > 0 ? (
          <>
            <strong>El adelanto de {soles(paid)} no se devuelve automáticamente.</strong> Si corresponde devolverlo, hazlo y
            regístralo aparte.
          </>
        ) : (
          "La encomienda no tiene pagos registrados."
        )}
        {reserved > 0 && ` ${reserved === 1 ? "La torta reservada vuelve" : `Las ${reserved} tortas reservadas vuelven`} a la vitrina.`}
        {" "}Esta acción no se puede deshacer.
      </Notice>
      {inTransit > 0 && (
        <Notice tone="bad">
          {inTransit === 1 ? "Hay una torta de esta encomienda en camino." : `Hay ${inTransit} tortas de esta encomienda en camino.`}{" "}
          Recíbelas primero en{" "}
          <Link href="/admin/recepcion" className="font-semibold underline underline-offset-2">Recepción</Link>{" "}
          y luego cancela: así vuelven a la vitrina.
        </Notice>
      )}
      <div>
        <label htmlFor="cancel-reason" className={labelClass}>Motivo</label>
        <textarea
          id="cancel-reason"
          rows={2}
          className={cx(inputClass, "h-auto py-2")}
          maxLength={LIMITS.reason}
          value={reason}
          disabled={busy}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Ej.: el cliente desistió, cambió de fecha…"
        />
      </div>
      {error && <p role="alert" className="text-sm font-semibold text-terracota">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={busy || inTransit > 0}
          className="h-12 flex-1 rounded-full bg-terracota px-5 text-sm font-semibold text-white hover:bg-terracota-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? "Cancelando…" : "Sí, cancelar encomienda"}
        </button>
        <button
          type="button"
          onClick={() => { setOpen(false); setError(null); }}
          disabled={busy}
          className="h-12 rounded-full border border-cacao/25 px-5 text-sm font-semibold text-cacao"
        >
          No, volver
        </button>
      </div>
    </div>
  );
}
