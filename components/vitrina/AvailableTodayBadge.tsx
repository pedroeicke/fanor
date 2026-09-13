"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { cx } from "@/lib/format";
import { IconChevron } from "@/components/ui/icons";
import { LiveDot } from "./LiveDot";
import type { VitrinaApiResponse } from "./types";

type Place = { name: string; quantity: number };

/**
 * "Disponible hoy en Calle Perú (2)" na página de produto.
 *
 * A página de produto é estática de propósito (ver o comentário dela), então
 * o estoque vem daqui, pelo navegador, de `/api/vitrina` — que o CDN guarda
 * por um minuto. Sem estoque confirmado, ou com qualquer falha, o selo
 * simplesmente não aparece: ele é um bônus, não pode virar erro na compra.
 */
export function AvailableTodayBadge({ slug, className }: { slug: string; className?: string }) {
  /* Guarda o slug junto: navegando de um produto para outro o componente é
     reaproveitado, e o selo do anterior não pode aparecer no novo enquanto a
     resposta nova não chega. */
  const [state, setState] = useState<{ slug: string; places: Place[] } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/vitrina?slug=${encodeURIComponent(slug)}`, { signal: controller.signal })
      .then((res) => (res.ok ? (res.json() as Promise<VitrinaApiResponse>) : null))
      .then((data) => {
        const places = data?.fresh
          ? data.stores.filter((s) => s.quantity > 0).map((s) => ({ name: s.name, quantity: s.quantity }))
          : [];
        setState({ slug, places });
      })
      .catch(() => {
        /* Abortado ou sem rede: fica sem selo, em silêncio. */
      });
    return () => controller.abort();
  }, [slug]);

  const places = state?.slug === slug ? state.places : [];
  if (!places.length) return null;

  const visible = listJoin(places.map((p) => `${p.name} (${p.quantity})`));
  const spoken = listJoin(places.map((p) => `${p.quantity} en ${p.name}`));

  return (
    <Link
      href="/vitrina"
      aria-label={`Disponible hoy para llevar: ${spoken}. Ver tortas disponibles hoy`}
      className={cx(
        "group flex min-h-11 items-center gap-3 rounded-2xl border border-verde/25 bg-verde-100 px-4 py-3 text-[15px] text-verde transition-colors hover:border-verde/50",
        className,
      )}
    >
      <LiveDot />
      <span className="flex-1">
        <span className="font-semibold">Disponible hoy</span> en {visible}
      </span>
      <IconChevron className="h-4 w-4 shrink-0 transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}

/** "A", "A y B", "A, B y C". */
function listJoin(parts: string[]) {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} y ${parts[parts.length - 1]}`;
}
