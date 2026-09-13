import { NextResponse } from "next/server";
import { getAdminUser } from "@/lib/supabase-server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { ORIGINALS_BUCKET, extensionFor, newOriginalPath } from "@/lib/photo/storage";
import { MAX_ORIGINAL_BYTES, isAcceptedType } from "@/lib/photo/types";

export const runtime = "nodejs";

/**
 * URL assinada para o celular subir o original direto no Storage.
 *
 * Existe por causa do limite de corpo da função (4,5 MB na Vercel): foto de
 * celular de 6 ou 8 MB morreria com 413 antes de chegar ao código. O
 * servidor decide o caminho e confere tipo e tamanho; o balde confere de
 * novo (limite de 15 MB e tipos aceitos), e a URL só vale para este caminho.
 */
export async function POST(request: Request) {
  const user = await getAdminUser();
  if (!user) return NextResponse.json({ error: "Sesión expirada. Vuelve a entrar." }, { status: 401 });

  let body: { type?: unknown; size?: unknown };
  try {
    body = (await request.json()) ?? {};
  } catch {
    return NextResponse.json({ error: "Solicitud inválida." }, { status: 400 });
  }

  const { type, size } = body;
  if (typeof type !== "string" || !isAcceptedType(type)) {
    return NextResponse.json({ error: "Formato no soportado. Usa JPG, PNG, WEBP o HEIC." }, { status: 415 });
  }
  if (typeof size !== "number" || !Number.isFinite(size) || size <= 0) {
    return NextResponse.json({ error: "Archivo vacío." }, { status: 400 });
  }
  if (size > MAX_ORIGINAL_BYTES) {
    return NextResponse.json({ error: "La foto supera los 15 MB." }, { status: 413 });
  }

  const admin = getSupabaseAdmin();
  if (!admin) return NextResponse.json({ error: "Falta configurar el almacenamiento." }, { status: 503 });

  const ext = extensionFor(type);
  if (!ext) return NextResponse.json({ error: "Formato no soportado." }, { status: 415 });

  const path = newOriginalPath(ext);
  const { data, error } = await admin.storage.from(ORIGINALS_BUCKET).createSignedUploadUrl(path);
  if (error || !data) {
    console.error("[fotos] url assinada", error);
    return NextResponse.json({ error: "No se pudo preparar la subida. Inténtalo de nuevo." }, { status: 502 });
  }

  return NextResponse.json({ path: data.path, signedUrl: data.signedUrl });
}
