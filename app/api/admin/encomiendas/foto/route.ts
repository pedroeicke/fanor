import { NextResponse } from "next/server";
import { getAdminUser, getServerSupabase } from "@/lib/supabase-server";
import { CUSTOMER_BUCKET, deleteImage, uploadImage } from "@/lib/storage";

/**
 * Foto de referência da encomenda (o modelo que o cliente mostrou no celular).
 *
 * Rota e não server action: server action recebe no máximo 1 MB por padrão, e
 * foto de celular passa disso. Vai para o balde privado — pode ter rosto de
 * criança — e o que volta é o caminho (fica na linha do contrato) mais uma URL
 * assinada só para a pré-visualização.
 */

const PATH = /^encomiendas\/[0-9a-f-]{36}\.(jpg|png|webp|avif|heic)$/;

export async function POST(request: Request) {
  const user = await getAdminUser();
  if (!user) return NextResponse.json({ error: "Sesión expirada. Vuelve a entrar." }, { status: 401 });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "No llegó ninguna foto." }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "No llegó ninguna foto." }, { status: 400 });
  }

  const result = await uploadImage(CUSTOMER_BUCKET, file, "encomiendas");
  if (!result.ok) {
    console.error("[encomiendas/foto]", result.error);
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({ path: result.path, url: result.url });
}

/**
 * Tira a foto que a vendedora subiu e trocou antes de salvar. Só apaga o que
 * nenhuma encomenda usa: uma foto já gravada num contrato não some por um
 * clique numa tela de rascunho.
 */
export async function DELETE(request: Request) {
  const user = await getAdminUser();
  if (!user) return NextResponse.json({ error: "Sesión expirada. Vuelve a entrar." }, { status: 401 });

  const path = new URL(request.url).searchParams.get("path") ?? "";
  if (!PATH.test(path)) return NextResponse.json({ error: "Foto inválida." }, { status: 400 });

  const db = await getServerSupabase();
  if (!db) return NextResponse.json({ error: "Sin conexión." }, { status: 503 });

  const { count, error } = await db
    .from("contract_lines")
    .select("id", { count: "exact", head: true })
    .eq("photo_url", path);
  if (error) return NextResponse.json({ error: "No se pudo verificar la foto." }, { status: 500 });
  if (count) return NextResponse.json({ ok: true, kept: true });

  await deleteImage(CUSTOMER_BUCKET, path);
  return NextResponse.json({ ok: true });
}
