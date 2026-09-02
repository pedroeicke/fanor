import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { OCCASIONS } from "@/lib/catalog";
import { getProducts } from "@/lib/catalog-db";
import { SectionHeading } from "@/components/ui/primitives";
import { IconArrowRight } from "@/components/ui/icons";
import { cdnImage } from "@/lib/format";
import { brand } from "@/lib/config";

export const metadata: Metadata = {
  title: "Tortas por ocasión",
  description: `Cumpleaños, aniversarios, tortas infantiles y para grupos grandes. Encuentra la torta que corresponde a tu celebración y prográmala en ${brand.city}.`,
  alternates: { canonical: "/ocasiones" },
};

export const revalidate = 300;

export default async function OcasionesPage() {
  const all = await getProducts();
  return (
    <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
      <SectionHeading
        as="h1"
        title="¿Qué estás celebrando?"
        subtitle="Cada celebración pide una torta distinta. Empieza por la ocasión y te mostramos las que encajan."
      />

      <ul className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {OCCASIONS.map((occasion) => {
          const list = all.filter((p) => p.occasions.includes(occasion.slug));
          const cover = list[Math.floor(list.length / 2)] ?? list[0];
          return (
            <li key={occasion.slug}>
              <Link
                href={`/ocasiones/${occasion.slug}`}
                className="group card block overflow-hidden transition-shadow hover:shadow-lift"
              >
                <div className="relative aspect-[4/3] overflow-hidden bg-crema-100">
                  {cover && (
                    <Image
                      src={cdnImage(cover.images[0].src, 640)}
                      alt=""
                      fill
                      sizes="(min-width:1024px) 380px, (min-width:640px) 50vw, 100vw"
                      className="object-cover transition-transform duration-500 group-hover:scale-105"
                    />
                  )}
                </div>
                <div className="p-5">
                  <h2 className="font-display text-xl">{occasion.name}</h2>
                  <p className="mt-1.5 text-[15px] leading-relaxed text-cacao-500">{occasion.blurb}</p>
                  {/* "Ver 0 tortas" era o que aparecia nas ocasiões ainda sem
                      produto vinculado no painel. */}
                  <p className="mt-3 flex items-center gap-1.5 text-sm font-medium text-terracota">
                    {list.length === 0
                      ? "Pídela a medida"
                      : `Ver ${list.length} ${list.length === 1 ? "torta" : "tortas"}`}
                    <IconArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                  </p>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
