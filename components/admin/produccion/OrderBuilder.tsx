"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/lib/gestion/server";
import { formatQuantity } from "@/lib/produccion/plan";
import { cx } from "@/lib/format";
import { EmptyState, Notice, Section, inputClass, labelClass } from "@/components/admin/ui";
import {
  NOTES_MAX,
  QUANTITY_MAX,
  SEARCH_MIN,
  STAGE_LABEL,
  type ArticleOption,
  type BatidaFormat,
  type DemandOrder,
  type OrderInput,
  type PlanPreview,
  type TargetDraft,
} from "@/components/admin/produccion/types";

type Actions = {
  search: (query: string) => Promise<ActionResult<ArticleOption[]>>;
  formats: (batidaCode: string) => Promise<ActionResult<BatidaFormat[]>>;
  preview: (input: { targets: { code: string; quantity: number }[]; useStock: boolean; fullBatchPreparados: boolean }) => Promise<ActionResult<PlanPreview>>;
  create: (input: OrderInput) => Promise<ActionResult<{ id: string; number: number }>>;
};

/**
 * Montar uma ordem de produção.
 *
 * Quem produz só diz quantos quer de cada formato; a conta das frações é do
 * sistema. A lista aceita misturar formatos da mesma batida ("1 torta 26 e 2
 * pranchas"), que é o caso que motivou a tela.
 */
