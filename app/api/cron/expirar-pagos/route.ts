import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const provided = request.headers.get("authorization")?.replace("Bearer ", "");
  if (!secret || provided !== secret) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Sin conexión." }, { status: 503 });
  const cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { data, error } = await db
    .from("orders")
    .update({ status: "abandoned" })
    .eq("status", "pending_payment")
    .eq("payment_method", "card")
    .lt("created_at", cutoff)
    .select("code");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ cutoff, abandoned: data?.length ?? 0 });
}
