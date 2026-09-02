"use client";

import { useState, useTransition } from "react";
import { setProductStatus } from "@/app/admin/actions";
import { cx } from "@/lib/format";

const OPTIONS = [
  { value: "active", label: "Publicado" },
  { value: "draft", label: "Borrador" },
  { value: "unavailable", label: "Agotado" },
];

/**
 * Troca o estado de publicação direto na lista.
 *
 * Otimista: a etiqueta muda na hora e volta atrás se o servidor recusar.
 * Publicar e despublicar é a ação mais repetida do painel — obrigar a abrir o
 * produto para isso seria dois cliques a mais, dezenas de vezes por semana.
 */
export function StatusToggle({
  id,
  status,
  name,
}: {
  id: string;
  status: string;
  name: string;
}) {
  const [value, setValue] = useState(status);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleChange(next: string) {
    const previous = value;
    setValue(next);
    setError(null);

    startTransition(async () => {
      const result = await setProductStatus(id, next);
      if (!result.ok) {
        setValue(previous);
        setError(result.error);
      }
    });
  }

  return (
    <span className="relative shrink-0">
      <select
        value={value}
        disabled={pending}
        onChange={(e) => handleChange(e.target.value)}
        aria-label={`Estado de ${name}`}
        className={cx(
          "h-9 cursor-pointer appearance-none rounded-full border px-3.5 pr-8 text-[13px] font-medium transition-colors",
          "bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%23806047%22 stroke-width=%222%22 stroke-linecap=%22round%22><path d=%22m5 9 7 7 7-7%22/></svg>')] bg-[length:14px] bg-[right_0.7rem_center] bg-no-repeat",
          value === "active" && "border-verde/35 bg-verde-100 text-verde",
          value === "draft" && "border-crema-300 bg-white text-cacao-500",
          value === "unavailable" && "border-terracota/30 bg-terracota/10 text-terracota-700",
          pending && "opacity-60",
        )}
      >
        {OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>

      {error && (
        <span
          role="alert"
          className="absolute right-0 top-full z-10 mt-1 w-52 rounded-lg bg-terracota px-3 py-2 text-[12px] text-white shadow-lift"
        >
          {error}
        </span>
      )}
    </span>
  );
}
