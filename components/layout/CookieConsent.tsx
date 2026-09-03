"use client";

import Link from "next/link";
import { useEffect, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/primitives";

/**
 * Consentimento de cookies.
 *
 * Só as analíticas dependem de escolha — as próprias, que guardam o carrinho,
 * são necessárias para o site funcionar. Por isso há duas opções reais e não
 * um botão "aceitar" sozinho: um aviso sem recusa possível não é
 * consentimento.
 *
 * A resposta vira Consent Mode do Google. O padrão declarado no layout é
 * `denied`, então nenhuma tag mede nada antes de a pessoa decidir.
 *
 * Fica no fluxo da página, logo abaixo do cabeçalho, e não flutuando sobre
 * ela. Flutuando era `fixed` no rodapé e cobria o que estivesse embaixo — no
 * checkout tapava o campo "Dirección": dava para ver o campo e não dava para
 * clicar nele, porque o clique acertava o banner. Reservar espaço no fim da
 * página não resolve, já que `fixed` se ancora no viewport, não no documento.
 */
const STORAGE_KEY = "fanor-consent";

type Choice = "granted" | "denied";

/* -------------------------------------------------------------------------- */
/*  Escolha guardada, lida como sistema externo                               */
/*                                                                            */
/*  localStorage não pertence ao React. `useSyncExternalStore` é o que evita  */
/*  o setState-dentro-de-effect e o render em cascata que ele provoca.        */
/* -------------------------------------------------------------------------- */

let cached: Choice | null | undefined;
const listeners = new Set<() => void>();

function readStored(): Choice | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === "granted" || value === "denied" ? value : null;
  } catch {
    /* Navegador sem storage: trata como já decidido e não insiste. */
    return "denied";
  }
}

function getSnapshot(): Choice | null {
  if (cached === undefined) cached = readStored();
  return cached;
}

/** No servidor o banner não existe — evita salto de layout na hidratação. */
function getServerSnapshot(): Choice | null {
  return "denied";
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function store(choice: Choice) {
  try {
    localStorage.setItem(STORAGE_KEY, choice);
  } catch {
    /* Sem storage a escolha vale só nesta visita. */
  }
  cached = choice;
  listeners.forEach((listener) => listener());
}

function pushConsent(choice: Choice) {
  window.dataLayer = window.dataLayer ?? [];
  window.dataLayer.push({
    event: "consent_update",
    analytics_storage: choice,
    ad_storage: choice,
    ad_user_data: choice,
    ad_personalization: choice,
  });
}

export function CookieConsent() {
  const choice = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  /* Reaplica a escolha a cada visita: o dataLayer começa vazio em cada
     carregamento, e o padrão do layout é negar. */
  useEffect(() => {
    if (choice) pushConsent(choice);
  }, [choice]);

  if (choice) return null;

  return (
    <div
      role="region"
      aria-label="Cookies"
      className="border-b border-crema-300 bg-crema-100"
    >
      <div className="mx-auto flex max-w-7xl flex-col gap-2.5 px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:px-6 sm:py-3 lg:px-8">
        <p className="text-[13px] leading-snug text-cacao-700 sm:text-[14px] sm:leading-relaxed">
          Usamos cookies para recordar tu carrito y, si aceptas, para medir cómo se usa la
          tienda. Rechazar no cambia nada.{" "}
          <Link
            href="/politicas-de-privacidad"
            className="text-terracota underline underline-offset-4"
          >
            Más información
          </Link>
        </p>

        <div className="flex shrink-0 gap-2">
          <Button size="sm" onClick={() => store("granted")}>
            Aceptar todas
          </Button>
          <Button size="sm" variant="outline" onClick={() => store("denied")}>
            Solo las necesarias
          </Button>
        </div>
      </div>
    </div>
  );
}
