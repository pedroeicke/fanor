import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAdminUser, getServerSupabase, type AdminUser } from "@/lib/supabase-server";

/**
 * Porta de entrada das telas de operação (taller, recepção, balcão,
 * encomendas, leads).
 *
 * Tudo que muda estoque ou dinheiro é uma função no banco (`op_*`, migração
 * 0012): acontece inteiro ou não acontece. Aqui fica o que toda ação repete —
 * conferir a sessão, chamar a função com o cliente da sessão (o RLS continua
 * valendo) e devolver um erro que a vendedora entende.
 */

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export type Operator = {
  user: AdminUser;
  db: SupabaseClient;
  /** Vendedora ligada ao login, quando houver. Define a loja padrão das telas. */
  seller: { id: string; name: string; storeId: string | null; role: string } | null;
};

/** Sessão de painel + vendedora do login. Null quando a sessão expirou. */
export async function getOperator(): Promise<Operator | null> {
  const user = await getAdminUser();
  if (!user) return null;
  const db = await getServerSupabase();
  if (!db) return null;

  const { data: seller } = await db
    .from("sellers")
    .select("id, name, store_id, role")
    .eq("user_id", user.id)
    .eq("active", true)
    .maybeSingle();

  return {
    user,
    db,
    seller: seller ? { id: seller.id, name: seller.name, storeId: seller.store_id, role: seller.role } : null,
  };
}

/**
 * Executa uma operação do banco.
 *
 * As funções `op_*` levantam exceção com a mensagem pronta em espanhol
 * ("La torta G… no está disponible."). Erros que não são nossos — rede,
 * restrição violada — viram uma frase genérica, e o detalhe vai para o log.
 */
export async function runOp<T = unknown>(
  fn: string,
  args: Record<string, unknown>,
): Promise<ActionResult<T>> {
  const op = await getOperator();
  if (!op) return { ok: false, error: "Sesión expirada. Vuelve a entrar." };

  const { data, error } = await op.db.rpc(fn, args);
  if (error) return { ok: false, error: friendlyDbError(error) };
  return { ok: true, data: data as T };
}

type PgError = { message: string; code?: string; details?: string | null; hint?: string | null };

/** Mensagem legível para o painel. Exceções levantadas por `op_*` (P0001) passam como estão. */
export function friendlyDbError(error: PgError) {
  if (error.code === "P0001" || error.code === "42501") return error.message.trim();
  if (error.code === "23505") return "Ya existe un registro con esos datos.";
  if (error.code === "23503") return "El registro está en uso y no se puede modificar así.";
  if (error.code === "22P02") return "Algún dato tiene un formato inválido.";
  console.error("[gestion]", error.code, error.message, error.details ?? "");
  return "No se pudo completar la operación. Inténtalo de nuevo.";
}

/** Lê uma chave de `system_settings` com valor padrão. */
export async function getSetting<T>(db: SupabaseClient, key: string, fallback: T): Promise<T> {
  const { data } = await db.from("system_settings").select("value").eq("key", key).maybeSingle();
  return (data?.value as T | undefined) ?? fallback;
}

export type SlaSettings = {
  lead_first_contact_min: number;
  request_attend_hours: number;
  dispatch_receive_hours: number;
  complaint_response_days: number;
  sync_stale_min: number;
};

export const DEFAULT_SLA: SlaSettings = {
  lead_first_contact_min: 15,
  request_attend_hours: 4,
  dispatch_receive_hours: 3,
  complaint_response_days: 15,
  sync_stale_min: 15,
};

/** Lojas com prefixo de série — as únicas que recebem torta. */
export async function listStores(db: SupabaseClient) {
  const { data } = await db
    .from("stores")
    .select("id, name, serial_prefix")
    .eq("active", true)
    .not("serial_prefix", "is", null)
    .order("sort_order");
  return (data ?? []) as { id: string; name: string; serial_prefix: string }[];
}

/** "Tortas Fanor — Calle Perú" → "Calle Perú". O prefixo da marca só ocupa espaço nas telas internas. */
export function shortStoreName(name: string | null | undefined) {
  return (name ?? "").replace(/^Tortas Fanor\s*[—-]\s*/i, "") || "Tienda";
}
