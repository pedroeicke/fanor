import type { Metadata } from "next";
import { getServerSupabase } from "@/lib/supabase-server";
import { DeliverySettings } from "@/components/admin/DeliverySettings";

export const metadata: Metadata = { title: "Entrega" };

/**
 * Configuração de entrega.
 *
 * Lê as tabelas direto, sem o cache de `getDeliveryConfig()`: o painel precisa
 * ver zonas desativadas e faixas inativas, que a loja não vê.
 */
export default async function DeliveryAdminPage() {
  const db = await getServerSupabase();
  if (!db) return <p className="card p-6">Falta configurar la base de datos.</p>;

  const [zones, slots, blackouts, settings, stores] = await Promise.all([
    db.from("delivery_zones").select("slug, name, coverage, fee, active").order("sort_order"),
    db.from("delivery_slots").select("slug, label, start_hour, weekdays, capacity, active").order("sort_order"),
    db.from("delivery_blackouts").select("date, reason, delivery_slots(slug, label)").order("date"),
    db
      .from("delivery_settings")
      .select("free_delivery_from, base_fee, fee_per_km, max_distance_km")
      .maybeSingle(),
    db.from("stores").select("id, name, address, lat, lng, active").order("sort_order"),
  ]);

  return (
    <DeliverySettings
      zones={(zones.data ?? []).map((z) => ({ ...z, fee: String(z.fee) }))}
      slots={slots.data ?? []}
      blackouts={(blackouts.data ?? []).map((b) => {
        const joined = Array.isArray(b.delivery_slots) ? b.delivery_slots[0] : b.delivery_slots;
        return {
          date: b.date as string,
          reason: (b.reason as string | null) ?? null,
          slotSlug: (joined as { slug: string } | null)?.slug ?? null,
          slotLabel: (joined as { label: string } | null)?.label ?? null,
        };
      })}
      freeFrom={String(settings.data?.free_delivery_from ?? 150)}
      distanceSettings={{
        baseFee: String(settings.data?.base_fee ?? 12),
        feePerKm: String(settings.data?.fee_per_km ?? 0),
        maxDistanceKm: String(settings.data?.max_distance_km ?? 25),
      }}
      stores={(stores.data ?? []).map((store) => ({
        ...store,
        lat: store.lat === null ? "" : String(store.lat),
        lng: store.lng === null ? "" : String(store.lng),
      }))}
    />
  );
}
