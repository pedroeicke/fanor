"use server";

import { revalidatePath } from "next/cache";
import { getOperator, type ActionResult, type Operator } from "@/lib/gestion/server";
import { isSerial } from "@/lib/gestion/qr";
import {
  cakePhotoBlock,
  getCakeOption,
  getCakeRow,
  searchProductOptions,
} from "@/lib/photo/queries";
import {
  CAKE_PHOTO_STATUSES,
  UUID_RE,
  normalizeAltText,
  type CakeOption,
  type PhotoReport,
  type PhotoUse,
  type ProductOption,
} from "@/lib/photo/types";

/**
 * Ações da tela de fotos: achar o destino e usar a foto tratada nele.
 *
 * Foto não é estoque nem dinheiro — não há `op_*` para isso. Grava pela
 * sessão (RLS de administrador) depois de conferir o login, como os
 * cadastros do painel.
 */

const EXPIRED = "Sesión expirada. Vuelve a entrar.";

export async function searchProducts(query: string): Promise<ActionResult<ProductOption[]>> {
  const op = await getOperator();
  if (!op) return { ok: false, error: EXPIRED };
  const text = typeof query === "string" ? query.slice(0, 60) : "";
  return { ok: true, data: await searchProductOptions(op.db, text) };
}

export async function findCake(serial: string): Promise<ActionResult<CakeOption>> {
  const op = await getOperator();
  if (!op) return { ok: false, error: EXPIRED };
  const value = typeof serial === "string" ? serial.trim().toUpperCase() : "";
  if (!isSerial(value)) return { ok: false, error: "Serie inválida. Debe ser como G0000100001." };
  const cake = await getCakeOption(op.db, value);
  if (!cake) return { ok: false, error: `No existe la torta ${value}.` };
  return { ok: true, data: cake };
}

type PhotoRow = { id: string; status: string; processed_url: string | null; width: number | null; height: number | null; report: PhotoReport | null };

async function loadReadyPhoto(op: Operator, photoId: unknown): Promise<ActionResult<PhotoRow & { processed_url: string }>> {
  if (typeof photoId !== "string" || !UUID_RE.test(photoId)) return { ok: false, error: "Foto inválida." };
  const { data } = await op.db
    .from("photo_treatments")
    .select("id, status, processed_url, width, height, report")
    .eq("id", photoId)
    .maybeSingle();
  const photo = data as PhotoRow | null;
  if (!photo) return { ok: false, error: "Foto no encontrada." };
  if (photo.status !== "done" || !photo.processed_url) return { ok: false, error: "Esta foto no se pudo tratar. Toma otra." };
  return { ok: true, data: { ...photo, processed_url: photo.processed_url } };
}

/**
 * Anota onde a foto foi usada. O relatório guarda o nome da época: se o
 * produto for renomeado, o histórico continua dizendo o que a vendedora viu.
 */
async function recordUse(op: Operator, photo: PhotoRow, use: PhotoUse) {
  const report = photo.report ? { ...photo.report, applied: [...(photo.report.applied ?? []), use] } : null;
  const { error } = await op.db
    .from("photo_treatments")
    .update({ target: use.type, target_id: use.id, ...(report ? { report } : {}) })
    .eq("id", photo.id);
  if (error) console.error("[fotos] anotar uso", error);
}

