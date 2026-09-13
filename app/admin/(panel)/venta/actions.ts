"use server";

import { revalidatePath } from "next/cache";
import { friendlyDbError, getOperator, runOp, shortStoreName, type ActionResult } from "@/lib/gestion/server";
import { limaToday } from "@/lib/gestion/dates";
import { suggestedPrice } from "@/lib/gestion/pricing";
import { isSerial, parseQr } from "@/lib/gestion/qr";
import {
  MAX_CENTS,
  MAX_QUANTITY,
  isCounterMethod,
  lineTotal,
  settle,
  solesToCents,
  type CounterMethod,
} from "@/components/admin/venta/money";
import { daysBetween } from "@/components/admin/venta/format";
import type {
  CakeLookup,
  CustomerRef,
  ProductHit,
  RegisterSaleInput,
  SaleReceipt,
} from "@/components/admin/venta/types";

/**
 * Ações do balcão.
 *
 * A tela confere tudo enquanto a vendedora digita, mas quem decide é aqui:
 * uma ação do servidor é um POST que qualquer um com sessão pode montar à
 * mão. Cada entrada é revalidada, e o dinheiro e o estoque só mudam dentro
 * do `op_sale_register`, que é atômico.
 */

const SESSION_EXPIRED = "Sesión expirada. Vuelve a entrar.";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

function isCents(value: unknown, min = 0): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= MAX_CENTS;
}

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

/**
 * Texto de busca seguro para o filtro `or` do PostgREST: vírgula e parêntese
 * quebrariam a expressão, e `%` deixaria a vendedora buscar "tudo". Espaços
 * viram curinga — "torta fresa" acha "TORTA PASIÓN DE FRESA".
 *
 * Letra acentuada vira `_` (qualquer caractere): o cadastro do Sisgeco é
 * "PASION" sem acento, o do site é "Pasión", e `ilike` não ignora acento.
 */
function searchPattern(raw: unknown, max = 40) {
  if (typeof raw !== "string") return null;
  const words = raw
    .normalize("NFC")
    .slice(0, max)
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/[áéíóúüñ]/gi, "_")
    .trim()
    .split(" ")
    .filter(Boolean);
  return words.length ? `%${words.join("%")}%` : null;
}

/* -------------------------------------------------------------------------- */
/*  Torta pelo QR                                                             */
/* -------------------------------------------------------------------------- */

const UNAVAILABLE: Record<string, (serial: string) => string> = {
  in_transit: (s) => `La torta ${s} todavía está en camino. Confírmala en Recepción antes de venderla.`,
  reserved: (s) => `La torta ${s} está reservada para una encomienda. Se entrega desde Encomiendas.`,
  sold: (s) => `La torta ${s} ya fue vendida.`,
  missing: (s) => `La torta ${s} figura como faltante. Avisa al taller antes de venderla.`,
  returned: (s) => `La torta ${s} fue devuelta al taller.`,
  discarded: (s) => `La torta ${s} fue descartada.`,
};

type CakeRow = {
  serial: string;
  status: string;
  source: string;
  store_id: string;
  expires_on: string;
  product_id: string;
  products: { name: string; sku: string | null; status: string | null; base_price: number | string | null } | null;
  flavors: { name: string } | null;
  stores: { name: string } | null;
};

