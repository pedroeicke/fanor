import { cx } from "@/lib/format";

/**
 * Colunas de uma série só (faturamento por dia ou semana), sem biblioteca.
 *
 * Passar o dedo ou o mouse numa coluna mostra o valor; o teclado chega a
 * cada coluna com Tab. O mesmo número está na tabela logo abaixo — a dica
 * ajuda, não é o único caminho até o dado.
 *
 * Período longo não espreme as colunas até sumirem: abaixo de 16 px por
 * coluna o gráfico rola na horizontal dentro do próprio cartão.
 */

export type ColumnPoint = { key: string; axisLabel: string; label: string; value: number; display: string; detail?: string };

const PLOT_HEIGHT = 176;
const MIN_COLUMN_PX = 16;
const GUTTER_PX = 56;

/** Teto "redondo" do eixo e três marcas: 0 · 400 · 800 · 1,200. */
function niceTicks(max: number) {
  if (max <= 0) return { top: 1, ticks: [0] };
  const rough = max / 3;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= rough) ?? 10 * magnitude;
  return { top: step * 3, ticks: [0, step, step * 2, step * 3] };
}

export function ColumnChart({ points, formatTick, caption }: { points: ColumnPoint[]; formatTick: (value: number) => string; caption: string }) {
  const max = Math.max(0, ...points.map((p) => p.value));
  const { top, ticks } = niceTicks(max);
  const n = points.length;
  /* Um rótulo de eixo a cada k colunas, para os textos não se atropelarem. */
  const every = Math.max(1, Math.ceil(n / 10));

  return (
    <figure className="px-5 pb-4 pt-5">
      <figcaption className="sr-only">{caption}</figcaption>
      <div className="overflow-x-auto">
        {/* O respiro no alto é do rótulo da marca de cima, que o rolador cortaria pela metade. */}
        <div className="pt-2" style={{ minWidth: `${n * MIN_COLUMN_PX + GUTTER_PX}px` }}>
          <div className="relative" style={{ height: PLOT_HEIGHT }}>
            {ticks.map((tick) => (
              <div key={tick} aria-hidden className="absolute inset-x-0 border-t border-crema-200" style={{ bottom: `${(tick / top) * 100}%` }}>
                <span className="absolute left-0 -translate-y-1/2 bg-white pr-2 text-[11px] tabular-nums text-cacao-300">{formatTick(tick)}</span>
              </div>
            ))}
            <ol className="absolute inset-0 flex items-end gap-[2px]" style={{ paddingLeft: GUTTER_PX }}>
              {points.map((p, i) => (
                <li
                  key={p.key}
                  tabIndex={0}
                  aria-label={`${p.label}: ${p.display}${p.detail ? `, ${p.detail}` : ""}`}
                  className="group relative flex h-full flex-1 items-end justify-center"
                >
                  <span
                    aria-hidden
                    className="block w-full max-w-6 rounded-t-[4px] bg-dorado-600 transition-colors group-hover:bg-dorado group-focus-visible:bg-dorado"
                    style={{ height: p.value > 0 ? `max(2px, ${(p.value / top) * 100}%)` : 0 }}
                  />
                  <span
                    role="tooltip"
                    className={cx(
                      "pointer-events-none invisible absolute top-0 z-10 whitespace-nowrap rounded-lg bg-cacao px-2.5 py-1.5 text-left text-[12px] leading-tight text-white shadow-lift group-hover:visible group-focus-visible:visible",
                      i < 2 ? "left-0" : i >= n - 2 ? "right-0" : "left-1/2 -translate-x-1/2",
                    )}
                  >
                    <strong className="block text-[13px] font-semibold">{p.display}</strong>
                    <span className="text-crema-300">{p.label}{p.detail ? ` · ${p.detail}` : ""}</span>
                  </span>
                </li>
              ))}
            </ol>
          </div>
          <ol aria-hidden className="mt-1.5 flex gap-[2px]" style={{ paddingLeft: GUTTER_PX }}>
            {points.map((p, i) => (
              <li key={p.key} className="relative h-4 flex-1">
                {i % every === 0 && (
                  <span className="absolute left-1/2 -translate-x-1/2 whitespace-nowrap text-[11px] text-cacao-300">{p.axisLabel}</span>
                )}
              </li>
            ))}
          </ol>
        </div>
      </div>
    </figure>
  );
}
