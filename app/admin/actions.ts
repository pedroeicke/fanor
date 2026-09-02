"use server";

import { revalidatePath } from "next/cache";
import { getAdminUser, getServerSupabase } from "@/lib/supabase-server";
import { sendOrderEmails } from "@/lib/email/dispatch";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { PRODUCT_BUCKET } from "@/lib/storage";

/**
 * Ações do painel.
 *
 * Toda ação confere a sessão antes de escrever. As políticas de RLS já
 * barrariam, mas checar aqui devolve um erro legível em vez de um silêncio —
 * uma escrita bloqueada pelo RLS afeta zero linhas sem levantar exceção.
 */

const STATUSES = ["active", "draft", "unavailable"] as const;
type Status = (typeof STATUSES)[number];

export async function setProductStatus(id: string, status: string) {
  if (!STATUSES.includes(status as Status)) {
    return { ok: false as const, error: "Estado inválido." };
  }

  const user = await getAdminUser();
  if (!user) return { ok: false as const, error: "Sesión expirada. Vuelve a entrar." };

  const db = await getServerSupabase();
  if (!db) return { ok: false as const, error: "Sin conexión con la base de datos." };

  const { data, error } = await db
    .from("products")
    .update({ status })
    .eq("id", id)
    .select("slug")
    .maybeSingle();

  if (error) return { ok: false as const, error: error.message };
  if (!data) return { ok: false as const, error: "No se pudo actualizar el producto." };

  await db.from("audit_log").insert({
    actor: user.id,
    action: "product.status",
    entity: "products",
    entity_id: id,
    changes: { status },
  });

  /* Invalida a loja também: sem isto o produto continuaria visível por até
     5 minutos, o tempo do ISR. */
  revalidatePath("/admin/productos");
  revalidatePath("/tortas");
  revalidatePath(`/tortas/${data.slug}`);

  return { ok: true as const };
}

/* -------------------------------------------------------------------------- */
/*  Edição de produto                                                         */
/* -------------------------------------------------------------------------- */

export type ProductPatch = {
  name: string;
  sku: string;
  shortDescription: string;
  status: string;
  basePrice: string;
  leadTimeHours: string;
  minFlavors: string;
  maxFlavors: string;
  defaultServes: string;
  maxServings: string;
  acceptsPhoto: boolean;
  featured: boolean;
  sizes: { id: string; price: string }[];
};

export async function updateProduct(id: string, patch: ProductPatch) {
  const user = await getAdminUser();
  if (!user) return { ok: false as const, error: "Sesión expirada. Vuelve a entrar." };

  const db = await getServerSupabase();
  if (!db) return { ok: false as const, error: "Sin conexión con la base de datos." };

  const name = patch.name.trim();
  if (name.length < 2) return { ok: false as const, error: "El nombre es obligatorio." };
  if (!STATUSES.includes(patch.status as Status)) {
    return { ok: false as const, error: "Estado inválido." };
  }

  const num = (v: string) => (v.trim() === "" ? null : Number(v));

  const min = Number(patch.minFlavors) || 0;
  const max = Number(patch.maxFlavors) || 0;
  if (max < min) {
    return { ok: false as const, error: "El máximo de sabores no puede ser menor que el mínimo." };
  }

  const basePrice = num(patch.basePrice);
  if (basePrice !== null && (!Number.isFinite(basePrice) || basePrice < 0)) {
    return { ok: false as const, error: "Precio inválido." };
  }

  /* Preço de tamanho gravado antes do produto: se algum for inválido, nada
     muda, em vez de o produto ficar salvo pela metade. */
  for (const size of patch.sizes) {
    const price = Number(size.price);
    if (!Number.isFinite(price) || price < 0) {
      return { ok: false as const, error: "Hay un precio de tamaño inválido." };
    }
  }

  const { data, error } = await db
    .from("products")
    .update({
      name,
      sku: patch.sku.trim() || null,
      short_description: patch.shortDescription.trim() || null,
      status: patch.status,
      base_price: basePrice,
      lead_time_hours: Number(patch.leadTimeHours) || 24,
      min_flavors: min,
      max_flavors: max,
      default_serves: patch.defaultServes.trim() || null,
      max_servings: num(patch.maxServings),
      accepts_photo: patch.acceptsPhoto,
      featured: patch.featured,
    })
    .eq("id", id)
    .select("slug")
    .maybeSingle();

  if (error) return { ok: false as const, error: error.message };
  if (!data) return { ok: false as const, error: "No se pudo guardar el producto." };

  for (const size of patch.sizes) {
    const { error: sizeError } = await db
      .from("product_sizes")
      .update({ price: Number(size.price) })
      .eq("id", size.id);
    if (sizeError) return { ok: false as const, error: sizeError.message };
  }

  await db.from("audit_log").insert({
    actor: user.id,
    action: "product.update",
    entity: "products",
    entity_id: id,
    changes: { name, status: patch.status },
  });

  revalidatePath("/admin/productos");
  revalidatePath("/tortas");
  revalidatePath(`/tortas/${data.slug}`);

  return { ok: true as const };
}

