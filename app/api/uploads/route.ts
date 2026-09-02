import { NextResponse } from "next/server";
import { CUSTOMER_BUCKET, MAX_BYTES, isAllowedImage, uploadImage } from "@/lib/storage";
import { checkRateLimit } from "@/lib/rate-limit";

/**
 * Recebe a foto que vai impressa na torta.
 *
 * Grava no balde privado do Supabase Storage. O cliente recebe de volta uma
 * URL assinada, só para conferir a prévia; o que fica guardado no pedido é o
 * `path`, e a cozinha vê a imagem por URL assinada gerada na hora.
 *
 * A versão anterior gravava em `public/uploads` — disco efêmero, que perderia
 * as fotos no primeiro deploy.
 */
export async function POST(request: Request) {
  /* O mais caro de abusar: cada arquivo ocupa espaço permanente. */
  const limit = await checkRateLimit("uploads", request);
  if (!limit.ok) {
    return NextResponse.json(
      { error: limit.message },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  const form = await request.formData();
  const file = form.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Falta el archivo." }, { status: 400 });
  }
  if (!isAllowedImage(file.type)) {
    return NextResponse.json({ error: "Formato no soportado." }, { status: 415 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "La imagen supera los 8 MB." }, { status: 413 });
  }

  /* Uma pasta por dia: facilita achar e limpar o que já passou do prazo de
     retenção definido na política de privacidade. */
  const folder = new Date().toISOString().slice(0, 10);
  const result = await uploadImage(CUSTOMER_BUCKET, file, folder);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 502 });
  }

  return NextResponse.json({
    /* `path` é o que o carrinho deve guardar: a URL assinada expira. */
    path: result.path,
    url: result.url,
    name: file.name,
  });
}
