import type { Metadata } from "next";
import { Prose } from "@/components/ui/Prose";
import { ButtonLink } from "@/components/ui/primitives";
import { getDeliveryConfig } from "@/lib/delivery-db";
import { brand } from "@/lib/config";
import { soles } from "@/lib/format";

export const metadata: Metadata = {
  title: "Sobre el delivery",
  description: `Zonas, costos y horarios de entrega de ${brand.name} en ${brand.city}. Elige día y franja horaria al comprar.`,
  alternates: { canonical: "/delivery" },
};

export const revalidate = 300;

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
/** Plural em espanhol, como se diz: "los domingos", "los lunes". */
const DAY_PLURAL = ["domingos", "lunes", "martes", "miércoles", "jueves", "viernes", "sábados"];

/** "domingos", "domingos y lunes", "domingos, lunes y martes". */
function listDays(days: number[]) {
  const names = days.map((d) => DAY_PLURAL[d]);
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} y ${names[names.length - 1]}`;
}

export default async function DeliveryPage() {
  const config = await getDeliveryConfig();
  const FREE_DELIVERY_FROM = config.freeFrom;
  const SLOTS = config.slots;
  const principal = config.districts.filter((d) => d.coverage === "principal");
  const extendida = config.districts.filter((d) => d.coverage === "extendida");
  /* Faixas que não existem em algum dia da semana. */
  const restricted = SLOTS.map((s) => ({
    id: s.id,
    label: s.label,
    missing: ALL_DAYS.filter((d) => !s.weekdays.includes(d)),
  })).filter((s) => s.missing.length > 0 && s.missing.length < 7);

  return (
    <Prose
      title="Sobre el delivery"
      intro={`Todo lo que necesitas saber antes de comprar: a dónde llegamos, cuánto cuesta y en qué horarios entregamos en ${brand.city}.`}
    >
      <h2>Costos por zona</h2>
      <p>
        El costo aparece en el checkout apenas eliges tu distrito, antes de pagar. En pedidos desde{" "}
        <strong>{soles(FREE_DELIVERY_FROM)}</strong> el delivery corre por nuestra cuenta.
      </p>

      <table className="w-full border-collapse text-[15px]">
        <thead>
          <tr className="border-b border-crema-300 text-left">
            <th className="py-3 font-semibold">Zona</th>
            <th className="py-3 font-semibold">Costo</th>
            <th className="py-3 font-semibold">Distritos</th>
          </tr>
        </thead>
        <tbody>
          {/* Só as coberturas com distritos ativos: o painel pode desativar
              uma zona inteira e a tabela não pode quebrar por isso. */}
          {principal.length > 0 && (
            <tr className="border-b border-crema-200 align-top">
              <td className="py-3 pr-4 font-medium">Principal</td>
              <td className="py-3 pr-4 whitespace-nowrap">{soles(principal[0].fee)}</td>
              <td className="py-3 text-cacao-500">{principal.map((d) => d.name).join(", ")}</td>
            </tr>
          )}
          {extendida.length > 0 && (
            <tr className="align-top">
              <td className="py-3 pr-4 font-medium">Extendida</td>
              <td className="py-3 pr-4 whitespace-nowrap">{soles(extendida[0].fee)}</td>
              <td className="py-3 text-cacao-500">{extendida.map((d) => d.name).join(", ")}</td>
            </tr>
          )}
        </tbody>
      </table>

      <h2>Horarios de entrega</h2>
      <p>Eliges una franja al momento de comprar y entregamos dentro de ella:</p>
      <ul>
        {SLOTS.map((s) => (
          <li key={s.id}>{s.label}</li>
        ))}
      </ul>
      {/* Derivado da configuração, não escrito à mão: o Joseka pode abrir a
          última faixa no domingo pelo painel e o texto acompanha sozinho. */}
      {restricted.map((r) => (
        <p key={r.id}>
          La franja de {r.label} no está disponible los {listDays(r.missing)}.
        </p>
      ))}

      <h2>Con cuánta anticipación pedir</h2>
      <ul>
        <li>
          <strong>Tortas del catálogo:</strong> 24 horas de anticipación.
        </li>
        <li>
          <strong>Altezas, FotoTortas y personalizadas:</strong> 48 horas, porque se decoran a mano
          pieza por pieza.
        </li>
      </ul>
      <p>
        El calendario del producto ya descarta las fechas imposibles: si aparece disponible, la
        entregamos.
      </p>

      <h2>Recojo en tienda</h2>
      <p>
        Sin costo. Eliges la franja horaria igual que en el delivery y te enviamos la dirección exacta
        por WhatsApp al confirmar el pedido.
      </p>

      <h2>¿Y si no estoy en casa?</h2>
      <p>
        Te escribimos por WhatsApp cuando el pedido sale. Si nadie recibe, esperamos 15 minutos y
        coordinamos una segunda visita el mismo día cuando la ruta lo permite. Deja siempre una
        referencia clara y un número que conteste.
      </p>

      <div className="not-prose pt-6">
        <ButtonLink href="/tortas" size="lg">
          Ver las tortas
        </ButtonLink>
      </div>
    </Prose>
  );
}
