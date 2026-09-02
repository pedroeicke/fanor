import "server-only";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getProducts } from "./catalog-db";
import { ADDONS } from "./addons";
import {
  deliveryCost,
  parseISO,
  quoteDistanceDelivery,
  slotsForDate,
  validCoordinates,
  type Coordinates,
  type DeliveryConfig,
} from "./delivery";
import { getDeliveryConfig } from "./delivery-db";
import { getSupabaseAdmin } from "./supabase-admin";
import {
  CUSTOM_FLAVORS,
  CUSTOM_LEAD_TIME_HOURS,
  CUSTOM_SIZES,
  CUSTOM_STYLES,
  MAX_CUSTOM_FLAVORS,
  customPrice,
} from "./custom-cake";

export type PaymentMethod = "card" | "transfer";
export type OrderStatus = "pending_payment" | "paid" | "failed" | "cancelled" | "abandoned";

export type OrderLine = {
  slug: string;
  name: string;
  sizeSlug: string | null;
  qty: number;
  unitPrice: number;
  cakeMessage: string;
  photoUrl: string | null;
  flavors: string[];
};

export type Order = {
  code: string;
  createdAt: string;
  status: OrderStatus;
  paymentMethod: PaymentMethod;
  /** Preenchido quando o pagamento roda sem credenciais reais. */
  simulated?: boolean;
  chargeId?: string;
  customer: { name: string; phone: string; email: string };
  delivery: {
    method: "delivery" | "pickup";
    dateISO: string;
    slotId: string;
    districtSlug: string | null;
    address: string;
    reference: string;
    storeId?: string | null;
    coordinates?: Coordinates | null;
  };
  lines: OrderLine[];
  addons: { addonId: string; qty: number; message: string }[];
  totals: { subtotal: number; shipping: number; total: number };
  notes: string;
  /** Chave de idempotência da tentativa de compra. */
  idempotencyKey?: string | null;
};

/* -------------------------------------------------------------------------- */
/*  Validação e preço                                                         */
/* -------------------------------------------------------------------------- */

export class OrderError extends Error {
  constructor(
    message: string,
    readonly field?: string,
  ) {
    super(message);
  }
}

/**
 * Recalcula tudo a partir do catálogo do servidor.
 *
 * O preço que chega do navegador é informativo — nunca é a fonte da verdade.
 * Sem isto, qualquer pessoa com o devtools aberto compra uma Alteza por S/1.
 */
