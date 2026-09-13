"use server";

import { randomInt } from "node:crypto";
import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { friendlyDbError, getOperator, listStores, type ActionResult } from "@/lib/gestion/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import {
  SELLER_NAME_MAX,
  SHELF_LIFE_MAX,
  SIMPLE_CATALOGS,
  UUID_PATTERN,
  codeError,
  emailError,
  isSellerRole,
  isSimpleCatalogKind,
  nameError,
  normalizeCode,
  phoneError,
  type SellerInput,
} from "@/components/admin/catalogos/config";

/**
 * Cadastros de apoio da operação: sabores, tipos de torta, decoradoras,
 * vendedoras e validade por família.
 *
 * Nada aqui mexe em estoque ou dinheiro, então não passa por `runOp`: é
 * escrita simples com o cliente da sessão, e o RLS continua valendo. A
 * exceção é o acesso ao painel — criar conta no Auth e a linha em `admins`
 * só a chave de serviço faz, e só o dono pode pedir.
 *
 * Nunca se apaga item de catálogo: a torta vendida ontem aponta para o sabor
 * e a decoradora. Desativar tira das listas e mantém o histórico legível.
 */

const PATH = "/admin/catalogos";
const EXPIRED = "Sesión expirada. Vuelve a entrar.";

type Db = SupabaseClient;

