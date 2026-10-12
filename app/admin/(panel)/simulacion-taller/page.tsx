import type { Metadata } from "next";
import { WorkshopSimulation } from "@/components/admin/taller/WorkshopSimulation";
import { Notice } from "@/components/admin/ui";
import { getOperator } from "@/lib/gestion/server";

export const metadata: Metadata = { title: "Simulación por áreas del taller" };
export const dynamic = "force-dynamic";

export default async function WorkshopSimulationPage() {
  const operator = await getOperator();
  if (!operator) return <Notice tone="bad">Sesión expirada. Vuelve a entrar.</Notice>;
  return <WorkshopSimulation />;
}
