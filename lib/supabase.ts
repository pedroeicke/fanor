import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Clientes do Supabase.
 *
 * Dois níveis de acesso, e a diferença importa:
 *
 *   · `anon` vai para o navegador. A chave é pública por natureza — quem
 *     protege os dados são as políticas de RLS da migração 0001, não o sigilo
 *     da chave.
 *   · `service` ignora RLS por completo. **Nunca** pode chegar ao cliente, por
 *     isso mora num módulo marcado como server-only e lê uma variável sem o
 *     prefixo NEXT_PUBLIC.
 *
 * Enquanto o banco não estiver provisionado, ambos devolvem null e a aplicação
 * cai no catálogo em arquivo — o site continua de pé sem Supabase.
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(url && anonKey);

let browserClient: SupabaseClient | null = null;

/** Cliente de leitura pública. Sujeito às políticas de RLS. */
export function getSupabase(): SupabaseClient | null {
  if (!url || !anonKey) return null;
  browserClient ??= createClient(url, anonKey, {
    auth: { persistSession: true, autoRefreshToken: true },
  });
  return browserClient;
}
