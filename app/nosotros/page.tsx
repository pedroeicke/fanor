import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { SectionHeading } from "@/components/ui/primitives";
import { IconCake, IconClock, IconMail, IconPin, IconTruck, IconWhatsapp, IconWhisk } from "@/components/ui/icons";
import { getProduct, getProducts } from "@/lib/catalog-db";
import { brand, whatsappLink, yearsInBusiness } from "@/lib/config";
import { getDeliveryConfig } from "@/lib/delivery-db";
import { cdnImage, soles } from "@/lib/format";

export const metadata: Metadata = {
  title: "Nosotros",
  description: `Más de ${yearsInBusiness} años horneando tortas artesanales en ${brand.city}. Conoce cómo trabajamos, nuestras zonas de entrega y cómo contactarnos.`,
  alternates: { canonical: "/nosotros" },
};

/* Depende da contagem de produtos, que agora vem do banco — por isso é função
   e não constante de módulo. */
function pillars(catalogSize: number) {
  return [
    {
      icon: <IconWhisk className="h-7 w-7" />,
      title: "Hechas frescas",
      text: "Preparamos cada torta para tu fecha con ingredientes seleccionados. Nada sale del congelador.",
    },
    {
      icon: <IconCake className="h-7 w-7" />,
      title: "Diseños propios",
      text: `${catalogSize} modelos exclusivos de la casa, más las personalizadas que armas tú mismo.`,
    },
    {
      icon: <IconTruck className="h-7 w-7" />,
      title: "Entrega puntual",
      text: "Eliges día y franja horaria al comprar, y te avisamos por WhatsApp cuando salimos.",
    },
  ];
}

export const revalidate = 300;

