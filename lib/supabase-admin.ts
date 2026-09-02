import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Cliente com a service role key: ignora RLS.
 *
 * Só existe em código de servidor. É o que grava pedidos e reclamações, que
 * por política não são acessíveis pela chave anônima nem para leitura.
 *
 * O `import "server-only"` acima faz o build quebrar se este módulo for
 * importado por engano num componente de cliente — o erro aparece na
 * compilação, não em produção com a chave exposta.
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const isAdminConfigured = Boolean(url && serviceKey);

let client: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient | null {
  if (!url || !serviceKey) return null;
  client ??= createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}
