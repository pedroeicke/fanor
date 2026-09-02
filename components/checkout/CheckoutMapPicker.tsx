"use client";

import dynamic from "next/dynamic";
import { DeliveryLocationPicker, type DeliveryCoordinates } from "./DeliveryLocationPicker";

/**
 * Escolhe qual mapa o checkout mostra.
 *
 * Com `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` definida, usa o Google. Sem ela, cai
 * no mapa de OpenStreetMap, que não precisa de chave nem de conta de
 * faturamento. Os dois têm a mesma interface, então o resto do checkout não
 * sabe qual está em uso.
 *
 * A alternativa — exigir a chave — deixaria o site sem mapa no dia em que a
 * cota do mês estourasse ou o cartão vencesse. Aqui o pior caso é o mapa ficar
 * menos bonito.
 */

/* `dynamic` para o pacote do Google não entrar no bundle de quem não tem
   chave configurada. */
const GoogleMapPicker = dynamic(
  () => import("./GoogleMapPicker").then((m) => m.GoogleMapPicker),
  { ssr: false },
);

type Store = { id: string; name: string; address: string; lat: number; lng: number };

export function CheckoutMapPicker(props: {
  stores: Store[];
  maxDistanceKm: number;
  value: DeliveryCoordinates | null;
  onChange: (coordinates: DeliveryCoordinates) => void;
  invalid?: boolean;
  required?: boolean;
}) {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY?.trim();

  if (apiKey) return <GoogleMapPicker apiKey={apiKey} {...props} />;
  return <DeliveryLocationPicker {...props} />;
}
