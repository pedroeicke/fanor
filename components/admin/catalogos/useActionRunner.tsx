"use client";

import { useRef, useState, useTransition } from "react";
import type { ActionResult } from "@/lib/gestion/server";
import { Notice } from "@/components/admin/ui";

/**
 * Executa uma ação do servidor com trava de duplo envio e mensagem de volta.
 *
 * Um único "pendente" por tela, de propósito: enquanto um cadastro grava,
 * nenhum outro botão da lista responde — dois toques rápidos no celular não
 * viram dois sabores iguais nem uma ordem trocada duas vezes.
 *
 * A mensagem sai perto de onde a pessoa tocou (`feedbackFor`): no celular a
 * lista é longa, e um erro no topo da página é um erro que ninguém vê.
 *
 * A ação revalida a rota no servidor, então a lista nova chega na mesma ida;
 * não precisa de `router.refresh()`.
 */

/** `key` é "ação:id" para uma linha, ou só "ação" para o formulário da tela. */
export type Feedback = { key: string; tone: "ok" | "bad"; text: string } | null;

type Options<T> = {
  success?: string | ((data: T) => string);
  onSuccess?: (data: T) => void;
};

export function useActionRunner() {
  const [pending, startTransition] = useTransition();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  /* O `disabled` só vale depois do próximo render; dois toques no mesmo
     quadro passariam. A referência fecha a porta na hora. */
  const inFlight = useRef(false);

  function run<T>(key: string, action: () => Promise<ActionResult<T>>, options: Options<T> = {}) {
    if (inFlight.current) return;
    inFlight.current = true;
    setFeedback(null);
    setBusyKey(key);
    startTransition(async () => {
      let settle: () => void;
      try {
        const result = await action();
        settle = () => {
          if (result.ok) {
            options.onSuccess?.(result.data);
            const text = typeof options.success === "function" ? options.success(result.data) : options.success;
            if (text) setFeedback({ key, tone: "ok", text });
          } else {
            setFeedback({ key, tone: "bad", text: result.error });
          }
        };
      } catch {
        /* Rede caiu ou o servidor reiniciou no meio: a ação pode não ter
           chegado. Dizer isso é melhor que um botão que "não fez nada". */
        settle = () =>
          setFeedback({ key, tone: "bad", text: "No se pudo conectar con el servidor. Revisa tu conexión e inténtalo de nuevo." });
      }
      inFlight.current = false;
      /* Depois de um `await` o React não sabe mais que é transição: sem este
         segundo startTransition, fechar o formulário apareceria antes da
         lista nova e o nome antigo piscaria na tela. */
      startTransition(() => {
        settle();
        setBusyKey(null);
      });
    });
  }

  /** Mensagem da linha `id`, ou — sem `id` — das ações que não são de linha. */
  function feedbackFor(id?: string): Feedback {
    if (!feedback) return null;
    const scope = feedback.key.split(":")[1];
    return (id ? scope === id : scope === undefined) ? feedback : null;
  }

  return { pending, busyKey, feedbackFor, setFeedback, run };
}

export function ActionFeedback({ feedback }: { feedback: Feedback }) {
  if (!feedback) return null;
  return (
    <div role={feedback.tone === "bad" ? "alert" : "status"}>
      <Notice tone={feedback.tone}>{feedback.text}</Notice>
    </div>
  );
}

/* Alvos de 44 px: a vendedora toca com o polegar, às vezes com luva. */
const base =
  "inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-full px-5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-45";

export const buttonClass = {
  primary: `${base} bg-dorado text-cacao hover:bg-dorado-600`,
  outline: `${base} border border-crema-300 bg-white text-cacao-700 hover:border-cacao/35`,
  danger: `${base} border border-terracota/40 bg-white text-terracota-700 hover:bg-terracota/10`,
  dangerSolid: `${base} bg-terracota text-white hover:bg-terracota-700`,
  dark: `${base} bg-cacao text-crema hover:bg-cacao-700`,
  icon: "inline-grid h-11 w-11 shrink-0 place-items-center rounded-full border border-crema-300 bg-white text-cacao-700 transition-colors hover:border-cacao/35 disabled:cursor-not-allowed disabled:opacity-35",
};
