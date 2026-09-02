"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/primitives";
import type { DeliveryCoordinates } from "./DeliveryLocationPicker";

/**
 * Seletor do ponto de entrega sobre o Google Maps.
 *
 * Só entra em cena quando `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` existe. Sem chave,
 * o checkout usa o mapa de OpenStreetMap — ver `CheckoutMapPicker`. O motivo é
 * de custo: a chave do Google exige conta de faturamento, e o site não pode
 * quebrar se ela for suspensa ou se a cota do mês estourar.
 *
 * Marcador clássico (`google.maps.Marker`) em vez de `AdvancedMarkerElement`:
 * o novo exige um Map ID criado no console do Google, e isso é mais um passo
 * de configuração para ganhar nada aqui — um pino é um pino.
 */

type Store = { id: string; name: string; address: string; lat: number; lng: number };

const AREQUIPA_CENTER = { lat: -16.409, lng: -71.5375 };

/* Carrega o script uma vez por página, mesmo que o componente remonte. */
let loader: Promise<void> | null = null;

function loadMaps(key: string) {
  if (typeof window === "undefined") return Promise.reject(new Error("sin ventana"));
  if (window.google?.maps?.Map) return Promise.resolve();
  if (loader) return loader;

  loader = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src =
      "https://maps.googleapis.com/maps/api/js" +
      `?key=${encodeURIComponent(key)}&language=es&region=PE&loading=async`;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      /* Zera para uma tentativa futura poder recomeçar: a rede cai, a chave é
         corrigida no console, e guardar o promise rejeitado travaria o mapa
         para o resto da visita. */
      loader = null;
      reject(new Error("Google Maps no cargó."));
    };
    document.head.appendChild(script);
  });

  return loader;
}

