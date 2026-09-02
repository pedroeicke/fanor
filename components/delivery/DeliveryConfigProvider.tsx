"use client";

import { createContext, useContext, type ReactNode } from "react";
import { DEFAULT_DELIVERY_CONFIG, type DeliveryConfig } from "@/lib/delivery";

/**
 * Configuração de entrega disponível a todo componente de cliente.
 *
 * Contexto em vez de prop: o cálculo de frete acontece no carrinho, na gaveta,
 * no checkout e no seletor de data — passar a mesma tabela por quatro níveis
 * de props é onde essas coisas se perdem e um deles acaba usando um valor
 * velho.
 *
 * O valor é lido no servidor e injetado no layout raiz, então já chega no
 * primeiro HTML: nada de o frete aparecer depois de um piscar.
 */
const DeliveryConfigContext = createContext<DeliveryConfig>(DEFAULT_DELIVERY_CONFIG);

export function DeliveryConfigProvider({
  config,
  children,
}: {
  config: DeliveryConfig;
  children: ReactNode;
}) {
  return <DeliveryConfigContext.Provider value={config}>{children}</DeliveryConfigContext.Provider>;
}

export function useDeliveryConfig() {
  return useContext(DeliveryConfigContext);
}
