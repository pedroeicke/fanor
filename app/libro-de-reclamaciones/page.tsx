import type { Metadata } from "next";
import { Prose } from "@/components/ui/Prose";
import { ComplaintForm } from "@/components/legal/ComplaintForm";
import { brand } from "@/lib/config";

export const metadata: Metadata = {
  title: "Libro de reclamaciones",
  description: `Registra tu reclamo o queja ante ${brand.name}. Respondemos en un plazo máximo de 15 días hábiles.`,
  alternates: { canonical: "/libro-de-reclamaciones" },
};

export default function ComplaintsPage() {
  return (
    <Prose
      title="Libro de reclamaciones"
      intro="Conforme a lo establecido en el Código de Protección y Defensa del Consumidor, este establecimiento cuenta con un Libro de Reclamaciones virtual a tu disposición."
    >
      <p className="text-[15px] text-cacao-500">
        <strong>Reclamo:</strong> disconformidad con el producto o servicio recibido.{" "}
        <strong>Queja:</strong> disconformidad con la atención al cliente.
      </p>

      <div className="not-prose pt-4">
        <ComplaintForm />
      </div>
    </Prose>
  );
}