/** Confere uma torta escaneada: existe, é desta loja e está na vitrine. */
export async function lookupCake(storeId: string, raw: string): Promise<ActionResult<CakeLookup>> {
  const op = await getOperator();
  if (!op) return fail(SESSION_EXPIRED);
  if (!isUuid(storeId)) return fail("Elige la tienda antes de escanear.");

  const parsed = typeof raw === "string" ? parseQr(raw) : null;
  if (!parsed) return fail("Serie inválida.");
  if (parsed.type === "dispatch") return fail("Ese QR es la guía del despacho. Escanea la etiqueta de la torta.");
  const serial = parsed.serial;

  const { data, error } = await op.db
    .from("cake_units")
    .select("serial, status, source, store_id, expires_on, product_id, products(name, sku, status, base_price), flavors(name), stores(name)")
    .eq("serial", serial)
    .maybeSingle();
  if (error) return fail(friendlyDbError(error));
  if (!data) return fail(`No encontramos la torta ${serial}.`);

  const cake = data as unknown as CakeRow;
  /* A série do Sisgeco e a nova usam o mesmo formato; a antiga ainda vende
     pelo sistema da loja, e vender aqui daria baixa duas vezes. */
  if (cake.source !== "native") return fail(`La torta ${serial} es del Sisgeco. Véndela en el sistema de la tienda.`);
  if (cake.store_id !== storeId) {
    return fail(`La torta ${serial} es de ${shortStoreName(cake.stores?.name)}, no de esta tienda.`);
  }
  if (cake.status !== "in_stock") {
    return fail(UNAVAILABLE[cake.status]?.(serial) ?? `La torta ${serial} no está disponible.`);
  }

  const daysExpired = daysBetween(cake.expires_on, limaToday());
  const price = suggestedPrice(cake.products);
  return {
    ok: true,
    data: {
      serial,
      productId: cake.product_id,
      name: cake.products?.name ?? "Torta",
      sku: cake.products?.sku ?? null,
      flavor: cake.flavors?.name ?? null,
      expiresOn: cake.expires_on,
      expired: daysExpired > 0,
      daysExpired,
      suggestedCents: price === null ? null : solesToCents(price),
    },
  };
}

/* -------------------------------------------------------------------------- */
/*  Produtos sem série                                                        */
/* -------------------------------------------------------------------------- */

type ProductRow = {
  id: string;
  name: string;
  sku: string | null;
  status: string | null;
  base_price: number | string | null;
  product_families: { code: string; name: string } | null;
};

/**
 * Busca por nome ou código entre o que se vende por quantidade.
 *
 * Só famílias sem série e que não são serviço: torta sai pela etiqueta (é o
 * furo do Sisgeco que motivou tudo isto), e adiantamento/saldo de encomenda
 * nascem na tela de Encomiendas, ligados ao contrato.
 */
export async function searchProducts(query: string): Promise<ActionResult<ProductHit[]>> {
  const op = await getOperator();
  if (!op) return fail(SESSION_EXPIRED);

  const pattern = searchPattern(query);
  if (!pattern) return { ok: true, data: [] };

  const { data, error } = await op.db
    .from("products")
    .select("id, name, sku, status, base_price, product_families!inner(code, name, tracks_serial, is_service)")
    .eq("product_families.tracks_serial", false)
    .eq("product_families.is_service", false)
    .eq("sold_at_counter", true)
    .or(`name.ilike.${pattern},sku.ilike.${pattern}`)
    .order("name")
    .limit(30);
  if (error) return fail(friendlyDbError(error));

  /* Quem digita o código exato ("E3") quer aquele produto em primeiro. */
  const typed = String(query).slice(0, 40).trim().toUpperCase();
  const rank = (p: ProductRow) =>
    p.sku?.toUpperCase() === typed ? 0 : p.name.toUpperCase().startsWith(typed) ? 1 : 2;

  const rows = ((data ?? []) as unknown as ProductRow[]).sort((a, b) => rank(a) - rank(b)).slice(0, 12);
  return {
    ok: true,
    data: rows.map((p) => ({
      id: p.id,
      name: p.name,
      sku: p.sku,
      family: p.product_families?.name ?? "",
      suggestedCents: (() => {
        const price = suggestedPrice(p);
        return price === null ? null : solesToCents(price);
      })(),
    })),
  };
}

/* -------------------------------------------------------------------------- */
/*  Cliente                                                                   */
/* -------------------------------------------------------------------------- */

type CustomerRow = { id: string; name: string; phone: string | null; doc_type: string; doc_number: string | null };

function toCustomerRef(row: CustomerRow): CustomerRef {
  return { id: row.id, name: row.name, phone: row.phone, docType: row.doc_type, docNumber: row.doc_number };
}

