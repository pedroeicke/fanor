/**
 * Camada de medição.
 *
 * O site antigo não tinha nada: sem GA4, sem GTM, sem Pixel. Sem isso não há
 * remarketing, não há público semelhante e não dá para saber onde o funil
 * quebra. Aqui os eventos de e-commerce são emitidos no formato GA4 e
 * empurrados para o dataLayer, que serve tanto ao GTM quanto ao Pixel.
 */

type Params = Record<string, unknown>;

declare global {
  interface Window {
    dataLayer?: unknown[];
    fbq?: (...args: unknown[]) => void;
  }
}

/** Nomes de evento GA4 mapeados para o equivalente no Pixel da Meta. */
const META_EVENTS: Record<string, string> = {
  view_item: "ViewContent",
  add_to_cart: "AddToCart",
  begin_checkout: "InitiateCheckout",
  add_payment_info: "AddPaymentInfo",
  purchase: "Purchase",
};

export function track(event: string, params: Params = {}) {
  if (typeof window === "undefined") return;

  window.dataLayer = window.dataLayer ?? [];
  window.dataLayer.push({ event, ...params });

  const metaEvent = META_EVENTS[event];
  if (metaEvent && typeof window.fbq === "function") {
    window.fbq("track", metaEvent, {
      currency: params.currency ?? "PEN",
      value: params.value ?? 0,
    });
  }

  if (process.env.NODE_ENV === "development") {
    console.debug(`[analytics] ${event}`, params);
  }
}