/* -------------------------------------------------------------------------- */
/*  Reenvio de e-mail                                                         */
/* -------------------------------------------------------------------------- */

export async function resendOrderEmails(code: string) {
  const user = await getAdminUser();
  if (!user) return { ok: false as const, error: "Sesión expirada. Vuelve a entrar." };

  /* force: true ignora a trava de idempotência. É deliberado — reenviar é
     exatamente o caso em que queremos passar por cima dela. */
  const results = await sendOrderEmails(code, { force: true });

  const db = await getServerSupabase();
  await db?.from("audit_log").insert({
    actor: user.id,
    action: "email.resend",
    entity: "orders",
    entity_id: code,
    changes: { results },
  });

  revalidatePath("/admin/pedidos");

  const failed = results.filter((r) => r.status === "failed");
  if (failed.length) {
    return { ok: false as const, error: failed.map((f) => f.error).filter(Boolean).join(" · ") };
  }
  return { ok: true as const };
}

/* -------------------------------------------------------------------------- */
/*  Criar, excluir e imagens                                                  */
/* -------------------------------------------------------------------------- */

/** Slug legível derivado do nome, como no importador do catálogo. */
function slugify(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export async function createProduct(input: { name: string; kind: string; basePrice: string }) {
  const user = await getAdminUser();
  if (!user) return { ok: false as const, error: "Sesión expirada. Vuelve a entrar." };

  const db = await getServerSupabase();
  if (!db) return { ok: false as const, error: "Sin conexión con la base de datos." };

  const name = input.name.trim();
  if (name.length < 2) return { ok: false as const, error: "Escribe el nombre del producto." };

  const base = slugify(name);
  if (!base) return { ok: false as const, error: "El nombre no genera una URL válida." };

  /* Nome repetido é comum ("Torta de Chocolate 2"): sufixo numérico em vez de
     erro, para não travar quem está cadastrando. */
  let slug = base;
  for (let i = 2; i < 50; i++) {
    const { data: taken } = await db.from("products").select("id").eq("slug", slug).maybeSingle();
    if (!taken) break;
    slug = `${base}-${i}`;
  }

  const price = input.basePrice.trim() === "" ? null : Number(input.basePrice);
  if (price !== null && (!Number.isFinite(price) || price < 0)) {
    return { ok: false as const, error: "Precio inválido." };
  }

  const { data, error } = await db
    .from("products")
    .insert({
      slug,
      name,
      kind: ["simple", "variable", "custom"].includes(input.kind) ? input.kind : "simple",
      /* Nasce como rascunho: um produto sem foto nem descrição não deve
         aparecer na loja no instante em que é criado. */
      status: "draft",
      base_price: price,
      lead_time_hours: 24,
      default_serves: "10–12 porciones",
      max_servings: 12,
    })
    .select("id")
    .single();

  if (error) return { ok: false as const, error: error.message };

  await db.from("audit_log").insert({
    actor: user.id,
    action: "product.create",
    entity: "products",
    entity_id: data.id,
    changes: { name, slug },
  });

  revalidatePath("/admin/productos");
  return { ok: true as const, id: data.id as string };
}

export async function deleteProduct(id: string) {
  const user = await getAdminUser();
  if (!user) return { ok: false as const, error: "Sesión expirada. Vuelve a entrar." };

  const db = await getServerSupabase();
  if (!db) return { ok: false as const, error: "Sin conexión con la base de datos." };

  const { data: product } = await db
    .from("products")
    .select("slug, name, product_images(url, kind)")
    .eq("id", id)
    .maybeSingle();

  if (!product) return { ok: false as const, error: "Producto no encontrado." };

  /* Histórico de venda não pode sumir: order_items guarda nome e preço
     copiados, e a FK é ON DELETE SET NULL. Ainda assim avisamos quantos
     pedidos ficarão sem vínculo — apagar um produto vendido costuma ser
     engano, e "agotado" é quase sempre o que a pessoa queria. */
  const { count } = await db
    .from("order_items")
    .select("id", { count: "exact", head: true })
    .eq("product_id", id);

  const { error } = await db.from("products").delete().eq("id", id);
  if (error) return { ok: false as const, error: error.message };

  /* Imagens do balde não são apagadas pela FK. Falha aqui é só espaço
     ocupado, então não desfaz a exclusão. */
  const paths = (product.product_images ?? [])
    .map((i: { url: string }) => storagePathFromUrl(i.url))
    .filter((p): p is string => Boolean(p));
  if (paths.length) {
    const admin = getSupabaseAdmin();
    await admin?.storage.from(PRODUCT_BUCKET).remove(paths);
  }

  await db.from("audit_log").insert({
    actor: user.id,
    action: "product.delete",
    entity: "products",
    entity_id: id,
    changes: { name: product.name, orphanedOrderItems: count ?? 0 },
  });

  revalidatePath("/admin/productos");
  revalidatePath("/tortas");
  return { ok: true as const, orphanedOrderItems: count ?? 0 };
}

/** Extrai o caminho no balde a partir da URL pública. */
function storagePathFromUrl(url: string) {
  const marker = `/storage/v1/object/public/${PRODUCT_BUCKET}/`;
  const i = url.indexOf(marker);
  return i === -1 ? null : url.slice(i + marker.length);
}

export async function deleteProductImage(imageId: string) {
  const user = await getAdminUser();
  if (!user) return { ok: false as const, error: "Sesión expirada." };

  const db = await getServerSupabase();
  if (!db) return { ok: false as const, error: "Sin conexión." };

  const { data: image } = await db
    .from("product_images")
    .select("url, product_id, products(slug)")
    .eq("id", imageId)
    .maybeSingle();

  if (!image) return { ok: false as const, error: "Imagen no encontrada." };

  const { error } = await db.from("product_images").delete().eq("id", imageId);
  if (error) return { ok: false as const, error: error.message };

  const path = storagePathFromUrl(image.url);
  if (path) {
    const admin = getSupabaseAdmin();
    await admin?.storage.from(PRODUCT_BUCKET).remove([path]);
  }

  revalidatePath(`/admin/productos/${image.product_id}`);
  revalidatePath("/tortas");
  return { ok: true as const };
}

/** Reordena a galeria. A primeira imagem é a capa em toda a loja. */
export async function reorderProductImages(productId: string, orderedIds: string[]) {
  const user = await getAdminUser();
  if (!user) return { ok: false as const, error: "Sesión expirada." };

  const db = await getServerSupabase();
  if (!db) return { ok: false as const, error: "Sin conexión." };

  for (const [index, id] of orderedIds.entries()) {
    const { error } = await db
      .from("product_images")
      .update({ sort_order: index })
      .eq("id", id)
      .eq("product_id", productId);
    if (error) return { ok: false as const, error: error.message };
  }

  revalidatePath(`/admin/productos/${productId}`);
  revalidatePath("/tortas");
  return { ok: true as const };
}

/* -------------------------------------------------------------------------- */
/*  Estado do pedido                                                          */
/* -------------------------------------------------------------------------- */

const ORDER_STATUSES = ["pending_payment", "paid", "failed", "cancelled", "abandoned"] as const;
type OrderStatusValue = (typeof ORDER_STATUSES)[number];

/**
 * Muda o estado de um pedido.
 *
 * É a operação diária que faltava: chega o comprovante de transferência no
 * WhatsApp e alguém precisa registrar que foi pago. Sem isto, o pedido fica
 * eternamente "esperando pago" e a cozinha não sabe se produz.
 */
export async function setOrderStatus(code: string, status: string) {
  if (!ORDER_STATUSES.includes(status as OrderStatusValue)) {
    return { ok: false as const, error: "Estado inválido." };
  }

  const user = await getAdminUser();
  if (!user) return { ok: false as const, error: "Sesión expirada. Vuelve a entrar." };

  const db = await getServerSupabase();
  if (!db) return { ok: false as const, error: "Sin conexión con la base de datos." };

  const { data: before } = await db
    .from("orders")
    .select("status, payment_method")
    .eq("code", code)
    .maybeSingle();

  if (!before) return { ok: false as const, error: "Pedido no encontrado." };

  const patch: Record<string, unknown> = { status };
  /* `paid_at` marca quando o dinheiro entrou, não quando o registro mudou —
     mas só na primeira vez, para um clique errado e desfeito não reescrever
     a data original. */
  if (status === "paid" && before.status !== "paid") patch.paid_at = new Date().toISOString();
  if (status !== "paid") patch.paid_at = null;

  const { error } = await db.from("orders").update(patch).eq("code", code);
  if (error) return { ok: false as const, error: error.message };

  await db.from("audit_log").insert({
    actor: user.id,
    action: "order.status",
    entity: "orders",
    entity_id: code,
    changes: { from: before.status, to: status },
  });

  /* Confirmar um pagamento por transferência é o momento em que o pedido
     entra em produção de verdade. Reenviar avisa a cozinha e tranquiliza o
     cliente — e a falha do e-mail não desfaz a mudança de estado. */
  if (status === "paid" && before.status !== "paid" && before.payment_method === "transfer") {
    await sendOrderEmails(code, { force: true });
  }

  revalidatePath("/admin/pedidos");
  revalidatePath(`/admin/pedidos/${code}`);
  revalidatePath("/admin");
  return { ok: true as const };
}

/* -------------------------------------------------------------------------- */
/*  Configuração de entrega                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Invalida a loja inteira depois de mexer em entrega.
 *
 * Frete e horário aparecem no rodapé, na home, no produto, no carrinho e no
 * checkout. Revalidar só a página de origem deixaria a tabela antiga no ar em
 * todas as outras por até 5 minutos — tempo suficiente para alguém comprar
 * com o frete errado.
 */
function revalidateDelivery() {
  revalidatePath("/", "layout");
}

export async function saveDeliveryZone(input: {
  slug: string;
  name: string;
  coverage: string;
  fee: string;
  active: boolean;
}) {
  const user = await getAdminUser();
  if (!user) return { ok: false as const, error: "Sesión expirada." };

  const db = await getServerSupabase();
  if (!db) return { ok: false as const, error: "Sin conexión." };

  const name = input.name.trim();
  if (name.length < 2) return { ok: false as const, error: "Escribe el nombre del distrito." };

  const fee = Number(input.fee);
  if (!Number.isFinite(fee) || fee < 0) return { ok: false as const, error: "Costo inválido." };

  const slug = input.slug || slugify(name);
  const row = {
    slug,
    name,
    coverage: input.coverage === "extendida" ? "extendida" : "principal",
    fee,
    active: input.active,
  };

  const { error } = await db.from("delivery_zones").upsert(row, { onConflict: "slug" });
  if (error) return { ok: false as const, error: error.message };

  await db.from("audit_log").insert({
    actor: user.id,
    action: "delivery.zone",
    entity: "delivery_zones",
    entity_id: slug,
    changes: row,
  });

  revalidateDelivery();
  return { ok: true as const };
}

export async function deleteDeliveryZone(slug: string) {
  const user = await getAdminUser();
  if (!user) return { ok: false as const, error: "Sesión expirada." };

  const db = await getServerSupabase();
  if (!db) return { ok: false as const, error: "Sin conexión." };

  /* Zona apagada quebraria o histórico: os pedidos guardam o slug. Desativar
     tira da loja e mantém o registro legível. */
  const { error } = await db.from("delivery_zones").update({ active: false }).eq("slug", slug);
  if (error) return { ok: false as const, error: error.message };

  await db.from("audit_log").insert({
    actor: user.id,
    action: "delivery.zone.disable",
    entity: "delivery_zones",
    entity_id: slug,
  });

  revalidateDelivery();
  return { ok: true as const };
}

export async function saveDeliverySlot(input: {
  slug: string;
  label: string;
  capacity: string;
  weekdays: number[];
  active: boolean;
}) {
  const user = await getAdminUser();
  if (!user) return { ok: false as const, error: "Sesión expirada." };

  const db = await getServerSupabase();
  if (!db) return { ok: false as const, error: "Sin conexión." };

  const capacity = input.capacity.trim() === "" ? null : Number(input.capacity);
  if (capacity !== null && (!Number.isInteger(capacity) || capacity < 1)) {
    return { ok: false as const, error: "La capacidad debe ser un número entero mayor que cero." };
  }
  if (!input.weekdays.length) {
    return { ok: false as const, error: "Elige al menos un día para esta franja." };
  }

  const { error } = await db
    .from("delivery_slots")
    .update({ label: input.label.trim(), capacity, weekdays: input.weekdays, active: input.active })
    .eq("slug", input.slug);

  if (error) return { ok: false as const, error: error.message };

  await db.from("audit_log").insert({
    actor: user.id,
    action: "delivery.slot",
    entity: "delivery_slots",
    entity_id: input.slug,
    changes: { capacity, weekdays: input.weekdays, active: input.active },
  });

  revalidateDelivery();
  return { ok: true as const };
}

export async function saveFreeDeliveryThreshold(value: string) {
  const user = await getAdminUser();
  if (!user) return { ok: false as const, error: "Sesión expirada." };

  const db = await getServerSupabase();
  if (!db) return { ok: false as const, error: "Sin conexión." };

  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) return { ok: false as const, error: "Monto inválido." };

  const { error } = await db
    .from("delivery_settings")
    .update({ free_delivery_from: amount, updated_at: new Date().toISOString() })
    .eq("id", true);

  if (error) return { ok: false as const, error: error.message };

  revalidateDelivery();
  return { ok: true as const };
}