/* A trilha não pode derrubar a ação que já aconteceu: falha vai para o log. */
async function audit(db: Db, actor: string, action: string, entity: string, entityId: string, changes: Record<string, unknown>) {
  const { error } = await db.from("audit_log").insert({ actor, action, entity, entity_id: entityId, changes });
  if (error) console.error("[auditoria]", action, error.code, error.message);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

/* -------------------------------------------------------------------------- */
/*  Sabores, tipos de torta e decoradoras                                     */
/* -------------------------------------------------------------------------- */

export async function createCatalogItem(kind: string, input: { code: string; name: string }): Promise<ActionResult> {
  const op = await getOperator();
  if (!op) return { ok: false, error: EXPIRED };
  if (!isSimpleCatalogKind(kind)) return { ok: false, error: "Catálogo inválido." };
  const config = SIMPLE_CATALOGS[kind];

  const code = normalizeCode(text(input?.code));
  const name = text(input?.name);
  const invalid = codeError(code) ?? nameError(name);
  if (invalid) return { ok: false, error: invalid };

  const row: Record<string, unknown> = { code, name, active: true };
  if (config.sortable) {
    /* Entra no fim da lista: quem cadastra um sabor novo não espera vê-lo
       passar na frente dos que o taller usa todo dia. */
    const { data: last } = await op.db
      .from(config.table)
      .select("sort_order")
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    row.sort_order = ((last?.sort_order as number | undefined) ?? 0) + 1;
  }

  const { data, error } = await op.db.from(config.table).insert(row).select("id").single();
  if (error) {
    if (error.code === "23505") return { ok: false, error: `Ya existe ${config.article === "la" ? "una" : "un"} ${config.singular} con el código ${code}.` };
    return { ok: false, error: friendlyDbError(error) };
  }

  await audit(op.db, op.user.id, `catalog.${config.table}.create`, config.table, data.id, { code, name });
  revalidatePath(PATH);
  return { ok: true, data: undefined };
}

export async function updateCatalogItem(kind: string, id: string, input: { code: string; name: string }): Promise<ActionResult> {
  const op = await getOperator();
  if (!op) return { ok: false, error: EXPIRED };
  if (!isSimpleCatalogKind(kind) || !isUuid(id)) return { ok: false, error: "Registro inválido." };
  const config = SIMPLE_CATALOGS[kind];

  const code = normalizeCode(text(input?.code));
  const name = text(input?.name);
  const invalid = codeError(code) ?? nameError(name);
  if (invalid) return { ok: false, error: invalid };

  const { data: before } = await op.db.from(config.table).select("code, name").eq("id", id).maybeSingle();
  if (!before) return { ok: false, error: "No se encontró el registro." };
  if (before.code === code && before.name === name) return { ok: true, data: undefined };

  const { error } = await op.db.from(config.table).update({ code, name }).eq("id", id);
  if (error) {
    if (error.code === "23505") return { ok: false, error: `El código ${code} ya está en uso.` };
    return { ok: false, error: friendlyDbError(error) };
  }

  await audit(op.db, op.user.id, `catalog.${config.table}.update`, config.table, id, { before, after: { code, name } });
  revalidatePath(PATH);
  return { ok: true, data: undefined };
}

export async function setCatalogItemActive(kind: string, id: string, active: boolean): Promise<ActionResult> {
  const op = await getOperator();
  if (!op) return { ok: false, error: EXPIRED };
  if (!isSimpleCatalogKind(kind) || !isUuid(id) || typeof active !== "boolean") {
    return { ok: false, error: "Registro inválido." };
  }
  const config = SIMPLE_CATALOGS[kind];

  const { data, error } = await op.db.from(config.table).update({ active }).eq("id", id).select("code").maybeSingle();
  if (error) return { ok: false, error: friendlyDbError(error) };
  if (!data) return { ok: false, error: "No se encontró el registro." };

  await audit(op.db, op.user.id, `catalog.${config.table}.${active ? "activate" : "deactivate"}`, config.table, id, { code: data.code, active });
  revalidatePath(PATH);
  return { ok: true, data: undefined };
}

/**
 * Sobe ou desce um item entre os ativos.
 *
 * Os `sort_order` antigos podem estar repetidos (cadastro por script, tudo 0)
 * — trocar dois valores iguais não mudaria nada. Então a lista inteira é
 * renumerada na ordem nova, e só as linhas que mudaram são gravadas.
 */
export async function moveCatalogItem(kind: string, id: string, direction: "up" | "down"): Promise<ActionResult> {
  const op = await getOperator();
  if (!op) return { ok: false, error: EXPIRED };
  if (!isSimpleCatalogKind(kind) || !isUuid(id) || (direction !== "up" && direction !== "down")) {
    return { ok: false, error: "Registro inválido." };
  }
  const config = SIMPLE_CATALOGS[kind];
  if (!config.sortable) return { ok: false, error: "Este catálogo no tiene orden." };

  const { data, error } = await op.db
    .from(config.table)
    .select("id, active, sort_order")
    .order("sort_order")
    .order("name");
  if (error) return { ok: false, error: friendlyDbError(error) };

  const rows = (data ?? []) as { id: string; active: boolean; sort_order: number }[];
  const item = rows.find((r) => r.id === id);
  if (!item) return { ok: false, error: "No se encontró el registro." };
  if (!item.active) return { ok: false, error: `Activa ${config.article} ${config.singular} antes de cambiar su posición.` };

  /* Vizinho entre os ativos: os inativos não aparecem na lista ordenável, e
     "subir" não pode parecer que não fez nada por ter pulado um invisível. */
  const active = rows.filter((r) => r.active);
  const index = active.findIndex((r) => r.id === id);
  const neighbor = active[direction === "up" ? index - 1 : index + 1];
  if (!neighbor) return { ok: true, data: undefined };

  const reordered = rows.filter((r) => r.id !== id);
  const at = reordered.findIndex((r) => r.id === neighbor.id);
  reordered.splice(direction === "up" ? at : at + 1, 0, item);

  for (const [position, row] of reordered.entries()) {
    const sortOrder = position + 1;
    if (row.sort_order === sortOrder) continue;
    const { error: updateError } = await op.db.from(config.table).update({ sort_order: sortOrder }).eq("id", row.id);
    if (updateError) return { ok: false, error: friendlyDbError(updateError) };
  }

  revalidatePath(PATH);
  return { ok: true, data: undefined };
}

/* -------------------------------------------------------------------------- */
/*  Vendedoras                                                                */
/* -------------------------------------------------------------------------- */

type SellerFields = { code: string; name: string; store_id: string | null; role: string; phone: string | null };

async function parseSeller(
  db: Db,
  input: SellerInput,
  currentStoreId: string | null = null,
): Promise<{ ok: true; row: SellerFields } | { ok: false; error: string }> {
  const code = normalizeCode(text(input?.code));
  const name = text(input?.name);
  const phone = text(input?.phone);
  const storeId = typeof input?.storeId === "string" ? input.storeId : "";
  const role = input?.role;

  const invalid = nameError(name, SELLER_NAME_MAX) ?? codeError(code) ?? phoneError(phone);
  if (invalid) return { ok: false, error: invalid };
  if (!isSellerRole(role)) return { ok: false, error: "Elige el rol." };

  /* Só lojas que recebem torta: é a loja padrão das telas de recepção e
     balcão, e uma loja sem prefixo de série não tem vitrine para mostrar.
     A loja que a ficha já tem passa: se ela foi desativada depois, corrigir
     o celular da vendedora não pode exigir mudar a loja junto. */
  if (storeId && storeId !== currentStoreId) {
    const stores = await listStores(db);
    if (!stores.some((s) => s.id === storeId)) return { ok: false, error: "Tienda inválida." };
  }

  return { ok: true, row: { code, name, store_id: storeId || null, role, phone: phone || null } };
}

export async function createSeller(input: SellerInput): Promise<ActionResult> {
  const op = await getOperator();
  if (!op) return { ok: false, error: EXPIRED };

  const parsed = await parseSeller(op.db, input);
  if (!parsed.ok) return parsed;

  const { data, error } = await op.db.from("sellers").insert({ ...parsed.row, active: true }).select("id").single();
  if (error) {
    if (error.code === "23505") return { ok: false, error: `Ya existe una vendedora con el código ${parsed.row.code}.` };
    return { ok: false, error: friendlyDbError(error) };
  }

  await audit(op.db, op.user.id, "seller.create", "sellers", data.id, parsed.row);
  revalidatePath(PATH);
  return { ok: true, data: undefined };
}

export async function updateSeller(id: string, input: SellerInput): Promise<ActionResult> {
  const op = await getOperator();
  if (!op) return { ok: false, error: EXPIRED };
  if (!isUuid(id)) return { ok: false, error: "Registro inválido." };

  const { data: before } = await op.db.from("sellers").select("code, name, store_id, role, phone").eq("id", id).maybeSingle();
  if (!before) return { ok: false, error: "No se encontró la vendedora." };

  const parsed = await parseSeller(op.db, input, before.store_id as string | null);
  if (!parsed.ok) return parsed;

  /* Nada mudou: não grava nem suja a trilha com um "antes = depois". */
  const fields = ["code", "name", "store_id", "role", "phone"] as const;
  if (fields.every((key) => (before[key] ?? null) === parsed.row[key])) return { ok: true, data: undefined };

  const { error } = await op.db.from("sellers").update(parsed.row).eq("id", id);
  if (error) {
    if (error.code === "23505") return { ok: false, error: `El código ${parsed.row.code} ya está en uso.` };
    return { ok: false, error: friendlyDbError(error) };
  }

  await audit(op.db, op.user.id, "seller.update", "sellers", id, { before, after: parsed.row });
  revalidatePath(PATH);
  return { ok: true, data: undefined };
}

export async function setSellerActive(id: string, active: boolean): Promise<ActionResult> {
  const op = await getOperator();
  if (!op) return { ok: false, error: EXPIRED };
  if (!isUuid(id) || typeof active !== "boolean") return { ok: false, error: "Registro inválido." };

  const { data, error } = await op.db.from("sellers").update({ active }).eq("id", id).select("code").maybeSingle();
  if (error) return { ok: false, error: friendlyDbError(error) };
  if (!data) return { ok: false, error: "No se encontró la vendedora." };

  await audit(op.db, op.user.id, active ? "seller.activate" : "seller.deactivate", "sellers", id, { code: data.code, active });
  revalidatePath(PATH);
  return { ok: true, data: undefined };
}

/* -------------------------------------------------------------------------- */
/*  Acesso ao painel                                                          */
/* -------------------------------------------------------------------------- */

/* Sem I, O, l, 0 e 1: a senha é ditada ou copiada de um papel, e "Il0O" é
   onde a vendedora erra na primeira entrada. 12 símbolos de 57 ≈ 70 bits. */
const PASSWORD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

function temporaryPassword() {
  for (;;) {
    const groups = Array.from({ length: 3 }, () =>
      Array.from({ length: 4 }, () => PASSWORD_ALPHABET[randomInt(PASSWORD_ALPHABET.length)]).join(""),
    );
    const password = groups.join("-");
    if (/[A-Z]/.test(password) && /[a-z]/.test(password) && /\d/.test(password)) return password;
  }
}

/**
 * Cria a conta de login da vendedora e a liga à ficha dela.
 *
 * Três escritas que não cabem numa transação (Auth, `admins`, `sellers`).
 * Se uma falha, as anteriores são desfeitas: conta no Auth sem linha em
 * `admins` não entra no painel, mas ocupa o e-mail para sempre.
 *
 * A senha volta uma única vez para a tela e não é gravada em lugar nenhum
 * — nem na trilha de auditoria.
 */
export async function grantSellerAccess(sellerId: string, rawEmail: string): Promise<ActionResult<{ email: string; password: string }>> {
  const op = await getOperator();
  if (!op) return { ok: false, error: EXPIRED };
  if (op.user.role !== "owner") return { ok: false, error: "Solo el dueño puede dar acceso al panel." };
  if (!isUuid(sellerId)) return { ok: false, error: "Registro inválido." };

  const email = typeof rawEmail === "string" ? rawEmail.trim().toLowerCase() : "";
  const invalid = emailError(email);
  if (invalid) return { ok: false, error: invalid };

  const { data: seller } = await op.db.from("sellers").select("id, name, active, user_id").eq("id", sellerId).maybeSingle();
  if (!seller) return { ok: false, error: "No se encontró la vendedora." };
  if (seller.user_id) return { ok: false, error: `${seller.name} ya tiene acceso al panel.` };
  /* A tela de operação só reconhece vendedora ativa: login de inativa
     entraria sem loja e sem nome, um usuário fantasma. */
  if (!seller.active) return { ok: false, error: "Activa a la vendedora antes de darle acceso." };

  const admin = getSupabaseAdmin();
  if (!admin) return { ok: false, error: "Falta configurar la clave de servicio en el servidor." };

  const password = temporaryPassword();
  const { data: created, error: createError } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (createError || !created.user) {
    const code = createError?.code;
    if (code === "email_exists" || code === "user_already_exists" || /already (been )?registered|already exists/i.test(createError?.message ?? "")) {
      return { ok: false, error: `Ya existe una cuenta con el correo ${email}. Usa otro correo.` };
    }
    if (code === "email_address_invalid" || code === "validation_failed") return { ok: false, error: "Correo inválido." };
    console.error("[acceso]", code, createError?.message);
    return { ok: false, error: "No se pudo crear la cuenta. Inténtalo de nuevo." };
  }

  const userId = created.user.id;
  const undoUser = async () => {
    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error) console.error("[acceso] no se pudo deshacer la cuenta", userId, error.message);
  };

  const { error: adminError } = await admin.from("admins").insert({ user_id: userId, name: seller.name, role: "staff" });
  if (adminError) {
    console.error("[acceso] admins", adminError.code, adminError.message);
    await undoUser();
    return { ok: false, error: "No se pudo dar acceso al panel. Inténtalo de nuevo." };
  }

  /* `user_id is null` na condição: dois cliques em abas diferentes não ligam
     duas contas à mesma vendedora. */
  const { data: linked, error: linkError } = await op.db
    .from("sellers")
    .update({ user_id: userId })
    .eq("id", sellerId)
    .is("user_id", null)
    .select("id")
    .maybeSingle();
  if (linkError || !linked) {
    if (linkError) console.error("[acceso] sellers", linkError.code, linkError.message);
    await admin.from("admins").delete().eq("user_id", userId);
    await undoUser();
    return { ok: false, error: linked === null && !linkError ? `${seller.name} ya tiene acceso al panel.` : "No se pudo ligar la cuenta a la vendedora. Inténtalo de nuevo." };
  }

  /* Acesso ao painel é o evento que mais importa ter registrado; grava com a
     chave de serviço para não depender da política da tabela. */
  await audit(admin, op.user.id, "seller.access.grant", "sellers", sellerId, { user_id: userId, email, name: seller.name });
  revalidatePath(PATH);
  return { ok: true, data: { email, password } };
}

