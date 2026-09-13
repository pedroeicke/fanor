"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";

/**
 * Impede a vitrine de mostrar estoque de outra hora.
 *
 * `/vitrina` se regenera a cada minuto, mas o ISR entrega a versão guardada
 * ao primeiro visitante depois do prazo e só então refaz a página no fundo.
 * Numa noite sem visitas, quem abre às 9h receberia a vitrine das 20h de
 * ontem: "Preparada hoy" em torta de ontem, torta que já foi vendida. A aba
 * esquecida aberta envelhece do mesmo jeito.
 *
 * O servidor carimba a hora do render; o navegador confere:
 * - mais velha que `REFRESH_AFTER_MS`: pede a versão nova em silêncio (a
 *   própria visita já disparou a regeneração, então uma nova tentativa logo
 *   depois costuma vir em dia);
 * - mais velha que `HIDE_AFTER_MS`: tira os números da tela enquanto
 *   atualiza e, se não conseguir, mostra o estado honesto no lugar.
 *
 * Numa carga completa, um script inline esconde o bloco antes da primeira
 * pintura — sem ele a pessoa veria o estoque velho até o React hidratar.
 */

const TICK_MS = 15_000;
/* A página se refaz a cada 60 s; até 2 min é o ritmo normal do ISR. */
const REFRESH_AFTER_MS = 2 * 60_000;
/* Dentro do prazo do SLA do leitor (15 min) com folga: além disto, não é
   mais "agora". */
const HIDE_AFTER_MS = 10 * 60_000;
/* Espera antes de cada tentativa: a regeneração leva alguns segundos, e um
   servidor com problema não merece ser martelado. Soma ~2 min. */
const RETRY_DELAYS_MS = [1_500, 4_000, 8_000, 15_000, 30_000, 60_000];

function subscribeClock(onChange: () => void) {
  const timer = window.setInterval(onChange, TICK_MS);
  /* Voltando para a aba, o relógio anda na hora — não no próximo tique. */
  document.addEventListener("visibilitychange", onChange);
  return () => {
    window.clearInterval(timer);
    document.removeEventListener("visibilitychange", onChange);
  };
}

/* Arredondado para cima no tique: o valor fica estável entre leituras e
   nunca atrás do script inline, que usa a hora exata. Assim, o que o script
   escondeu o React também considera velho. */
const readClock = () => Math.ceil(Date.now() / TICK_MS) * TICK_MS;
/* No servidor e na hidratação a idade é zero: o HTML tem de bater. */
const noClock = () => null;

function subscribeVisibility(onChange: () => void) {
  document.addEventListener("visibilitychange", onChange);
  return () => document.removeEventListener("visibilitychange", onChange);
}
const isVisible = () => document.visibilityState === "visible";
const assumeVisible = () => true;

function useAge(renderedAt: number) {
  const now = useSyncExternalStore(subscribeClock, readClock, noClock);
  return now === null ? 0 : now - renderedAt;
}

/**
 * Esconde o que só vale "agora" (selo "En tienda ahora", atalhos com
 * contagem) quando a página ficou velha. Não atualiza nada sozinho: quem
 * pede a versão nova é o `FreshnessGuard` da mesma página.
 */
export function FreshOnly({ renderedAt, children }: { renderedAt: number; children: ReactNode }) {
  const age = useAge(renderedAt);
  if (age > HIDE_AFTER_MS) return null;
  return <Hideable until={renderedAt + HIDE_AFTER_MS}>{children}</Hideable>;
}

/** Bloco de estoque: atualiza a página velha e, sem sucesso, cede ao `fallback`. */
export function FreshnessGuard({
  renderedAt,
  children,
  fallback,
}: {
  /** `Date.now()` do render no servidor. */
  renderedAt: number;
  children: ReactNode;
  /** O que mostrar se a versão nova não vier: nunca o número velho. */
  fallback: ReactNode;
}) {
  const router = useRouter();
  const age = useAge(renderedAt);
  const visible = useSyncExternalStore(subscribeVisibility, isVisible, assumeVisible);

  /* Tentativas por versão da página: chegando um render novo, a contagem
     recomeça sem precisar de efeito para zerar. */
  const [tries, setTries] = useState({ renderedAt, count: 0 });
  const count = tries.renderedAt === renderedAt ? tries.count : 0;
  const shouldRefresh = age > REFRESH_AFTER_MS && count < RETRY_DELAYS_MS.length;

  useEffect(() => {
    /* Aba no fundo não gasta tentativa nem bate no servidor. */
    if (!shouldRefresh || !visible) return;
    const timer = window.setTimeout(() => {
      setTries({ renderedAt, count: count + 1 });
      router.refresh();
    }, RETRY_DELAYS_MS[count]);
    return () => window.clearTimeout(timer);
  }, [shouldRefresh, visible, count, renderedAt, router]);

  if (age <= HIDE_AFTER_MS) return <Hideable until={renderedAt + HIDE_AFTER_MS}>{children}</Hideable>;
  if (count < RETRY_DELAYS_MS.length) return <Updating />;
  return <>{fallback}</>;
}

function Updating() {
  return (
    <div role="status" className="card mx-auto flex max-w-2xl flex-col items-center px-6 py-10 text-center sm:px-10">
      <span aria-hidden="true" className="h-9 w-9 animate-spin rounded-full border-[3px] border-crema-300 border-t-dorado-600" />
      <p className="mt-5 font-display text-xl text-cacao sm:text-2xl">Actualizando las tortas disponibles…</p>
      <p className="mt-2 max-w-md text-[15px] leading-relaxed text-cacao-500">
        Un momento: estamos confirmando qué queda en cada tienda.
      </p>
    </div>
  );
}

/**
 * Embrulha o conteúdo e, logo depois dele, um script que o esconde antes da
 * pintura se o HTML chegou velho.
 *
 * O script só roda no HTML do servidor: no cliente o React não executa
 * `<script>`, e o tipo inerte evita o aviso dele. `suppressHydrationWarning`
 * aceita o `hidden` que o script pôs — em seguida o próprio React troca o
 * bloco pelo estado de atualização.
 */
function Hideable({ until, children }: { until: number; children: ReactNode }) {
  /* Número que vai para dentro do script: só dígitos, nunca texto. Sem
     carimbo válido, nunca esconde. */
  const limit = Number.isFinite(until) ? Math.trunc(until) : Number.MAX_SAFE_INTEGER;
  return (
    <>
      <div suppressHydrationWarning>{children}</div>
      <script
        type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
        suppressHydrationWarning
        dangerouslySetInnerHTML={{
          __html: `(function(s){var e=s&&s.previousElementSibling;if(e&&Date.now()>${limit})e.hidden=true})(document.currentScript)`,
        }}
      />
    </>
  );
}
