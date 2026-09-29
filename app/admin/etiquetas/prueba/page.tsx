import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getAdminUser } from "@/lib/supabase-server";
import { CAKE_LABEL_CSS, cakeLabelContent } from "@/lib/gestion/cake-label";
import { CakeLabel } from "@/components/admin/taller/CakeLabel";
import { PrintButton } from "@/components/admin/taller/PrintButton";
import cases from "@/data/cake-label-tests.json";

export const metadata: Metadata = { title: "Prueba de etiquetas · TSC TE200" };
export const dynamic = "force-dynamic";

export default async function LabelTestPage() {
  if (!await getAdminUser()) redirect("/admin/login?next=%2Fadmin%2Fetiquetas%2Fprueba");

  return <div className="etq-root mx-auto max-w-4xl px-4 py-6">
    <style dangerouslySetInnerHTML={{ __html: `
body > :not(#contenido) { display: none !important; }
body { background: #fff; }
@media print {
  .no-print { display: none !important; }
  .etq-root { max-width: none !important; margin: 0 !important; padding: 0 !important; }
}
${CAKE_LABEL_CSS}` }} />
    <div className="no-print mb-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/admin/taller" className="inline-flex h-11 items-center text-sm underline underline-offset-4">← Volver al taller</Link>
        <PrintButton label="Imprimir 11 pruebas" />
      </div>
      <h1 className="font-display text-2xl">Prueba de etiquetas · TSC TE200</h1>
      <p className="text-sm text-cacao-500">50 × 25 mm · margen interno de 3 mm · una etiqueta por página. Imprime al 100 %, sin ajustar al papel ni encabezados.</p>
      <p className="text-sm text-cacao-500">Solo las tortas de 3 sabores llevan la combinación. Moca y Delicia Tropical llevan únicamente su nombre. Estas pruebas no registran tortas ni movimientos de inventario.</p>
    </div>
    <div className="etq-50">
      {cases.map((sample, i) => {
        const number = String(i + 1).padStart(2, "0");
        return <CakeLabel key={number} label={{
          ...cakeLabelContent({ name: sample.name, minFlavors: sample.flavors.length, maxFlavors: sample.flavors.length, flavorName: sample.flavors.join("-") }),
          store: "PERU",
          serial: `PRUEBA ${number}`,
          qrValue: `FANOR-TEST:${number}`,
        }} />;
      })}
    </div>
  </div>;
}
