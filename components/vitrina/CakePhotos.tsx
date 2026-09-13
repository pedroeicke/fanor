"use client";

import Image from "next/image";
import { useRef, useState } from "react";
import { cdnImage, cx } from "@/lib/format";

type Photo = { src: string; alt: string };

/**
 * Fotos reais de um grupo de tortas, deslizando com o dedo.
 *
 * Três unidades da mesma torta raramente saem idênticas da decoração, e quem
 * reserva quer ver a que vai levar. Rolagem nativa com snap em vez de
 * carrossel com script: funciona com toque, trackpad e teclado, e o JS daqui
 * só acende o ponto da foto visível.
 *
 * Ocupa o quadro inteiro do pai, que define a proporção.
 */
export function CakePhotos({ photos, sizes, label }: { photos: Photo[]; sizes: string; label: string }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);

  if (photos.length === 1) {
    return (
      <Image src={cdnImage(photos[0].src, 640)} alt={photos[0].alt} fill sizes={sizes} className="object-cover" />
    );
  }

  function onScroll() {
    const el = trackRef.current;
    if (!el || !el.clientWidth) return;
    setActive(Math.min(photos.length - 1, Math.max(0, Math.round(el.scrollLeft / el.clientWidth))));
  }

  return (
    <>
      <div
        ref={trackRef}
        onScroll={onScroll}
        tabIndex={0}
        role="group"
        aria-label={label}
        className="no-scrollbar absolute inset-0 flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain"
      >
        {photos.map((photo) => (
          <div key={photo.src} className="relative h-full w-full shrink-0 snap-center">
            <Image src={cdnImage(photo.src, 640)} alt={photo.alt} fill sizes={sizes} className="object-cover" />
          </div>
        ))}
      </div>

      {/* Indicador, não controle: o gesto é deslizar. Botões de 6 px num card
          de 165 px seriam alvo de toque impossível. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-2.5 flex justify-center gap-1.5">
        {photos.map((photo, i) => (
          <span
            key={photo.src}
            className={cx(
              "h-1.5 rounded-full shadow-[0_1px_3px_rgb(59_35_20/0.35)] transition-all",
              i === active ? "w-4 bg-white" : "w-1.5 bg-white/65",
            )}
          />
        ))}
      </div>
    </>
  );
}
