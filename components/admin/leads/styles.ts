/**
 * Classes dos botões da tela de leads. Mesmo desenho dos botões da loja
 * (components/ui/primitives), repetido aqui porque o "Escribir por WhatsApp"
 * é um <a> externo, e o `Button` de lá só existe como <button> e <Link>.
 *
 * Uma constante por variante, sem somar classe por cima: no Tailwind quem
 * vence entre `bg-white` e `bg-dorado` é a ordem do CSS gerado, não a ordem
 * no atributo — sobrescrever assim dá cor diferente de um build para outro.
 */

const base =
  "inline-flex items-center justify-center gap-2 rounded-full font-semibold transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-45 aria-disabled:pointer-events-none aria-disabled:opacity-45";

export const primaryButton = `${base} h-12 px-6 text-[15px] bg-dorado text-cacao hover:bg-dorado-600`;

const whatsapp = "bg-[#25D366] text-[#0b3d20] hover:bg-[#1fbb59]";
export const whatsappButton = `${base} h-12 px-5 text-[15px] ${whatsapp}`;
export const whatsappButtonSmall = `${base} h-11 px-4 text-sm ${whatsapp}`;

export const secondaryButton = `${base} h-11 px-4 text-sm font-medium border border-crema-300 bg-white text-cacao-700 hover:border-cacao/35`;

export const dangerButton = `${base} h-11 px-4 text-sm font-medium border border-terracota/35 bg-white text-terracota-700 hover:bg-terracota/10`;

/* Confirmação dentro dos painéis do card. */
export const confirmButton = `${base} h-11 w-full px-4 text-sm bg-dorado text-cacao hover:bg-dorado-600`;
export const wonButton = `${base} h-11 w-full px-4 text-sm bg-verde text-white hover:bg-cacao-700`;
export const lostButton = `${base} h-11 w-full px-4 text-sm bg-terracota text-white hover:bg-terracota-700`;
