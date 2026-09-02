import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase-server";

/**
 * Encerra a sessão do painel.
 *
 * Só POST: um GET de logout seria disparado por qualquer <img src> numa página
 * de terceiro, derrubando a sessão de quem estivesse trabalhando.
 */
export async function POST(request: Request) {
  const db = await getServerSupabase();
  await db?.auth.signOut();
  return NextResponse.redirect(new URL("/admin/login", request.url), { status: 303 });
}
