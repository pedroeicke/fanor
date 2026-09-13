import Link from "next/link";
import { cx, soles } from "@/lib/format";
import { formatDuration } from "@/lib/gestion/dates";
import { EmptyState, Section, StatCard } from "@/components/admin/ui";
import type { LeadMetrics as Metrics } from "./shared";

/**
 * Relatório de atendimento: quanto demoram, quanto fecham, por que perdem.
 *
 * É a pergunta que o Joseka não conseguia responder sem abrir o WhatsApp de
 * cada vendedora. A régua fica escrita na tela, para ninguém ler "tempo de
 * resposta" como algo que o sistema não mede (leitura da mensagem, conversa
 * de verdade).
 */

export type MetricsRow = { key: string; label: string; metrics: Metrics };
export type LossReasonRow = { reason: string; count: number; details: string[] };

function minutes(value: number | null) {
  return value === null ? "—" : formatDuration(value);
}

function pct(value: number | null) {
  return value === null ? "—" : `${value}%`;
}

export function LeadMetrics({
  period,
  periodHrefs,
  slaMin,
  total,
  byStore,
  bySeller,
  lossReasons,
}: {
  period: number;
  /** Link de cada período, preservando os filtros de loja e vendedora. */
  periodHrefs: { days: number; href: string }[];
  slaMin: number;
  total: Metrics;
  byStore: MetricsRow[];
  bySeller: MetricsRow[];
  lossReasons: LossReasonRow[];
}) {
  const lostTotal = lossReasons.reduce((sum, r) => sum + r.count, 0);

  return (
    <Section
      title="Métricas de atención"
      aside={
        <div className="flex gap-1 rounded-full border border-crema-300 bg-crema-100 p-1" role="group" aria-label="Período">
          {periodHrefs.map(({ days, href }) => (
            <Link
              key={days}
              href={href}
              scroll={false}
              aria-current={days === period ? "true" : undefined}
              className={cx(
                "flex h-11 items-center rounded-full px-4 text-sm font-semibold transition-colors",
                days === period ? "bg-white text-cacao shadow-[0_1px_2px_rgb(59_35_20/0.1)]" : "text-cacao-500 hover:text-cacao",
              )}
            >
              {days} días
            </Link>
          ))}
        </div>
      }
    >
      <div className="space-y-6 px-5 py-5">
        <p className="rounded-2xl border border-cacao/20 bg-crema-100 px-4 py-3 text-[13px] leading-relaxed text-cacao-700">
          Leads <strong>recibidos en los últimos {period} días</strong>. El <strong>tiempo de respuesta</strong> va desde
          que el lead se asignó a la tienda (o se registró, si nunca se asignó) hasta que alguien tocó{" "}
          <strong>«Escribir por WhatsApp»</strong>. No mide si el cliente leyó ni cuánto duró la conversación. Plazo
          actual: {slaMin} min.
        </p>

        {total.received === 0 ? (
          <EmptyState>Sin leads recibidos en los últimos {period} días con estos filtros.</EmptyState>
        ) : (
          <>
            {/* Uma coluna no celular: "S/ 12345.00" no tamanho do StatCard não cabe em meia tela. */}
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <StatCard label="Recibidos" value={total.received} />
              <StatCard
                label="Contactados"
                value={total.contacted}
                hint={`${total.received - total.contacted} sin contacto registrado`}
                tone={total.contacted < total.received ? "warn" : undefined}
              />
              <StatCard
                label="Mediana 1er contacto"
                value={minutes(total.medianMin)}
                hint={`P90: ${minutes(total.p90Min)}`}
                tone={total.medianMin !== null && total.medianMin >= slaMin ? "warn" : undefined}
              />
              <StatCard
                label="Dentro del plazo"
                value={pct(total.withinSlaPct)}
                hint={total.contacted ? `${total.withinSla} de ${total.contacted} contactados` : "Nadie contactado aún"}
                tone={total.withinSlaPct === null ? undefined : total.withinSlaPct >= 80 ? "ok" : "warn"}
              />
              <StatCard
                label="Conversión"
                value={pct(total.conversionPct)}
                hint={`${total.won} ganados de ${total.won + total.lost} cerrados`}
              />
              <StatCard label="Valor ganado" value={soles(total.wonValue)} hint={`${total.won} ventas`} />
            </ul>

            <BreakdownTable title="Por tienda" rows={byStore} />
            <BreakdownTable title="Por vendedora" rows={bySeller} />

            <div>
              <h4 className="font-display text-base">Motivos de pérdida</h4>
              {lostTotal === 0 ? (
                <p className="mt-2 text-sm text-cacao-500">Ningún lead perdido en el período.</p>
              ) : (
                <ul className="mt-3 space-y-3">
                  {lossReasons.map((row) => {
                    const share = Math.round((row.count / lostTotal) * 100);
                    return (
                      <li key={row.reason} className="text-sm">
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="font-medium text-cacao">{row.reason}</span>
                          <span className="tabular-nums text-cacao-500">
                            {row.count} · {share}%
                          </span>
                        </div>
                        <div className="mt-1 h-2 overflow-hidden rounded-full bg-crema-200" aria-hidden>
                          <div className="h-full rounded-full bg-terracota/70" style={{ width: `${share}%` }} />
                        </div>
                        {row.details.length > 0 && (
                          <p className="mt-1 text-[13px] text-cacao-500">{row.details.join(" · ")}</p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </>
        )}
      </div>
    </Section>
  );
}

function BreakdownTable({ title, rows }: { title: string; rows: MetricsRow[] }) {
  if (!rows.length) return null;
  return (
    <div>
      <h4 className="font-display text-base">{title}</h4>
      <div className="mt-2 overflow-x-auto rounded-2xl border border-crema-200">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-crema-100 text-left text-[12px] font-bold uppercase tracking-[0.1em] text-cacao-300">
            <tr>
              <th className="px-4 py-2.5">Nombre</th>
              <th className="px-3 py-2.5 text-right">Recibidos</th>
              <th className="px-3 py-2.5 text-right">Contactados</th>
              <th className="px-3 py-2.5 text-right">Mediana</th>
              <th className="px-3 py-2.5 text-right">P90</th>
              <th className="px-3 py-2.5 text-right">En plazo</th>
              <th className="px-3 py-2.5 text-right">Ganados</th>
              <th className="px-3 py-2.5 text-right">Conversión</th>
              <th className="px-4 py-2.5 text-right">Valor ganado</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-crema-200 tabular-nums">
            {rows.map(({ key, label, metrics: m }) => (
              <tr key={key}>
                <td className="px-4 py-2.5 font-medium text-cacao">{label}</td>
                <td className="px-3 py-2.5 text-right">{m.received}</td>
                <td className="px-3 py-2.5 text-right">{m.contacted}</td>
                <td className="px-3 py-2.5 text-right">{minutes(m.medianMin)}</td>
                <td className="px-3 py-2.5 text-right">{minutes(m.p90Min)}</td>
                <td className="px-3 py-2.5 text-right">{pct(m.withinSlaPct)}</td>
                <td className="px-3 py-2.5 text-right">{m.won}</td>
                <td className="px-3 py-2.5 text-right">{pct(m.conversionPct)}</td>
                <td className="px-4 py-2.5 text-right">{soles(m.wonValue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
