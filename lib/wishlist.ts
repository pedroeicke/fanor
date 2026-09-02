"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Favoritos. Comprar torta costuma ser decisão a dois — a pessoa salva
 * candidatas, consulta e volta. O site antigo tinha wishlist mas exigia conta,
 * o que matava o uso; aqui vive no navegador, sem cadastro.
 */
type WishlistState = {
  ids: string[];
  toggle: (id: string) => void;
  clear: () => void;
};

export const useWishlist = create<WishlistState>()(
  persist(
    (set) => ({
      ids: [] as string[],
      toggle: (id) =>
        set((s) => ({ ids: s.ids.includes(id) ? s.ids.filter((x) => x !== id) : [...s.ids, id] })),
      clear: () => set({ ids: [] }),
    }),
    { name: "fanor-wishlist" },
  ),
);
