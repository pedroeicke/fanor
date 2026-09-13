import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { BACKUP_URL_TTL_SECONDS, backupFileName, secretMatches, signBackupUrl } from "@/lib/backup";

/**
 * Último respaldo pronto, para o baixador do PC do Joseka
 * (scripts/descargar-respaldo.mjs).
 *
 * Não há sessão de painel num script agendado; a porta é um token próprio,
 * RESPALDO_TOKEN, que só serve para isto. Vazou? Troca-se o token sem mexer
 * na senha de ninguém. Devolve só um link assinado que expira em 10 minutos,
 * nunca o arquivo nem a chave do balde.
 */

export const dynamic = "force-dynamic";

/* Token curto adivinha-se; abaixo disto a rota se recusa a abrir. */
const MIN_TOKEN_LENGTH = 24;

const noStore = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  const token = process.env.RESPALDO_TOKEN?.trim();
  if (!token || token.length < MIN_TOKEN_LENGTH) {
    return NextResponse.json({ error: "Descarga de respaldos no configurada." }, { status: 503, headers: noStore });
  }

  const header = request.headers.get("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : null;
  if (!secretMatches(provided, token)) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401, headers: noStore });
  }

  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Sin conexión con la base de datos." }, { status: 503, headers: noStore });

  const { data: run, error } = await db
    .from("backup_runs")
    .select("id, started_at, finished_at, bytes, path")
    .eq("status", "done")
    .not("path", "is", null)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[respaldo/ultimo]", error.message);
    return NextResponse.json({ error: "No se pudo consultar los respaldos." }, { status: 502, headers: noStore });
  }
  if (!run?.path) {
    return NextResponse.json({ error: "Todavía no hay ningún respaldo terminado." }, { status: 404, headers: noStore });
  }

  const signed = await signBackupUrl(db, run.path);
  if (!signed.ok) {
    console.error("[respaldo/ultimo] firma:", signed.error);
    return NextResponse.json({ error: "No se pudo generar el enlace de descarga." }, { status: 502, headers: noStore });
  }

  return NextResponse.json(
    {
      url: signed.url,
      created_at: run.started_at,
      finished_at: run.finished_at,
      bytes: run.bytes === null ? null : Number(run.bytes),
      path: run.path,
      filename: backupFileName(run.path),
      expires_in: BACKUP_URL_TTL_SECONDS,
    },
    { headers: noStore },
  );
}