export async function saveDistanceDeliverySettings(input: {
  baseFee: string;
  feePerKm: string;
  maxDistanceKm: string;
}) {
  const user = await getAdminUser();
  if (!user) return { ok: false as const, error: "Sesión expirada." };
  const db = await getServerSupabase();
  if (!db) return { ok: false as const, error: "Sin conexión." };

  const values = {
    base_fee: Number(input.baseFee),
    fee_per_km: Number(input.feePerKm),
    max_distance_km: Number(input.maxDistanceKm),
  };
  if (
    !Number.isFinite(values.base_fee) ||
    !Number.isFinite(values.fee_per_km) ||
    !Number.isFinite(values.max_distance_km) ||
    values.base_fee < 0 ||
    values.fee_per_km <= 0 ||
    values.max_distance_km <= 0
  ) {
    return { ok: false as const, error: "Revisa la tarifa base, el costo por km y la cobertura." };
  }

  const { error } = await db
    .from("delivery_settings")
    .update({ ...values, updated_at: new Date().toISOString() })
    .eq("id", true);
  if (error) return { ok: false as const, error: error.message };

  await db.from("audit_log").insert({
    actor: user.id,
    action: "delivery.distance-settings",
    entity: "delivery_settings",
    entity_id: "global",
    changes: values,
  });
  revalidateDelivery();
  return { ok: true as const };
}