/**
 * Tira o acesso ao painel. Apaga só a linha em `admins` — é ela que abre a
 * porta — e desliga a ficha. A conta do Auth fica: o histórico de quem
 * despachou e recebeu aponta para ela.
 */
export async function revokeSellerAccess(sellerId: string): Promise<ActionResult> {
  const op = await getOperator();
  if (!op) return { ok: false, error: EXPIRED };
  if (op.user.role !== "owner") return { ok: false, error: "Solo el dueño puede quitar el acceso al panel." };
  if (!isUuid(sellerId)) return { ok: false, error: "Registro inválido." };

  const { data: seller } = await op.db.from("sellers").select("id, name, user_id").eq("id", sellerId).maybeSingle();
  if (!seller) return { ok: false, error: "No se encontró la vendedora." };
  if (!seller.user_id) return { ok: false, error: `${seller.name} no tiene acceso al panel.` };
  if (seller.user_id === op.user.id) return { ok: false, error: "No puedes quitarte tu propio acceso." };

  const admin = getSupabaseAdmin();
  if (!admin) return { ok: false, error: "Falta configurar la clave de servicio en el servidor." };

  const { data: account } = await admin.from("admins").select("role").eq("user_id", seller.user_id).maybeSingle();
  if (account?.role === "owner") {
    return { ok: false, error: "Esa cuenta es de un dueño; su acceso no se quita desde aquí." };
  }

  if (account) {
    const { error } = await admin.from("admins").delete().eq("user_id", seller.user_id);
    if (error) {
      console.error("[acceso] admins", error.code, error.message);
      return { ok: false, error: "No se pudo quitar el acceso. Inténtalo de nuevo." };
    }
  }

  /* Se isto falhar, a porta já está fechada (sem linha em `admins`); repetir
     a ação só termina de desligar a ficha. */
  const { error: unlinkError } = await op.db.from("sellers").update({ user_id: null }).eq("id", sellerId);
  if (unlinkError) {
    return { ok: false, error: "Se quitó el acceso, pero la ficha sigue ligada a la cuenta. Inténtalo de nuevo." };
  }

  await audit(admin, op.user.id, "seller.access.revoke", "sellers", sellerId, { user_id: seller.user_id, name: seller.name });
  revalidatePath(PATH);
  return { ok: true, data: undefined };
}

