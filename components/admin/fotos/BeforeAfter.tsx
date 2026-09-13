"use client";

import Image from "next/image";
import { useState } from "react";
import type { PhotoRecord } from "@/lib/photo/types";

/**
 * Antes e depois lado a lado, com o recorte desenhado sobre o original.
 *
 * O retângulo tracejado é o que convence a vendedora de que o sistema achou
 * a torta — ou mostra, sem precisar ler nada, que cortou no lugar errado e
 * vale repetir a foto mais de perto.
 */
export function BeforeAfter({
  preview,
  photo,
  processing,
}: {
  /** URL local (blob:) da foto escolhida. Null quando veio do histórico. */
  preview: string | null;
  photo: PhotoRecord | null;
  processing: boolean;
}) {
  const [brokenPreview, setBrokenPreview] = useState<string | null>(null);
  const source = photo?.report?.source ?? null;
  const crop = photo?.report?.crop ?? null;
  const showPreview = Boolean(preview) && brokenPreview !== preview;

  return (
    <div className="grid grid-cols-2 gap-3">
      <figure className="min-w-0">
        <figcaption className="mb-1.5 text-[12px] font-bold uppercase tracking-[0.1em] text-cacao-300">Antes</figcaption>
        <div
          className="relative overflow-hidden rounded-xl bg-crema-100"
          style={{ aspectRatio: source ? `${source.width} / ${source.height}` : "4 / 5" }}
        >
          {showPreview && preview ? (
            <Image
              src={preview}
              alt="Foto original"
              fill
              unoptimized
              sizes="50vw"
              className="object-contain"
              onError={() => setBrokenPreview(preview)}
            />
          ) : (
            <p className="absolute inset-0 flex items-center justify-center p-3 text-center text-[12px] leading-snug text-cacao-500">
              {preview ? "Este navegador no muestra la vista previa (HEIC)." : "El original queda guardado en privado."}
            </p>
          )}
          {showPreview && crop && source && (
            <span
              aria-hidden
              className="pointer-events-none absolute rounded-md border-2 border-dashed border-dorado shadow-[0_0_0_9999px_rgb(59_35_20/0.35)]"
              style={{
                left: `${(crop.left / source.width) * 100}%`,
                top: `${(crop.top / source.height) * 100}%`,
                width: `${(crop.width / source.width) * 100}%`,
                height: `${(crop.height / source.height) * 100}%`,
              }}
            />
          )}
        </div>
      </figure>

      <figure className="min-w-0">
        <figcaption className="mb-1.5 text-[12px] font-bold uppercase tracking-[0.1em] text-cacao-300">Después</figcaption>
        <div className="relative aspect-[4/5] overflow-hidden rounded-xl bg-crema-100">
          {photo?.processed_url ? (
            <Image
              src={photo.processed_url}
              alt={photo.report?.altText || "Foto tratada"}
              fill
              sizes="(max-width: 1024px) 50vw, 320px"
              className="object-cover"
            />
          ) : processing ? (
            <div className="absolute inset-0 animate-pulse bg-crema-200" aria-hidden />
          ) : (
            <p className="absolute inset-0 flex items-center justify-center p-3 text-center text-[12px] leading-snug text-cacao-500">
              {photo?.status === "failed" ? "No se pudo tratar." : "Aquí aparece la foto tratada."}
            </p>
          )}
        </div>
      </figure>
    </div>
  );
}