export function GoogleMapPicker({
  apiKey,
  stores,
  maxDistanceKm,
  value,
  onChange,
  invalid,
  required = false,
}: {
  apiKey: string;
  stores: Store[];
  maxDistanceKm: number;
  value: DeliveryCoordinates | null;
  onChange: (coordinates: DeliveryCoordinates) => void;
  invalid?: boolean;
  required?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markerRef = useRef<google.maps.Marker | null>(null);
  /* Mesmo motivo do mapa de OpenStreetMap: sem publicar o criador para fora
     do efeito de montagem, escolher pelo campo de endereço não punha pino. */
  const putMarkerRef = useRef<((point: DeliveryCoordinates) => void) | null>(null);
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);

  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  useEffect(() => {
    let disposed = false;

    void loadMaps(apiKey)
      .then(() => {
        if (disposed || !containerRef.current || mapRef.current) return;

        const map = new google.maps.Map(containerRef.current, {
          center: value ?? stores[0] ?? AREQUIPA_CENTER,
          zoom: value ? 16 : 13,
          /* Um checkout não é lugar para Street View nem para trocar para
             satélite: cada controle a mais é uma chance de sair da compra. */
          streetViewControl: false,
          mapTypeControl: false,
          fullscreenControl: false,
          clickableIcons: false,
          /* Rolar a página sobre o mapa deve rolar a página, não dar zoom. */
          gestureHandling: "cooperative",
        });
        mapRef.current = map;

        for (const store of stores) {
          new google.maps.Marker({
            position: { lat: store.lat, lng: store.lng },
            map,
            title: `${store.name} — ${store.address}`,
            icon: {
              path: google.maps.SymbolPath.CIRCLE,
              scale: 7,
              fillColor: "#f7c118",
              fillOpacity: 1,
              strokeColor: "#3b2314",
              strokeWeight: 2,
            },
          });

          /* O círculo desenha o raio de cobertura. Com o preço vindo da tabela
             de distritos não há raio, e um círculo de 0 km seria só uma
             mancha estranha sobre a loja. */
          if (maxDistanceKm > 0) {
            new google.maps.Circle({
              map,
              center: { lat: store.lat, lng: store.lng },
              radius: maxDistanceKm * 1_000,
              strokeColor: "#376b4a",
              strokeWeight: 1,
              fillColor: "#376b4a",
              fillOpacity: 0.06,
              clickable: false,
            });
          }
        }

        const putMarker = (position: DeliveryCoordinates) => {
          if (markerRef.current) {
            markerRef.current.setPosition(position);
            return;
          }
          const marker = new google.maps.Marker({
            position,
            map,
            /* Arrastável: acertar de primeira num mapa pequeno é difícil, e
               corrigir arrastando é mais rápido do que tocar de novo. */
            draggable: true,
            title: "Punto de entrega",
          });
          marker.addListener("dragend", () => {
            const p = marker.getPosition();
            if (p) onChangeRef.current(round({ lat: p.lat(), lng: p.lng() }));
          });
          markerRef.current = marker;
        };

        putMarkerRef.current = putMarker;
        if (valueRef.current) putMarker(valueRef.current);

        map.addListener("click", (event: google.maps.MapMouseEvent) => {
          if (!event.latLng) return;
          const point = round({ lat: event.latLng.lat(), lng: event.latLng.lng() });
          putMarker(point);
          setError(null);
          onChangeRef.current(point);
        });
      })
      .catch(() => {
        /* Cota estourada, chave errada, rede fora: o pedido continua possível
           sem o ponto. Travar o checkout por causa do mapa seria pior que não
           ter mapa nenhum. */
        if (!disposed) setError("El mapa no cargó. Puedes continuar sin marcar el punto.");
      });

    return () => {
      disposed = true;
      putMarkerRef.current = null;
    };
    // O mapa nasce uma vez; mudança de ponto é tratada no efeito abaixo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey]);

  useEffect(() => {
    if (!value || !mapRef.current) return;
    putMarkerRef.current?.(value);
    mapRef.current.panTo(value);
  }, [value]);

  function useCurrentLocation() {
    setError(null);
    if (!navigator.geolocation) {
      setError("Tu navegador no permite obtener la ubicación.");
      return;
    }

    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const point = round({ lat: position.coords.latitude, lng: position.coords.longitude });
        setLocating(false);
        onChangeRef.current(point);
        mapRef.current?.panTo(point);
        mapRef.current?.setZoom(16);
      },
      (geoError) => {
        setLocating(false);
        setError(
          geoError.code === geoError.PERMISSION_DENIED
            ? "Activa el permiso de ubicación o marca el punto en el mapa."
            : "No pudimos obtener tu ubicación. Marca el punto en el mapa.",
        );
      },
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 60_000 },
    );
  }

  return (
    <div
      className={`rounded-xl border bg-white p-3 ${invalid ? "border-terracota" : "border-crema-300"}`}
      aria-label="Ubicación exacta de entrega"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-cacao">
            Marca el punto exacto de entrega{" "}
            {!required && <span className="font-normal text-cacao-300">(opcional)</span>}
          </p>
          <p className="mt-0.5 text-[12px] leading-relaxed text-cacao-500">
            {required
              ? "Usa tu GPS o toca el mapa. Verifica que coincida con la dirección escrita."
              : "No cambia el costo del delivery: ayuda al motorizado a llegar sin llamarte."}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          className="min-h-11 shrink-0"
          onClick={useCurrentLocation}
          disabled={locating}
        >
          {locating ? "Ubicando…" : "Usar mi ubicación"}
        </Button>
      </div>

      <div
        ref={containerRef}
        className="mt-3 h-56 w-full overflow-hidden rounded-lg bg-crema-100 sm:h-64"
        role="application"
        aria-label="Mapa de Arequipa. Toca el lugar de entrega."
      />

      {value && (
        <p className="mt-2 text-[12px] text-verde">
          Punto marcado: {value.lat.toFixed(5)}, {value.lng.toFixed(5)}
        </p>
      )}
      {error && <p className="mt-2 text-[12px] text-terracota">{error}</p>}
    </div>
  );
}

/** Seis casas ≈ 11 cm de precisão. Mais que isso é ruído. */
function round({ lat, lng }: DeliveryCoordinates): DeliveryCoordinates {
  return {
    lat: Math.round(lat * 1_000_000) / 1_000_000,
    lng: Math.round(lng * 1_000_000) / 1_000_000,
  };
}
