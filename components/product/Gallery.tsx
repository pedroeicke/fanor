"use client";

import Image from "next/image";
import { useState } from "react";
import type { ProductImage } from "@/lib/catalog";
import { cdnImage, cx } from "@/lib/format";
import { Spin360 } from "./Spin360";

/**
 * Galeria do produto, com giro 360° quando o conjunto existe.
 *
 * O 360° assume o lugar de destaque e a galeria fica logo abaixo — se o
 * produto não tiver quadros suficientes, tudo degrada para a galeria comum
 * sem que a área fique vazia.
 */
export function Gallery({
  images,
  spinFrames = [],
  name,
}: {
  images: ProductImage[];
  spinFrames?: ProductImage[];
  name: string;
}) {
  const hasSpin = spinFrames.length >= 8;
  const [view, setView] = useState<"spin" | "photo">(hasSpin ? "spin" : "photo");
  const [active, setActive] = useState(0);

  const current = images[active] ?? images[0];

  return (
    <div>
      {view === "spin" && hasSpin ? (
        <Spin360 frames={spinFrames} name={name} className="aspect-square" />
      ) : (
        <div className="relative aspect-square overflow-hidden rounded-[20px] bg-crema-100">
          {/* Sem foto ainda (produto recém-criado no painel), a área fica
              creme em vez de o next/image lançar erro por `src` vazio. */}
          {current.src && (
            <Image
              src={cdnImage(current.src, 1080)}
              alt={current.alt || name}
              fill
              priority
              sizes="(min-width:1024px) 620px, 100vw"
              className="object-cover"
            />
          )}
        </div>
      )}

      <ul className="no-scrollbar mt-3 flex gap-2.5 overflow-x-auto pb-1">
        {hasSpin && (
          <li>
            <button
              type="button"
              onClick={() => setView("spin")}
              aria-label="Ver en 360 grados"
              aria-current={view === "spin"}
              className={cx(
                "relative flex h-20 w-20 flex-col items-center justify-center gap-1 overflow-hidden rounded-xl border-2 bg-crema-100 text-cacao-700 transition-colors",
                view === "spin" ? "border-dorado-600" : "border-transparent hover:border-crema-300",
              )}
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" aria-hidden="true">
                <ellipse cx="12" cy="12" rx="9" ry="4.5" />
                <path d="M12 3.5a8.5 8.5 0 0 1 0 17" strokeDasharray="2 3" />
              </svg>
              <span className="text-[11px] font-semibold">360°</span>
            </button>
          </li>
        )}

        {images.filter((img) => img.src).map((img, i) => (
          <li key={img.src}>
            <button
              type="button"
              onClick={() => {
                setActive(i);
                setView("photo");
              }}
              aria-label={`Ver imagen ${i + 1} de ${images.length}`}
              aria-current={view === "photo" && i === active}
              className={cx(
                "relative block h-20 w-20 overflow-hidden rounded-xl border-2 transition-colors",
                view === "photo" && i === active
                  ? "border-dorado-600"
                  : "border-transparent hover:border-crema-300",
              )}
            >
              <Image src={cdnImage(img.src, 200)} alt="" fill sizes="80px" className="object-cover" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
