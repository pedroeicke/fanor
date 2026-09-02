/**
 * Entrega: tipos, cálculos e as regras que não mudam.
 *
 * Este arquivo é puro e serve cliente e servidor. Os **dados** — distritos,
 * tarifas, faixas horárias, feriados — vivem no banco e chegam por
 * `DeliveryConfig`. O que está aqui como `DEFAULT_*` é fallback para o site
 * subir sem banco, não a fonte da verdade.
 *
 * Existe porque o site antigo não tinha nada disso: pedia o distrito no
 * checkout mas nunca mostrava frete, e nunca perguntava a data — a variável
 * nº 1 da compra de uma torta.
 */

export type Coverage = "principal" | "extendida";

export type District = {
  slug: string;
  name: string;
  coverage: Coverage;
  fee: number;
};

export type Slot = {
  id: string;
  label: string;
  startHour: number;
  /** Dias em que a faixa existe: 0 = domingo … 6 = sábado. */
  weekdays: number[];
  /** Teto de pedidos na faixa; null = sem limite. */
  capacity: number | null;
};

/** Tudo que a loja precisa saber sobre entrega, num objeto só. */
export type DeliveryConfig = {
  districts: District[];
  slots: Slot[];
  /** Datas bloqueadas em ISO; a chave sem faixa bloqueia o dia inteiro. */
  blackouts: { date: string; slotId: string | null }[];
  freeFrom: number;
  distance: {
    enabled: boolean;
    baseFee: number;
    feePerKm: number;
    maxDistanceKm: number;
    stores: { id: string; name: string; address: string; lat: number; lng: number }[];
  };
  /** Quantos pedidos já ocupam cada par data+faixa. */
  usage: Record<string, number>;
};

/* -------------------------------------------------------------------------- */
/*  Fallback                                                                  */
/* -------------------------------------------------------------------------- */

const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];
const MON_TO_SAT = [1, 2, 3, 4, 5, 6];

export const DEFAULT_FREE_FROM = 150;

export const DEFAULT_SLOTS: Slot[] = [
  { id: "10-13", label: "10:00 a.m. – 1:00 p.m.", startHour: 10, weekdays: EVERY_DAY, capacity: null },
  { id: "13-16", label: "1:00 p.m. – 4:00 p.m.", startHour: 13, weekdays: EVERY_DAY, capacity: null },
  { id: "16-18", label: "4:00 p.m. – 6:00 p.m.", startHour: 16, weekdays: EVERY_DAY, capacity: null },
  { id: "18-20", label: "6:00 p.m. – 8:00 p.m.", startHour: 18, weekdays: MON_TO_SAT, capacity: null },
];

const d = (name: string, coverage: Coverage, fee: number): District => ({
  slug: name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-"),
  name,
  coverage,
  fee,
});

export const DEFAULT_DISTRICTS: District[] = [
  d("Cercado - Arequipa", "principal", 12),
  d("Yanahuara", "principal", 12),
  d("Cayma", "principal", 12),
  d("José Luis Bustamante y Rivero", "principal", 12),
  d("Miraflores", "principal", 12),
  d("Mariano Melgar", "principal", 12),
  d("Selva Alegre", "principal", 12),
  d("Alto Selva Alegre", "principal", 12),
  d("Paucarpata", "extendida", 18),
  d("Cerro Colorado", "extendida", 18),
  d("Sachaca", "extendida", 18),
  d("Socabaya", "extendida", 18),
  d("Jacobo Hunter", "extendida", 18),
  d("Tiabaya", "extendida", 18),
  d("Characato", "extendida", 18),
  d("Sabandía", "extendida", 18),
  d("Uchumayo", "extendida", 18),
];

export const DEFAULT_DELIVERY_CONFIG: DeliveryConfig = {
  districts: DEFAULT_DISTRICTS,
  slots: DEFAULT_SLOTS,
  blackouts: [],
  freeFrom: DEFAULT_FREE_FROM,
  distance: { enabled: false, baseFee: 12, feePerKm: 0, maxDistanceKm: 25, stores: [] },
  usage: {},
};

/* -------------------------------------------------------------------------- */
/*  Cálculos                                                                  */
/* -------------------------------------------------------------------------- */

export function findDistrict(config: DeliveryConfig, slug: string | null | undefined) {
  return config.districts.find((x) => x.slug === slug) ?? null;
}

/** Custo final considerando a cortesia por valor de pedido. */
export function deliveryCost(config: DeliveryConfig, district: District | null, subtotal: number) {
  if (!district) return null;
  if (subtotal >= config.freeFrom) return 0;
  return district.fee;
}

export type DistanceQuote = {
  covered: boolean;
  distanceKm: number;
  shipping: number | null;
  storeId: string | null;
  storeName: string | null;
};

export type Coordinates = { lat: number; lng: number };

