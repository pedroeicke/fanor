import "server-only";
import { randomUUID } from "node:crypto";
import { limaToday } from "@/lib/gestion/dates";
import { PRODUCT_BUCKET } from "@/lib/storage";

/**
 * Onde cada versão da foto mora.
 *
 * O original vai para um balde privado: foto de celular carrega GPS no EXIF
 * e às vezes o rosto de quem está no balcão. A tratada, já sem metadados, vai
 * para o balde público do catálogo — é ela que a vitrine mostra.
 *
 * Pasta por dia de Lima: quem procurar "a foto de sábado" no painel do
 * Supabase acha pela data da loja, não pela de Greenwich.
 */

export const ORIGINALS_BUCKET = "photo-originals";
export const PROCESSED_BUCKET = PRODUCT_BUCKET;

/** AAAA-MM-DD/uuid.ext — o único formato que a rota aceita de volta do navegador. */
export const ORIGINAL_PATH_RE = /^\d{4}-\d{2}-\d{2}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp|heic|heif)$/;

const EXT_BY_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
};

export function extensionFor(type: string) {
  return EXT_BY_TYPE[type] ?? null;
}

export function newOriginalPath(ext: string) {
  return `${limaToday()}/${randomUUID()}.${ext}`;
}

export function newProcessedPath() {
  return `tratadas/${limaToday()}/${randomUUID()}.webp`;
}
