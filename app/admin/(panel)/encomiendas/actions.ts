"use server";

import { revalidatePath } from "next/cache";
import { friendlyDbError, getOperator, runOp, shortStoreName, type ActionResult } from "@/lib/gestion/server";
import { addDays, limaToday } from "@/lib/gestion/dates";
import { isSerial } from "@/lib/gestion/qr";
import {
  DOC_TYPES,
  LIMITS,
  PAY_METHODS,
  checkPayments,
  isIsoDate,
  isTime,
  isUuid,
  round2,
  type CreateContractInput,
  type CustomerSummary,
  type DeliverableCake,
  type DocType,
  type PaymentInput,
} from "@/components/admin/encomiendas/shared";

/**
 * Ações da encomenda.
 *
 * Toda escrita de dinheiro e de torta vai por `runOp` (função do banco,
 * atômica). Aqui fica o que o banco não diz com clareza: formato de cada
 * campo, limites e a mensagem certa quando algo vem errado — tudo conferido
 * de novo no servidor, porque a ação é um POST que qualquer um pode montar.
 */

const EXPIRED = "Sesión expirada. Vuelve a entrar.";
const PHOTO_PATH = /^encomiendas\/[0-9a-f-]{36}\.(jpg|png|webp|avif|heic)$/;

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function money(value: unknown, max: number) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= max ? round2(value) : null;
}

function revalidateContract(id?: string) {
  revalidatePath("/admin/encomiendas");
  if (id) revalidatePath(`/admin/encomiendas/${id}`);
  /* A encomenda mexe na vitrine (reserva/libera), na fila do taller e nas
     vendas; quem estiver com essas telas abertas vê o efeito sem F5. */
  revalidatePath("/admin/tienda");
  revalidatePath("/admin/taller");
  revalidatePath("/admin/ventas");
  /* Torta vendida na entrega ou liberada no cancelamento muda a vitrine pública. */
  revalidatePath("/vitrina");
}

/* -------------------------------------------------------------------------- */
/*  Cliente                                                                   */
/* -------------------------------------------------------------------------- */

type CustomerRow = { id: string; name: string; phone: string | null; doc_type: string; doc_number: string | null };

function toSummary(c: CustomerRow): CustomerSummary {
  return { id: c.id, name: c.name, phone: c.phone, docType: c.doc_type, docNumber: c.doc_number };
}