export default async function NosotrosPage() {
  const [hero, products, config] = await Promise.all([
    getProduct("alteza-ambar"),
    getProducts(),
    getDeliveryConfig(),
  ]);
  const DISTRICTS = config.districts;
  const FREE_DELIVERY_FROM = config.freeFrom;
  const PILLARS = pillars(products.length);
  const principal = DISTRICTS.filter((d) => d.coverage === "principal");
  const extendida = DISTRICTS.filter((d) => d.coverage === "extendida");

  return (
    <>
      <section className="relative overflow-hidden border-b border-crema-200 bg-crema-100">
        <div className="mx-auto grid max-w-7xl items-center gap-10 px-4 py-14 sm:px-6 lg:grid-cols-2 lg:py-20 lg:px-8">
          <div className="max-w-xl">
            <h1 className="text-[2.5rem] leading-[1.08] sm:text-5xl">
              Horneamos recuerdos desde hace más de {yearsInBusiness} años
            </h1>
            <p className="mt-6 text-lg leading-relaxed text-cacao-500">
              En {brand.name} combinamos recetas que acompañan a las familias de {brand.city} con
              diseños pensados para cada celebración. Lo que empezó como un horno de barrio hoy
              llega a {DISTRICTS.length} distritos, y seguimos decorando cada torta a mano.
            </p>
          </div>
          <div className="relative aspect-[4/3] overflow-hidden rounded-[24px]">
            {hero && (
              <Image
                src={cdnImage(hero.images[0].src, 1000)}
                alt="Torta artesanal decorada a mano en nuestro taller"
                fill
                priority
                sizes="(min-width:1024px) 580px, 100vw"
                className="object-cover"
              />
            )}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <ul className="grid gap-10 md:grid-cols-3">
          {PILLARS.map((p) => (
            <li key={p.title} className="text-center">
              <span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-dorado-100 text-dorado-600">
                {p.icon}
              </span>
              <h2 className="mt-4 text-xl">{p.title}</h2>
              <p className="mx-auto mt-2 max-w-xs leading-relaxed text-cacao-500">{p.text}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="border-y border-crema-200 bg-crema-100 py-16">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <SectionHeading
            title={`Llegamos a todo ${brand.city}`}
            subtitle={`Delivery propio, con costo visible antes de pagar y de cortesía desde ${soles(FREE_DELIVERY_FROM)}.`}
          />

          {/* Cada painel só existe se a cobertura tiver distritos: desativar
              todos os "extendida" no painel não pode derrubar a página. */}
          <div className="mt-10 grid gap-5 lg:grid-cols-2">
            {principal.length > 0 && (
              <CoveragePanel
                title="Cobertura principal"
                fee={principal[0].fee}
                districts={principal}
                accent
              />
            )}
            {extendida.length > 0 && (
              <CoveragePanel title="Cobertura extendida" fee={extendida[0].fee} districts={extendida} />
            )}
          </div>

          <p className="mt-6 text-center text-[15px] text-cacao-500">
            ¿Tu distrito no está en la lista?{" "}
            <a
              href={whatsappLink("Hola, ¿llegan con delivery a mi distrito?")}
              target="_blank"
              rel="noopener noreferrer"
              className="text-terracota underline underline-offset-4"
            >
              Consúltanos por WhatsApp
            </a>
            .
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <SectionHeading title="Estamos para ayudarte" />

        <div className="mx-auto mt-10 grid max-w-3xl gap-4 sm:grid-cols-2">
          <a
            href={whatsappLink(`Hola ${brand.name}, quisiera hacer una consulta.`)}
            target="_blank"
            rel="noopener noreferrer"
            className="card flex items-center gap-4 p-5 transition-shadow hover:shadow-lift"
          >
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-[#25D366] text-white">
              <IconWhatsapp className="h-6 w-6" />
            </span>
            <span>
              <strong className="block">WhatsApp</strong>
              <span className="text-cacao-500">{brand.whatsappDisplay}</span>
            </span>
          </a>

          <a href={`mailto:${brand.email}`} className="card flex items-center gap-4 p-5 transition-shadow hover:shadow-lift">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-dorado-100 text-dorado-600">
              <IconMail className="h-6 w-6" />
            </span>
            <span className="min-w-0">
              <strong className="block">Correo</strong>
              <span className="block truncate text-cacao-500">{brand.email}</span>
            </span>
          </a>

          <div className="card flex items-center gap-4 p-5">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-dorado-100 text-dorado-600">
              <IconClock className="h-6 w-6" />
            </span>
            <span>
              <strong className="block">Horario de atención</strong>
              {brand.hours.map((h) => (
                <span key={h.days} className="block text-cacao-500">
                  {h.days} · {h.time}
                </span>
              ))}
            </span>
          </div>

          <Link href="/delivery" className="card flex items-center gap-4 p-5 transition-shadow hover:shadow-lift">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-dorado-100 text-dorado-600">
              <IconPin className="h-6 w-6" />
            </span>
            <span>
              <strong className="block">Zonas y costos</strong>
              <span className="text-cacao-500">Ver detalle del delivery</span>
            </span>
          </Link>
        </div>
      </section>
    </>
  );
}

function CoveragePanel({
  title,
  fee,
  districts,
  accent = false,
}: {
  title: string;
  fee: number;
  districts: { slug: string; name: string }[];
  accent?: boolean;
}) {
  return (
    <div className="card p-6">
      <div className="flex items-baseline justify-between gap-4">
        <h3 className="flex items-center gap-2.5 text-xl">
          <span className={`h-3 w-3 rounded-full ${accent ? "bg-dorado" : "bg-dorado-200"}`} />
          {title}
        </h3>
        <span className="font-display text-xl font-semibold text-terracota">{soles(fee)}</span>
      </div>
      <ul className="mt-4 flex flex-wrap gap-2">
        {districts.map((d) => (
          <li
            key={d.slug}
            className="rounded-full border border-crema-300 bg-crema-100 px-3 py-1.5 text-[13px] text-cacao-700"
          >
            {d.name}
          </li>
        ))}
      </ul>
    </div>
  );
}
