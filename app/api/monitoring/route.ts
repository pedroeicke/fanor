import { NextResponse } from "next/server";
import { reportError } from "@/lib/monitoring";
import { checkRateLimit } from "@/lib/rate-limit";

export async function POST(request: Request) {
  const limit = await checkRateLimit("monitoring", request);
  if (!limit.ok) return new NextResponse(null, { status: 429 });
  try {
    const body = (await request.json()) as { message?: string; stack?: string; path?: string };
    await reportError({
      source: "client",
      message: String(body.message ?? "Error de navegador").slice(0, 1000),
      stack: body.stack?.slice(0, 4000),
      path: body.path?.slice(0, 500),
    });
    return new NextResponse(null, { status: 204 });
  } catch {
    return new NextResponse(null, { status: 400 });
  }
}