/** Por nome, celular ou documento. Oito resultados bastam no balcão. */
export async function searchCustomers(query: string): Promise<ActionResult<CustomerRef[]>> {
  const op = await getOperator();
  if (!op) return fail(SESSION_EXPIRED);

  /* Uma letra só traria meio cadastro. */
  const pattern = searchPattern(query, 60);
  if (!pattern) return { ok: true, data: [] };
  /* Mesmo corte do padrão: um POST montado à mão com um texto enorme viraria
     uma URL que o PostgREST recusa. */
  const text = String(query).slice(0, 60);
  if (text.replace(/[^\p{L}\p{N}]/gu, "").length < 2) return { ok: true, data: [] };

  const filters = [`name.ilike.${pattern}`];
  const digits = text.replace(/\D/g, "");
  if (digits.length >= 3) {
    /* O celular é comparado normalizado (sem +51 nem espaços), como o CRM grava. */
    filters.push(`phone_norm.ilike.%${digits.replace(/^51(?=\d{9}$)/, "")}%`, `doc_number.ilike.%${digits}%`);
  }

  const { data, error } = await op.db
    .from("customers")
    .select("id, name, phone, doc_type, doc_number")
    .or(filters.join(","))
    .order("last_purchase_at", { ascending: false, nullsFirst: false })
    .limit(8);
  if (error) return fail(friendlyDbError(error));
  return { ok: true, data: ((data ?? []) as CustomerRow[]).map(toCustomerRef) };
}

/**
 * Cadastro rápido no balcão. Passa pelo `op_customer_upsert`, que funde com
 * quem já existe pelo documento ou celular — a cliente que comprou pelo site
 * não vira uma segunda ficha só porque agora veio à loja.
 */
export async function createCustomer(input: { name: string; phone: string; doc: string }): Promise<ActionResult<CustomerRef>> {
  const op = await getOperator();
  if (!op) return fail(SESSION_EXPIRED);
  if (!input || typeof input !== "object") return fail("Datos inválidos.");

  const name = typeof input.name === "string" ? input.name.replace(/\s+/g, " ").trim() : "";
  if (name.length < 2 || name.length > 120) return fail("Escribe el nombre del cliente.");

  const phoneRaw = typeof input.phone === "string" ? input.phone.trim() : "";
  const phoneDigits = phoneRaw.replace(/\D/g, "");
  if (phoneRaw && (phoneDigits.length < 6 || phoneDigits.length > 15)) return fail("Celular inválido.");

  const doc = typeof input.doc === "string" ? input.doc.replace(/\D/g, "") : "";
  let docType: "NONE" | "DNI" | "RUC" = "NONE";
  if (doc) {
    if (doc.length === 8) docType = "DNI";
    else if (doc.length === 11 && /^(10|15|17|20)/.test(doc)) docType = "RUC";
    else return fail("El DNI tiene 8 dígitos y el RUC 11 (empieza con 10 o 20).");
  }

  const result = await runOp<string>("op_customer_upsert", {
    p_name: name,
    p_phone: phoneDigits || null,
    p_email: null,
    p_doc_type: docType,
    p_doc_number: docType === "NONE" ? null : doc,
    p_source: "counter",
  });
  if (!result.ok) return result;
  if (!isUuid(result.data)) return fail("No se pudo registrar el cliente.");

  /* Pode ter fundido com uma ficha antiga: mostra o nome que ficou gravado. */
  const { data } = await op.db
    .from("customers")
    .select("id, name, phone, doc_type, doc_number")
    .eq("id", result.data)
    .maybeSingle();

  revalidatePath("/admin/clientes");
  return {
    ok: true,
    data: data
      ? toCustomerRef(data as CustomerRow)
      : { id: result.data, name, phone: phoneDigits || null, docType, docNumber: docType === "NONE" ? null : doc },
  };
}

/* -------------------------------------------------------------------------- */
/*  Cobrar                                                                    */
/* -------------------------------------------------------------------------- */

type OpSaleResult = { id: string; number: number | string; total: number | string; paid: number | string; change: number | string };

type PreparedSale = {
  storeId: string;
  kind: "counter" | "staff";
  sellerId: string | null;
  customerId: string | null;
  userNotes: string;
  pLines: Record<string, unknown>[];
  pPayments: { method: CounterMethod; amount: number; reference: string | null }[];
  totalCents: number;
  paidCents: number;
  serials: Set<string>;
  expiredAccepted: Set<string>;
  /** Linhas como o banco as grava, para reconhecer esta venda depois. */
  signature: string;
};

