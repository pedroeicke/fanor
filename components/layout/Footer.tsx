import Link from "next/link";
import { brand, whatsappLink } from "@/lib/config";
import { OCCASIONS } from "@/lib/catalog";
import type { DeliveryConfig } from "@/lib/delivery";
import { soles } from "@/lib/format";
import { Logo } from "./Logo";
import { IconClock, IconMail, IconWhatsapp } from "@/components/ui/icons";
import { PaymentMarks } from "@/components/ui/PaymentMarks";
import { isTransferEnabled } from "@/lib/payment-config";

const SHOP_LINKS = [
  { href: "/tortas", label: "Todas las tortas" },
  { href: "/personalizadas", label: "Tortas personalizadas" },
  { href: "/tortas?filtro=chocolate", label: "Chocolate" },
  { href: "/tortas?filtro=tres-leches", label: "Tres leches" },
  { href: "/tortas?filtro=frutales", label: "Frutales" },
];

const LEGAL_LINKS = [
  { href: "/delivery", label: "Sobre el delivery" },
  { href: "/preguntas-frecuentes", label: "Preguntas frecuentes" },
  { href: "/politicas-de-privacidad", label: "Políticas de privacidad" },
  { href: "/terminos-y-condiciones", label: "Términos y condiciones" },
  { href: "/libro-de-reclamaciones", label: "Libro de reclamaciones" },
];

export function Footer({ config }: { config: DeliveryConfig }) {
  const transferEnabled = isTransferEnabled();

  return (
    <footer className="mt-24 border-t border-crema-200 bg-crema-100">
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="grid gap-12 lg:grid-cols-[1.3fr_1fr_1fr_1fr]">
          <div>
            <Logo className="h-14" />
            <p className="mt-5 max-w-xs text-[15px] leading-relaxed text-cacao-500">
              {brand.tagline}
            </p>

            <a
              href={whatsappLink("Hola Fanor, tengo una consulta sobre sus tortas.")}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-6 inline-flex items-center gap-2.5 rounded-full bg-[#25D366] px-5 py-3 text-[15px] font-semibold text-[#0b3d20] transition-colors hover:bg-[#1fbb59]"
            >
              <IconWhatsapp className="h-[18px] w-[18px]" />
              {brand.whatsappDisplay}
            </a>

            <div className="mt-6 space-y-2 text-sm text-cacao-500">
              <p className="flex items-start gap-2.5">
                <IconClock className="mt-0.5 h-[18px] w-[18px] shrink-0 text-dorado-600" />
                <span>
                  {brand.hours.map((h) => (
                    <span key={h.days} className="block">
                      {h.days} · {h.time}
                    </span>
                  ))}
                </span>
              </p>
              <p className="flex items-center gap-2.5">
                <IconMail className="h-[18px] w-[18px] shrink-0 text-dorado-600" />
                <a href={`mailto:${brand.email}`} className="hover:text-cacao">
                  {brand.email}
                </a>
              </p>
            </div>
          </div>

          <FooterColumn title="Tienda" links={SHOP_LINKS} />
          <FooterColumn
            title="Ocasiones"
            links={OCCASIONS.map((o) => ({ href: `/ocasiones/${o.slug}`, label: o.name }))}
          />
          <FooterColumn title="Ayuda" links={LEGAL_LINKS} />
        </div>

        <div className="mt-14 rounded-2xl border border-crema-300 bg-white p-6">
          <h3 className="font-display text-lg">Llegamos a {config.districts.length} distritos de {brand.city}</h3>
          <p className="mt-2 text-sm leading-relaxed text-cacao-500">
            {config.districts.map((d) => d.name).join(" · ")}.{" "}
            <span className="font-medium text-cacao">
              Delivery de cortesía en pedidos desde {soles(config.freeFrom)}.
            </span>{" "}
            <Link href="/delivery" className="text-terracota underline underline-offset-4 hover:text-terracota-700">
              Ver costos y horarios
            </Link>
          </p>
        </div>

        <div className="mt-10 flex flex-col items-center gap-6 border-t border-crema-300 pt-8 sm:flex-row sm:justify-between">
          <p className="text-sm text-cacao-300">
            © {new Date().getFullYear()} {brand.name}. Todos los derechos reservados.
          </p>
          <PaymentMarks only={transferEnabled ? undefined : ["VISA", "Mastercard", "AMEX"]} />
          <div className="flex gap-5 text-sm text-cacao-500">
            <a href={brand.instagram} target="_blank" rel="noopener noreferrer" className="hover:text-cacao">
              Instagram
            </a>
            <a href={brand.facebook} target="_blank" rel="noopener noreferrer" className="hover:text-cacao">
              Facebook
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}

function FooterColumn({ title, links }: { title: string; links: { href: string; label: string }[] }) {
  return (
    <div>
      <h3 className="font-sans text-xs font-bold uppercase tracking-[0.14em] text-cacao-300">{title}</h3>
      <ul className="mt-4 space-y-2.5">
        {links.map((l) => (
          <li key={l.href}>
            <Link href={l.href} className="text-[15px] text-cacao-700 transition-colors hover:text-cacao">
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
