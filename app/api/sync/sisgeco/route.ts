import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { applySisgecoBatch, readCursor, type SisgecoBatch } from "@/lib/sync/sisgeco";

/**
 * Ponta que recebe o leitor do Sisgeco (agente-sisgeco/).
 *
 *   GET  ?source=sisgeco  → { cursor }         onde o leitor parou
 *   POST { movements, articles… }  → { cursor } aplica o lote e devolve o novo cursor
 *
 * Quem escreve no banco é este servidor, com a chave de serviço — a chave
 * nunca vai para o PC da loja. O leitor só prova que é ele: cada pedido vem
 * assinado com HMAC sobre `timestamp.corpo`, e o timestamp tem de estar a
 * menos de 5 minutos do nosso relógio. Repetir um pedido gravado não passa.
 */

const MAX_SKEW_MS = 5 * 60_000;

function verify(request: Request, body: string) {
  const secret = process.env.SYNC_SHARED_SECRET?.trim();
  if (!secret) return { ok: false as const, error: "SYNC_SHARED_SECRET não configurado no servidor." };

  const ts = request.headers.get("x-fanor-timestamp") ?? "";
  const given = request.headers.get("x-fanor-signature") ?? "";
  if (!/^\d{13}$/.test(ts) || Math.abs(Date.now() - Number(ts)) > MAX_SKEW_MS) {
    return { ok: false as const, error: "Timestamp ausente ou fora da janela." };
  }
  const expected = `sha256=${createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex")}`;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false as const, error: "Assinatura inválida." };
  return { ok: true as const };
}

export async function GET(request: Request) {
  const auth = verify(request, "");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 });

  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Banco indisponível." }, { status: 503 });

  const source = new URL(request.url).searchParams.get("source") ?? "sisgeco";
  return NextResponse.json({ cursor: await readCursor(db, source) });
}

export async function POST(request: Request) {
  const body = await request.text();
  const auth = verify(request, body);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 });

  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Banco indisponível." }, { status: 503 });

  let batch: SisgecoBatch;
  try {
    batch = JSON.parse(body) as SisgecoBatch;
  } catch {
    return NextResponse.json({ error: "Corpo não é JSON." }, { status: 400 });
  }

  try {
    const result = await applySisgecoBatch(db, batch, request.headers.get("x-fanor-agent") ?? "desconhecido");
    return NextResponse.json(result);
  } catch (error) {
    /* O leitor vai reenviar. Devolver o cursor antigo é o que faz o reenvio
       recomeçar do lugar certo. */
    const message = error instanceof Error ? error.message : String(error);
    console.error("[sync/sisgeco]", message);
    return NextResponse.json({ error: message, cursor: batch.cursorFrom ?? 0 }, { status: 500 });
  }
}
