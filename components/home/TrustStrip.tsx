import { brand, yearsInBusiness } from "@/lib/config";
import { getDeliveryConfig } from "@/lib/delivery-db";
import { Stars } from "@/components/ui/primitives";
import { IconCake, IconShield, IconStar, IconTruck } from "@/components/ui/icons";
import { SHOW_REVIEWS } from "@/data/reviews";

export async function TrustStrip() {
  const config = await getDeliveryConfig();
  return (
    <section className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
      <ul className="grid gap-6 rounded-2xl bg-crema-100 px-6 py-7 sm:grid-cols-3 sm:gap-0 sm:divide-x sm:divide-crema-300">
        <Item icon={<IconCake className="h-6 w-6" />} title={`Más de ${yearsInBusiness} años`}>
          endulzando {brand.city}
        </Item>

        {/* A nota em `brand` é de exemplo. Enquanto não houver avaliações
            reais, o espaço fala de pagamento — verdade que já vale hoje. */}
        {SHOW_REVIEWS ? (
          <Item icon={<IconStar className="h-6 w-6" />} title={`${brand.rating} en reseñas`}>
            <Stars value={brand.rating} size={15} />
          </Item>
        ) : (
          <Item icon={<IconShield className="h-6 w-6" />} title="Pago seguro">
            tarjeta, Yape o Plin
          </Item>
        )}

        <Item icon={<IconTruck className="h-6 w-6" />} title="Entrega programada">
          en {config.districts.length} distritos de {brand.city}
        </Item>
      </ul>
    </section>
  );
}

function Item({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex items-center justify-center gap-4 sm:px-6">
      <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-dorado-100 text-dorado-600">
        {icon}
      </span>
      <span className="text-[15px] leading-snug">
        <strong className="block font-display text-lg font-semibold">{title}</strong>
        <span className="text-cacao-500">{children}</span>
      </span>
    </li>
  );
}
