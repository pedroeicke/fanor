"use client";

import type { ReactNode } from "react";
import { track } from "@/lib/analytics";
import { cx } from "@/lib/format";
import { IconWhatsapp } from "@/components/ui/icons";

/**
 * Link de WhatsApp da vitrine, com medição.
 *
 * É o "checkout" desta página: sem o evento, não dá para saber quantas
 * reservas saíram da vitrine nem de qual loja. O mesmo nome de evento do
 * botão flutuante (`whatsapp_click`), com `location` separando a origem.
 */
export function WhatsappLink({
  href,
  children,
  label,
  item,
  store,
  className,
}: {
  href: string;
  children: ReactNode;
  /** Nome acessível completo quando o texto visível é curto ("Reservar"). */
  label?: string;
  item?: string;
  store?: string;
  className?: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      onClick={() => track("whatsapp_click", { location: "vitrina", item_name: item, store })}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-full bg-[#25D366] font-semibold text-[#0b3d20] transition-colors hover:bg-[#1fbb59]",
        className,
      )}
    >
      <IconWhatsapp className="h-[18px] w-[18px] shrink-0" />
      {children}
    </a>
  );
}
