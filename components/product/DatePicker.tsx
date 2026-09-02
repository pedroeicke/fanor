"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { formatDateLong, parseISO, toISO } from "@/lib/delivery";
import { cx } from "@/lib/format";
import { IconCalendar, IconChevron } from "@/components/ui/icons";

/**
 * Calendário de entrega.
 *
 * Escolher "sábado que vem" num `<select>` de 90 linhas é hostil: a pessoa
 * pensa em dia da semana e proximidade, não em posição numa lista. O
 * calendário mostra as duas coisas de uma vez.
 *
 * Dia indisponível aparece esmaecido em vez de sumir: ver que o sábado está
 * fechado é informação; um buraco na grade seria confusão.
 *
 * Semana começa na segunda, como nos calendários do Peru.
 */

const WEEKDAYS = ["L", "M", "M", "J", "V", "S", "D"];
const MONTHS = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

/** Segunda = 0. `getDay()` devolve domingo = 0, daí o deslocamento. */
const weekIndex = (date: Date) => (date.getDay() + 6) % 7;

export function DatePicker({
  value,
  available,
  onChange,
  invalid,
}: {
  value: string | null;
  /** Datas em ISO que a operação consegue cumprir. */
  available: string[];
  onChange: (iso: string) => void;
  invalid?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const availableSet = useMemo(() => new Set(available), [available]);
  const first = available[0] ? parseISO(available[0]) : new Date();
  const last = available[available.length - 1]
    ? parseISO(available[available.length - 1])
    : new Date();

  /* Abre no mês da data escolhida; sem escolha, no mês do primeiro dia livre. */
  const [cursor, setCursor] = useState(() => {
    const base = (value ? parseISO(value) : first) ?? new Date();
    return { year: base.getFullYear(), month: base.getMonth() };
  });

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onClick = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  const monthStart = new Date(cursor.year, cursor.month, 1);
  const daysInMonth = new Date(cursor.year, cursor.month + 1, 0).getDate();
  const leading = weekIndex(monthStart);

  /* Não deixa navegar para meses sem nenhuma data possível. */
  const atFirstMonth =
    !first ||
    (cursor.year === first.getFullYear() && cursor.month === first.getMonth());
  const atLastMonth =
    !last || (cursor.year === last.getFullYear() && cursor.month === last.getMonth());

  const step = (delta: number) =>
    setCursor(({ year, month }) => {
      const d = new Date(year, month + delta, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={cx(
          "flex h-12 w-full items-center gap-2.5 rounded-xl border bg-white px-4 text-left text-[15px] transition-colors",
          invalid ? "border-terracota" : "border-crema-300 hover:border-cacao/30",
          open && "border-dorado-600",
        )}
      >
        <IconCalendar className="h-[18px] w-[18px] shrink-0 text-dorado-600" />
        <span className={cx("truncate", !value && "text-cacao-300")}>
          {value ? formatDateLong(value) : "Selecciona una fecha"}
        </span>
        <IconChevron
          className={cx("ml-auto h-4 w-4 shrink-0 text-cacao-300 transition-transform", open && "rotate-90")}
        />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Elige la fecha de entrega"
          /* Absoluto e com largura fixa: o calendário não participa do fluxo,
             então nunca alarga a coluna nem provoca rolagem horizontal. */
          className="absolute left-0 top-full z-30 mt-2 w-[19rem] rounded-2xl border border-crema-300 bg-white p-4 shadow-lift"
        >
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => step(-1)}
              disabled={atFirstMonth}
              aria-label="Mes anterior"
              className="grid h-9 w-9 place-items-center rounded-full text-cacao-700 hover:bg-crema-100 disabled:opacity-25"
            >
              <IconChevron className="h-4 w-4 rotate-180" />
            </button>

            <p aria-live="polite" className="font-display text-[1.05rem] capitalize">
              {MONTHS[cursor.month]} {cursor.year}
            </p>

            <button
              type="button"
              onClick={() => step(1)}
              disabled={atLastMonth}
              aria-label="Mes siguiente"
              className="grid h-9 w-9 place-items-center rounded-full text-cacao-700 hover:bg-crema-100 disabled:opacity-25"
            >
              <IconChevron className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-3 grid grid-cols-7 gap-1">
            {WEEKDAYS.map((d, i) => (
              <span
                key={i}
                aria-hidden
                className="grid h-8 place-items-center text-[11px] font-semibold uppercase text-cacao-300"
              >
                {d}
              </span>
            ))}

            {Array.from({ length: leading }, (_, i) => <span key={`x${i}`} />)}

            {Array.from({ length: daysInMonth }, (_, i) => {
              const day = i + 1;
              const iso = toISO(new Date(cursor.year, cursor.month, day));
              const usable = availableSet.has(iso);
              const selected = value === iso;
              const soonest = available[0] === iso;

              return (
                <button
                  key={iso}
                  type="button"
                  disabled={!usable}
                  aria-pressed={selected}
                  aria-label={formatDateLong(iso)}
                  onClick={() => {
                    onChange(iso);
                    setOpen(false);
                  }}
                  className={cx(
                    "relative grid h-10 place-items-center rounded-lg text-sm font-medium transition-colors",
                    selected && "bg-cacao text-crema",
                    !selected && usable && "text-cacao hover:bg-dorado-100",
                    !usable && "cursor-not-allowed text-cacao-300/50 line-through",
                  )}
                >
                  {day}
                  {soonest && !selected && (
                    <span
                      aria-hidden
                      className="absolute bottom-1 h-1 w-1 rounded-full bg-verde"
                    />
                  )}
                </button>
              );
            })}
          </div>

          <p className="mt-3 border-t border-crema-200 pt-3 text-[12px] leading-relaxed text-cacao-500">
            <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-verde align-middle" />
            La fecha más próxima que podemos cumplir. Los días tachados no están disponibles.
          </p>
        </div>
      )}
    </div>
  );
}