export async function priceOrder(input: {
  lines: {
    slug: string;
    sizeSlug: string | null;
    qty: number;
    flavors?: string[];
    photoUrl?: string | null;
    custom?: { sizeId: string; styleId: string } | null;
  }[];
  addons: { addonId: string; qty: number }[];
  delivery: {
    method: "delivery" | "pickup";
    districtSlug: string | null;
    coordinates?: Coordinates | null;
  };
}) {
  if (!input.lines.length) throw new OrderError("El pedido está vacío.");

  const [products, config] = await Promise.all([getProducts(), getDeliveryConfig()]);

  let subtotal = 0;
  const lines = input.lines.map((line) => {
    const qty = Math.floor(line.qty);
    if (!Number.isFinite(qty) || qty < 1 || qty > 20) {
      throw new OrderError("Cantidad inválida.");
    }

    /* Torta personalizada: não existe no catálogo, então o preço sai das
       regras do configurador — nunca do valor enviado pelo navegador. */
    if (line.custom) {
      const size = CUSTOM_SIZES.find((x) => x.id === line.custom!.sizeId);
      const style = CUSTOM_STYLES.find((x) => x.id === line.custom!.styleId);
      if (!size) throw new OrderError("Elige el tamaño de tu torta personalizada.", "size");
      if (!style) throw new OrderError("Elige el estilo de tu torta personalizada.", "style");

      const chosen = line.flavors ?? [];
      if (chosen.length < 1 || chosen.length > MAX_CUSTOM_FLAVORS) {
        throw new OrderError(
          `Elige entre 1 y ${MAX_CUSTOM_FLAVORS} sabores para tu torta personalizada.`,
          "flavors",
        );
      }
      const unknown = chosen.find((f) => !CUSTOM_FLAVORS.includes(f));
      if (unknown) throw new OrderError(`Sabor no disponible (${unknown}).`, "flavors");

      if (style.requiresPhoto && !line.photoUrl) {
        throw new OrderError("Falta subir la foto de tu torta personalizada.", "photo");
      }

      const unitPrice = customPrice(size.id, style.id);
      subtotal += unitPrice * qty;

      return {
        product: {
          slug: "torta-personalizada",
          name: `Torta personalizada · ${style.label}`,
          leadTimeHours: CUSTOM_LEAD_TIME_HOURS,
        },
        size: size.label,
        qty,
        unitPrice,
      };
    }

    const product = products.find((p) => p.slug === line.slug);
    if (!product) throw new OrderError(`Producto no encontrado: ${line.slug}`);

    let unitPrice = product.price;
    /* O que fica gravado e vai no e-mail é o rótulo ("26 cm"), não o slug
       ("26cm"): a cozinha e o cliente leem o pedido, não o banco. */
    let sizeLabel: string | null = null;
    if (product.sizes.length) {
      const size = product.sizes.find((s) => s.slug === line.sizeSlug);
      if (!size) throw new OrderError(`Falta elegir el tamaño de ${product.name}.`, "size");
      unitPrice = size.price;
      sizeLabel = size.label;
    }

    /* Regra de sabores revalidada aqui: a checagem da tela é conveniência,
       esta é a que vale. Cobre tanto "exatamente 3 entre 9" (min = max) quanto
       "até N" (min < max). */
    const chosen = line.flavors ?? [];
    if (chosen.length < product.minFlavors || chosen.length > product.maxFlavors) {
      throw new OrderError(
        product.maxFlavors === 0
          ? `${product.name} no admite selección de sabores.`
          : product.minFlavors === product.maxFlavors
            ? `${product.name}: elige exactamente ${product.maxFlavors} sabores.`
            : `${product.name}: elige entre ${product.minFlavors} y ${product.maxFlavors} sabores.`,
        "flavors",
      );
    }
    /* Sabor que não pertence ao produto: pedido adulterado, recusa. */
    const invalid = chosen.find(
      (f) => !product.flavors.some((x) => x.label === f || x.slug === f),
    );
    if (invalid) {
      throw new OrderError(`${product.name}: sabor no disponible (${invalid}).`, "flavors");
    }

    subtotal += unitPrice * qty;
    return { product, size: sizeLabel, qty, unitPrice };
  });

  const addons = input.addons.map((a) => {
    const addon = ADDONS.find((x) => x.id === a.addonId);
    if (!addon) throw new OrderError(`Complemento no encontrado: ${a.addonId}`);
    const qty = Math.floor(a.qty);
    if (!Number.isFinite(qty) || qty < 1 || qty > 20) throw new OrderError("Cantidad inválida.");
    subtotal += addon.price * qty;
    return { addon, qty };
  });

  let shipping = 0;
  let deliveryQuote: ReturnType<typeof quoteDistanceDelivery> | null = null;
  if (input.delivery.method === "delivery") {
    if (config.distance.enabled) {
      if (!validCoordinates(input.delivery.coordinates)) {
        throw new OrderError("Marca el punto exacto de entrega en el mapa.", "address");
      }
      deliveryQuote = quoteDistanceDelivery(config, input.delivery.coordinates, subtotal);
      if (!deliveryQuote.covered || deliveryQuote.shipping === null) {
        throw new OrderError(
          `La dirección está fuera de nuestra cobertura de ${config.distance.maxDistanceKm} km.`,
          "address",
        );
      }
      shipping = deliveryQuote.shipping;
    } else {
      const district = config.districts.find((d) => d.slug === input.delivery.districtSlug);
      if (!district) throw new OrderError("Elige tu distrito de entrega.", "district");
      shipping = deliveryCost(config, district, subtotal) ?? district.fee;
    }
  }

  return {
    lines,
    addons,
    subtotal,
    shipping,
    total: subtotal + shipping,
    freeFrom: config.freeFrom,
    deliveryQuote,
  };
}

/** Antecedência: a data escolhida tem de caber no tempo de produção do carrinho. */
export function validateDelivery(
  config: DeliveryConfig,
  dateISO: string,
  slotId: string,
  leadTimeHours: number,
  now = new Date(),
) {
  const date = parseISO(dateISO);
  if (!date) throw new OrderError("Fecha de entrega inválida.", "date");

  /* Usa as faixas realmente disponíveis naquele dia: cobre dia da semana,
     feriado bloqueado e capacidade esgotada de uma vez. */
  const slot = slotsForDate(config, dateISO).find((s) => s.id === slotId);
  if (!slot) {
    throw new OrderError("Esa franja horaria ya no está disponible. Elige otra.", "slot");
  }

  const scheduled = new Date(date);
  scheduled.setHours(slot.startHour, 0, 0, 0);

  if (scheduled.getTime() < now.getTime() + leadTimeHours * 3600_000) {
    throw new OrderError(
      `Necesitamos ${leadTimeHours} horas para preparar tu pedido. Elige una fecha más adelante.`,
      "date",
    );
  }
}