/**
 * Confere a venda sem tocar no banco: formatos, contas e as regras de
 * pagamento. Serve ao cobrar e ao procurar uma cobrança que ficou sem
 * resposta — as duas precisam enxergar a mesma venda.
 */
function prepareSale(input: RegisterSaleInput): ActionResult<PreparedSale> {
  if (!input || typeof input !== "object") return fail("Datos inválidos.");

  if (!isUuid(input.storeId)) return fail("Elige la tienda.");
  const kind = input.kind === "staff" ? "staff" : input.kind === "counter" ? "counter" : null;
  if (!kind) return fail("Tipo de venta inválido.");

  const sellerId = input.sellerId === null || input.sellerId === "" ? null : input.sellerId;
  if (sellerId !== null && !isUuid(sellerId)) return fail("Vendedora inválida.");
  /* Venda ao pessoal sem nome é consumo sem responsável — o relatório de
     "comprada pelo personal" existe justamente para saber quem. */
  if (kind === "staff" && !sellerId) return fail("En la venta al personal elige la vendedora.");

  const customerId = input.customerId === null || input.customerId === "" ? null : input.customerId;
  if (customerId !== null && !isUuid(customerId)) return fail("Cliente inválido.");

  const userNotes = typeof input.notes === "string" ? input.notes.trim() : "";
  if (userNotes.length > 300) return fail("La nota es muy larga (máximo 300 caracteres).");

  /* Linhas */
  if (!Array.isArray(input.lines) || input.lines.length === 0) return fail("El carrito está vacío.");
  if (input.lines.length > 80) return fail("Demasiados productos en una sola venta.");

  const serials = new Set<string>();
  const expiredAccepted = new Set<string>();
  const pLines: Record<string, unknown>[] = [];
  const signature: string[] = [];
  let totalCents = 0;

  for (const line of input.lines) {
    if (!line || typeof line !== "object") return fail("Producto inválido.");
    if (!isCents(line.priceCents)) return fail("Hay un precio inválido.");
    if (!isCents(line.discountCents)) return fail("Hay un descuento inválido.");

    if (line.kind === "cake") {
      const serial = typeof line.serial === "string" ? line.serial.trim().toUpperCase() : "";
      if (!isSerial(serial)) return fail("Hay una serie de torta inválida.");
      if (serials.has(serial)) return fail(`La torta ${serial} está dos veces en el carrito.`);
      serials.add(serial);
      if (line.expiredAccepted === true) expiredAccepted.add(serial);

      const total = lineTotal(1, line.priceCents, line.discountCents);
      if (total === null) return fail(`El descuento de la torta ${serial} supera el precio.`);
      totalCents += total;
      signature.push(cakeSignature(serial, total));
      pLines.push({ cake_serial: serial, unit_price: line.priceCents / 100, discount: line.discountCents / 100 });
    } else if (line.kind === "item") {
      if (!isUuid(line.productId)) return fail("Producto inválido.");
      const qty = line.quantity;
      if (typeof qty !== "number" || !Number.isInteger(qty) || qty < 1 || qty > MAX_QUANTITY) {
        return fail("Hay una cantidad inválida.");
      }
      const total = lineTotal(qty, line.priceCents, line.discountCents);
      if (total === null) return fail("Hay un descuento que supera el precio.");
      totalCents += total;
      signature.push(itemSignature(line.productId, qty, total));
      pLines.push({
        product_id: line.productId,
        quantity: qty,
        unit_price: line.priceCents / 100,
        discount: line.discountCents / 100,
      });
    } else {
      return fail("Producto inválido.");
    }
  }
  if (totalCents > MAX_CENTS) return fail("El total de la venta es demasiado alto. Revisa los precios.");

  /* Pagamentos */
  if (!Array.isArray(input.payments) || input.payments.length > 6) return fail("Formas de pago inválidas.");
  const pPayments: PreparedSale["pPayments"] = [];
  for (const payment of input.payments) {
    if (!payment || typeof payment !== "object" || !isCounterMethod(payment.method)) return fail("Forma de pago inválida.");
    if (!isCents(payment.amountCents, 1)) return fail("Hay un monto de pago inválido.");
    const reference = typeof payment.reference === "string" ? payment.reference.trim().slice(0, 60) : "";
    pPayments.push({ method: payment.method, amount: payment.amountCents / 100, reference: payment.method === "cash" ? null : reference || null });
  }
  if (input.payments.filter((p) => p.method === "cash").length > 1) return fail("Registra el efectivo en un solo pago.");

  const settlement = settle(
    totalCents,
    input.payments.map((p) => ({ method: p.method, cents: p.amountCents })),
  );
  if (settlement.error) return fail(settlement.error);

  return {
    ok: true,
    data: {
      storeId: input.storeId,
      kind,
      sellerId,
      customerId,
      userNotes,
      pLines,
      pPayments,
      totalCents,
      paidCents: settlement.paid,
      serials,
      expiredAccepted,
      signature: signature.sort().join("|"),
    },
  };
}

