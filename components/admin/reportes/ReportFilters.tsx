import Link from "next/link";
import { addDays } from "@/lib/gestion/dates";
import { cx } from "@/lib/format";
import { inputClass, labelClass } from "@/components/admin/ui";

/**
 * Filtros do relatório de operação, numa linha só acima de tudo que eles
 * afetam: todo número da página responde ao mesmo recorte.
 *
 * Formulário GET comum: a URL guarda o recorte, dá para mandar o link a quem
 * pediu o número e funciona sem JavaScript.
 */

type Filters = { from: string; to: string; storeId: string | null; group: "dia" | "semana" };

const PRESETS = [
  { days: 1, label: "Hoy" },
  { days: 7, label: "7 días" },
  { days: 30, label: "30 días" },
  { days: 90, label: "90 días" },
];

export function ReportFilters({ filters, stores, today, maxDays }: { filters: Filters; stores: { id: string; name: string }[]; today: string; maxDays: number }) {
  const presetHref = (days: number) => {
    const params = new URLSearchParams({ desde: addDays(today, -(days - 1)), hasta: today });
    if (filters.storeId) params.set("tienda", filters.storeId);
    /* Noventa barras diárias não se leem num celular: o atalho longo já vem por semana. */
    params.set("agrupar", days > 31 ? "semana" : filters.group);
    return `/admin/reportes/operacion?${params.toString()}`;
  };

  return (
    <div className="card space-y-4 p-4 sm:p-5">
      <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1" aria-label="Períodos rápidos">
        {PRESETS.map((preset) => {
          const active = filters.to === today && filters.from === addDays(today, -(preset.days - 1));
          return (
            <Link
              key={preset.days}
              href={presetHref(preset.days)}
              aria-current={active ? "true" : undefined}
              className={cx(
                "flex h-11 shrink-0 items-center rounded-full border px-5 text-sm font-medium transition-colors",
                active ? "border-dorado bg-dorado text-cacao" : "border-crema-300 bg-white text-cacao-700 hover:border-cacao/35",
              )}
            >
              {preset.label}
            </Link>
          );
        })}
      </div>

      <form method="get" action="/admin/reportes/operacion" className="grid grid-cols-2 items-end gap-3 lg:grid-cols-[repeat(4,minmax(0,1fr))_auto]">
        <label className="block">
          <span className={labelClass}>Desde</span>
          <input type="date" name="desde" defaultValue={filters.from} max={today} required className={inputClass} />
        </label>
        <label className="block">
          <span className={labelClass}>Hasta</span>
          <input type="date" name="hasta" defaultValue={filters.to} max={today} required className={inputClass} />
        </label>
        <label className="block">
          <span className={labelClass}>Tienda</span>
          <select name="tienda" defaultValue={filters.storeId ?? ""} className={inputClass}>
            <option value="">Todas</option>
            {stores.map((store) => (
              <option key={store.id} value={store.id}>
                {store.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={labelClass}>Agrupar ventas</span>
          <select name="agrupar" defaultValue={filters.group} className={inputClass}>
            <option value="dia">Por día</option>
            <option value="semana">Por semana</option>
          </select>
        </label>
        <button type="submit" className="col-span-2 h-11 rounded-full bg-dorado px-6 text-sm font-semibold text-cacao transition-colors hover:bg-dorado-600 lg:col-span-1">
          Aplicar
        </button>
        <p className="col-span-2 text-[12px] text-cacao-300 lg:col-span-5">Máximo {maxDays} días por consulta. Fechas en hora de Lima.</p>
      </form>
    </div>
  );
}