/* -------------------------------------------------------------------------- */
/*  Persistência                                                              */
/*                                                                            */
/*  Supabase quando configurado; arquivo local como fallback, para o projeto  */
/*  recém clonado rodar sem banco. O fallback nunca deve ir para produção —   */
/*  não tem concorrência segura nem backup.                                   */
/* -------------------------------------------------------------------------- */

const STORE = join(process.cwd(), ".data", "orders.json");

async function readFileStore(): Promise<Record<string, Order>> {
  try {
    return JSON.parse(await readFile(STORE, "utf8"));
  } catch {
    return {};
  }
}

async function writeFileStore(orders: Record<string, Order>) {
  await mkdir(join(process.cwd(), ".data"), { recursive: true });
  await writeFile(STORE, JSON.stringify(orders, null, 2));
}

/** Código curto e legível ao telefone: FN-7K2Q9. */
export function makeOrderCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(5);
  return `FN-${Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("")}`;
}

function toRow(order: Order) {
  return {
    code: order.code,
    status: order.status,
    customer_name: order.customer.name,
    customer_phone: order.customer.phone,
    customer_email: order.customer.email,
    delivery_method: order.delivery.method,
    delivery_date: order.delivery.dateISO,
    delivery_slot: order.delivery.slotId,
    delivery_zone: order.delivery.districtSlug,
    delivery_address: order.delivery.address || null,
    delivery_reference: order.delivery.reference || null,
    store_id: order.delivery.storeId ?? null,
    delivery_lat: order.delivery.coordinates?.lat ?? null,
    delivery_lng: order.delivery.coordinates?.lng ?? null,
    subtotal: order.totals.subtotal,
    shipping: order.totals.shipping,
    total: order.totals.total,
    currency: "PEN",
    payment_method: order.paymentMethod,
    payment_provider: order.paymentMethod === "card" ? "culqi" : null,
    payment_reference: order.chargeId ?? null,
    paid_at: order.status === "paid" ? new Date().toISOString() : null,
    simulated: Boolean(order.simulated),
    notes: order.notes || null,
    idempotency_key: order.idempotencyKey ?? null,
  };
}

type OrderRow = ReturnType<typeof toRow> & { created_at: string };
type ItemRow = {
  product_name: string;
  size_label: string | null;
  flavors: string[];
  quantity: number;
  unit_price: string | number;
  cake_message: string | null;
  photo_url: string | null;
  /** Junção com o catálogo; null para complementos e produtos já excluídos. */
  products?: { slug: string } | { slug: string }[] | null;
};

/** O PostgREST devolve a junção 1:1 ora como objeto, ora como array de um. */
function joinedSlug(item: ItemRow) {
  const joined = Array.isArray(item.products) ? item.products[0] : item.products;
  return joined?.slug ?? "";
}

function fromRow(row: OrderRow, items: ItemRow[]): Order {
  return {
    code: row.code,
    createdAt: row.created_at,
    status: row.status as OrderStatus,
    paymentMethod: row.payment_method as PaymentMethod,
    simulated: row.simulated,
    chargeId: row.payment_reference ?? undefined,
    customer: {
      name: row.customer_name,
      phone: row.customer_phone,
      email: row.customer_email,
    },
    delivery: {
      method: row.delivery_method as "delivery" | "pickup",
      dateISO: row.delivery_date,
      slotId: row.delivery_slot,
      districtSlug: row.delivery_zone,
      address: row.delivery_address ?? "",
      reference: row.delivery_reference ?? "",
      storeId: row.store_id ?? null,
      coordinates:
        row.delivery_lat !== null && row.delivery_lng !== null
          ? { lat: Number(row.delivery_lat), lng: Number(row.delivery_lng) }
          : null,
    },
    lines: items.map((i) => ({
      /* Sem o slug, o evento `purchase` sairia com item_id vazio e o
         relatório por produto do GA4 ficaria cego. */
      slug: joinedSlug(i),
      name: i.product_name,
      sizeSlug: i.size_label,
      qty: i.quantity,
      unitPrice: Number(i.unit_price),
      cakeMessage: i.cake_message ?? "",
      photoUrl: i.photo_url,
      flavors: i.flavors ?? [],
    })),
    addons: [],
    totals: {
      subtotal: Number(row.subtotal),
      shipping: Number(row.shipping),
      total: Number(row.total),
    },
    notes: row.notes ?? "",
    idempotencyKey: row.idempotency_key ?? null,
  };
}

