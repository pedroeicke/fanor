import { SectionHeading } from "@/components/ui/primitives";
import { IconCake, IconCalendar, IconTruck } from "@/components/ui/icons";

/**
 * Os três passos existem para matar a dúvida que fazia todo pedido do site
 * antigo virar conversa de WhatsApp: quando chega, e o que já vem incluído.
 */
const STEPS = [
  {
    icon: <IconCake className="h-7 w-7" />,
    title: "Elige tu torta",
    text: "Tamaño en porciones, no en centímetros. Sabes para cuántas personas alcanza antes de comprar.",
  },
  {
    icon: <IconCalendar className="h-7 w-7" />,
    title: "Programa la entrega",
    text: "Escoges el día y la franja horaria. Nada de coordinar por chat después de pagar.",
  },
  {
    icon: <IconTruck className="h-7 w-7" />,
    title: "Recíbela fresca",
    text: "La horneamos el mismo día y la llevamos a tu puerta dentro de la franja que elegiste.",
  },
];

export function HowItWorks() {
  return (
    <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
      <SectionHeading
        title="Pedir es así de simple"
        subtitle="Tres pasos y listo. Sin llamadas, sin coordinar por chat."
      />

      <ol className="mt-12 grid gap-8 md:grid-cols-3">
        {STEPS.map((step, i) => (
          <li key={step.title} className="relative text-center">
            <span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-dorado-100 text-dorado-600">
              {step.icon}
            </span>
            <span className="mt-4 block font-sans text-xs font-bold uppercase tracking-[0.16em] text-cacao-300">
              Paso {i + 1}
            </span>
            <h3 className="mt-1.5 text-xl">{step.title}</h3>
            <p className="mx-auto mt-2 max-w-xs leading-relaxed text-cacao-500">{step.text}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
