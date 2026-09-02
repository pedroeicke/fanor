import { IconCake, IconShield, IconTruck, IconWhatsapp } from "@/components/ui/icons";
import { getDeliveryConfig } from "@/lib/delivery-db";
import { soles } from "@/lib/format";
import { brand } from "@/lib/config";

async function items() {
  const config = await getDeliveryConfig();
  return [
  {
    icon: <IconShield className="h-6 w-6" />,
    title: "Pago seguro",
    text: "Tarjeta, Yape o Plin. No guardamos los datos de tu tarjeta.",
  },
  {
    icon: <IconTruck className="h-6 w-6" />,
    title: "Entrega programada",
    text: `Tú eliges día y franja horaria. De cortesía desde ${soles(config.freeFrom)}.`,
  },
  {
    icon: <IconCake className="h-6 w-6" />,
    title: "Hecha fresca",
    text: "La horneamos para tu fecha, nunca sale del congelador.",
  },
  {
    icon: <IconWhatsapp className="h-6 w-6" />,
    title: "Te acompañamos",
    text: `Escríbenos al ${brand.whatsappDisplay} antes, durante y después.`,
    },
  ];
}

export async function TrustBar() {
  const list = await items();
  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {list.map((item) => (
        <li key={item.title} className="card flex gap-3.5 p-4">
          <span className="shrink-0 text-dorado-600">{item.icon}</span>
          <span>
            <strong className="block text-[15px] font-semibold">{item.title}</strong>
            <span className="mt-0.5 block text-[13px] leading-relaxed text-cacao-500">{item.text}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