export async function saveOrder(order: Order) {
  const db = getSupabaseAdmin();

  if (!db) {
    const orders = await readFileStore();
    orders[order.code] = order;
    await writeFileStore(orders);
    return order;
  }

  const { error } = await db.from("orders").insert(toRow(order));

  if (error) {
    /* Corrida de duplo envio: os dois pediram ao mesmo tempo, os dois viram o
       banco vazio, e um perdeu na chave única. Ninguém errou — o certo é
       devolver o pedido que venceu, não um erro.

       Sem isto o cliente vê falha e tenta de novo, que é exatamente o
       comportamento que a idempotência existe para evitar. */
    if (error.code === "23505" && order.idempotencyKey) {
      const winner = await findOrderByIdempotencyKey(order.idempotencyKey);
      if (winner) return winner;
    }
    throw new OrderError(`No pudimos registrar el pedido: ${error.message}`);
  }

  /* Vincula cada linha ao produto do catálogo. O nome e o preço continuam
     copiados — é o que preserva o histórico quando um produto é excluído —,
     mas sem este id não dá para responder "quantas Alteza 01 vendemos". */
  const catalog = await getProducts();
  const idBySlug = new Map(catalog.map((p) => [p.slug, p.id]));

  const items = [
    ...order.lines.map((l) => ({
      order_code: order.code,
      product_id: idBySlug.get(l.slug) ?? null,
      product_name: l.name,
      size_label: l.sizeSlug,
      flavors: l.flavors,
      quantity: l.qty,
      unit_price: l.unitPrice,
      cake_message: l.cakeMessage || null,
      photo_url: l.photoUrl,
    })),
    ...order.addons.map((a) => ({
      order_code: order.code,
      /* Complementos não são produtos do catálogo. */
      product_id: null,
      product_name: getAddonName(a.addonId),
      size_label: null,
      flavors: [],
      quantity: a.qty,
      unit_price: ADDONS.find((x) => x.id === a.addonId)?.price ?? 0,
      cake_message: a.message || null,
      photo_url: null,
    })),
  ];

  const { error: itemsError } = await db.from("order_items").insert(items);
  if (itemsError) {
    /* Pedido sem itens é lixo: desfaz para não deixar registro inconsistente. */
    await db.from("orders").delete().eq("code", order.code);
    throw new OrderError(`No pudimos registrar el pedido: ${itemsError.message}`);
  }

  return order;
}

function getAddonName(id: string) {
  return ADDONS.find((a) => a.id === id)?.name ?? id;
}

export async function getOrder(code: string): Promise<Order | null> {
  const db = getSupabaseAdmin();

  if (!db) {
    const orders = await readFileStore();
    return orders[code] ?? null;
  }

  const { data, error } = await db
    .from("orders")
    .select("*, order_items(*, products(slug))")
    .eq("code", code)
    .maybeSingle();

  if (error || !data) return null;
  const { order_items: items, ...row } = data as OrderRow & { order_items: ItemRow[] };
  return fromRow(row as OrderRow, items ?? []);
}

export async function updateOrder(code: string, patch: Partial<Order>) {
  const db = getSupabaseAdmin();

  if (!db) {
    const orders = await readFileStore();
    const current = orders[code];
    if (!current) return null;
    orders[code] = { ...current, ...patch };
    await writeFileStore(orders);
    return orders[code];
  }

  const update: Record<string, unknown> = {};
  if (patch.status) {
    update.status = patch.status;
    if (patch.status === "paid") update.paid_at = new Date().toISOString();
  }
  if (patch.chargeId !== undefined) update.payment_reference = patch.chargeId;
  if (patch.simulated !== undefined) update.simulated = patch.simulated;

  const { error } = await db.from("orders").update(update).eq("code", code);
  if (error) return null;

  return getOrder(code);
}

/**
 * Recupera o pedido criado por uma tentativa anterior com a mesma chave.
 *
 * É o que transforma um duplo envio em uma única compra: o segundo POST
 * recebe de volta o pedido do primeiro em vez de criar outro.
 */
export async function findOrderByIdempotencyKey(key: string) {
  const db = getSupabaseAdmin();
  if (!db) return null;

  const { data } = await db
    .from("orders")
    .select("code")
    .eq("idempotency_key", key)
    .maybeSingle();

  return data ? getOrder(data.code) : null;
}