function cakeSignature(serial: string, totalCents: number) {
  return `c:${serial}:${totalCents}`;
}

function itemSignature(productId: string, quantity: number, totalCents: number) {
  return `p:${productId.toLowerCase()}:${quantity}:${totalCents}`;
}

export async function registerSale(input: RegisterSaleInput): Promise<ActionResult<SaleReceipt>> {
  const op = await getOperator();
  if (!op) return fail(SESSION_EXPIRED);

  const prepared = prepareSale(input);
  if (!prepared.ok) return prepared;
  const sale = prepared.data;

  /* Vendedora e cliente: conferidos antes, para o erro dizer o que houve em
     vez de "el registro está en uso". */
  if (sale.sellerId) {
    const { data: seller } = await op.db.from("sellers").select("id, store_id, active").eq("id", sale.sellerId).maybeSingle();
    if (!seller || !seller.active) return fail("La vendedora no está activa.");
    if (seller.store_id && seller.store_id !== sale.storeId) return fail("La vendedora no es de esta tienda.");
  }
  let customerName: string | null = null;
  if (sale.customerId) {
    const { data: customer } = await op.db.from("customers").select("id, name").eq("id", sale.customerId).maybeSingle();
    if (!customer) return fail("El cliente ya no existe. Quítalo y vuelve a buscar.");
    customerName = customer.name;
  }

  /* Torta vencida só sai com a confirmação explícita da vendedora — e fica
     escrito na venda, para o relatório de sobras não mentir. */
  const expiredSold: string[] = [];
  if (sale.serials.size) {
    const { data: cakes, error } = await op.db
      .from("cake_units")
      .select("serial, expires_on")
      .in("serial", [...sale.serials]);
    if (error) return fail(friendlyDbError(error));
    const today = limaToday();
    for (const cake of (cakes ?? []) as { serial: string; expires_on: string }[]) {
      if (cake.expires_on < today) {
        if (!sale.expiredAccepted.has(cake.serial)) {
          return fail(`La torta ${cake.serial} está vencida. Quítala y vuelve a escanearla para confirmar.`);
        }
        expiredSold.push(cake.serial);
      }
    }
  }

  const notes = [sale.userNotes, expiredSold.length ? `Vendida vencida (confirmado): ${expiredSold.join(", ")}` : ""]
    .filter(Boolean)
    .join(" · ");

  const result = await runOp<OpSaleResult>("op_sale_register", {
    p_store: sale.storeId,
    p_lines: sale.pLines,
    p_payments: sale.pPayments,
    p_seller: sale.sellerId,
    p_customer: sale.customerId,
    p_kind: sale.kind,
    p_notes: notes || null,
  });
  if (!result.ok) return result;

  const changeCents = solesToCents(result.data.change);

  /* O banco desconta o vuelto do pagamento em dinheiro; o recibo mostra o
     mesmo que ficou gravado. */
  let changeLeft = changeCents;
  const payments = input.payments.map((p) => {
    if (p.method === "cash" && changeLeft > 0) {
      const amountCents = p.amountCents - changeLeft;
      changeLeft = 0;
      return { method: p.method, amountCents };
    }
    return { method: p.method, amountCents: p.amountCents };
  });

  revalidateAfterSale(sale.serials.size > 0);

  return {
    ok: true,
    data: {
      id: result.data.id,
      number: Number(result.data.number),
      totalCents: solesToCents(result.data.total),
      changeCents,
      kind: sale.kind,
      customerName,
      payments,
    },
  };
}

