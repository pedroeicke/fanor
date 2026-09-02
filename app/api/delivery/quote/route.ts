import { NextResponse } from "next/server";
import { getDeliveryConfig } from "@/lib/delivery-db";
import { quoteDistanceDelivery, validCoordinates } from "@/lib/delivery";
import { checkRateLimit } from "@/lib/rate-limit";

export async function POST(request: Request) {
  const limit = await checkRateLimit("quotes", request);
  if (!limit.ok) {
    return NextResponse.json(
      { error: limit.message },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  try {
    const body = (await request.json()) as { lat?: number; lng?: number; subtotal?: number };
    const subtotal = Number(body.subtotal);
    if (!Number.isFinite(subtotal) || subtotal < 0 || subtotal > 100_000) {
      return NextResponse.json({ error: "Monto inválido." }, { status: 400 });
    }

    const destination = { lat: Number(body.lat), lng: Number(body.lng) };
    if (!validCoordinates(destination)) {
      return NextResponse.json({ error: "Marca un punto válido en el mapa." }, { status: 400 });
    }
    const config = await getDeliveryConfig();
    if (!config.distance.enabled) {
      return NextResponse.json(
        { error: "El cálculo por distancia todavía no está configurado." },
        { status: 503 },
      );
    }

    const quote = quoteDistanceDelivery(config, destination, subtotal);
    if (!quote.covered) {
      return NextResponse.json(
        {
          error: `La dirección está fuera de nuestra cobertura de ${config.distance.maxDistanceKm} km.`,
          ...quote,
        },
        { status: 422 },
      );
    }

    return NextResponse.json({ ...quote, coordinates: destination });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No pudimos validar la dirección." },
      { status: 400 },
    );
  }
}
