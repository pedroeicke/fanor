"use client";

import { useEffect, useRef, useState } from "react";
import { cx } from "@/lib/format";
import { formatDuration } from "@/lib/gestion/dates";
import { TONE_CLASS } from "@/lib/gestion/labels";
import { slaTone, waitingMinutes } from "./shared";

/**
 * Quanto o lead está esperando, contando sozinho.
 *
 * O primeiro render usa a hora do servidor (a mesma do HTML), então não há
 * diferença entre servidor e navegador. Depois, a cada 30 s, soma o tempo
 * que passou no relógio do celular — corrigido pela diferença para o
 * servidor, porque celular com hora errada é comum e o vermelho tem de
 * aparecer na hora certa.
 *
 * Com primeiro contato registrado, o número congela: é o tempo de resposta.
 */
function useNow(serverNow: number, everyMs: number | null) {
  const [tick, setTick] = useState<number | null>(null);
  const offset = useRef(0);

  useEffect(() => {
    if (everyMs === null) return;
    offset.current = serverNow - Date.now();
    const timer = window.setInterval(() => setTick(Date.now() + offset.current), everyMs);
    return () => window.clearInterval(timer);
  }, [serverNow, everyMs]);

  /* Página recarregada traz `serverNow` novo; um tick velho não pode voltar o relógio. */
  return tick !== null && tick > serverNow ? tick : serverNow;
}

export function WaitTimer({
  createdAt,
  assignedAt,
  firstContactAt,
  closed,
  slaMin,
  serverNow,
}: {
  createdAt: string;
  assignedAt: string | null;
  firstContactAt: string | null;
  closed: boolean;
  slaMin: number;
  serverNow: number;
}) {
  const live = !firstContactAt && !closed;
  const now = useNow(serverNow, live ? 30_000 : null);

  if (closed && !firstContactAt) {
    return (
      <span className={cx("inline-flex min-h-8 items-center rounded-full border px-3 text-[12px] font-semibold", TONE_CLASS.muted)}>
        Sin contacto registrado
      </span>
    );
  }

  const minutes = waitingMinutes({ createdAt, assignedAt, firstContactAt }, now);
  const tone = slaTone(minutes, slaMin);

  return (
    <span
      className={cx("inline-flex min-h-8 items-center gap-1.5 rounded-full border px-3 text-[12px] font-semibold tabular-nums", TONE_CLASS[tone])}
      title={`Plazo para el primer contacto: ${slaMin} min`}
    >
      {live && <span aria-hidden className="h-2 w-2 animate-pulse rounded-full bg-current" />}
      {live ? `Esperando ${formatDuration(minutes)}` : `Contactado en ${formatDuration(minutes)}`}
    </span>
  );
}
