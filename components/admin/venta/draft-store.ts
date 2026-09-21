"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { centsToInput, type CounterMethod } from "./money";
import type { CakeLookup, CartLine, CustomerRef, PaymentLine, ProductHit, SaleKind, SaleReceipt } from "./types";

/**
 * Rascunho da venda em andamento.
 *
 * Fica no sessionStorage: o celular da vendedora recarrega a aba quando volta
 * da câmera ou do WhatsApp, e perder um carrinho com três tortas escaneadas no
 * meio do atendimento é o tipo de coisa que faz voltar ao caderno. Session e
 * não local: fechar a aba encerra o atendimento, e o carrinho de ontem não
 * aparece amanhã.
 */

type DraftData = {
  /** Null = ainda não escolheu; a tela usa a loja da vendedora do login. */
  storeId: string | null;
  /** Null = padrão (vendedora do login); "" = escolheu "sin vendedora". */
  sellerId: string | null;
  kind: SaleKind;
  lines: CartLine[];
  payments: PaymentLine[];
  customer: CustomerRef | null;
  notes: string;
  receipt: SaleReceipt | null;
  /**
   * Uma cobrança saiu e a resposta não voltou (rede caiu, aba recarregou).
   * A venda pode estar gravada: o próximo "Cobrar" procura antes de repetir.
   */
  unconfirmed: boolean;
  /**
   * Identifica este carrinho no banco. Cobrar duas vezes com a mesma chave
   * devolve a venda já gravada em vez de criar outra — é o que fecha a
   * janela entre gravar e a resposta chegar. Nasce com o carrinho e só muda
   * quando começa uma venda nova.
   */
  clientRef: string;
};

type DraftActions = {
  /** Trocar de loja esvazia o carrinho: torta de outra loja não vende aqui. */
  setStore: (storeId: string) => void;
  setSeller: (sellerId: string) => void;
  setKind: (kind: SaleKind) => void;
  addCake: (cake: CakeLookup, expiredAccepted: boolean) => boolean;
  addItem: (product: ProductHit) => void;
  updateLine: (key: string, patch: { price?: string; discount?: string; quantity?: string }) => void;
  removeLine: (key: string) => void;
  /** `freeze`: valor atual dos pagamentos automáticos, que deixam de acompanhar o total. */
  addPayment: (method: CounterMethod, freeze: Record<string, number>) => void;
  updatePayment: (key: string, patch: { amount?: string; reference?: string }) => void;
  removePayment: (key: string) => void;
  setCustomer: (customer: CustomerRef | null) => void;
  setNotes: (notes: string) => void;
  setUnconfirmed: (unconfirmed: boolean) => void;
  /** Venda gravada: limpa o carrinho, mantém loja e vendedora, mostra o recibo. */
  finish: (receipt: SaleReceipt) => void;
  newSale: () => void;
};

function newKey() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/* O banco guarda a chave como uuid; navegador sem randomUUID (http em rede
   local, versão antiga) monta um no mesmo formato a partir de números
   aleatórios. */
function newClientRef() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  const hex = Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));
  hex[6] = (hex[6] & 0x0f) | 0x40;
  hex[8] = (hex[8] & 0x3f) | 0x80;
  const s = hex.map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

/* Função, não constante: cada carrinho novo precisa da sua própria chave. */
const emptyCart = () => ({
  lines: [],
  payments: [],
  customer: null,
  notes: "",
  kind: "counter" as SaleKind,
  clientRef: newClientRef(),
});

