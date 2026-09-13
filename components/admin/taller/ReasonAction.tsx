"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/lib/gestion/server";
import { cx } from "@/lib/format";
import { inputClass } from "@/components/admin/ui";

/**
 * Botão de ação que pede um motivo antes de executar.
 *
 * Cancelar pedido, fechar pedido, descartar torta, dar faltante por perdida:
 * nenhuma tem volta. Um toque abre a confirmação com o motivo; o segundo
 * executa. Em celular, com o dedo, isso evita o "apertei sem querer".
 *
 * O motivo vai para as notas da operação — é o que o Joseka lê depois para
 * entender por que o pedido fechou pela metade.
 */
export function ReasonAction({
  action,
  label,
  confirmLabel,
  prompt,
  placeholder = "Motivo",
  suggestions = [],
  requireReason = false,
  tone = "neutral",
  maxLength = 200,
  onDone,
}: {
  /** Server action já com os ids amarrados (`acao.bind(null, id)`); recebe só o texto. */
  action: (reason: string) => Promise<ActionResult<unknown>>;
  label: string;
  confirmLabel: string;
  prompt: string;
  placeholder?: string;
  suggestions?: string[];
  requireReason?: boolean;
  tone?: "neutral" | "danger" | "ok";
  maxLength?: number;
  onDone?: () => void;
}) {
  const router = useRouter();
  const fieldId = useId();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const missingReason = requireReason && reason.trim().length < 3;

  function confirm() {
    if (pending || missingReason) return;
    setError(null);
    startTransition(async () => {
      const result = await action(reason.trim());
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOpen(false);
      setReason("");
      onDone?.();
      router.refresh();
    });
  }

  const triggerTone = {
    neutral: "border-crema-300 bg-white text-cacao-700 hover:border-cacao/35",
    danger: "border-terracota/30 bg-white text-terracota-700 hover:border-terracota/60",
    ok: "border-verde/35 bg-white text-verde hover:border-verde/60",
  }[tone];

  const confirmTone = {
    neutral: "bg-cacao text-crema hover:bg-cacao-700",
    danger: "bg-terracota text-white hover:bg-terracota-700",
    ok: "bg-verde text-white hover:opacity-90",
  }[tone];

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cx("inline-flex h-11 items-center justify-center rounded-full border px-5 text-sm font-semibold transition-colors", triggerTone)}
      >
        {label}
      </button>
    );
  }

  return (
    <div className="w-full space-y-3 rounded-2xl border border-crema-300 bg-crema-100 p-4">
      <label htmlFor={fieldId} className="block text-sm font-semibold text-cacao">
        {prompt}
      </label>
      <input
        id={fieldId}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        maxLength={maxLength}
        placeholder={requireReason ? placeholder : `${placeholder} (opcional)`}
        className={inputClass}
        /* Só abre o teclado do celular quando o motivo é obrigatório; nos
           opcionais ele cobriria o botão de confirmar. */
        autoFocus={requireReason}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            confirm();
          }
        }}
      />
      {suggestions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setReason(s)}
              className={cx(
                "h-11 rounded-full border px-4 text-sm transition-colors",
                reason === s ? "border-dorado bg-dorado-100 text-cacao" : "border-crema-300 bg-white text-cacao-700",
              )}
            >
              {s}
            </button>
          ))}
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm font-medium text-terracota-700">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={confirm}
          disabled={pending || missingReason}
          className={cx(
            "inline-flex h-11 flex-1 items-center justify-center rounded-full px-5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-45 sm:flex-none",
            confirmTone,
          )}
        >
          {pending ? "Guardando…" : confirmLabel}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          disabled={pending}
          className="inline-flex h-11 items-center justify-center rounded-full border border-crema-300 bg-white px-5 text-sm font-medium text-cacao-700 disabled:opacity-45"
        >
          Volver
        </button>
      </div>
    </div>
  );
}
