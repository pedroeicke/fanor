"use client";

import { useState, useTransition } from "react";
import { resendOrderEmails } from "@/app/admin/actions";
import { IconCheck, IconMail } from "@/components/ui/icons";
import { cx } from "@/lib/format";

export type EmailRow = {
  kind: string;
  status: string;
  recipient: string;
  attempts: number;
  last_error: string | null;
  simulated: boolean;
};

const KIND_LABEL: Record<string, string> = {
  customer_confirmation: "Cliente",
  ops_notification: "Cocina",
};

/**
 * Estado dos e-mails do pedido, com reenvio.
 *
 * Fica na lista de pedidos porque é onde a falha importa: um pedido cuja
 * cozinha não foi avisada precisa saltar aos olhos de quem passa os olhos na
 * lista, não ficar escondido numa tela de detalhe.
 */
export function EmailStatus({ code, emails }: { code: string; emails: EmailRow[] }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const failed = emails.filter((e) => e.status === "failed");
  const missing = ["customer_confirmation", "ops_notification"].filter(
    (k) => !emails.some((e) => e.kind === k),
  );
  const needsAttention = failed.length > 0 || missing.length > 0;

  function resend() {
    setResult(null);
    startTransition(async () => {
      const r = await resendOrderEmails(code);
      setResult(
        r.ok
          ? { ok: true, message: "Reenviado" }
          : { ok: false, message: r.error ?? "No se pudo reenviar" },
      );
    });
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-crema-200 pt-3">
      <IconMail className="h-4 w-4 text-cacao-300" />

      {["customer_confirmation", "ops_notification"].map((kind) => {
        const row = emails.find((e) => e.kind === kind);
        const state = row?.status ?? "missing";
        return (
          <span
            key={kind}
            title={row?.last_error ?? undefined}
            className={cx(
              "rounded-full px-2.5 py-1 text-[11px] font-semibold",
              state === "sent" && !row?.simulated && "bg-verde-100 text-verde",
              state === "sent" && row?.simulated && "bg-crema-200 text-cacao-500",
              state === "failed" && "bg-terracota/10 text-terracota-700",
              (state === "missing" || state === "pending") && "bg-dorado-100 text-cacao-700",
            )}
          >
            {KIND_LABEL[kind]}:{" "}
            {state === "sent"
              ? row?.simulated
                ? "simulado"
                : "enviado"
              : state === "failed"
                ? "falló"
                : state === "pending"
                  ? "en curso"
                  : "sin enviar"}
            {row && row.attempts > 1 && ` (${row.attempts})`}
          </span>
        );
      })}

      {failed[0]?.last_error && (
        <span className="text-[12px] text-terracota-700">{failed[0].last_error}</span>
      )}

      {(needsAttention || result) && (
        <button
          type="button"
          onClick={resend}
          disabled={pending}
          className="ml-auto rounded-full border border-crema-300 px-3 py-1.5 text-[12px] font-medium text-cacao-700 transition-colors hover:border-cacao/35 disabled:opacity-50"
        >
          {pending ? "Reenviando..." : "Reenviar"}
        </button>
      )}

      {result && (
        <span
          className={cx(
            "flex items-center gap-1 text-[12px] font-medium",
            result.ok ? "text-verde" : "text-terracota-700",
          )}
        >
          {result.ok && <IconCheck className="h-3.5 w-3.5" />}
          {result.message}
        </span>
      )}
    </div>
  );
}
