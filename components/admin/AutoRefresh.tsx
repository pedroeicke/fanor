"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Recarrega os dados da página de tempos em tempos, sem F5.
 *
 * A página é renderizada no servidor; `router.refresh()` pede ao servidor a
 * versão nova e troca só o conteúdo, mantendo rolagem e estado. Vale para
 * tela que fica aberta no balcão ou na produção, onde ninguém vai apertar F5
 * para ver se entrou torta.
 *
 * Só enquanto a aba está visível: uma aba esquecida no fundo não fica
 * batendo no servidor a cada 5 s.
 */
export function AutoRefresh({ everyMs = 5_000 }: { everyMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const timer = window.setInterval(tick, everyMs);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [router, everyMs]);

  return null;
}
