import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AdminNav } from "@/components/admin/AdminNav";
import { WorkshopSimulation } from "@/components/admin/taller/WorkshopSimulation";
import { getOperator } from "@/lib/gestion/server";
import { getServerSupabase } from "@/lib/supabase-server";

export const metadata: Metadata = { title: "Simulación por áreas del taller" };
export const dynamic = "force-dynamic";

export default async function WorkshopSimulationPage() {
  const db = await getServerSupabase();
  if (!db) redirect("/admin/login?next=%2Fadmin%2Fsimulacion-taller");

  const { data: { user } } = await db.auth.getUser();
  if (!user) redirect("/admin/login?next=%2Fadmin%2Fsimulacion-taller");

  const { data: admin } = await db
    .from("admins")
    .select("name")
    .eq("user_id", user.id)
    .maybeSingle();
  const simulationOnly = !admin && user.app_metadata?.fanor_simulation_test === true;
  if (!admin && !simulationOnly) redirect("/admin/login?next=%2Fadmin%2Fsimulacion-taller");
  const op = admin ? await getOperator() : null;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-crema-200 pb-5">
        <div>
          <p className="font-sans text-xs font-bold uppercase tracking-[0.16em] text-cacao-300">
            {simulationOnly ? "Acceso de prueba" : "Panel de administración"}
          </p>
          <h1 className="mt-1 font-display text-2xl">Hola, {admin?.name.split(" ")[0] ?? "equipo"}</h1>
        </div>
        <div className="flex items-center gap-3 text-sm">
          {admin && <Link href="/admin" className="text-cacao-500 underline underline-offset-4 hover:text-cacao">Volver al panel</Link>}
          <form action="/admin/salir" method="post">
            <button type="submit" className="rounded-full border border-crema-300 px-4 py-2 font-medium text-cacao-700 transition-colors hover:border-cacao/35">Salir</button>
          </form>
        </div>
      </header>
      {op && <AdminNav profile={op.profile} />}
      <div className="mt-8"><WorkshopSimulation simulationOnly={simulationOnly} /></div>
    </div>
  );
}
