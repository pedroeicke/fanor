import "server-only";
import { randomUUID } from "node:crypto";
import { getSupabaseAdmin } from "./supabase-admin";

/**
 * Upload de imagens no Supabase Storage.
 *
 * Substitui a gravação em `public/uploads`, que só sobrevive enquanto o
 * servidor não é reimplantado. Em hospedagem serverless o disco é efêmero: as
 * fotos que os clientes enviam para imprimir na torta sumiriam no primeiro
 * deploy, e o pedido chegaria à cozinha sem a imagem.
 */

export const PRODUCT_BUCKET = "product-images";
export const CUSTOMER_BUCKET = "customer-photos";

export const MAX_BYTES = 8 * 1024 * 1024;

const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/heic": "heic",
};

/** Validade da URL assinada de foto do cliente: cobre produção e pós-venda. */
const SIGNED_TTL_SECONDS = 60 * 60 * 24 * 30;

export function isAllowedImage(type: string) {
  return type in EXT;
}

export type UploadResult =
  | { ok: true; path: string; url: string }
  | { ok: false; error: string };

/**
 * Grava um arquivo e devolve caminho e URL.
 *
 * No balde público a URL é permanente. No privado é assinada e expira — por
 * isso o `path` também volta: é ele que fica no banco, não a URL.
 */
export async function uploadImage(
  bucket: string,
  file: File,
  prefix = "",
): Promise<UploadResult> {
  if (!isAllowedImage(file.type)) {
    return { ok: false, error: "Formato no soportado. Usa JPG, PNG o WEBP." };
  }
  if (file.size > MAX_BYTES) {
    return { ok: false, error: "La imagen supera los 8 MB." };
  }

  const db = getSupabaseAdmin();
  if (!db) return { ok: false, error: "Sin conexión con el almacenamiento." };

  /* Nome aleatório: o do cliente pode conter acentos, espaços e barras, que
     quebram o caminho — e o original fica guardado à parte, no pedido. */
  const path = `${prefix}${prefix ? "/" : ""}${randomUUID()}.${EXT[file.type]}`;

  const { error } = await db.storage
    .from(bucket)
    .upload(path, await file.arrayBuffer(), { contentType: file.type, upsert: false });

  if (error) return { ok: false, error: error.message };

  const url =
    bucket === PRODUCT_BUCKET
      ? db.storage.from(bucket).getPublicUrl(path).data.publicUrl
      : ((await signedUrl(bucket, path)) ?? "");

  return { ok: true, path, url };
}

/** URL temporária para o que está no balde privado. */
export async function signedUrl(bucket: string, path: string, seconds = SIGNED_TTL_SECONDS) {
  const db = getSupabaseAdmin();
  if (!db) return null;

  const { data, error } = await db.storage.from(bucket).createSignedUrl(path, seconds);
  return error ? null : data.signedUrl;
}

/**
 * Resolve o que está gravado no pedido para algo exibível.
 *
 * Aceita as duas formas por compatibilidade: os pedidos antigos guardaram
 * `/uploads/arquivo.jpg` do disco local; os novos guardam o caminho no balde.
 */
export async function resolvePhotoUrl(stored: string | null) {
  if (!stored) return null;
  if (stored.startsWith("http") || stored.startsWith("/uploads/")) return stored;
  return signedUrl(CUSTOMER_BUCKET, stored);
}

export async function deleteImage(bucket: string, path: string) {
  const db = getSupabaseAdmin();
  if (!db) return false;
  const { error } = await db.storage.from(bucket).remove([path]);
  return !error;
}