export async function saveStoreCoordinates(input: { id: string; lat: string; lng: string }) {
  const user = await getAdminUser();
  if (!user) return { ok: false as const, error: "Sesión expirada." };
  const db = await getServerSupabase();
  if (!db) return { ok: false as const, error: "Sin conexión." };

  const lat = Number(input.lat);
  const lng = Number(input.lng);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
    return { ok: false as const, error: "Coordenadas inválidas." };
  }

  const { error } = await db.from("stores").update({ lat, lng }).eq("id", input.id);
  if (error) return { ok: false as const, error: error.message };
  await db.from("audit_log").insert({
    actor: user.id,
    action: "store.coordinates",
    entity: "stores",
    entity_id: input.id,
    changes: { lat, lng },
  });
  revalidateDelivery();
  return { ok: true as const };
}

export async function createDeliveryStore(input: {
  name: string;
  address: string;
  district: string;
  lat: string;
  lng: string;
}) {
  const user = await getAdminUser();
  if (!user) return { ok: false as const, error: "Sesión expirada." };
  const db = await getServerSupabase();
  if (!db) return { ok: false as const, error: "Sin conexión." };

  const name = input.name.trim();
  const address = input.address.trim();
  const lat = Number(input.lat);
  const lng = Number(input.lng);
  if (name.length < 2 || address.length < 5) {
    return { ok: false as const, error: "Nombre y dirección son obligatorios." };
  }
  if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
    return { ok: false as const, error: "Coordenadas inválidas." };
  }

  const { data, error } = await db
    .from("stores")
    .insert({ name, address, district: input.district.trim() || null, lat, lng, active: true })
    .select("id")
    .single();
  if (error) return { ok: false as const, error: error.message };
  await db.from("audit_log").insert({
    actor: user.id,
    action: "store.create",
    entity: "stores",
    entity_id: data.id,
    changes: { name, address, lat, lng },
  });
  revalidateDelivery();
  return { ok: true as const };
}

