import "server-only";
import { cache } from "react";
import { getSupabaseAdmin } from "./supabase-admin";
import {
  DEFAULT_DELIVERY_CONFIG,
  toISO,
  usageKey,
  type Coverage,
  type DeliveryConfig,
} from "./delivery";

/**
 * Configuração de entrega vinda do banco.
 *
 * Antes disso, distritos, tarifas e feriados eram listas fixas no código: a
 * Joseka não conseguia incluir um distrito nem bloquear um feriado sem
 * programador. As tabelas existiam desde a primeira migração, mas ninguém as
 * lia — este arquivo é o que as coloca em uso.
 *
 * Sem banco, devolve os valores padrão. O site nunca fica sem tabela de frete.
 */
export const getDeliveryConfig = cache(async (): Promise<DeliveryConfig> => {
  const db = getSupabaseAdmin();
  if (!db) return DEFAULT_DELIVERY_CONFIG;

  const today = toISO(new Date());

  const [zones, slots, blackouts, settings, booked, stores] = await Promise.all([
    db.from("delivery_zones").select("slug, name, coverage, fee").eq("active", true).order("sort_order"),
    db
      .from("delivery_slots")
      .select("slug, label, start_hour, weekdays, capacity")
      .eq("active", true)
      .order("sort_order"),
    /* Bloqueios passados não interessam e só engordariam a resposta. */
    db.from("delivery_blackouts").select("date, slot_id, delivery_slots(slug)").gte("date", today),
    db
      .from("delivery_settings")
      .select("free_delivery_from, base_fee, fee_per_km, max_distance_km")
      .maybeSingle(),
    /* Ocupação por data e faixa, para respeitar a capacidade. Pedido
       cancelado libera a vaga. */
    db
      .from("orders")
      .select("delivery_date, delivery_slot")
      .gte("delivery_date", today)
      .neq("status", "cancelled"),
    db
      .from("stores")
      .select("id, name, address, lat, lng")
      .eq("active", true)
      .not("lat", "is", null)
      .not("lng", "is", null)
      .order("sort_order"),
  ]);

  if (zones.error || slots.error || !zones.data?.length || !slots.data?.length) {
    if (zones.error || slots.error) {
      console.error("[delivery] falha ao ler a configuração, usando padrão", zones.error ?? slots.error);
    }
    return DEFAULT_DELIVERY_CONFIG;
  }

  const usage: Record<string, number> = {};
  for (const row of booked.data ?? []) {
    const key = usageKey(row.delivery_date as string, row.delivery_slot as string);
    usage[key] = (usage[key] ?? 0) + 1;
  }

  const distanceStores = (stores.data ?? []).map((store) => ({
    id: store.id as string,
    name: store.name as string,
    address: store.address as string,
    lat: Number(store.lat),
    lng: Number(store.lng),
  }));

  return {
    districts: zones.data.map((z) => ({
      slug: z.slug as string,
      name: z.name as string,
      coverage: z.coverage as Coverage,
      fee: Number(z.fee),
    })),
    slots: slots.data.map((s) => ({
      id: s.slug as string,
      label: s.label as string,
      startHour: s.start_hour as number,
      weekdays: (s.weekdays as number[]) ?? [0, 1, 2, 3, 4, 5, 6],
      capacity: (s.capacity as number | null) ?? null,
    })),
    blackouts: (blackouts.data ?? []).map((b) => ({
      date: b.date as string,
      /* O join aninhado do PostgREST volta como array mesmo sendo 1:1. */
      slotId:
        (Array.isArray(b.delivery_slots)
          ? (b.delivery_slots[0] as { slug: string } | undefined)
          : (b.delivery_slots as { slug: string } | null)
        )?.slug ?? null,
    })),
    freeFrom: Number(settings.data?.free_delivery_from ?? DEFAULT_DELIVERY_CONFIG.freeFrom),
    distance: {
      enabled:
        distanceStores.length > 0 &&
        Number(settings.data?.max_distance_km ?? 0) > 0,
      baseFee: Number(settings.data?.base_fee ?? 12),
      feePerKm: Number(settings.data?.fee_per_km ?? 0),
      maxDistanceKm: Number(settings.data?.max_distance_km ?? 25),
      stores: distanceStores,
    },
    usage,
  };
});
