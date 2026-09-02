import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { checkRateLimit } from "@/lib/rate-limit";

/**
 * Registro do Libro de Reclamaciones.
 *
 * A norma peruana exige conservar os registros por dois anos e responder em
 * até 15 dias úteis — por isso vai para o banco, com a leitura restrita a
 * administradores pela política de RLS. O arquivo local só existe como
 * fallback de desenvolvimento.
 */

/* Nome do campo → rótulo em espanhol. A mensagem de erro chega à tela; devolver
   a chave interna ("request", "detail") seria texto em inglês para o cliente. */
const REQUIRED: Record<string, string> = {
  name: "nombre completo",
  document: "documento de identidad",
  email: "correo electrónico",
  phone: "celular",
  address: "domicilio",
  type: "tipo",
  detail: "detalle",
  request: "pedido concreto",
};

export async function POST(request: Request) {
  const limit = await checkRateLimit("complaints", request);
  if (!limit.ok) {
    return NextResponse.json(
      { error: limit.message },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  const body = (await request.json()) as Record<string, string>;

  for (const [field, label] of Object.entries(REQUIRED)) {
    if (!body[field]?.trim()) {
      return NextResponse.json({ error: `Falta completar: ${label}.` }, { status: 400 });
    }
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(body.email)) {
    return NextResponse.json({ error: "Ingresa un correo válido." }, { status: 400 });
  }
  if (body.type !== "reclamo" && body.type !== "queja") {
    return NextResponse.json({ error: "Tipo inválido." }, { status: 400 });
  }

  const code = `LR-${new Date().getFullYear()}-${randomBytes(3).toString("hex").toUpperCase()}`;
  const trim = (v: string | undefined, max = 2000) => (v ?? "").trim().slice(0, max);

  const record = {
    code,
    status: "recibido",
    name: trim(body.name, 200),
    document: trim(body.document, 40),
    email: trim(body.email, 200).toLowerCase(),
    phone: trim(body.phone, 40),
    address: trim(body.address, 400),
    kind: body.type,
    /* Só vincula ao pedido se o código existir de verdade — a coluna tem
       chave estrangeira e um código digitado errado derrubaria o registro. */
    order_code: null as string | null,
    detail: trim(body.detail),
    request: trim(body.request),
  };

  const db = getSupabaseAdmin();

  if (!db) {
    const store = join(process.cwd(), ".data", "reclamaciones.json");
    let all: Record<string, unknown> = {};
    try {
      all = JSON.parse(await readFile(store, "utf8"));
    } catch {
      /* Primeiro registro: o arquivo ainda não existe. */
    }
    all[code] = { ...record, createdAt: new Date().toISOString() };
    await mkdir(join(process.cwd(), ".data"), { recursive: true });
    await writeFile(store, JSON.stringify(all, null, 2));
    return NextResponse.json({ code });
  }

  const typed = trim(body.orderCode, 20).toUpperCase();
  if (typed) {
    const { data } = await db.from("orders").select("code").eq("code", typed).maybeSingle();
    record.order_code = data?.code ?? null;
  }

  const { error } = await db.from("complaints").insert(record);
  if (error) {
    console.error("[reclamaciones] falha ao gravar", error);
    return NextResponse.json({ error: "No pudimos registrar tu reclamo." }, { status: 500 });
  }

  return NextResponse.json({ code });
}