/** Feriado ou dia em que a operação não entrega. */
export async function addBlackout(date: string, slotSlug: string | null, reason: string) {
  const user = await getAdminUser();
  if (!user) return { ok: false as const, error: "Sesión expirada." };

  const db = await getServerSupabase();
  if (!db) return { ok: false as const, error: "Sin conexión." };

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false as const, error: "Fecha inválida." };

  let slotId: string | null = null;
  if (slotSlug) {
    const { data } = await db.from("delivery_slots").select("id").eq("slug", slotSlug).maybeSingle();
    if (!data) return { ok: false as const, error: "Franja no encontrada." };
    slotId = data.id;
  }

  /* Bloquear uma data já comprometida não cancela nada, mas quem bloqueia
     precisa saber que existem pedidos ali. */
  const { count } = await db
    .from("orders")
    .select("code", { count: "exact", head: true })
    .eq("delivery_date", date)
    .neq("status", "cancelled");

  const { error } = await db
    .from("delivery_blackouts")
    .upsert({ date, slot_id: slotId, reason: reason.trim() || null });

  if (error) return { ok: false as const, error: error.message };

  await db.from("audit_log").insert({
    actor: user.id,
    action: "delivery.blackout",
    entity: "delivery_blackouts",
    entity_id: date,
    changes: { slot: slotSlug, reason, existingOrders: count ?? 0 },
  });

  revalidateDelivery();
  return { ok: true as const, existingOrders: count ?? 0 };
}

