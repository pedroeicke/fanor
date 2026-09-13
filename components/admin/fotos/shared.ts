import { cdnImage } from "@/lib/format";
import type { PhotoRecord, PhotoUse } from "@/lib/photo/types";

/** Cor da nota: verde vende, dourado serve com ressalva, terracota repetir. */
export function scoreTone(score: number): "ok" | "warn" | "bad" {
  if (score >= 8) return "ok";
  if (score >= 5) return "warn";
  return "bad";
}

export function scoreVerdict(score: number) {
  if (score >= 9) return "Lista para el catálogo";
  if (score >= 7) return "Buena foto";
  if (score >= 5) return "Sirve, pero conviene repetirla";
  return "Mejor tomar otra";
}

export const PRODUCT_STATUS: Record<string, { label: string; tone: "ok" | "warn" | "muted" }> = {
  active: { label: "Publicado", tone: "ok" },
  draft: { label: "Borrador", tone: "muted" },
  unavailable: { label: "Agotado", tone: "warn" },
};

/**
 * Só passa pelo `next/image` o que o next.config autoriza (arquivos locais,
 * Sirv e Storage do Supabase). URL de outro host quebraria a miniatura.
 */
export function thumbnailSrc(url: string | null, width: number) {
  if (!url) return null;
  if (url.startsWith("/")) return url;
  if (/^https:\/\/tortasfanor\.sirv\.com\//.test(url)) return cdnImage(url, width);
  if (/^https:\/\/[a-z0-9-]+\.supabase\.co\/storage\/v1\/object\//.test(url)) return url;
  return null;
}

/** Texto alternativo com que a caixa abre: o último usado, senão o sugerido. */
export function initialAlt(photo: PhotoRecord | null) {
  const applied = photo?.report?.applied ?? [];
  const lastAlt = [...applied].reverse().find((use) => use.alt)?.alt;
  return lastAlt ?? photo?.report?.altText ?? "";
}

/* Não começa com "use": o linter de hooks trataria como hook. */
export function describeUse(use: PhotoUse) {
  return use.type === "product" ? `Producto: ${use.label}` : `Torta ${use.label}`;
}
