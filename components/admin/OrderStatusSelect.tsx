"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setOrderStatus } from "@/app/admin/actions";
import { cx } from "@/lib/format";

const OPTIONS = [
  { value: "pending_payment", label: "Esperando pago" },
  { value: "paid", label: "Pagado" },
  { value: "failed", label: "Pago fallido" },
  { value: "cancelled", label: "Cancelado" },
  { value: "abandoned", label: "Abandonado" },
];

const STYLE: Record<string, string> = {
  paid: "border-verde/35 bg-verde-100 text-verde",
  pending_payment: "border-dorado-600/40 bg-dorado-100 text-cacao-700",
  failed: "border-terracota/30 bg-terracota/10 text-terracota-700",
  cancelled: "border-crema-300 bg-crema-200 text-cacao-500",
  abandoned: "border-crema-300 bg-crema-100 text-cacao-300",
};

/**
 * Troca o estado direto na lista, com atualização otimista.
 *
 * Confirmar pagamento é a ação mais repetida do dia; exigir abrir o pedido
 * para isso seriam dois cliques a mais, dezenas de vezes por semana.
 */
export function OrderStatusSelect({ code, status }: { code: string; status: string }) {
  const router = useRouter();
  const [value, setValue] = useState(status);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleChange(next: string) {
    const previous = value;
    setValue(next);
    setError(null);

    startTransition(async () => {
      const result = await setOrderStatus(code, next);
      if (!result.ok) {
        setValue(previous);
        setError(result.error);
      } else {
        router.refresh();
      }
    });
  }

  return (
    <span className="relative">
      <select
        value={value}
        disabled={pending}
        onChange={(e) => handleChange(e.target.value)}
        aria-label={`Estado del pedido ${code}`}
        className={cx(
          "h-8 cursor-pointer appearance-none rounded-full border px-3 pr-7 text-[11px] font-semibold transition-colors",
          "bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%23806047%22 stroke-width=%222%22 stroke-linecap=%22round%22><path d=%22m5 9 7 7 7-7%22/></svg>')] bg-[length:12px] bg-[right_0.55rem_center] bg-no-repeat",
          STYLE[value],
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
        <span role="alert" className="absolute left-0 top-full z-10 mt-1 w-56 rounded-lg bg-terracota px-3 py-2 text-[12px] text-white shadow-lift">
          {error}
        </span>
      )}
    </span>
  );
}