export async function removeBlackout(date: string, slotSlug: string | null) {
  const user = await getAdminUser();
  if (!user) return { ok: false as const, error: "Sesión expirada." };

  const db = await getServerSupabase();
  if (!db) return { ok: false as const, error: "Sin conexión." };

  let query = db.from("delivery_blackouts").delete().eq("date", date);
  if (slotSlug) {
    const { data } = await db.from("delivery_slots").select("id").eq("slug", slotSlug).maybeSingle();
    query = query.eq("slot_id", data?.id ?? "");
  } else {
    query = query.is("slot_id", null);
  }

  const { error } = await query;
  if (error) return { ok: false as const, error: error.message };

  revalidateDelivery();
  return { ok: true as const };
}

/* -------------------------------------------------------------------------- */
/*  Tamanhos, sabores e categorias                                            */
/* -------------------------------------------------------------------------- */

async function touchProduct(productId: string) {
  const db = await getServerSupabase();
  const { data } = await db!.from("products").select("slug").eq("id", productId).maybeSingle();
  revalidatePath(`/admin/productos/${productId}`);
  revalidatePath("/tortas");
  if (data?.slug) revalidatePath(`/tortas/${data.slug}`);
}

export async function addProductSize(
  productId: string,
  input: { label: string; serves: string; price: string },
) {
  const user = await getAdminUser();
  if (!user) return { ok: false as const, error: "Sesión expirada." };

  const db = await getServerSupabase();
  if (!db) return { ok: false as const, error: "Sin conexión." };

  const label = input.label.trim();
  if (label.length < 1) return { ok: false as const, error: "Escribe el nombre del tamaño." };

  const price = Number(input.price);
  if (!Number.isFinite(price) || price < 0) return { ok: false as const, error: "Precio inválido." };

  const { data: last } = await db
    .from("product_sizes")
    .select("sort_order")
    .eq("product_id", productId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { error } = await db.from("product_sizes").insert({
    product_id: productId,
    slug: slugify(label),
    label,
    serves: input.serves.trim() || null,
    price,
    sort_order: (last?.sort_order ?? -1) + 1,
  });

  if (error) {
    return {
      ok: false as const,
      error: error.code === "23505" ? "Ya existe un tamaño con ese nombre." : error.message,
    };
  }

  /* Passar a ter tamanhos torna o produto variável: o preço deixa de sair de
     base_price e passa a sair da variação. */
  await db.from("products").update({ kind: "variable", base_price: null }).eq("id", productId);

  await touchProduct(productId);
  return { ok: true as const };
}

export async function deleteProductSize(productId: string, sizeId: string) {
  const user = await getAdminUser();
  if (!user) return { ok: false as const, error: "Sesión expirada." };

  const db = await getServerSupabase();
  if (!db) return { ok: false as const, error: "Sin conexión." };

  const { error } = await db.from("product_sizes").delete().eq("id", sizeId);
  if (error) return { ok: false as const, error: error.message };

  /* Sem tamanhos, volta a ser produto simples — senão ficaria sem preço
     nenhum e a loja mostraria S/ 0. */
  const { count } = await db
    .from("product_sizes")
    .select("id", { count: "exact", head: true })
    .eq("product_id", productId);

  if (!count) {
    await db.from("products").update({ kind: "simple" }).eq("id", productId);
  }

  await touchProduct(productId);
  return { ok: true as const, remaining: count ?? 0 };
}

export async function addProductFlavor(productId: string, label: string) {
  const user = await getAdminUser();
  if (!user) return { ok: false as const, error: "Sesión expirada." };

  const db = await getServerSupabase();
  if (!db) return { ok: false as const, error: "Sin conexión." };

  const name = label.trim();
  if (!name) return { ok: false as const, error: "Escribe el nombre del sabor." };

  const { data: last } = await db
    .from("product_flavors")
    .select("sort_order")
    .eq("product_id", productId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { error } = await db.from("product_flavors").insert({
    product_id: productId,
    slug: slugify(name),
    label: name,
    sort_order: (last?.sort_order ?? -1) + 1,
  });

  if (error) {
    return {
      ok: false as const,
      error: error.code === "23505" ? "Ese sabor ya está en la lista." : error.message,
    };
  }

  await touchProduct(productId);
  return { ok: true as const };
}

export async function deleteProductFlavor(productId: string, flavorId: string) {
  const user = await getAdminUser();
  if (!user) return { ok: false as const, error: "Sesión expirada." };

  const db = await getServerSupabase();
  if (!db) return { ok: false as const, error: "Sin conexión." };

  const { error } = await db.from("product_flavors").delete().eq("id", flavorId);
  if (error) return { ok: false as const, error: error.message };

  /* Se sobrar menos sabor do que o mínimo exigido, o produto ficaria
     impossível de comprar. Ajusta o limite junto. */
  const { count } = await db
    .from("product_flavors")
    .select("id", { count: "exact", head: true })
    .eq("product_id", productId);

  const remaining = count ?? 0;
  const { data: product } = await db
    .from("products")
    .select("min_flavors, max_flavors")
    .eq("id", productId)
    .maybeSingle();

  if (product && (product.max_flavors > remaining || product.min_flavors > remaining)) {
    await db
      .from("products")
      .update({
        max_flavors: Math.min(product.max_flavors, remaining),
        min_flavors: Math.min(product.min_flavors, remaining),
      })
      .eq("id", productId);
  }

  await touchProduct(productId);
  return { ok: true as const };
}

export async function setProductCategories(productId: string, categoryIds: string[]) {
  const user = await getAdminUser();
  if (!user) return { ok: false as const, error: "Sesión expirada." };

  const db = await getServerSupabase();
  if (!db) return { ok: false as const, error: "Sin conexión." };

  await db.from("product_categories").delete().eq("product_id", productId);

  if (categoryIds.length) {
    const { error } = await db
      .from("product_categories")
      .insert(categoryIds.map((category_id) => ({ product_id: productId, category_id })));
    if (error) return { ok: false as const, error: error.message };
  }

  await db.from("audit_log").insert({
    actor: user.id,
    action: "product.categories",
    entity: "products",
    entity_id: productId,
    changes: { count: categoryIds.length },
  });

  await touchProduct(productId);
  revalidatePath("/ocasiones", "layout");
  return { ok: true as const };
}