/* -------------------------------------------------------------------------- */
/*  Validade por família                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Validade da família em dias. Vazio devolve a decisão ao padrão (2 dias em
 * `product_shelf_life`). Vale para o que for despachado daqui em diante: a
 * torta que já está na vitrine guarda a data de vencimento com que nasceu.
 */
export async function setFamilyShelfLife(familyId: string, days: number | null): Promise<ActionResult> {
  const op = await getOperator();
  if (!op) return { ok: false, error: EXPIRED };
  if (!isUuid(familyId)) return { ok: false, error: "Registro inválido." };
  if (days !== null && (typeof days !== "number" || !Number.isInteger(days) || days < 0 || days > SHELF_LIFE_MAX)) {
    return { ok: false, error: `La validez debe ser un número entero de 0 a ${SHELF_LIFE_MAX} días, o vacía.` };
  }

  const { data: before } = await op.db
    .from("product_families")
    .select("code, is_service, shelf_life_days")
    .eq("id", familyId)
    .maybeSingle();
  if (!before) return { ok: false, error: "No se encontró la familia." };
  if (before.is_service) return { ok: false, error: "Un servicio no vence: no lleva validez." };
  if (before.shelf_life_days === days) return { ok: true, data: undefined };

  const { error } = await op.db.from("product_families").update({ shelf_life_days: days }).eq("id", familyId);
  if (error) return { ok: false, error: friendlyDbError(error) };

  await audit(op.db, op.user.id, "family.shelf_life", "product_families", familyId, {
    code: before.code,
    before: before.shelf_life_days,
    after: days,
  });
  revalidatePath(PATH);
  return { ok: true, data: undefined };
}