export const useSaleDraft = create<DraftData & DraftActions>()(
  persist(
    (set, get) => ({
      storeId: null,
      sellerId: null,
      receipt: null,
      unconfirmed: false,
      ...emptyCart(),

      /* Cliente e nota não são da loja: continuam. */
      setStore: (storeId) => set({ storeId, sellerId: null, lines: [], payments: [] }),
      setSeller: (sellerId) => set({ sellerId }),
      setKind: (kind) => set({ kind }),

      addCake: (cake, expiredAccepted) => {
        if (get().lines.some((l) => l.kind === "cake" && l.serial === cake.serial)) return false;
        set((s) => ({
          lines: [
            ...s.lines,
            {
              key: newKey(),
              kind: "cake",
              serial: cake.serial,
              productId: cake.productId,
              name: cake.name,
              sku: cake.sku,
              flavor: cake.flavor,
              expiresOn: cake.expiresOn,
              expiredAccepted,
              price: centsToInput(cake.suggestedCents),
              discount: "",
            },
          ],
        }));
        return true;
      },

      /* O mesmo produto tocado de novo soma na linha que já existe: duas
         empanadas são uma linha "2 ×", como na boleta. */
      addItem: (product) =>
        set((s) => {
          const existing = s.lines.find((l) => l.kind === "item" && l.productId === product.id);
          if (existing && existing.kind === "item") {
            const qty = Math.min(999, (Number(existing.quantity) || 0) + 1);
            return { lines: s.lines.map((l) => (l.key === existing.key ? { ...existing, quantity: String(qty) } : l)) };
          }
          return {
            lines: [
              ...s.lines,
              {
                key: newKey(),
                kind: "item",
                productId: product.id,
                name: product.name,
                sku: product.sku,
                quantity: "1",
                price: centsToInput(product.suggestedCents),
                discount: "",
              },
            ],
          };
        }),

      updateLine: (key, patch) =>
        set((s) => ({
          lines: s.lines.map((l) => {
            if (l.key !== key) return l;
            if (l.kind === "cake") {
              return { ...l, price: patch.price ?? l.price, discount: patch.discount ?? l.discount };
            }
            return {
              ...l,
              price: patch.price ?? l.price,
              discount: patch.discount ?? l.discount,
              quantity: patch.quantity ?? l.quantity,
            };
          }),
        })),

      removeLine: (key) => set((s) => ({ lines: s.lines.filter((l) => l.key !== key) })),

      /* Dinheiro é quem absorve o resto: "50 no Yape e o resto em efectivo"
         é o pagamento dividido mais comum. Com efectivo automático na tela, a
         forma nova entra vazia para digitar e o efectivo recalcula sozinho.
         Sem ele, a forma anterior fica com o valor que tinha e a nova assume
         o que falta. */
      addPayment: (method, freeze) =>
        set((s) => {
          const autoCash = s.payments.some((p) => p.auto && p.method === "cash");
          if (method !== "cash" && autoCash) {
            return { payments: [...s.payments, { key: newKey(), method, amount: "", reference: "", auto: false }] };
          }
          return {
            payments: [
              ...s.payments.map((p) => (p.auto ? { ...p, auto: false, amount: centsToInput(freeze[p.key] ?? 0) } : p)),
              { key: newKey(), method, amount: "", reference: "", auto: true },
            ],
          };
        }),

      /* Digitar o valor desliga o acompanhamento automático daquele pagamento. */
      updatePayment: (key, patch) =>
        set((s) => ({
          payments: s.payments.map((p) =>
            p.key !== key
              ? p
              : {
                  ...p,
                  amount: patch.amount ?? p.amount,
                  reference: patch.reference ?? p.reference,
                  auto: patch.amount !== undefined ? false : p.auto,
                },
          ),
        })),

      removePayment: (key) => set((s) => ({ payments: s.payments.filter((p) => p.key !== key) })),
      setCustomer: (customer) => set({ customer }),
      setNotes: (notes) => set({ notes }),
      setUnconfirmed: (unconfirmed) => set({ unconfirmed }),

      finish: (receipt) => set({ receipt, unconfirmed: false, ...emptyCart() }),
      newSale: () => set({ receipt: null, unconfirmed: false, ...emptyCart() }),
    }),
    {
      name: "fanor-venta",
      version: 1,
      storage: createJSONStorage(() => sessionStorage),
      partialize: (s) => ({
        storeId: s.storeId,
        sellerId: s.sellerId,
        kind: s.kind,
        lines: s.lines,
        payments: s.payments,
        customer: s.customer,
        notes: s.notes,
        receipt: s.receipt,
        unconfirmed: s.unconfirmed,
        /* Sem isto, recarregar a aba geraria chave nova e a cobrança repetida
           voltaria a duplicar. */
        clientRef: s.clientRef,
      }),
    },
  ),
);
