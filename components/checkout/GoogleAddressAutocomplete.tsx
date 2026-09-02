"use client";

import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/primitives";

type Place = { placeId: string; address: string };

type GooglePlaceResult = {
  place_id?: string;
  formatted_address?: string;
  name?: string;
};

type GoogleAutocomplete = {
  addListener: (event: string, callback: () => void) => { remove: () => void };
  getPlace: () => GooglePlaceResult;
};

declare global {
  interface Window {
    google?: {
      maps: {
        places: {
          Autocomplete: new (
            input: HTMLInputElement,
            options: Record<string, unknown>,
          ) => GoogleAutocomplete;
        };
      };
    };
  }
}

let mapsPromise: Promise<void> | null = null;

function loadGoogleMaps(key: string) {
  if (window.google?.maps?.places) return Promise.resolve();
  if (mapsPromise) return mapsPromise;

  mapsPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-fanor-google-maps]');
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Google Maps no cargó.")), {
        once: true,
      });
      return;
    }

    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&libraries=places&language=es&region=PE`;
    script.async = true;
    script.defer = true;
    script.dataset.fanorGoogleMaps = "true";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Google Maps no cargó."));
    document.head.appendChild(script);
  });

  return mapsPromise;
}

export function GoogleAddressAutocomplete({
  apiKey,
  value,
  onChange,
  onPlace,
  invalid,
}: {
  apiKey: string;
  value: string;
  onChange: (value: string) => void;
  onPlace: (place: Place | null) => void;
  invalid?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const onChangeRef = useRef(onChange);
  const onPlaceRef = useRef(onPlace);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    onChangeRef.current = onChange;
    onPlaceRef.current = onPlace;
  }, [onChange, onPlace]);

  useEffect(() => {
    let listener: { remove: () => void } | undefined;
    let disposed = false;

    loadGoogleMaps(apiKey)
      .then(() => {
        if (disposed || !inputRef.current || !window.google) return;
        const autocomplete = new window.google.maps.places.Autocomplete(inputRef.current, {
          componentRestrictions: { country: "pe" },
          fields: ["place_id", "formatted_address", "name"],
          types: ["address"],
        });
        listener = autocomplete.addListener("place_changed", () => {
          const place = autocomplete.getPlace();
          if (!place.place_id) {
            onPlaceRef.current(null);
            return;
          }
          const address = place.formatted_address || place.name || inputRef.current?.value || "";
          onChangeRef.current(address);
          onPlaceRef.current({ placeId: place.place_id, address });
        });
      })
      .catch(() => setLoadError(true));

    return () => {
      disposed = true;
      listener?.remove();
    };
  }, [apiKey]);

  return (
    <>
      <Input
        ref={inputRef}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
          onPlace(null);
        }}
        placeholder="Empieza a escribir tu dirección"
        autoComplete="street-address"
        aria-invalid={invalid}
      />
      {loadError && (
        <span className="mt-1.5 block text-[13px] text-terracota">
          Google Maps no cargó. Recarga la página o elige un distrito.
        </span>
      )}
    </>
  );
}
