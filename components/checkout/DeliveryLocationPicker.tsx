"use client";

import { useEffect, useRef, useState } from "react";
import type { CircleMarker, Map as LeafletMap } from "leaflet";
import { Button } from "@/components/ui/primitives";

export type DeliveryCoordinates = { lat: number; lng: number };

type Store = {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
};

const AREQUIPA_CENTER: [number, number] = [-16.409, -71.5375];
/**
 * CARTO Voyager, sobre dados do OpenStreetMap.
 *
 * O OSM cru é denso demais e o Positron é pálido demais — sem cor nas vias,
 * quem olha não reconhece a própria cidade. Voyager fica no meio: avenidas em
 * destaque, parques verdes, rótulos legíveis, num desenho parecido com o que
 * as pessoas já conhecem. Gratuito, sem chave e sem cartão; exige só a
 * atribuição abaixo.
 */
const TILE_URL =
  process.env.NEXT_PUBLIC_MAP_TILE_URL ||
  "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png";

export function DeliveryLocationPicker({
  stores,
  maxDistanceKm,
  value,
  onChange,
  invalid,
  required = false,
}: {
  stores: Store[];
  maxDistanceKm: number;
  value: DeliveryCoordinates | null;
  onChange: (coordinates: DeliveryCoordinates) => void;
  invalid?: boolean;
  /** Quando o preço vem da distância, o ponto é obrigatório. Vindo da tabela
      de distritos ele é só uma ajuda para quem entrega. */
  required?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const markerRef = useRef<CircleMarker | null>(null);
  /**
   * `putMarker` publicado para fora do efeito de montagem.
   *
   * Sem isto, escolher o endereço no campo de cima não punha pino nenhum: o
   * efeito abaixo só sabia *mover* um marcador, e marcador só nascia quando
   * alguém clicava no mapa. Quem usava a busca — o caminho principal — via a
   * confirmação em texto e o mapa vazio.
   */
  const putMarkerRef = useRef<((point: DeliveryCoordinates) => void) | null>(null);
  /* O efeito de montagem roda uma vez e congela o `value` daquele instante.
     Se a escolha acontecer enquanto o Leaflet ainda carrega, é por aqui que
     ela chega. */
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);

  /**
   * Rua do ponto marcado, guardada junto das coordenadas que a originaram.
   *
   * Guardar o par, e não só o texto, é o que deixa a exibição ser derivada:
   * se o pino já mudou, o nome antigo simplesmente não casa e some sozinho —
   * sem precisar de um efeito que zere o estado, que é o que a regra
   * `react-hooks/set-state-in-effect` proíbe.
   */
  const [place, setPlace] = useState<{ lat: number; lng: number; address: string } | null>(null);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    let disposed = false;
    let map: LeafletMap | null = null;

    void import("leaflet").then((L) => {
      if (disposed || !containerRef.current) return;

      const initialCenter: [number, number] = value
        ? [value.lat, value.lng]
        : stores[0]
          ? [stores[0].lat, stores[0].lng]
          : AREQUIPA_CENTER;

      map = L.map(containerRef.current, {
        center: initialCenter,
        zoom: value ? 16 : 13,
        scrollWheelZoom: false,
      });
      mapRef.current = map;

      L.tileLayer(TILE_URL, {
        maxZoom: 19,
        subdomains: "abcd",
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
      }).addTo(map);

      for (const store of stores) {
        /* O círculo desenha o raio de cobertura. Com o preço vindo da tabela
           de distritos não há raio, e um círculo de 0 km seria só um ponto
           estranho sobre a loja. */
        if (maxDistanceKm > 0) {
          L.circle([store.lat, store.lng], {
            radius: maxDistanceKm * 1_000,
            color: "#376b4a",
            fillColor: "#e6f2ea",
            fillOpacity: 0.08,
            weight: 1,
            interactive: false,
          }).addTo(map);
        }
        L.circleMarker([store.lat, store.lng], {
          radius: 7,
          color: "#3b2314",
          fillColor: "#f7c118",
          fillOpacity: 1,
          weight: 2,
        })
          .addTo(map)
          .bindTooltip(`${store.name}<br>${store.address}`);
      }

      const putMarker = (coordinates: DeliveryCoordinates) => {
        if (markerRef.current) {
          markerRef.current.setLatLng([coordinates.lat, coordinates.lng]);
        } else {
          markerRef.current = L.circleMarker([coordinates.lat, coordinates.lng], {
            radius: 9,
            color: "#fff",
            fillColor: "#c23a17",
            fillOpacity: 1,
            weight: 3,
          })
            .addTo(map!)
            .bindTooltip("Punto de entrega", { permanent: false });
        }
      };

      putMarkerRef.current = putMarker;
      /* `valueRef`, não `value`: pode ter sido escolhido durante o carregamento. */
      if (valueRef.current) putMarker(valueRef.current);

      map.on("click", (event) => {
        const coordinates = {
          lat: Math.round(event.latlng.lat * 1_000_000) / 1_000_000,
          lng: Math.round(event.latlng.lng * 1_000_000) / 1_000_000,
        };
        putMarker(coordinates);
        setLocationError(null);
        onChangeRef.current(coordinates);
      });

      window.setTimeout(() => map?.invalidateSize(), 0);
    });

    return () => {
      disposed = true;
      map?.remove();
      mapRef.current = null;
      markerRef.current = null;
      putMarkerRef.current = null;
    };
    // O mapa nasce uma vez. Mudanças posteriores de ponto são tratadas abaixo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!value || !mapRef.current) return;
    /* Cria se ainda não existe, move se já existe. */
    putMarkerRef.current?.(value);
    /* Enquadra o ponto. `setView` e não `flyTo`: a animação do `flyTo` roda
       em `requestAnimationFrame`, que o navegador congela em aba oculta — o
       pino ficava criado e o mapa parado no enquadramento anterior. Aqui não
       há nada para o navegador suspender. */
    mapRef.current.setView([value.lat, value.lng], 17, { animate: false });
  }, [value]);

  /** Nome da rua do ponto marcado — confirma o acerto sem sair da página. */
  useEffect(() => {
    if (!value) return;

    const controller = new AbortController();
    const { lat, lng } = value;
    void (async () => {
      try {
        const response = await fetch(`/api/geo?lat=${lat}&lng=${lng}`, {
          signal: controller.signal,
        });
        const data = (await response.json()) as { address?: string };
        if (data.address) setPlace({ lat, lng, address: data.address });
      } catch {
        /* Sem nome de rua o ponto continua válido; só não é confirmado por
           extenso. */
      }
    })();

    return () => controller.abort();
  }, [value]);

  /* Derivado, não estado: some sozinho quando o pino muda. */
  const placeName =
    place && value && place.lat === value.lat && place.lng === value.lng ? place.address : null;

  function useCurrentLocation() {
    setLocationError(null);
    if (!navigator.geolocation) {
      setLocationError("Tu navegador no permite obtener la ubicación.");
      return;
    }

    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const coordinates = {
          lat: Math.round(position.coords.latitude * 1_000_000) / 1_000_000,
          lng: Math.round(position.coords.longitude * 1_000_000) / 1_000_000,
        };
        setLocating(false);
        onChangeRef.current(coordinates);
        mapRef.current?.flyTo([coordinates.lat, coordinates.lng], 16);
      },
      (error) => {
        setLocating(false);
        setLocationError(
          error.code === error.PERMISSION_DENIED
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
              ? "Se marca solo al elegir tu dirección arriba. También puedes tocar el mapa."
              : "Se marca solo al elegir tu dirección arriba. Ajústalo tocando el mapa si hace falta."}
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
          {/* Nome da rua, não coordenada: "-16.39958, -71.53701" não diz a
              ninguém se o pino caiu no lugar certo. */}
          Punto marcado{placeName ? `: ${placeName}` : ""}
        </p>
      )}
      {locationError && (
        <p role="alert" className="mt-2 text-[12px] font-medium text-terracota">
          {locationError}
        </p>
      )}
    </div>
  );
}
