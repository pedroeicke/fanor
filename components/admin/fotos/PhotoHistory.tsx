"use client";

import Image from "next/image";
import { cx } from "@/lib/format";
import { TONE_CLASS } from "@/lib/gestion/labels";
import type { PhotoHistoryItem } from "@/lib/photo/types";
import { EmptyState } from "@/components/admin/ui";
import { describeUse, scoreTone } from "./shared";

/**
 * Últimas fotos tratadas. Tocar uma reabre o resultado para usar a mesma
 * foto em outro lugar — a vendedora tira de manhã e o Joseka põe no produto
 * à tarde, sem ninguém repetir a foto.
 */
export function PhotoHistory({
  items,
  currentId,
  onSelect,
}: {
  items: PhotoHistoryItem[];
  currentId: string | null;
  onSelect: (item: PhotoHistoryItem) => void;
}) {
  if (!items.length) {
    return <EmptyState>Todavía no hay fotos tratadas. La primera que tomes aparece aquí.</EmptyState>;
  }

  return (
    <ul className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 sm:p-5 lg:grid-cols-5">
      {items.map((item) => {
        const uses = item.report?.applied ?? [];
        const failed = item.status !== "done" || !item.processed_url;
        return (
          <li key={item.id} className="min-w-0">
            <button
              type="button"
              onClick={() => onSelect(item)}
              aria-pressed={item.id === currentId}
              className={cx(
                "block w-full rounded-xl p-1.5 text-left transition-colors",
                item.id === currentId ? "bg-dorado-100 ring-2 ring-dorado-600" : "hover:bg-crema-100",
              )}
            >
              <span className="relative block aspect-[4/5] overflow-hidden rounded-lg bg-crema-100">
                {!failed && item.processed_url ? (
                  <Image src={item.processed_url} alt="" fill sizes="(max-width: 640px) 45vw, (max-width: 1024px) 30vw, 200px" className="object-cover" />
                ) : (
                  <span className="absolute inset-0 flex items-center justify-center p-2 text-center text-[12px] font-semibold text-terracota">
                    No se pudo tratar
                  </span>
                )}
                {!failed && item.report && (
                  <span
                    className={cx(
                      "absolute left-1.5 top-1.5 rounded-full border px-2 py-0.5 text-[12px] font-bold",
                      TONE_CLASS[scoreTone(item.report.score)],
                    )}
                  >
                    {item.report.score}
                  </span>
                )}
                {!failed && !item.ai_used && (
                  <span className="absolute right-1.5 top-1.5 rounded-full bg-white/90 px-2 py-0.5 text-[11px] font-semibold text-cacao-500">
                    Sin IA
                  </span>
                )}
              </span>
              <span className="mt-1.5 block text-[12px] text-cacao-300">{item.createdLabel}</span>
              <span className="line-clamp-2 block text-[13px] leading-snug text-cacao-700">
                {failed ? item.error ?? "Error al tratar" : uses.length ? uses.map(describeUse).join(" · ") : "Sin usar"}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
