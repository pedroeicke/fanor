import { cx } from "@/lib/format";

/**
 * Selos dos meios de pagamento.
 *
 * São marcas nominativas com a cor de cada bandeira, não os logotipos oficiais
 * — trocar por SVGs licenciados é uma edição neste arquivo. O que importa aqui
 * é a função: dizer, antes do checkout, o que a loja aceita.
 */
const MARKS = [
  { label: "VISA", className: "text-[#1434CB] font-black italic tracking-tight" },
  { label: "Mastercard", className: "text-[#EB001B] font-bold" },
  { label: "AMEX", className: "text-[#006FCF] font-black tracking-tight" },
  { label: "Yape", className: "text-[#742384] font-bold" },
  { label: "Plin", className: "text-[#0DB8B2] font-bold" },
  { label: "BCP", className: "text-[#002A8D] font-black" },
  { label: "Interbank", className: "text-[#00A94F] font-bold" },
];

export function PaymentMarks({ only, className }: { only?: string[]; className?: string }) {
  const marks = only ? MARKS.filter((m) => only.includes(m.label)) : MARKS;
  return (
    <ul className={cx("flex flex-wrap items-center gap-2", className)}>
      {marks.map((m) => (
        <li
          key={m.label}
          className="grid h-7 place-items-center rounded-md border border-crema-300 bg-white px-2"
        >
          <span className={cx("text-[11px] leading-none", m.className)}>{m.label}</span>
        </li>
      ))}
    </ul>
  );
}
