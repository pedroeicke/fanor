import "server-only";

type GoogleGeocodeResult = {
  formatted_address: string;
  geometry: { location: { lat: number; lng: number } };
  address_components?: { long_name: string; short_name: string; types: string[] }[];
};

export type VerifiedPlace = {
  placeId: string;
  address: string;
  lat: number;
  lng: number;
};

/**
 * Resolve o place_id novamente no servidor. Latitude/longitude enviadas pelo
 * navegador não são confiáveis para preço nem para cobertura.
 */
export async function verifyGooglePlace(placeId: string): Promise<VerifiedPlace> {
  const key = process.env.GOOGLE_MAPS_SERVER_API_KEY?.trim();
  if (!key) throw new Error("Google Maps no está configurado en el servidor.");
  if (!/^[-\w]{10,300}$/.test(placeId)) throw new Error("Dirección inválida.");

  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("place_id", placeId);
  url.searchParams.set("key", key);
  url.searchParams.set("language", "es");
  url.searchParams.set("region", "pe");

  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error("Google Maps no respondió.");
  const payload = (await response.json()) as { status: string; results?: GoogleGeocodeResult[] };
  const result = payload.results?.[0];
  if (payload.status !== "OK" || !result) throw new Error("No pudimos validar esa dirección.");

  const country = result.address_components?.find((part) => part.types.includes("country"));
  if (country?.short_name !== "PE") throw new Error("La dirección debe estar en Perú.");

  return {
    placeId,
    address: result.formatted_address,
    lat: result.geometry.location.lat,
    lng: result.geometry.location.lng,
  };
}
