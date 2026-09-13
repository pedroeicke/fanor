import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAdminUser, getServerSupabase } from "@/lib/supabase-server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { isSerial } from "@/lib/gestion/qr";
import { detectImage } from "@/lib/photo/detect";
import { PhotoError, treatPhoto } from "@/lib/photo/treat";
import {
  ORIGINALS_BUCKET,
  ORIGINAL_PATH_RE,
  PROCESSED_BUCKET,
  newOriginalPath,
  newProcessedPath,
} from "@/lib/photo/storage";
import {
  MAX_ORIGINAL_BYTES,
  PHOTO_RECORD_COLUMNS,
  PHOTO_TARGETS,
  UUID_RE,
  type PhotoRecord,
  type PhotoReport,
  type PhotoTarget,
} from "@/lib/photo/types";

/* sharp é nativo: não roda no edge. 60 s cobrem download do original, a
   análise do Claude (teto de 35 s, com nova tentativa dentro dele) e o WebP. */
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Recebe a foto do celular, trata e registra.
 *
 * Multipart com `file` (foto de até 4 MB, que cabe no corpo da função) ou
 * `originalPath` (foto maior, que o celular já subiu por URL assinada — ver
 * ./subida). Mais `target` ('none' | 'product' | 'cake_unit'), `productId`
 * e `serial`: o destino previsto, que dá contexto à IA e fica anotado. Usar a
 * foto no produto ou na torta é outra ação, depois de a vendedora ver o
 * resultado e revisar o texto alternativo.
 *
 * Service role só no Storage (balde privado dos originais e upload no balde
 * público); o registro em `photo_treatments` vai pela sessão, com RLS.
 */
