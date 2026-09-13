"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { cx } from "@/lib/format";
import { inputClass, labelClass } from "@/components/admin/ui";
import type { SellerOption, StoreOption } from "./shared";

/**
 * Filtro por loja e vendedora, na URL.
 *
 * Na URL e não em estado local: o Joseka manda o link "leads da Av. EE.UU."
 * para a encarregada, e a atualização automática da página mantém o filtro.
 * Aplica ao escolher, sem botão — no celular é um toque a menos.
 */
export function LeadFilters({
  stores,
  sellers,
  store,
  seller,
  period,
  mySellerId,
}: {
  stores: StoreOption[];
  sellers: SellerOption[];
  store: string | null;
  seller: string | null;
  period: number;
  mySellerId: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const visibleSellers = sellers.filter((s) => !store || !s.storeId || s.storeId === store);

  function go(next: { store?: string | null; seller?: string | null }) {
    const params = new URLSearchParams();
    const nextStore = next.store === undefined ? store : next.store;
    let nextSeller = next.seller === undefined ? seller : next.seller;
    /* Trocar de loja solta a vendedora de outra loja; senão a tela fica vazia sem explicar. */
    const chosen = sellers.find((s) => s.id === nextSeller);
    if (nextStore && chosen?.storeId && chosen.storeId !== nextStore) nextSeller = null;
    if (nextStore) params.set("tienda", nextStore);
    if (nextSeller) params.set("vendedora", nextSeller);
    if (period !== 7) params.set("periodo", String(period));
    const query = params.toString();
    startTransition(() => router.replace(query ? `/admin/leads?${query}` : "/admin/leads", { scroll: false }));
  }

  const mine = Boolean(mySellerId && seller === mySellerId);

  return (
    <div className={cx("card flex flex-wrap items-end gap-3 p-4 transition-opacity", pending && "opacity-60")} aria-busy={pending}>
      <label className="block min-w-40 flex-1">
        <span className={labelClass}>Tienda</span>
        <select className={inputClass} value={store ?? ""} onChange={(e) => go({ store: e.target.value || null })}>
          <option value="">Todas</option>
          {stores.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <label className="block min-w-40 flex-1">
        <span className={labelClass}>Vendedora</span>
        <select className={inputClass} value={seller ?? ""} onChange={(e) => go({ seller: e.target.value || null })}>
          <option value="">Todas</option>
          {visibleSellers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      {mySellerId && (
        <button
          type="button"
          aria-pressed={mine}
          onClick={() => go({ seller: mine ? null : mySellerId })}
          className={cx(
            "h-11 shrink-0 rounded-full border px-5 text-sm font-medium transition-colors",
            mine ? "border-dorado bg-dorado text-cacao" : "border-crema-300 bg-white text-cacao-700 hover:border-cacao/35",
          )}
        >
          Solo míos
        </button>
      )}
      {(store || seller) && (
        <button
          type="button"
          onClick={() => go({ store: null, seller: null })}
          className="h-11 shrink-0 px-2 text-sm font-medium text-terracota underline underline-offset-4"
        >
          Quitar filtros
        </button>
      )}
    </div>
  );
}
