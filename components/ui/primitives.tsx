import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { cx } from "@/lib/format";
import { Flourish, IconStar } from "./icons";

/* -------------------------------------------------------------------------- */
/*  Botão                                                                     */
/* -------------------------------------------------------------------------- */

type Variant = "primary" | "outline" | "ghost" | "dark" | "whatsapp";
type Size = "sm" | "md" | "lg";

const VARIANTS: Record<Variant, string> = {
  /* Dourado com tinta cacau: 9:1 de contraste, legível ao sol. */
  primary:
    "bg-dorado text-cacao hover:bg-dorado-600 active:bg-dorado-600 shadow-[0_1px_2px_rgb(59_35_20/0.08)]",
  outline: "border border-cacao/25 text-cacao hover:border-cacao hover:bg-crema-100",
  ghost: "text-cacao hover:bg-crema-100",
  dark: "bg-cacao text-crema hover:bg-cacao-700",
  whatsapp: "bg-[#25D366] text-[#0b3d20] hover:bg-[#1fbb59]",
};

const SIZES: Record<Size, string> = {
  sm: "h-10 px-4 text-sm gap-2",
  md: "h-12 px-6 text-[15px] gap-2.5",
  lg: "h-14 px-8 text-base gap-3",
};

const buttonBase =
  "inline-flex items-center justify-center rounded-full font-semibold transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-45";

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ComponentProps<"button"> & { variant?: Variant; size?: Size }) {
  return <button className={cx(buttonBase, VARIANTS[variant], SIZES[size], className)} {...props} />;
}

export function ButtonLink({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ComponentProps<typeof Link> & { variant?: Variant; size?: Size }) {
  return <Link className={cx(buttonBase, VARIANTS[variant], SIZES[size], className)} {...props} />;
}

/* -------------------------------------------------------------------------- */
/*  Cabeçalho de seção                                                        */
/* -------------------------------------------------------------------------- */

export function SectionHeading({
  title,
  subtitle,
  align = "center",
  as: Tag = "h2",
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  align?: "center" | "left";
  as?: "h1" | "h2";
}) {
  return (
    <div className={cx(align === "center" ? "text-center" : "text-left")}>
      <Tag className="text-3xl sm:text-4xl lg:text-[2.75rem] leading-[1.1]">{title}</Tag>
      <Flourish
        className={cx("mt-3 h-4 w-28 text-dorado-600", align === "center" && "mx-auto")}
      />
      {subtitle && (
        <p className="mt-3 text-cacao-500 text-base sm:text-lg max-w-2xl mx-auto">{subtitle}</p>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Avaliação                                                                 */
/* -------------------------------------------------------------------------- */

export function Stars({ value, size = 16 }: { value: number; size?: number }) {
  const rounded = Math.round(value);
  return (
    <span
      className="inline-flex items-center gap-0.5 text-dorado"
      style={{ fontSize: size / 1.25 }}
      aria-label={`${value} de 5 estrellas`}
    >
      {[1, 2, 3, 4, 5].map((i) => (
        <IconStar key={i} filled={i <= rounded} className={i <= rounded ? "h-[1.25em] w-[1.25em]" : "h-[1.25em] w-[1.25em] opacity-30"} />
      ))}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/*  Chip de filtro                                                            */
/* -------------------------------------------------------------------------- */

export function Chip({
  active,
  className,
  ...props
}: ComponentProps<"button"> & { active?: boolean }) {
  return (
    <button
      aria-pressed={active}
      className={cx(
        "h-10 shrink-0 rounded-full border px-5 text-sm font-medium transition-colors",
        active
          ? "border-dorado bg-dorado text-cacao"
          : "border-crema-300 bg-white text-cacao-700 hover:border-cacao/35",
        className,
      )}
      {...props}
    />
  );
}

/* -------------------------------------------------------------------------- */
/*  Passo a passo do checkout                                                 */
/* -------------------------------------------------------------------------- */

export function FieldLabel({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <span className="mb-1.5 block text-sm font-medium text-cacao-700">
      {children}
      {hint && <span className="ml-1.5 font-normal text-cacao-300">{hint}</span>}
    </span>
  );
}

const fieldBase =
  "w-full rounded-xl border border-crema-300 bg-white px-4 text-[15px] text-cacao placeholder:text-cacao-300 transition-colors focus:border-dorado-600";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cx(fieldBase, "h-12", className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cx(fieldBase, "py-3 leading-relaxed", className)} {...props} />;
}

export function Select({ className, ...props }: ComponentProps<"select">) {
  return (
    <select
      className={cx(
        fieldBase,
        "h-12 appearance-none bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%23806047%22 stroke-width=%221.6%22 stroke-linecap=%22round%22><path d=%22m5 9 7 7 7-7%22/></svg>')] bg-[length:18px] bg-[right_1rem_center] bg-no-repeat pr-11",
        className,
      )}
      {...props}
    />
  );
}