function revalidateAfterSale(hasCakes: boolean) {
  revalidatePath("/admin/ventas");
  if (hasCakes) {
    revalidatePath("/admin/tienda");
    revalidatePath("/vitrina");
  }
}

/** Janela em que uma cobrança sem resposta ainda é "a mesma venda". */
const RECOVERY_WINDOW_MS = 30 * 60_000;

type RecentSaleRow = {
  id: string;
  number: number | string;
  total: number | string;
  customers: { name: string } | null;
  sale_lines: { product_id: string | null; quantity: number | string; total: number | string; cake_units: { serial: string } | null }[];
  sale_payments: { method: string; amount: number | string }[];
};

/**
 * A cobrança anterior ficou sem resposta (rede caiu, aba recarregou): a venda
 * pode ter sido gravada ou não. O `op_sale_register` não tem chave de
 * idempotência, e cobrar de novo um carrinho só de empanadas duplicaria a
 * venda e a baixa de estoque. Antes de repetir, procura uma venda paga desta
 * sessão, nesta loja, nos últimos minutos, com exatamente as mesmas linhas,
 * cliente, vendedora e total. Achou: é ela, e a tela mostra o recibo em vez
 * de cobrar outra vez.
 */
export async function findRecentSale(input: RegisterSaleInput): Promise<ActionResult<SaleReceipt | null>> {
  const op = await getOperator();
  if (!op) return fail(SESSION_EXPIRED);

  /* Carrinho inválido não pode ter sido gravado; o cobrar mostra o erro. */
  const prepared = prepareSale(input);
  if (!prepared.ok) return { ok: true, data: null };
  const sale = prepared.data;

  let query = op.db
    .from("sales")
    .select(
      "id, number, total, customers(name), sale_lines(product_id, quantity, total, cake_units(serial)), sale_payments(method, amount)",
    )
    .eq("store_id", sale.storeId)
    .eq("created_by", op.user.id)
    .eq("status", "paid")
    .eq("kind", sale.kind)
    .gte("sold_at", new Date(Date.now() - RECOVERY_WINDOW_MS).toISOString())
    .order("sold_at", { ascending: false })
    .limit(10);
  query = sale.sellerId ? query.eq("seller_id", sale.sellerId) : query.is("seller_id", null);
  query = sale.customerId ? query.eq("customer_id", sale.customerId) : query.is("customer_id", null);

  const { data, error } = await query;
  if (error) return fail(friendlyDbError(error));

  const match = ((data ?? []) as unknown as RecentSaleRow[]).find((row) => {
    if (solesToCents(row.total) !== sale.totalCents) return false;
    const lines = (row.sale_lines ?? []).map((l) =>
      l.cake_units?.serial
        ? cakeSignature(l.cake_units.serial, solesToCents(l.total))
        : itemSignature(l.product_id ?? "", Number(l.quantity), solesToCents(l.total)),
    );
    return lines.sort().join("|") === sale.signature;
  });
  if (!match) return { ok: true, data: null };

  revalidateAfterSale(sale.serials.size > 0);

  return {
    ok: true,
    data: {
      id: match.id,
      number: Number(match.number),
      totalCents: solesToCents(match.total),
      /* O banco não guarda o vuelto (desconta do efectivo); é o que a
         vendedora digitou a mais nesta mesma cobrança. */
      changeCents: Math.max(0, sale.paidCents - sale.totalCents),
      kind: sale.kind,
      customerName: match.customers?.name ?? null,
      payments: (match.sale_payments ?? [])
        .filter((p): p is { method: CounterMethod; amount: number | string } => isCounterMethod(p.method))
        .map((p) => ({ method: p.method, amountCents: solesToCents(p.amount) })),
      recovered: true,
    },
  };
}