/** Busca por nome, celular ou documento. Devolve no máximo 8. */
export async function searchCustomers(query: string): Promise<ActionResult<CustomerSummary[]>> {
  const op = await getOperator();
  if (!op) return { ok: false, error: EXPIRED };

  /* O filtro `or` do PostgREST usa vírgula, ponto e parêntese como sintaxe:
     deixar passar só letra, número, espaço, hífen e apóstrofo impede que a
     busca vire outro filtro. */
  const clean = text(query, 60).replace(/[^\p{L}\p{N}\s'-]/gu, " ").replace(/\s+/g, " ").trim();
  const digits = clean.replace(/\D/g, "");
  if (clean.length < 2) return { ok: true, data: [] };

  const filters = [`name.ilike.%${clean.replace(/ /g, "%")}%`];
  if (digits.length >= 3) {
    filters.push(`phone_norm.ilike.%${digits}%`, `doc_number.ilike.%${digits}%`);
  }

  const { data, error } = await op.db
    .from("customers")
    .select("id, name, phone, doc_type, doc_number")
    .or(filters.join(","))
    .order("last_purchase_at", { ascending: false, nullsFirst: false })
    .limit(8);

  if (error) return { ok: false, error: friendlyDbError(error) };
  return { ok: true, data: ((data ?? []) as CustomerRow[]).map(toSummary) };
}

/**
 * Cadastro rápido. O banco funde com o cliente que já existe (documento →
 * celular), então digitar de novo quem já comprou não duplica ninguém.
 */
export async function saveCustomer(input: {
  name: string;
  phone: string;
  docType: string;
  docNumber: string;
}): Promise<ActionResult<CustomerSummary>> {
  const op = await getOperator();
  if (!op) return { ok: false, error: EXPIRED };

  const name = text(input?.name, 120);
  const phone = text(input?.phone, 20);
  const docType = (DOC_TYPES as readonly string[]).includes(input?.docType) ? (input.docType as DocType) : "NONE";
  const docNumber = docType === "NONE" ? "" : text(input?.docNumber, 20).toUpperCase();
  const phoneDigits = phone.replace(/\D/g, "");

  if (name.length < 2) return { ok: false, error: "Escribe el nombre del cliente." };
  if (phoneDigits.length < 6 || phoneDigits.length > 15) return { ok: false, error: "Escribe un celular válido." };
  if (docType === "DNI" && !/^\d{8}$/.test(docNumber)) return { ok: false, error: "El DNI tiene 8 dígitos." };
  if (docType === "RUC" && !/^\d{11}$/.test(docNumber)) return { ok: false, error: "El RUC tiene 11 dígitos." };
  if ((docType === "CE" || docType === "PASSPORT") && !/^[A-Z0-9]{5,15}$/.test(docNumber)) {
    return { ok: false, error: "Número de documento inválido." };
  }

  const result = await runOp<string>("op_customer_upsert", {
    p_name: name,
    p_phone: phone,
    p_doc_type: docType,
    p_doc_number: docNumber || null,
    p_source: "store",
  });
  if (!result.ok) return result;
  if (!isUuid(result.data)) return { ok: false, error: "No se pudo registrar al cliente." };

  const { data } = await op.db
    .from("customers")
    .select("id, name, phone, doc_type, doc_number")
    .eq("id", result.data)
    .maybeSingle();
  if (!data) return { ok: false, error: "No se pudo registrar al cliente." };

  /* Sem revalidatePath: ele re-renderizaria o formulário inteiro (catálogo de
     produtos incluído) só para devolver um nome. A ficha de clientes é
     dinâmica e já lê o novo na próxima visita. */
  return { ok: true, data: toSummary(data as CustomerRow) };
}

/* -------------------------------------------------------------------------- */
/*  Nova encomenda                                                            */
/* -------------------------------------------------------------------------- */

export async function createContract(input: CreateContractInput): Promise<ActionResult<{ id: string; number: number }>> {
  const op = await getOperator();
  if (!op) return { ok: false, error: EXPIRED };

  if (!input || typeof input !== "object") return { ok: false, error: "Datos inválidos." };
  if (!isUuid(input.storeId)) return { ok: false, error: "Elige la tienda." };
  if (input.sellerId !== null && !isUuid(input.sellerId)) return { ok: false, error: "Vendedora inválida." };
  if (!isUuid(input.customerId)) return { ok: false, error: "Elige o registra al cliente." };

  const today = limaToday();
  if (!isIsoDate(input.deliverOn)) return { ok: false, error: "Fecha de entrega inválida." };
  if (input.deliverOn < today) return { ok: false, error: "La fecha de entrega no puede ser pasada." };
  /* "2062" digitado no lugar de "2026" viraria uma OP que o taller nunca vê. */
  if (input.deliverOn > addDays(today, 365)) return { ok: false, error: "La fecha de entrega está a más de un año. Revísala." };
  if (input.deliverAt !== null && !isTime(input.deliverAt)) return { ok: false, error: "Hora de entrega inválida." };

  const place = text(input.deliverPlace, LIMITS.place);
  if (place.length < 3) return { ok: false, error: "Indica el lugar de entrega." };
  const notes = text(input.notes, LIMITS.notes);

  if (!Array.isArray(input.lines) || input.lines.length === 0) {
    return { ok: false, error: "Agrega al menos un producto." };
  }
  if (input.lines.length > LIMITS.lines) return { ok: false, error: `Máximo ${LIMITS.lines} productos por encomienda.` };

  const lines: {
    product_id: string;
    quantity: number;
    unit_price: number;
    flavor_id: string | null;
    decorator_id: string | null;
    cake_type_id: string | null;
    cake_message: string | null;
    photo_url: string | null;
  }[] = [];
  for (const [i, l] of input.lines.entries()) {
    const n = i + 1;
    if (!l || !isUuid(l.productId)) return { ok: false, error: `Producto ${n}: elige el producto.` };
    if (!Number.isInteger(l.quantity) || l.quantity < 1 || l.quantity > LIMITS.quantity) {
      return { ok: false, error: `Producto ${n}: cantidad inválida.` };
    }
    const price = money(l.unitPrice, LIMITS.price);
    if (price === null) return { ok: false, error: `Producto ${n}: precio inválido.` };
    for (const [key, label] of [["flavorId", "sabor"], ["decoratorId", "decoradora"], ["cakeTypeId", "tipo de torta"]] as const) {
      if (l[key] !== null && !isUuid(l[key])) return { ok: false, error: `Producto ${n}: ${label} inválido.` };
    }
    if (l.photoPath !== null && (typeof l.photoPath !== "string" || !PHOTO_PATH.test(l.photoPath))) {
      return { ok: false, error: `Producto ${n}: foto inválida. Vuelve a subirla.` };
    }
    lines.push({
      product_id: l.productId,
      quantity: l.quantity,
      unit_price: price,
      flavor_id: l.flavorId,
      decorator_id: l.decoratorId,
      cake_type_id: l.cakeTypeId,
      cake_message: text(l.message, LIMITS.message) || null,
      photo_url: l.photoPath,
    });
  }

  const total = round2(lines.reduce((sum, l) => sum + l.quantity * l.unit_price, 0));

  let advance: { amount: number; method: string; reference: string | null } | null = null;
  if (input.advance) {
    const amount = money(input.advance.amount, LIMITS.price);
    if (amount === null) return { ok: false, error: "Monto de adelanto inválido." };
    if (amount > total) return { ok: false, error: "El adelanto supera el total de la encomienda." };
    if (amount > 0) {
      if (!(PAY_METHODS as readonly string[]).includes(input.advance.method)) {
        return { ok: false, error: "Elige la forma de pago del adelanto." };
      }
      advance = { amount, method: input.advance.method, reference: text(input.advance.reference, LIMITS.reference) || null };
    }
  }

  /* Referências conferidas antes: sem isto, um sabor apagado no meio do
     cadastro voltaria como "registro en uso", que não diz nada a ninguém. */
  const productIds = [...new Set(lines.map((l) => l.product_id))];
  const pick = (key: "flavor_id" | "decorator_id" | "cake_type_id") =>
    [...new Set(lines.map((l) => l[key]).filter((v): v is string => Boolean(v)))];
  const [flavorIds, decoratorIds, typeIds] = [pick("flavor_id"), pick("decorator_id"), pick("cake_type_id")];

  const [store, customer, seller, products, flavors, decorators, types] = await Promise.all([
    /* Só loja com prefixo de série recebe torta: noutra, a OP nasceria e o despacho nunca sairia. */
    op.db.from("stores").select("id").eq("id", input.storeId).eq("active", true).not("serial_prefix", "is", null).maybeSingle(),
    op.db.from("customers").select("id").eq("id", input.customerId).maybeSingle(),
    input.sellerId ? op.db.from("sellers").select("id").eq("id", input.sellerId).eq("active", true).maybeSingle() : null,
    op.db.from("products").select("id, product_families(is_service)").in("id", productIds),
    flavorIds.length ? op.db.from("flavors").select("id").in("id", flavorIds) : null,
    decoratorIds.length ? op.db.from("decorators").select("id").in("id", decoratorIds) : null,
    typeIds.length ? op.db.from("cake_types").select("id").in("id", typeIds) : null,
  ]);

  if (!store.data) return { ok: false, error: "Tienda no encontrada." };
  if (!customer.data) return { ok: false, error: "Cliente no encontrado. Búscalo de nuevo." };
  if (seller && !seller.data) return { ok: false, error: "La vendedora ya no está activa." };
  const productRows = (products.data ?? []) as unknown as { id: string; product_families: { is_service: boolean } | null }[];
  if (productRows.length !== productIds.length) return { ok: false, error: "Algún producto ya no existe." };
  /* Adelanto e saldo (ADL/REIN) o próprio banco lança; como linha, cobrariam duas vezes. */
  if (productRows.some((p) => p.product_families?.is_service)) {
    return { ok: false, error: "Adelanto y saldo no van como producto: se registran solos." };
  }
  if (flavors && (flavors.data ?? []).length !== flavorIds.length) return { ok: false, error: "Algún sabor ya no existe." };
  if (decorators && (decorators.data ?? []).length !== decoratorIds.length) return { ok: false, error: "Alguna decoradora ya no existe." };
  if (types && (types.data ?? []).length !== typeIds.length) return { ok: false, error: "Algún tipo de torta ya no existe." };

  const result = await runOp<{ id: string; number: number }>("op_contract_create", {
    p_store: input.storeId,
    p_deliver_on: input.deliverOn,
    p_lines: lines,
    p_customer: input.customerId,
    p_seller: input.sellerId,
    p_deliver_at: input.deliverAt,
    p_deliver_place: place,
    p_notes: notes || null,
    p_advance: advance,
  });
  if (!result.ok) return result;

  revalidateContract(result.data.id);
  revalidatePath("/admin/clientes");
  return { ok: true, data: { id: result.data.id, number: result.data.number } };
}

/* -------------------------------------------------------------------------- */
/*  Entrega                                                                   */
/* -------------------------------------------------------------------------- */

type CakeLookupRow = {
  serial: string;
  status: string;
  store_id: string;
  contract_id: string | null;
  expires_on: string;
  product_id: string;
  products: { name: string } | null;
  flavors: { name: string } | null;
  stores: { name: string } | null;
  contracts: { number: number } | null;
};

/**
 * Confere uma torta escaneada que não estava na lista da tela (chegou depois,
 * ou é de outro lugar) e diz o motivo exato quando não pode sair.
 */
export async function findDeliverableCake(contractId: string, serial: string): Promise<ActionResult<DeliverableCake>> {
  const op = await getOperator();
  if (!op) return { ok: false, error: EXPIRED };
  if (!isUuid(contractId)) return { ok: false, error: "Encomienda inválida." };
  const code = text(serial, 20).toUpperCase();
  if (!isSerial(code)) return { ok: false, error: "Serie inválida." };

  const [{ data: contract, error: contractError }, { data: cake, error: cakeError }] = await Promise.all([
    op.db.from("contracts").select("id, store_id, status").eq("id", contractId).maybeSingle(),
    op.db
      .from("cake_units")
      .select("serial, status, store_id, contract_id, expires_on, product_id, products(name), flavors(name), stores(name), contracts(number)")
      .eq("serial", code)
      .eq("source", "native")
      .maybeSingle(),
  ]);

  /* Falha de leitura não pode virar "a torta não existe": a vendedora iria atrás da torta errada. */
  const readError = contractError ?? cakeError;
  if (readError) return { ok: false, error: friendlyDbError(readError) };
  if (!contract) return { ok: false, error: "Encomienda no encontrada." };
  if (contract.status === "delivered" || contract.status === "cancelled") {
    return { ok: false, error: "La encomienda ya fue entregada o cancelada." };
  }
  if (!cake) return { ok: false, error: `La torta ${code} no existe en el sistema.` };

  const u = cake as unknown as CakeLookupRow;
  const today = limaToday();
  if (u.store_id !== contract.store_id) {
    return { ok: false, error: `La torta ${code} es de otra tienda (${shortStoreName(u.stores?.name)}).` };
  }

  const mine = u.status === "reserved" && u.contract_id === contractId;
  if (!mine) {
    const why: Record<string, string> = {
      reserved: `está reservada para la encomienda #${u.contracts?.number ?? "?"}`,
      in_transit: "está en camino: recíbela primero en Recepción",
      missing: "figura como faltante: acláralo primero",
      sold: "ya fue vendida",
      returned: "fue devuelta al taller",
      discarded: "fue descartada",
    };
    if (u.status !== "in_stock") return { ok: false, error: `La torta ${code} ${why[u.status] ?? "no está disponible"}.` };
    if (u.expires_on < today) return { ok: false, error: `La torta ${code} está vencida. No se entrega.` };
  }

  return {
    ok: true,
    data: {
      serial: u.serial,
      productId: u.product_id,
      product: u.products?.name ?? "Torta",
      flavor: u.flavors?.name ?? null,
      expiresOn: u.expires_on,
      reserved: mine,
    },
  };
}

export async function deliverContract(input: {
  contractId: string;
  serials: string[];
  payments: PaymentInput[];
  notes: string;
  confirmWithoutCake: boolean;
  /** Saldo que a vendedora viu na tela. Se mudou, o vuelto que ela contou está errado. */
  expectedBalance: number;
}): Promise<ActionResult<{ cakes: number; balance: number }>> {
  const op = await getOperator();
  if (!op) return { ok: false, error: EXPIRED };
  if (!input || !isUuid(input.contractId)) return { ok: false, error: "Encomienda inválida." };

  if (!Array.isArray(input.serials) || input.serials.length > LIMITS.serials) {
    return { ok: false, error: "Lista de tortas inválida." };
  }
  const serials = [...new Set(input.serials.map((s) => text(s, 20).toUpperCase()))];
  if (serials.some((s) => !isSerial(s))) return { ok: false, error: "Alguna serie es inválida." };

  /* Entrega sem torta é exatamente o furo antigo (a venda sai e ninguém sabe
     qual torta foi). Permitido, mas só com confirmação explícita. */
  if (serials.length === 0 && input.confirmWithoutCake !== true) {
    return { ok: false, error: "Selecciona la torta entregada o confirma la entrega sin torta." };
  }

  if (!Array.isArray(input.payments) || input.payments.length > LIMITS.payments) {
    return { ok: false, error: "Pagos inválidos." };
  }
  const payments = [];
  for (const p of input.payments) {
    const amount = money(p?.amount, LIMITS.price);
    if (!(PAY_METHODS as readonly string[]).includes(p?.method)) return { ok: false, error: "Forma de pago inválida." };
    if (amount === null || amount <= 0) return { ok: false, error: "Monto de pago inválido." };
    payments.push({ method: p.method, amount, reference: text(p.reference, LIMITS.reference) || null });
  }

  /* Saldo relido do banco, não o que a tela mandou: outra vendedora pode ter
     cobrado algo no meio. */
  const [{ data: contract, error: contractError }, { data: sales, error: salesError }] = await Promise.all([
    op.db.from("contracts").select("id, status, total").eq("id", input.contractId).maybeSingle(),
    op.db.from("sales").select("total").eq("contract_id", input.contractId).eq("status", "paid"),
  ]);
  const readError = contractError ?? salesError;
  if (readError) return { ok: false, error: friendlyDbError(readError) };
  if (!contract) return { ok: false, error: "Encomienda no encontrada." };
  if (contract.status === "delivered" || contract.status === "cancelled") {
    revalidateContract(input.contractId);
    return { ok: false, error: "La encomienda ya fue entregada o cancelada." };
  }
  const paid = (sales ?? []).reduce((sum, s) => sum + Number(s.total), 0);
  const balance = Math.max(0, round2(Number(contract.total) - paid));

  const seen = money(input.expectedBalance, LIMITS.price * LIMITS.lines);
  if (seen === null || Math.round(seen * 100) !== Math.round(balance * 100)) {
    /* A tela volta do servidor com o saldo novo junto com este aviso. */
    revalidateContract(input.contractId);
    return { ok: false, error: `El saldo cambió: ahora es S/ ${balance.toFixed(2)}. Revisa el cobro y confirma de nuevo.` };
  }

  if (balance > 0) {
    const check = checkPayments(balance, payments);
    if (!check.ok) return { ok: false, error: check.error };
  }

  const result = await runOp<{ cakes: number; balance: number }>("op_contract_deliver", {
    p_contract: input.contractId,
    p_serials: serials,
    /* Saldo zero: o banco não registra venda, e pagamento sobrando só
       confundiria o caixa. */
    p_payments: balance > 0 ? payments : [],
    p_notes: text(input.notes, LIMITS.notes) || null,
  });
  if (!result.ok) return result;


  revalidateContract(input.contractId);
  return { ok: true, data: { cakes: Number(result.data.cakes), balance: Number(result.data.balance) } };
}

/* -------------------------------------------------------------------------- */
/*  Cancelamento                                                              */
/* -------------------------------------------------------------------------- */

export async function cancelContract(contractId: string, reason: string): Promise<ActionResult> {
  const op = await getOperator();
  if (!op) return { ok: false, error: EXPIRED };
  if (!isUuid(contractId)) return { ok: false, error: "Encomienda inválida." };

  const why = text(reason, LIMITS.reason);
  if (why.length < 3) return { ok: false, error: "Escribe el motivo de la cancelación." };

  /* `op_contract_cancel` libera só a reservada. A que está em trânsito chega
     depois como "reservada" de uma encomenda cancelada e fica presa fora da
     vitrine. Recebida antes, o cancelamento a devolve à vitrine. */
  const { count: inTransit, error: transitError } = await op.db
    .from("cake_units")
    .select("id", { count: "exact", head: true })
    .eq("contract_id", contractId)
    .eq("status", "in_transit");
  if (transitError) return { ok: false, error: friendlyDbError(transitError) };
  if (inTransit) {
    return {
      ok: false,
      error: `${inTransit === 1 ? "Hay una torta" : `Hay ${inTransit} tortas`} de esta encomienda en camino. Recíbelas primero en Recepción y luego cancela: así vuelven a la vitrina.`,
    };
  }

  const result = await runOp("op_contract_cancel", { p_contract: contractId, p_reason: why });
  if (!result.ok) return result;


  revalidateContract(contractId);
  return { ok: true, data: undefined };
}