export function OrderBuilder({
  batidas,
  demand,
  today,
  actions,
}: {
  batidas: ArticleOption[];
  demand: DemandOrder[];
  today: string;
  actions: Actions;
}) {
  const router = useRouter();
  const [targets, setTargets] = useState<TargetDraft[]>([]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ArticleOption[]>([]);
  const [batida, setBatida] = useState("");
  const [formats, setFormats] = useState<BatidaFormat[]>([]);
  const [useStock, setUseStock] = useState(true);
  const [fullBatch, setFullBatch] = useState(false);
  const [forDate, setForDate] = useState(today);
  const [notes, setNotes] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [preview, setPreview] = useState<PlanPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  const [calculating, startCalculating] = useTransition();
  const searchRun = useRef(0);
  const previewRun = useRef(0);

  useEffect(() => {
    if (query.trim().length < SEARCH_MIN) return;
    const run = ++searchRun.current;
    const timer = setTimeout(async () => {
      const result = await actions.search(query);
      if (run !== searchRun.current) return;
      if (result.ok) setResults(result.data);
      else setError(result.error);
    }, 250);
    return () => clearTimeout(timer);
  }, [query, actions]);

  const active = targets.filter((t) => t.quantity > 0);
  const activeKey = active.map((t) => `${t.code}:${t.quantity}`).join("|");

  /* Recalcula a cada mudança: a lista de insumos é a resposta que a tela existe para dar. */
  useEffect(() => {
    const run = ++previewRun.current;
    if (!activeKey) return;
    const list = activeKey.split("|").map((part) => {
      const at = part.lastIndexOf(":");
      return { code: part.slice(0, at), quantity: Number(part.slice(at + 1)) };
    });
    const timer = setTimeout(() => {
      startCalculating(async () => {
        const result = await actions.preview({ targets: list, useStock, fullBatchPreparados: fullBatch });
        if (run !== previewRun.current) return;
        if (result.ok) {
          setPreview(result.data);
          setError(null);
        } else {
          setError(result.error);
        }
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [activeKey, useStock, fullBatch, actions]);

  const shownPreview = activeKey ? preview : null;

  function addTarget(option: ArticleOption, quantity = 1) {
    setTargets((list) => (list.some((t) => t.code === option.code) ? list : [...list, { ...option, quantity }]));
  }

  function setQuantity(code: string, value: string) {
    const quantity = Number(value);
    const safe = Number.isFinite(quantity) && quantity >= 0 ? Math.min(quantity, QUANTITY_MAX) : 0;
    setTargets((list) => list.map((t) => (t.code === code ? { ...t, quantity: safe } : t)));
  }

  async function openBatida(code: string) {
    setBatida(code);
    setFormats([]);
    if (!code) return;
    const result = await actions.formats(code);
    if (result.ok) setFormats(result.data);
    else setError(result.error);
  }

  function formatQuantityOf(option: BatidaFormat) {
    return targets.find((t) => t.code === option.code)?.quantity ?? 0;
  }

  function setFormatQuantity(option: BatidaFormat, value: string) {
    if (targets.some((t) => t.code === option.code)) setQuantity(option.code, value);
    else if (Number(value) > 0) addTarget(option, Math.min(Number(value), QUANTITY_MAX));
  }

  function togglePicked(id: string) {
    setPicked((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]));
  }

  function submit() {
    if (saving || active.length === 0) return;
    setError(null);
    startSaving(async () => {
      const result = await actions.create({
        targets: active.map((t) => ({ code: t.code, quantity: t.quantity })),
        useStock,
        fullBatchPreparados: fullBatch,
        forDate,
        notes,
        demandOrderIds: picked,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push(`/admin/produccion/${result.data.id}`);
    });
  }

  const totalBatida = shownPreview?.tasks.filter((t) => t.stage === "batidas") ?? [];

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="space-y-6">
        {demand.length > 0 && (
          <Section title="Pedidos de las tiendas" aside="Marca los que esta orden atiende">
            <ul className="divide-y divide-crema-200">
              {demand.map((order) => (
                <li key={order.id}>
                  <label className="flex min-h-14 cursor-pointer items-start gap-3 px-4 py-3 sm:px-5">
                    <input type="checkbox" checked={picked.includes(order.id)} onChange={() => togglePicked(order.id)} className="mt-1 h-5 w-5 accent-cacao" />
                    <span className="min-w-0 text-sm">
                      <span className="font-semibold text-cacao">
                        #{order.number} · {order.store}
                      </span>
                      <span className="block text-[13px] text-cacao-500">{order.lines.map((l) => `${l.pending} ${l.name}`).join(" · ")}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </Section>
        )}

        <Section title="Por batida" aside="Varios formatos en la misma batida">
          <div className="space-y-3 p-4 sm:p-5">
            <div>
              <label htmlFor="orden-batida" className={labelClass}>
                Batida
              </label>
              <select id="orden-batida" value={batida} onChange={(e) => openBatida(e.target.value)} className={inputClass}>
                <option value="">Elige una batida</option>
                {batidas.map((b) => (
                  <option key={b.code} value={b.code}>
                    {b.description}
                  </option>
                ))}
              </select>
            </div>
            {formats.length > 0 && (
              <ul className="divide-y divide-crema-200 rounded-xl border border-crema-200">
                {formats.map((f) => (
                  <li key={f.code} className="flex items-center justify-between gap-3 px-3 py-2">
                    <span className="min-w-0 text-sm">
                      <span className="block font-medium text-cacao">{f.description}</span>
                      <span className="block text-[12px] text-cacao-500">Una batida rinde {formatQuantity(f.perBatida)}</span>
                    </span>
                    <span className="w-24 shrink-0">
                      <input
                        type="number"
                        inputMode="numeric"
                        min={0}
                        max={QUANTITY_MAX}
                        aria-label={`Cantidad de ${f.description}`}
                        value={formatQuantityOf(f) || ""}
                        onChange={(e) => setFormatQuantity(f, e.target.value)}
                        className={cx(inputClass, "text-right")}
                      />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Section>

        <Section title="Buscar producto o preparado">
          <div className="space-y-3 p-4 sm:p-5">
            <div>
              <label htmlFor="orden-busca" className={labelClass}>
                Código o nombre
              </label>
              <input
                id="orden-busca"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  if (e.target.value.trim().length < SEARCH_MIN) setResults([]);
                }}
                placeholder="Ej.: torta 26 moca"
                className={inputClass}
              />
            </div>
            {results.length > 0 && (
              <ul className="divide-y divide-crema-200 rounded-xl border border-crema-200">
                {results.map((r) => (
                  <li key={r.code}>
                    <button type="button" onClick={() => addTarget(r)} className="flex min-h-12 w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-crema-100">
                      <span className="min-w-0">
                        <span className="block font-medium text-cacao">{r.description}</span>
                        <span className="block font-mono text-[12px] text-cacao-300">{r.code}</span>
                      </span>
                      <span className="shrink-0 text-[12px] text-cacao-500">{STAGE_LABEL[r.stage] ?? r.stage}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Section>
      </div>

      <div className="space-y-6 lg:sticky lg:top-4">
        <Section title="Qué se va a producir" aside={active.length ? `${active.length} ${active.length === 1 ? "producto" : "productos"}` : undefined}>
          {targets.length === 0 ? (
            <EmptyState>Elige una batida o busca un producto para empezar.</EmptyState>
          ) : (
            <ul className="divide-y divide-crema-200">
              {targets.map((t) => (
                <li key={t.code} className="flex items-center justify-between gap-3 px-4 py-2 sm:px-5">
                  <span className="min-w-0 text-sm">
                    <span className="block font-medium text-cacao">{t.description}</span>
                    <span className="block text-[12px] text-cacao-500">{STAGE_LABEL[t.stage] ?? t.stage}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="w-24">
                      <input
                        type="number"
                        inputMode="decimal"
                        min={0}
                        max={QUANTITY_MAX}
                        aria-label={`Cantidad de ${t.description}`}
                        value={t.quantity || ""}
                        onChange={(e) => setQuantity(t.code, e.target.value)}
                        className={cx(inputClass, "text-right")}
                      />
                    </span>
                    <button
                      type="button"
                      onClick={() => setTargets((list) => list.filter((x) => x.code !== t.code))}
                      aria-label={`Quitar ${t.description}`}
                      className="h-11 w-11 rounded-full border border-crema-300 text-cacao-500 transition-colors hover:border-cacao/35"
                    >
                      ×
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {shownPreview && (
          <Section title="Lo que se necesita" aside={calculating ? "Calculando…" : undefined}>
            <div className="space-y-4 p-4 sm:p-5">
              {shownPreview.warnings.map((w) => (
                <Notice key={w} tone="warn">
                  {w}
                </Notice>
              ))}

              {totalBatida.length > 0 && (
                <div>
                  <p className={labelClass}>Batidas</p>
                  <ul className="space-y-1 text-sm">
                    {totalBatida.map((t) => (
                      <li key={t.code} className="flex justify-between gap-3">
                        <span className="text-cacao-700">{t.description}</span>
                        <span className="shrink-0 font-semibold tabular-nums text-cacao">{Math.round(t.factor * 1000) / 10}% de la fórmula</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div>
                <p className={labelClass}>Etapas</p>
                <ul className="space-y-1 text-sm">
                  {shownPreview.tasks
                    .filter((t) => t.stage !== "batidas")
                    .map((t) => (
                      <li key={t.code} className="flex justify-between gap-3">
                        <span className="min-w-0 text-cacao-700">
                          <span className="text-cacao-500">{STAGE_LABEL[t.stage] ?? t.stage} · </span>
                          {t.description}
                        </span>
                        <span className="shrink-0 tabular-nums text-cacao">
                          {formatQuantity(t.quantity)} {t.unit}
                        </span>
                      </li>
                    ))}
                </ul>
              </div>

              {shownPreview.fromStock.length > 0 && (
                <div>
                  <p className={labelClass}>Sale de lo que ya hay en el taller</p>
                  <ul className="space-y-1 text-sm">
                    {shownPreview.fromStock.map((s) => (
                      <li key={s.code} className="flex justify-between gap-3">
                        <span className="text-cacao-700">{s.description}</span>
                        <span className="shrink-0 tabular-nums text-cacao">
                          {formatQuantity(s.quantity)} {s.unit}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div>
                <p className={labelClass}>Insumos del almacén</p>
                <ul className="space-y-1 text-sm">
                  {shownPreview.rawMaterials.map((m) => (
                    <li key={m.code} className="flex justify-between gap-3">
                      <span className="text-cacao-700">{m.description}</span>
                      <span className="shrink-0 tabular-nums font-medium text-cacao">
                        {formatQuantity(m.quantity)} {m.unit}
                        {m.stockHint && <span className="font-normal text-cacao-500"> ({m.stockHint})</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </Section>
        )}

        <Section title="Datos de la orden">
          <div className="space-y-3 p-4 sm:p-5">
            <div>
              <label htmlFor="orden-fecha" className={labelClass}>
                Fecha de producción
              </label>
              <input id="orden-fecha" type="date" value={forDate} onChange={(e) => setForDate(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label htmlFor="orden-notas" className={labelClass}>
                Notas
              </label>
              <input id="orden-notas" value={notes} maxLength={NOTES_MAX} onChange={(e) => setNotes(e.target.value)} className={inputClass} />
            </div>
            <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm text-cacao-700">
              <input type="checkbox" checked={useStock} onChange={(e) => setUseStock(e.target.checked)} className="h-5 w-5 accent-cacao" />
              Aprovechar los intermedios que ya hay en el taller
            </label>
            <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm text-cacao-700">
              <input type="checkbox" checked={fullBatch} onChange={(e) => setFullBatch(e.target.checked)} className="h-5 w-5 accent-cacao" />
              Hacer los preparados en lote entero (lo que sobra queda guardado)
            </label>
            {error && <Notice tone="bad">{error}</Notice>}
            <button
              type="button"
              onClick={submit}
              disabled={saving || active.length === 0}
              className="inline-flex h-12 w-full items-center justify-center rounded-full bg-dorado px-6 font-semibold text-cacao transition-colors hover:bg-dorado-600 disabled:cursor-not-allowed disabled:opacity-45"
            >
              {saving ? "Creando…" : "Crear orden de producción"}
            </button>
          </div>
        </Section>
      </div>
    </div>
  );
}
