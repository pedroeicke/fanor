"use client";

import { useSyncExternalStore } from "react";

/** Nada a assinar: o valor muda uma vez, na transição servidor → cliente. */
const subscribe = () => () => {};

/**
 * `false` durante o render do servidor e a hidratação, `true` depois.
 *
 * Carrinho e favoritos vivem no localStorage, então o primeiro render tem de
 * bater com o HTML do servidor para não quebrar a hidratação. Esta é a forma
 * sancionada no React 19 — `useState` + `useEffect` provoca render em cascata
 * e é justamente o que a regra `react-hooks/set-state-in-effect` aponta.
 */
export function useHydrated() {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
