"use client";

import { usePathname } from "next/navigation";
import { brand, whatsappLink } from "@/lib/config";
import { track } from "@/lib/analytics";
import { IconWhatsapp } from "@/components/ui/icons";

/**
 * WhatsApp como suporte, não como checkout.
 *
 * No site antigo ele era a única forma de fechar o pedido — data, mensagem e
 * frete só existiam na conversa. Aqui a compra fecha sozinha e o botão some
 * durante o checkout, onde qualquer saída da página é abandono.
 */
export function WhatsappFab() {
  const pathname = usePathname();
  if (pathname.startsWith("/checkout") || pathname.startsWith("/pedido")) return null;

  return (
    <a
      href={whatsappLink(`Hola ${brand.name}, quisiera una recomendación para mi celebración.`)}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() => track("whatsapp_click", { location: pathname })}
      className="fixed bottom-5 right-5 z-30 grid h-14 w-14 place-items-center rounded-full bg-[#25D366] text-white shadow-lift transition-transform hover:scale-105 max-lg:bottom-[calc(1.25rem+env(safe-area-inset-bottom))]"
      aria-label="Escríbenos por WhatsApp"
    >
      <IconWhatsapp className="h-7 w-7" />
    </a>
  );
}
