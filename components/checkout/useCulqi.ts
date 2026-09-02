"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Integração com o Culqi Checkout.
 *
 * O formulário de cartão é o modal do próprio Culqi: os dados do cartão nunca
 * tocam este código nem o nosso servidor, o que mantém a loja fora do escopo
 * pesado de PCI-DSS. Daqui só sai o token.
 *
 * Sem NEXT_PUBLIC_CULQI_PUBLIC_KEY o hook opera em modo demonstração: chama a
 * API de cobrança direto, que aprova e marca o pedido como simulado. É o que
 * permite percorrer o funil inteiro antes de existirem credenciais.
 */

type ChargeInput = {
  code: string;
  amount: number;
  email: string;
  description: string;
  paymentSession: string;
};
type ChargeResult = {
  status: "paid" | "failed" | "cancelled";
  error?: string;
  simulated?: boolean;
};

declare global {
  interface Window {
    Culqi?: {
      publicKey: string;
      settings: (opts: Record<string, unknown>) => void;
      options: (opts: Record<string, unknown>) => void;
      open: () => void;
      close: () => void;
      token?: { id: string };
      error?: { user_message?: string };
    };
    culqi?: () => void;
  }
}

const SCRIPT_SRC = "https://checkout.culqi.com/js/v4";
const publicKey = process.env.NEXT_PUBLIC_CULQI_PUBLIC_KEY;
const configured = Boolean(publicKey);

/* -------------------------------------------------------------------------- */
/*  Carregamento do script como sistema externo                               */
/*                                                                            */
/*  O estado do <script> não pertence ao React, então vive fora dele e é lido */
/*  por useSyncExternalStore. É o que evita o setState-dentro-de-effect e o   */
/*  render em cascata que ele provoca.                                        */
/* -------------------------------------------------------------------------- */

let loaded = !configured;
let requested = false;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((listener) => listener());
}

function ensureScript() {
  if (requested || loaded || typeof document === "undefined") return;
  requested = true;

  if (window.Culqi) {
    window.Culqi.publicKey = publicKey!;
    loaded = true;
    notify();
    return;
  }

  const script = document.createElement("script");
  script.src = SCRIPT_SRC;
  script.async = true;
  script.onload = () => {
    if (window.Culqi) window.Culqi.publicKey = publicKey!;
    loaded = true;
    notify();
  };
  script.onerror = () => {
    requested = false;
  };
  document.head.appendChild(script);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  ensureScript();
  return () => {
    listeners.delete(listener);
  };
}

export function useCulqi() {
  const ready = useSyncExternalStore(
    subscribe,
    () => loaded,
    /* No servidor não há script: o botão só destrava depois de hidratar. */
    () => !configured,
  );

  const charge = useCallback(async (input: ChargeInput): Promise<ChargeResult> => {
    if (!configured) {
      return postCharge({ code: input.code, email: input.email });
    }

    if (!window.Culqi) {
      return { status: "failed", error: "El formulario de pago no cargó. Recarga la página." };
    }

    const token = await openCulqiModal(input);
    if (!token) {
      await markCheckoutStopped(input.code, input.paymentSession, "cancelled");
      return { status: "cancelled", error: "Pago cancelado. Puedes intentarlo nuevamente." };
    }
    if (token.error) return { status: "failed", error: token.error };

    return postCharge({ code: input.code, email: input.email, token: token.id });
  }, []);

  return { ready, configured, charge };
}

export function markCheckoutStopped(
  code: string,
  paymentSession: string,
  reason: "cancelled" | "abandoned",
) {
  return fetch("/api/payments/culqi/cancel", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, paymentSession, reason }),
    keepalive: true,
  }).catch(() => undefined);
}

async function postCharge(body: { code: string; email: string; token?: string }): Promise<ChargeResult> {
  const res = await fetch("/api/payments/culqi", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) return { status: "failed", error: data.error };
  return { status: "paid", simulated: data.simulated };
}

/** Abre o modal e resolve quando o Culqi devolve token ou erro. */
function openCulqiModal(input: ChargeInput): Promise<{ id?: string; error?: string } | null> {
  return new Promise((resolve) => {
    const culqi = window.Culqi!;

    culqi.settings({
      title: "Tortas Fanor",
      currency: "PEN",
      /* Culqi trabalha em centavos, como inteiro. */
      amount: Math.round(input.amount * 100),
      order: input.code,
    });

    culqi.options({
      lang: "es",
      installments: false,
      paymentMethods: {
        tarjeta: true,
        yape: true,
        billetera: true,
        bancaMovil: false,
        agente: false,
        cuotealo: false,
      },
      style: { bannerColor: "#f7c118", buttonBackground: "#f7c118", menuColor: "#3b2314" },
    });

    /* O Culqi chama este global uma vez concluído o formulário. */
    window.culqi = () => {
      if (culqi.token?.id) resolve({ id: culqi.token.id });
      else resolve({ error: culqi.error?.user_message ?? "No pudimos validar tu tarjeta." });
      culqi.close();
    };

    culqi.open();
  });
}
