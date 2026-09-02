import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

/**
 * Cliente autenticado do lado do servidor.
 *
 * Diferente de `supabase-admin.ts`: aqui a sessão é a do usuário logado, e o
 * RLS continua valendo. É o que o painel usa — se alguém sem linha em `admins`
 * abrir a rota, as políticas devolvem vazio, mesmo que a rota falhe em barrar.
 * Duas travas independentes.
 */
export async function getServerSupabase() {
  const store = await cookies();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;

  return createServerClient(url, key, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          list.forEach(({ name, value, options }) => store.set(name, value, options));
        } catch {
          /* Server Component não pode escrever cookie; o proxy (proxy.ts) renova. */
        }
      },
    },
  });
}

export type AdminUser = { id: string; email: string; name: string; role: string };

/**
 * Sessão do painel, ou null.
 *
 * Confirma duas coisas: que existe usuário autenticado e que ele tem linha em
 * `admins`. Ter conta no Supabase não é o mesmo que ter acesso ao painel.
 */
export async function getAdminUser(): Promise<AdminUser | null> {
  const db = await getServerSupabase();
  if (!db) return null;

  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return null;

  const { data: admin } = await db
    .from("admins")
    .select("name, role")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!admin) return null;

  return {
    id: user.id,
    email: user.email ?? "",
    name: admin.name,
    role: admin.role,
  };
}