export function validCoordinates(value: unknown): value is Coordinates {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<Coordinates>;
  return (
    Number.isFinite(candidate.lat) &&
    Number.isFinite(candidate.lng) &&
    candidate.lat! >= -90 &&
    candidate.lat! <= 90 &&
    candidate.lng! >= -180 &&
    candidate.lng! <= 180
  );
}

/** Distância geodésica em km. O servidor repete este cálculo antes de cobrar. */
export function haversineKm(a: Coordinates, b: Coordinates) {
  const rad = (value: number) => (value * Math.PI) / 180;
  const earthKm = 6371;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return earthKm * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

export function quoteDistanceDelivery(
  config: DeliveryConfig,
  destination: Coordinates,
  subtotal: number,
): DistanceQuote {
  const nearest = config.distance.stores
    .map((store) => ({ store, distanceKm: haversineKm(store, destination) }))
    .sort((a, b) => a.distanceKm - b.distanceKm)[0];

  if (!config.distance.enabled || !nearest) {
    return { covered: false, distanceKm: 0, shipping: null, storeId: null, storeName: null };
  }

  const distanceKm = Math.round(nearest.distanceKm * 10) / 10;
  if (distanceKm > config.distance.maxDistanceKm) {
    return {
      covered: false,
      distanceKm,
      shipping: null,
      storeId: nearest.store.id,
      storeName: nearest.store.name,
    };
  }

  const shipping =
    subtotal >= config.freeFrom
      ? 0
      : Math.round((config.distance.baseFee + distanceKm * config.distance.feePerKm) * 100) / 100;
  return {
    covered: true,
    distanceKm,
    shipping,
    storeId: nearest.store.id,
    storeName: nearest.store.name,
  };
}

export const usageKey = (dateISO: string, slotId: string) => `${dateISO}|${slotId}`;

/**
 * Faixas realmente disponíveis num dia.
 *
 * Descarta o que não existe naquele dia da semana, o que a operação bloqueou
 * e o que já atingiu a capacidade. Oferecer um horário que a cozinha não
 * consegue cumprir é pior que não oferecer nenhum.
 */
export function slotsForDate(config: DeliveryConfig, iso: string): Slot[] {
  const date = parseISO(iso);
  if (!date) return config.slots;

  const dayBlocked = config.blackouts.some((b) => b.date === iso && b.slotId === null);
  if (dayBlocked) return [];

  return config.slots.filter((slot) => {
    if (!slot.weekdays.includes(date.getDay())) return false;
    if (config.blackouts.some((b) => b.date === iso && b.slotId === slot.id)) return false;
    if (slot.capacity !== null && (config.usage[usageKey(iso, slot.id)] ?? 0) >= slot.capacity) {
      return false;
    }
    return true;
  });
}

/* -------------------------------------------------------------------------- */
/*  Datas                                                                     */
/* -------------------------------------------------------------------------- */

const MONTHS = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];
const WEEKDAYS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
const WEEKDAYS_SHORT = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

export function toISO(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function parseISO(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export function formatDateLong(iso: string) {
  const date = parseISO(iso);
  if (!date) return "";
  return `${WEEKDAYS[date.getDay()]} ${date.getDate()} de ${MONTHS[date.getMonth()]}`;
}

export function formatDateShort(iso: string) {
  const date = parseISO(iso);
  if (!date) return "";
  return `${WEEKDAYS_SHORT[date.getDay()]} ${date.getDate()} ${MONTHS[date.getMonth()].slice(0, 3)}`;
}

/**
 * Primeira data possível dada a antecedência de produção do produto.
 * Altezas e personalizadas pedem 48h; catálogo padrão, 24h.
 */
export function earliestDate(leadTimeHours: number, now = new Date()) {
  return toISO(new Date(now.getTime() + leadTimeHours * 3600_000));
}

/**
 * Próximos `count` dias com ao menos uma faixa livre.
 * Datas impossíveis somem em vez de aparecerem desabilitadas — um calendário
 * só com opções válidas elimina a tentativa frustrada.
 */
export function availableDates(
  config: DeliveryConfig,
  leadTimeHours: number,
  count = 21,
  now = new Date(),
) {
  const first = parseISO(earliestDate(leadTimeHours, now))!;
  const days = [];

  for (let i = 0; days.length < count && i < count * 3; i++) {
    const day = new Date(first);
    day.setDate(first.getDate() + i);
    const iso = toISO(day);

    if (!slotsForDate(config, iso).length) continue;

    days.push({
      iso,
      weekday: WEEKDAYS_SHORT[day.getDay()],
      dayOfMonth: day.getDate(),
      month: MONTHS[day.getMonth()].slice(0, 3),
      /** Sinaliza a data mais próxima possível — reduz a dúvida "dá pra amanhã?". */
      isEarliest: days.length === 0,
    });
  }

  return days;
}
