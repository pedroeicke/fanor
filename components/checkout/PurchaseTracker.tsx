"use client";

import { useEffect, useRef } from "react";
import { track } from "@/lib/analytics";

/**
 * Dispara o evento `purchase` na tela de confirmação.
 *
 * É o evento que fecha o funil: sem ele não há ROAS, não há otimização por
 * conversão nos anúncios e não dá para saber quanto rende cada campanha. O
 * site atual não emitia evento nenhum, em nenhuma etapa.
 */
export function PurchaseTracker({
  code,
  value,
  shipping,
  items,
}: {
  code: string;
  value: number;
  shipping: number;
  items: { item_id: string; item_name: string; price: number; quantity: number }[];
}) {
  const fired = useRef(false);

  useEffect(() => {
    /* Recarregar a página de confirmação não pode duplicar a conversão. */
    if (fired.current) return;
    const key = `fanor-purchase-${code}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
    } catch {
      /* Modo privado sem storage: emitir uma vez por montagem é aceitável. */
    }
    fired.current = true;

    track("purchase", {
      transaction_id: code,
      currency: "PEN",
      value,
      shipping,
      items,
    });
  }, [code, value, shipping, items]);

  return null;
}
