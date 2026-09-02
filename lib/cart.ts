"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { deliveryCost, findDistrict, type DeliveryConfig } from "./delivery";
import { getAddon } from "./addons";
import { track } from "./analytics";

export type DeliveryMethod = "delivery" | "pickup";

export type CartItem = {
  /** Chave da linha: mesmo produto com tamanho ou mensagem diferente é outra linha. */
  key: string;
  productId: string;
  slug: string;
  name: string;
  image: string;
  unitPrice: number;
  qty: number;
  /** Identificador da variação — é o que o servidor usa para reprecificar. */
  sizeSlug: string | null;
  sizeLabel: string | null;
  sizeServes: string | null;
  flavors: string[];
  /** Texto escrito sobre a torta. */
  cakeMessage: string;
  /**
   * Caminho da foto no armazenamento. Não é URL: a do balde privado expira,
   * e um pedido de daqui a um mês precisa continuar apontando para a imagem.
   */
  photoUrl: string | null;
  photoName: string | null;
  leadTimeHours: number;
  /**
   * Torta montada no configurador. Quando presente, o servidor precifica pelas
   * regras de lib/custom-cake.ts em vez de procurar o slug no catálogo.
   */
  custom?: { sizeId: string; styleId: string } | null;
};

export type AddonItem = {
  addonId: string;
  name: string;
  detail: string;
  unitPrice: number;
  qty: number;
  message: string;
};

export type Delivery = {
  method: DeliveryMethod;
  dateISO: string | null;
  slotId: string | null;
  districtSlug: string | null;
};

type CartState = {
  items: CartItem[];
  addons: AddonItem[];
  delivery: Delivery;
  /** Abre a gaveta do carrinho após adicionar — confirma a ação sem trocar de página. */
  drawerOpen: boolean;

  addItem: (item: Omit<CartItem, "key">, delivery?: Partial<Delivery>) => void;
  removeItem: (key: string) => void;
  setQty: (key: string, qty: number) => void;
  addAddon: (addonId: string) => void;
  setAddonQty: (addonId: string, qty: number) => void;
  setAddonMessage: (addonId: string, message: string) => void;
  setDelivery: (patch: Partial<Delivery>) => void;
  openDrawer: () => void;
  closeDrawer: () => void;
  clear: () => void;
};

function makeKey(i: Omit<CartItem, "key">) {
  return [i.productId, i.sizeSlug ?? "-", i.flavors.join("+") || "-", i.cakeMessage || "-", i.photoUrl ?? "-"].join(
    "|",
  );
}

export const useCart = create<CartState>()(
  persist(
    (set) => ({
      items: [],
      addons: [],
      delivery: { method: "delivery", dateISO: null, slotId: null, districtSlug: null },
      drawerOpen: false,

      addItem: (item, delivery) => {
        const key = makeKey(item);
        set((s) => {
          const existing = s.items.find((x) => x.key === key);
          const items = existing
            ? s.items.map((x) => (x.key === key ? { ...x, qty: x.qty + item.qty } : x))
            : [...s.items, { ...item, key }];
          return { items, delivery: { ...s.delivery, ...delivery }, drawerOpen: true };
        });
        track("add_to_cart", {
          currency: "PEN",
          value: item.unitPrice * item.qty,
          items: [{ item_id: item.slug, item_name: item.name, price: item.unitPrice, quantity: item.qty }],
        });
      },

      removeItem: (key) => set((s) => ({ items: s.items.filter((x) => x.key !== key) })),

      setQty: (key, qty) =>
        set((s) => ({
          items:
            qty <= 0
              ? s.items.filter((x) => x.key !== key)
              : s.items.map((x) => (x.key === key ? { ...x, qty: Math.min(qty, 20) } : x)),
        })),

      addAddon: (addonId) => {
        const addon = getAddon(addonId);
        if (!addon) return;
        set((s) => {
          const existing = s.addons.find((a) => a.addonId === addonId);
          if (existing) {
            return { addons: s.addons.map((a) => (a.addonId === addonId ? { ...a, qty: a.qty + 1 } : a)) };
          }
          return {
            addons: [
              ...s.addons,
              { addonId, name: addon.name, detail: addon.detail, unitPrice: addon.price, qty: 1, message: "" },
            ],
          };
        });
        track("add_to_cart", {
          currency: "PEN",
          value: addon.price,
          items: [{ item_id: addon.id, item_name: addon.name, price: addon.price, quantity: 1 }],
        });
      },

      setAddonQty: (addonId, qty) =>
        set((s) => ({
          addons:
            qty <= 0
              ? s.addons.filter((a) => a.addonId !== addonId)
              : s.addons.map((a) => (a.addonId === addonId ? { ...a, qty: Math.min(qty, 20) } : a)),
        })),

      setAddonMessage: (addonId, message) =>
        set((s) => ({
          addons: s.addons.map((a) => (a.addonId === addonId ? { ...a, message } : a)),
        })),

      setDelivery: (patch) => set((s) => ({ delivery: { ...s.delivery, ...patch } })),
      openDrawer: () => set({ drawerOpen: true }),
      closeDrawer: () => set({ drawerOpen: false }),
      clear: () =>
        set({
          items: [],
          addons: [],
          delivery: { method: "delivery", dateISO: null, slotId: null, districtSlug: null },
          drawerOpen: false,
        }),
    }),
    {
      name: "fanor-cart",
      /** A gaveta não deve reabrir sozinha ao recarregar a página. */
      partialize: (s) => ({ items: s.items, addons: s.addons, delivery: s.delivery }),
    },
  ),
);

/* -------------------------------------------------------------------------- */
/*  Totais                                                                    */
/* -------------------------------------------------------------------------- */

export type Totals = {
  subtotal: number;
  shipping: number | null;
  total: number;
  itemCount: number;
  /** Quanto falta para o delivery sair de cortesia. */
  freeShippingGap: number;
};

export function computeTotals(
  items: CartItem[],
  addons: AddonItem[],
  delivery: Delivery,
  config: DeliveryConfig,
): Totals {
  const subtotal =
    items.reduce((sum, i) => sum + i.unitPrice * i.qty, 0) +
    addons.reduce((sum, a) => sum + a.unitPrice * a.qty, 0);

  const shipping =
    delivery.method === "pickup"
      ? 0
      : deliveryCost(config, findDistrict(config, delivery.districtSlug), subtotal);

  return {
    subtotal,
    shipping,
    total: subtotal + (shipping ?? 0),
    itemCount: items.reduce((n, i) => n + i.qty, 0) + addons.reduce((n, a) => n + a.qty, 0),
    freeShippingGap: Math.max(0, config.freeFrom - subtotal),
  };
}

/** Antecedência mais longa do carrinho manda na primeira data possível. */
export function cartLeadTime(items: CartItem[]) {
  return items.reduce((max, i) => Math.max(max, i.leadTimeHours), 24);
}
