"use client";

import { useMemo } from "react";
import { availableDates, slotsForDate } from "@/lib/delivery";
import { useDeliveryConfig } from "@/components/delivery/DeliveryConfigProvider";
import { DatePicker } from "./DatePicker";
import { cx } from "@/lib/format";
import { IconStore, IconTruck } from "@/components/ui/icons";
import type { DeliveryMethod } from "@/lib/cart";

/**
 * Data e horário de entrega escolhidos ANTES de adicionar ao carrinho.
 *
 * Este é o buraco central do site atual: em nenhuma tela — produto, carrinho
 * ou checkout — se pergunta quando a torta é para. Sem isso, todo pedido
 * precisava de uma conversa no WhatsApp para virar pedido de verdade, e cada
 * conversa é uma chance de desistir.
 *
 * A data abre um calendário. Quem compra torta pensa em dia da semana e
 * proximidade — "o sábado que vem" —, não em posição numa lista. O calendário
 * mostra as duas coisas de uma vez, e por ser flutuante não alarga a coluna
 * nem provoca rolagem horizontal, que foi o defeito do carrossel de dias que
 * havia aqui antes.
 */
export function DeliveryPicker({
  leadTimeHours,
  method,
  dateISO,
  slotId,
  onMethodChange,
  onDateChange,
  onSlotChange,
  error,
}: {
  leadTimeHours: number;
  method: DeliveryMethod;
  dateISO: string | null;
  slotId: string | null;
  onMethodChange: (m: DeliveryMethod) => void;
  onDateChange: (iso: string) => void;
  onSlotChange: (id: string) => void;
  error?: string | null;
}) {
  const config = useDeliveryConfig();
  const dates = useMemo(() => availableDates(config, leadTimeHours, 90), [config, leadTimeHours]);
  const slots = dateISO ? slotsForDate(config, dateISO) : [];

  return (
    <fieldset>
      <legend className="mb-2.5 flex flex-wrap items-baseline gap-x-2 text-[15px] font-semibold">
        ¿Cuándo la necesitas?
        <span className="text-[13px] font-normal text-cacao-300">
          Preparamos con {leadTimeHours} horas de anticipación
        </span>
      </legend>

      <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
        <DatePicker
          value={dateISO}
          available={dates.map((d) => d.iso)}
          onChange={onDateChange}
          invalid={Boolean(error)}
        />

        {/* Quem retira na loja não paga frete, e saber disso cedo remove a
            objeção de custo antes de escolher o horário. */}
        {(
          [
            { id: "delivery", label: "Delivery", icon: <IconTruck className="h-[18px] w-[18px]" /> },
            {
              id: "pickup",
              label: "Recojo en tienda",
              icon: <IconStore className="h-[18px] w-[18px]" />,
            },
          ] as const
        ).map((opt) => (
          <button
            key={opt.id}
            type="button"
            aria-pressed={method === opt.id}
            onClick={() => onMethodChange(opt.id as DeliveryMethod)}
            className={cx(
              "flex h-12 items-center justify-center gap-2 whitespace-nowrap rounded-xl border px-4 text-sm font-medium transition-colors",
              method === opt.id
                ? "border-dorado-600 bg-dorado-100 text-cacao"
                : "border-crema-300 bg-white text-cacao-700 hover:border-cacao/30",
            )}
          >
            {opt.icon}
            {opt.label}
          </button>
        ))}
      </div>

      {dateISO && slots.length > 0 && (
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {slots.map((s) => (
            <button
              key={s.id}
              type="button"
              aria-pressed={slotId === s.id}
              onClick={() => onSlotChange(s.id)}
              className={cx(
                "h-11 rounded-xl border px-2 text-[13px] font-medium transition-colors",
                slotId === s.id
                  ? "border-dorado-600 bg-dorado-100 text-cacao"
                  : "border-crema-300 bg-white text-cacao-700 hover:border-cacao/30",
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}

      {error && (
        <p role="alert" className="mt-2.5 text-sm font-medium text-terracota">
          {error}
        </p>
      )}
    </fieldset>
  );
}
