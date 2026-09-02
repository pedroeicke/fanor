import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { CUSTOMER_BUCKET } from "@/lib/storage";

/**
 * Apaga fotos de clientes com mais de 90 dias.
 *
 * A política de privacidade promete exatamente isso. Sem esta rotina, a
 * promessa seria falsa e as imagens ficariam guardadas para sempre — o tipo
 * de coisa que só aparece numa fiscalização.
 *
 * As pastas do balde são datadas (AAAA-MM-DD), então basta comparar nomes:
 * não é preciso listar arquivo por arquivo para saber a idade.
 *
 * Agendar uma vez por dia. Protegido por CRON_SECRET.
 */
const RETENTION_DAYS = 90;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const provided =
    request.headers.get("authorization")?.replace("Bearer ", "") ??
    new URL(request.url).searchParams.get("secret");

  if (!secret || provided !== secret) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Sin conexión." }, { status: 503 });

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);
  const cutoffFolder = cutoff.toISOString().slice(0, 10);

  const { data: folders, error } = await db.storage.from(CUSTOMER_BUCKET).list("", { limit: 1000 });
  if (error) return NextResponse.json({ error: error.message }, { status: 502 });

  const expired = (folders ?? []).filter((f) => /^\d{4}-\d{2}-\d{2}$/.test(f.name) && f.name < cutoffFolder);

  let removed = 0;
  for (const folder of expired) {
    const { data: files } = await db.storage.from(CUSTOMER_BUCKET).list(folder.name, { limit: 1000 });
    const paths = (files ?? []).map((f) => `${folder.name}/${f.name}`);
    if (!paths.length) continue;

    const { error: removeError } = await db.storage.from(CUSTOMER_BUCKET).remove(paths);
    if (!removeError) removed += paths.length;
  }

  return NextResponse.json({ cutoff: cutoffFolder, folders: expired.length, removed });
}
