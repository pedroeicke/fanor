import { PAYMENT_METHOD } from "@/lib/gestion/labels";
import { EmptyState } from "@/components/admin/ui";
import { Legend, StackedBar } from "./StackedBar";
import { PAYMENT_COLOR, int, money, pct } from "./format";

/**
 * Como cada loja recebe: dinheiro, cartão, Yape, Plin…
 *
 * Serve à conferência do caixa (o que tinha de estar na gaveta) e à decisão
 * de maquininha e taxa. Barra por loja para comparar a mistura; tabela
 * embaixo para o valor exato.
 */

type StoreMix = { storeId: string; storeName: string; total: number; count: number; methods: Record<string, number> };

const ORDER = ["cash", "card", "yape", "plin", "transfer", "deposit", "credit"];

export function PaymentMix({ stores, totals }: { stores: StoreMix[]; totals: Record<string, number> }) {
  const grand = Object.values(totals).reduce((sum, v) => sum + v, 0);
  if (!stores.length || grand <= 0) return <EmptyState>Sin ventas pagadas en este período.</EmptyState>;

  const methods = [
    ...ORDER.filter((m) => (totals[m] ?? 0) > 0),
    ...Object.keys(totals).filter((m) => !ORDER.includes(m) && totals[m] > 0),
  ];
  const label = (m: string) => PAYMENT_METHOD[m] ?? m;

  return (
    <>
      <div className="space-y-4 px-5 py-4">
        <Legend items={methods.map((m) => ({ key: m, label: label(m), color: PAYMENT_COLOR[m] ?? "#8a6c54" }))} />
        <ul className="space-y-4">
          {stores.map((store) => (
            <li key={store.storeId}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
                <span className="font-medium text-cacao">{store.storeName}</span>
                <span className="tabular-nums text-cacao-700">
                  {money(store.total)} · {int(store.count)} {store.count === 1 ? "venta" : "ventas"}
                </span>
              </div>
              <StackedBar
                className="mt-2"
                label={`Formas de pago en ${store.storeName}`}
                segments={methods.map((m) => ({ key: m, label: label(m), value: Math.round((store.methods[m] ?? 0) * 100) / 100, color: PAYMENT_COLOR[m] ?? "#8a6c54" }))}
              />
            </li>
          ))}
        </ul>
      </div>

      <div className="overflow-x-auto border-t border-crema-200">
        <table className="w-full text-sm">
          <thead className="bg-crema-100 text-left text-[12px] font-bold uppercase tracking-[0.12em] text-cacao-300">
            <tr>
              <th scope="col" className="px-5 py-2.5">Forma de pago</th>
              {stores.map((s) => (
                <th key={s.storeId} scope="col" className="whitespace-nowrap px-3 py-2.5 text-right">{s.storeName}</th>
              ))}
              {stores.length > 1 && <th scope="col" className="px-3 py-2.5 text-right">Total</th>}
              <th scope="col" className="px-5 py-2.5 text-right">%</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-crema-200">
            {methods.map((m) => (
              <tr key={m}>
                <th scope="row" className="px-5 py-2.5 text-left font-medium text-cacao">
                  <span aria-hidden className="mr-2 inline-block size-2.5 rounded-[2px] align-middle" style={{ backgroundColor: PAYMENT_COLOR[m] ?? "#8a6c54" }} />
                  {label(m)}
                </th>
                {stores.map((s) => (
                  <td key={s.storeId} className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-cacao-700">{money(s.methods[m] ?? 0)}</td>
                ))}
                {stores.length > 1 && <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums font-semibold text-cacao">{money(totals[m] ?? 0)}</td>}
                <td className="px-5 py-2.5 text-right tabular-nums text-cacao-500">{pct(totals[m] ?? 0, grand)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t border-crema-300">
            <tr>
              <th scope="row" className="px-5 py-2.5 text-left font-semibold text-cacao">Total</th>
              {stores.map((s) => (
                <td key={s.storeId} className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums font-semibold text-cacao">{money(s.total)}</td>
              ))}
              {stores.length > 1 && <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums font-semibold text-cacao">{money(grand)}</td>}
              <td className="px-5 py-2.5 text-right tabular-nums text-cacao-500">100%</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </>
  );
}
