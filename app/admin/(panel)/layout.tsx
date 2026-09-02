import Link from "next/link";
import { redirect } from "next/navigation";
import { getAdminUser } from "@/lib/supabase-server";
import { AdminNav } from "@/components/admin/AdminNav";

/**
 * Tudo dentro deste grupo exige sessão de administrador.
 *
 * Segunda trava, não a única: o proxy (proxy.ts) já barra antes de chegar aqui, e as
 * políticas de RLS barram depois. Falhar as três ao mesmo tempo é o que
 * exporia dado.
 */
export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const user = await getAdminUser();

  /* Autenticado mas sem linha em `admins` também cai aqui: ter conta no
     Supabase não é o mesmo que ter acesso ao painel. */
  if (!user) redirect("/admin/login");

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-crema-200 pb-5">
        <div>
          <p className="font-sans text-xs font-bold uppercase tracking-[0.16em] text-cacao-300">
            Panel de administración
          </p>
          <h1 className="mt-1 font-display text-2xl">Hola, {user.name.split(" ")[0]}</h1>
        </div>

        <div className="flex items-center gap-3 text-sm">
          <Link href="/" className="text-cacao-500 underline underline-offset-4 hover:text-cacao">
            Ver la tienda
          </Link>
          <form action="/admin/salir" method="post">
            <button
              type="submit"
              className="rounded-full border border-crema-300 px-4 py-2 font-medium text-cacao-700 transition-colors hover:border-cacao/35"
            >
              Salir
            </button>
          </form>
        </div>
      </header>

      <AdminNav />

      <main className="mt-8">{children}</main>
    </div>
  );
}
