import type { ReactNode } from "react";
import { cx } from "@/lib/format";
import { TONE_CLASS } from "@/lib/gestion/labels";

/**
 * Peças visuais repetidas nas telas de operação. Mesmo vocabulário do resto
 * do painel (card, crema, cacao, dorado): quem já usa Pedidos e Inventario
 * não tem de reaprender nada no Taller ou na Recepción.
 */

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h2 className="font-display text-2xl">{title}</h2>
        {description && <p className="mt-1 max-w-2xl text-sm text-cacao-500">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function StatusPill({ status, map }: { status: string; map: Record<string, { label: string; tone: keyof typeof TONE_CLASS }> }) {
  const entry = map[status] ?? { label: status, tone: "muted" as const };
  return (
    <span className={cx("inline-flex h-7 items-center rounded-full border px-3 text-[12px] font-semibold", TONE_CLASS[entry.tone])}>
      {entry.label}
    </span>
  );
}

export function StatCard({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "warn" | "ok" }) {
  return (
    <li className="card p-5">
      <p className="text-[12px] font-bold uppercase tracking-[0.12em] text-cacao-300">{label}</p>
      <p className={cx("mt-1 font-display text-3xl font-semibold", tone === "warn" ? "text-terracota" : tone === "ok" ? "text-verde" : "text-cacao")}>
        {value}
      </p>
      {hint && <p className="mt-1 text-[13px] text-cacao-500">{hint}</p>}
    </li>
  );
}

export function Section({ title, aside, children, className }: { title: ReactNode; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx("card overflow-hidden", className)}>
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-crema-200 px-5 py-4">
        <h3 className="font-display text-lg">{title}</h3>
        {aside && <div className="text-sm text-cacao-500">{aside}</div>}
      </header>
      {children}
    </section>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="px-5 py-6 text-sm text-cacao-500">{children}</p>;
}

/** Aviso que fica no topo quando algo precisa de atenção antes de continuar. */
export function Notice({ tone = "info", children }: { tone?: "info" | "warn" | "bad" | "ok"; children: ReactNode }) {
  return <div className={cx("rounded-2xl border px-4 py-3 text-sm", TONE_CLASS[tone])}>{children}</div>;
}

export const inputClass =
  "h-11 w-full rounded-xl border border-crema-300 bg-white px-3 text-[15px] text-cacao placeholder:text-cacao-300 focus:border-dorado-600 focus:outline-none";

export const labelClass = "mb-1 block text-[12px] font-bold uppercase tracking-[0.1em] text-cacao-300";