export async function applyPhotoToProduct(input: {
  photoId: string;
  productId: string;
  alt: string;
}): Promise<ActionResult<{ productId: string; productName: string }>> {
  const op = await getOperator();
  if (!op) return { ok: false, error: EXPIRED };
  /* Ação de servidor é endpoint público: o corpo pode chegar em qualquer formato. */
  if (!input || typeof input !== "object") return { ok: false, error: "Solicitud inválida." };

  const loaded = await loadReadyPhoto(op, input.photoId);
  if (!loaded.ok) return loaded;
  const photo = loaded.data;

  if (typeof input.productId !== "string" || !UUID_RE.test(input.productId)) {
    return { ok: false, error: "Elige un producto." };
  }
  const { data: product } = await op.db.from("products").select("id, name, slug").eq("id", input.productId).maybeSingle();
  if (!product) return { ok: false, error: "Producto no encontrado." };

  const alt =
    normalizeAltText(typeof input.alt === "string" ? input.alt : "") ||
    normalizeAltText(photo.report?.altText ?? "") ||
    normalizeAltText(product.name);

  /* Aplicar duas vezes (toque duplo, voltar e tocar de novo) duplicaria a
     foto na galeria. */
  const { data: already } = await op.db
    .from("product_images")
    .select("id")
    .eq("product_id", product.id)
    .eq("url", photo.processed_url)
    .limit(1)
    .maybeSingle();
  if (already) return { ok: false, error: `Esta foto ya está en la galería de ${product.name}.` };

  /* Entra no fim da galeria: a capa atual (primeira) é escolha de quem cuida
     do catálogo, não de quem tirou a foto. */
  const { data: last } = await op.db
    .from("product_images")
    .select("sort_order")
    .eq("product_id", product.id)
    .eq("kind", "gallery")
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: image, error } = await op.db
    .from("product_images")
    .insert({
      product_id: product.id,
      url: photo.processed_url,
      alt,
      kind: "gallery",
      width: photo.width,
      height: photo.height,
      sort_order: (last?.sort_order ?? -1) + 1,
    })
    .select("id")
    .single();
  if (error || !image) {
    console.error("[fotos] product_images", error);
    return { ok: false, error: "No se pudo agregar la foto al producto." };
  }

  await recordUse(op, photo, { type: "product", id: product.id, label: product.name, at: new Date().toISOString(), alt });
  await op.db.from("audit_log").insert({
    actor: op.user.id,
    action: "photo.apply.product",
    entity: "products",
    entity_id: product.id,
    changes: { photo: photo.id, image: image.id, alt },
  });

  revalidatePath("/admin/fotos");
  revalidatePath("/admin/tienda");
  revalidatePath("/vitrina");
  revalidatePath("/tortas");
  revalidatePath(`/tortas/${product.slug}`);
  revalidatePath(`/admin/productos/${product.id}`);

  return { ok: true, data: { productId: product.id, productName: product.name } };
}

export async function applyPhotoToCake(input: {
  photoId: string;
  serial: string;
  alt: string;
}): Promise<ActionResult<{ serial: string; productName: string; unchanged: boolean }>> {
  const op = await getOperator();
  if (!op) return { ok: false, error: EXPIRED };
  if (!input || typeof input !== "object") return { ok: false, error: "Solicitud inválida." };

  const loaded = await loadReadyPhoto(op, input.photoId);
  if (!loaded.ok) return loaded;
  const photo = loaded.data;

  const serial =typeof input.serial === "string" ? input.serial.trim().toUpperCase() : "";
  if (!isSerial(serial)) return { ok: false, error: "Escanea o escribe la serie de la torta." };

  const cake = await getCakeRow(op.db, serial);
  if (!cake) return { ok: false, error: `No existe la torta ${serial}.` };
  const blocked = cakePhotoBlock(cake);
  if (blocked) return { ok: false, error: blocked };

  const productName = cake.products?.name ?? "Torta";
  if (cake.photo_url === photo.processed_url) {
    return { ok: true, data: { serial, productName, unchanged: true } };
  }

  /* O filtro de estado vai no próprio update: se a torta foi vendida entre a
     leitura e a gravação, nada muda e a vendedora fica sabendo. */
  const { data: updated, error } = await op.db
    .from("cake_units")
    .update({ photo_url: photo.processed_url })
    .eq("id", cake.id)
    .eq("source", "native")
    .in("status", [...CAKE_PHOTO_STATUSES])
    .select("id");
  if (error) {
    console.error("[fotos] cake_units", error);
    return { ok: false, error: "No se pudo guardar la foto en la torta." };
  }
  if (!updated?.length) return { ok: false, error: `La torta ${serial} cambió de estado. Vuelve a escanearla.` };

  const alt = normalizeAltText(typeof input.alt === "string" ? input.alt : "") || normalizeAltText(photo.report?.altText ?? "");

  /* O diário da torta responde "quem trocou a foto e quando". Falhar aqui não
     desfaz a foto, que já está na vitrina. */
  const { error: eventError } = await op.db.from("cake_events").insert({
    cake_unit_id: cake.id,
    kind: "photo",
    store_id: cake.store_id,
    actor: op.user.id,
    ref_id: photo.id,
  });
  if (eventError) console.error("[fotos] cake_events", eventError);

  await recordUse(op, photo, { type: "cake_unit", id: cake.id, label: serial, at: new Date().toISOString(), ...(alt ? { alt } : {}) });
  await op.db.from("audit_log").insert({
    actor: op.user.id,
    action: "photo.apply.cake",
    entity: "cake_units",
    entity_id: cake.id,
    changes: { photo: photo.id, serial, previous: cake.photo_url },
  });

  revalidatePath("/admin/fotos");
  revalidatePath("/admin/tienda");
  revalidatePath("/vitrina");
  if (cake.products?.slug) revalidatePath(`/tortas/${cake.products.slug}`);

  return { ok: true, data: { serial, productName, unchanged: false } };
}
