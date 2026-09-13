"use client";

import { useState } from "react";
import { cx } from "@/lib/format";

/**
 * − [ 10 ] +  com alvo de toque de 44 px.
 *
 * O campo aceita digitar direto ("30" é mais rápido que trinta toques), mas
 * só devolve número inteiro dentro do limite. Enquanto a pessoa apaga para
 * redigitar, o rascunho fica só no campo; ao sair dele, volta ao último
 * valor válido.
 */
export function QuantityStepper({
  value,
  onChange,
  min = 1,
  max = 200,
  label,
  disabled = false,
}: {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  label: string;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);

  const set = (next: number) => onChange(Math.min(max, Math.max(min, next)));

  return (
    <div className={cx("inline-flex shrink-0 items-center rounded-full border border-crema-300 bg-white focus-within:border-dorado-600", disabled && "opacity-45")}>
      <button
        type="button"
        onClick={() => set(value - 1)}
        disabled={disabled || value <= min}
        aria-label={`Quitar uno: ${label}`}
        className="flex h-11 w-11 items-center justify-center rounded-full text-xl font-semibold text-cacao disabled:text-cacao-300"
      >
        −
      </button>
      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        aria-label={`Cantidad: ${label}`}
        disabled={disabled}
        value={draft ?? String(value)}
        onChange={(e) => {
          const text = e.target.value.replace(/\D/g, "").slice(0, 4);
          setDraft(text);
          const n = Number(text);
          if (text !== "" && Number.isInteger(n) && n >= min && n <= max) onChange(n);
        }}
        onBlur={() => setDraft(null)}
        onFocus={(e) => e.target.select()}
        className="h-11 w-12 bg-transparent text-center text-[16px] font-semibold tabular-nums text-cacao focus:outline-none"
      />
      <button
        type="button"
        onClick={() => set(value + 1)}
        disabled={disabled || value >= max}
        aria-label={`Agregar uno: ${label}`}
        className="flex h-11 w-11 items-center justify-center rounded-full text-xl font-semibold text-cacao disabled:text-cacao-300"
      >
        +
      </button>
    </div>
  );
}
