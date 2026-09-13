import { NextResponse } from "next/server";
import { runBackup, secretMatches } from "@/lib/backup";

/**
 * Respaldo diário de todas as tabelas.
 *
 * Agendar às 08:30 UTC ("30 8 * * *") = 03:30 em Lima: loja fechada, nada
 * sendo vendido, e o arquivo já está pronto quando o PC do Joseka liga de
 * manhã para baixar.
 *
 * Protegido por CRON_SECRET, como as outras rotinas. A Vercel manda o
 * segredo no cabeçalho Authorization; `?secret=` fica para disparar à mão.
 */

/* Exportar e comprimir o banco inteiro passa fácil do teto padrão. */
export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const provided =
    request.headers.get("authorization")?.replace("Bearer ", "") ??
    new URL(request.url).searchParams.get("secret");

  if (!secret || !secretMatches(provided, secret)) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  const result = await runBackup({ trigger: "cron" });

  /* Status 500 na falha: o painel de rotinas da Vercel marca a execução em
     vermelho, e ninguém descobre só no dia de precisar do arquivo. */
  return NextResponse.json(result, { status: result.ok ? 200 : 500, headers: { "Cache-Control": "no-store" } });
}