export async function POST(request: Request) {
  const user = await getAdminUser();
  if (!user) return fail("Sesión expirada. Vuelve a entrar.", 401);

  const db = await getServerSupabase();
  if (!db) return fail("Sin conexión con la base de datos.", 503);
  const admin = getSupabaseAdmin();
  if (!admin) return fail("Falta configurar el almacenamiento.", 503);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail("Solicitud inválida. Vuelve a elegir la foto.", 400);
  }

  /* ---------------------------------------------------------------- destino */
  const targetRaw = String(form.get("target") ?? "none");
  if (!(PHOTO_TARGETS as readonly string[]).includes(targetRaw)) return fail("Destino inválido.", 400);
  let target = targetRaw as PhotoTarget;

  /* O destino aqui é só previsão e dica para a IA. Se sumiu entre a escolha
     e o envio (produto apagado, série digitada errada), a foto é tratada do
     mesmo jeito: a vendedora não pode perder a foto por causa disso, e a
     ação de aplicar confere o destino de novo. */
  let targetId: string | null = null;
  let hint: string | null = null;
  if (target === "product") {
    const productId = String(form.get("productId") ?? "");
    if (!UUID_RE.test(productId)) return fail("Producto inválido.", 400);
    const { data: product } = await db.from("products").select("id, name").eq("id", productId).maybeSingle();
    if (product) {
      targetId = product.id;
      hint = product.name;
    } else {
      target = "none";
    }
  } else if (target === "cake_unit") {
    const serial = String(form.get("serial") ?? "").trim().toUpperCase();
    if (!isSerial(serial)) return fail("Serie de torta inválida.", 400);
    const { data: cake } = await db
      .from("cake_units")
      .select("id, products(name)")
      .eq("serial", serial)
      .maybeSingle();
    if (cake) {
      targetId = cake.id;
      hint = (cake.products as unknown as { name: string } | null)?.name ?? null;
    } else {
      target = "none";
    }
  }

  /* --------------------------------------------------------------- original */
  const file = form.get("file");
  const originalPathRaw = form.get("originalPath");

  let input: Buffer;
  let originalPath: string;

  if (file instanceof File) {
    if (file.size === 0) return fail("Archivo vacío.", 400);
    if (file.size > MAX_ORIGINAL_BYTES) return fail("La foto supera los 15 MB.", 413);
    input = Buffer.from(await file.arrayBuffer());
    const detected = detectImage(input);
    if (!detected) return fail("El archivo no es una foto JPG, PNG, WEBP o HEIC.", 415);

    originalPath = newOriginalPath(detected.ext);
    const { error } = await admin.storage
      .from(ORIGINALS_BUCKET)
      .upload(originalPath, input, { contentType: detected.mime, upsert: false });
    if (error) {
      console.error("[fotos] original", error);
      return fail("No se pudo guardar la foto original. Inténtalo de nuevo.", 502);
    }
  } else if (typeof originalPathRaw === "string" && ORIGINAL_PATH_RE.test(originalPathRaw)) {
    originalPath = originalPathRaw;

    /* Duplo envio (rede lenta, toque repetido): devolve o que já foi feito
       em vez de tratar e cobrar a IA duas vezes pela mesma foto. */
    const { data: existing } = await db
      .from("photo_treatments")
      .select(PHOTO_RECORD_COLUMNS)
      .eq("original_path", originalPath)
      .eq("status", "done")
      .limit(1)
      .maybeSingle();
    if (existing) return NextResponse.json({ photo: existing as PhotoRecord });

    const { data: blob, error } = await admin.storage.from(ORIGINALS_BUCKET).download(originalPath);
    if (error || !blob) {
      console.error("[fotos] download do original", error);
      return fail("No se encontró la foto subida. Vuelve a intentarlo.", 404);
    }
    if (blob.size > MAX_ORIGINAL_BYTES) return fail("La foto supera los 15 MB.", 413);
    input = Buffer.from(await blob.arrayBuffer());
    if (!detectImage(input)) return fail("El archivo no es una foto JPG, PNG, WEBP o HEIC.", 415);
  } else {
    return fail("Falta la foto.", 400);
  }

  /* -------------------------------------------------------------- tratamento */
  let treated: Awaited<ReturnType<typeof treatPhoto>>;
  try {
    treated = await treatPhoto(input, { hint });
  } catch (error) {
    const message = error instanceof PhotoError ? error.message : "No se pudo tratar la foto. Inténtalo de nuevo.";
    if (!(error instanceof PhotoError)) console.error("[fotos] tratamento", error);
    return saveFailure(db, { originalPath, target, targetId, userId: user.id, message });
  }

  const processedPath = newProcessedPath();
  const { error: uploadError } = await admin.storage.from(PROCESSED_BUCKET).upload(processedPath, treated.output, {
    contentType: "image/webp",
    /* Nome único por foto: pode ficar em cache para sempre. */
    cacheControl: "31536000",
    upsert: false,
  });
  if (uploadError) {
    console.error("[fotos] upload da tratada", uploadError);
    return saveFailure(db, {
      originalPath,
      target,
      targetId,
      userId: user.id,
      message: "No se pudo guardar la foto tratada. Inténtalo de nuevo.",
      report: treated.report,
    });
  }
  const processedUrl = admin.storage.from(PROCESSED_BUCKET).getPublicUrl(processedPath).data.publicUrl;

  const { data: photo, error: insertError } = await db
    .from("photo_treatments")
    .insert({
      original_path: originalPath,
      processed_path: processedPath,
      processed_url: processedUrl,
      status: "done",
      width: treated.width,
      height: treated.height,
      ai_used: treated.report.aiUsed,
      report: treated.report,
      target,
      target_id: targetId,
      created_by: user.id,
    })
    .select(PHOTO_RECORD_COLUMNS)
    .single();

  if (insertError || !photo) {
    console.error("[fotos] registro", insertError);
    /* Sem registro a foto pública ficaria órfã, sem ninguém saber dela. */
    await admin.storage.from(PROCESSED_BUCKET).remove([processedPath]);
    return fail("No se pudo registrar la foto. Inténtalo de nuevo.", 500);
  }

  revalidatePath("/admin/fotos");
  return NextResponse.json({ photo: photo as PhotoRecord }, { status: 201 });
}

function fail(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

/**
 * Foto que não deu para tratar também fica registrada: o histórico mostra a
 * tentativa e o motivo, e o original continua guardado para quem quiser
 * tentar de novo com outro formato.
 */
async function saveFailure(
  db: SupabaseClient,
  input: {
    originalPath: string;
    target: PhotoTarget;
    targetId: string | null;
    userId: string;
    message: string;
    report?: PhotoReport;
  },
) {
  const { data: photo, error } = await db
    .from("photo_treatments")
    .insert({
      original_path: input.originalPath,
      status: "failed",
      ai_used: input.report?.aiUsed ?? false,
      report: input.report ?? null,
      target: input.target,
      target_id: input.targetId,
      error: input.message,
      created_by: input.userId,
    })
    .select(PHOTO_RECORD_COLUMNS)
    .single();

  if (error) console.error("[fotos] registro de falha", error);
  revalidatePath("/admin/fotos");
  return NextResponse.json({ error: input.message, photo: (photo as PhotoRecord | null) ?? null }, { status: 422 });
}
