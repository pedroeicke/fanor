import type { Metadata } from "next";
import { Prose } from "@/components/ui/Prose";
import { brand, siteUrl } from "@/lib/config";
import { getDeliveryConfig } from "@/lib/delivery-db";
import type { DeliveryConfig } from "@/lib/delivery";
import { soles } from "@/lib/format";

export const metadata: Metadata = {
  title: "Preguntas frecuentes",
  description: `Anticipación, personalización, formas de pago y entregas: las dudas más comunes antes de comprar en ${brand.name}.`,
  alternates: { canonical: "/preguntas-frecuentes" },
};

/* Recebe a configuração inteira: tarifas e cortesia são editáveis no painel,
   e um número fixo aqui ficaria errado na primeira mudança. */
function faq(config: DeliveryConfig) {
  const FREE_DELIVERY_FROM = config.freeFrom;
  const fees = config.districts.map((d) => d.fee);
  const minFee = Math.min(...fees);
  const maxFee = Math.max(...fees);
  const feeText =
    minFee === maxFee
      ? `${soles(minFee)} en todos los distritos`
      : `Entre ${soles(minFee)} y ${soles(maxFee)} según el distrito`;

  return [
  {
    q: "¿Con cuánta anticipación debo pedir?",
    a: "24 horas para las tortas del catálogo y 48 horas para Altezas, FotoTortas y personalizadas. El calendario del producto solo te muestra fechas que sí podemos cumplir.",
  },
  {
    q: "¿Puedo elegir la hora de entrega?",
    a: "Sí. Al comprar eliges el día y una franja horaria. Te avisamos por WhatsApp cuando el pedido sale hacia tu dirección.",
  },
  {
    q: "¿El mensaje sobre la torta tiene costo?",
    a: "No. Lo escribes en la página del producto, hasta 80 caracteres, y va incluido en el precio.",
  },
  {
    q: "¿Cómo envío la foto para una FotoTorta?",
    a: "La subes directamente en la página del producto antes de añadirla al carrito. La imprimimos en papel de azúcar comestible. Usa una foto bien iluminada y sin filtros para el mejor resultado.",
  },
  {
    q: "¿Qué formas de pago aceptan?",
    a: "Tarjeta de crédito o débito (Visa, Mastercard, American Express) con cobro inmediato, o transferencia por Yape, Plin, BCP e Interbank enviando el comprobante por WhatsApp.",
  },
  {
    q: "¿Cuánto cuesta el delivery?",
    a: `${feeText}, y de cortesía en pedidos desde ${soles(FREE_DELIVERY_FROM)}. El costo aparece en el checkout apenas eliges tu distrito, nunca después de pagar.`,
  },
  {
    q: "¿Puedo cambiar o cancelar mi pedido?",
    a: "Sí, mientras falten más de 24 horas para la entrega y la torta no haya entrado en producción. Escríbenos por WhatsApp con tu código de pedido.",
  },
  {
    q: "¿Hacen tortas para eventos grandes?",
    a: "Sí. Filtra por 'Más de 20' porciones o escríbenos: armamos varias tortas coordinadas para oficinas y celebraciones familiares.",
    },
  ];
}

export const revalidate = 300;

export default async function FaqPage() {
  const config = await getDeliveryConfig();
  const FAQ = faq(config);

  const schema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    url: `${siteUrl}/preguntas-frecuentes`,
    mainEntity: FAQ.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: { "@type": "Answer", text: item.a },
    })),
  };

  return (
    <>
      {/* Rich result de FAQ na busca: ocupa mais espaço na página de resultados
          e responde a objeção antes do clique. */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }} />

      <Prose
        title="Preguntas frecuentes"
        intro="Las dudas que más nos escriben, respondidas antes de que tengas que preguntar."
      >
        {FAQ.map((item) => (
          <details key={item.q} className="group border-b border-crema-200 pb-4">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-2 font-display text-lg text-cacao marker:hidden">
              {item.q}
              <span className="shrink-0 text-2xl leading-none text-dorado-600 transition-transform group-open:rotate-45">
                +
              </span>
            </summary>
            <p className="pt-2 text-cacao-500">{item.a}</p>
          </details>
        ))}
      </Prose>
    </>
  );
}
