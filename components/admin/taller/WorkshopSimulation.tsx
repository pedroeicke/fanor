"use client";

import Link from "next/link";
import { useState } from "react";
import { EmptyState, Notice, PageHeader, Section, StatCard, inputClass } from "@/components/admin/ui";
import { cx } from "@/lib/format";
import { SIMULATION_SCENARIOS, type SimulationStep } from "./simulation-data";

type Entry = { quantity: string; note: string; completed: boolean };
const number = new Intl.NumberFormat("es-PE", { maximumFractionDigits: 3 });

function key(scenarioId: string, step: SimulationStep) {
  return `${scenarioId}:${step.id}`;
}

function parsedQuantity(value: string) {
  const parsed = Number(value.trim().replace(",", "."));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function WorkshopSimulation() {
  const [scenarioId, setScenarioId] = useState<(typeof SIMULATION_SCENARIOS)[number]["id"]>("torta");
  const [stepIndex, setStepIndex] = useState(0);
  const [entries, setEntries] = useState<Record<string, Entry>>({});
  const [error, setError] = useState("");

  const scenario = SIMULATION_SCENARIOS.find((item) => item.id === scenarioId) ?? SIMULATION_SCENARIOS[0];
  const step = scenario.steps[stepIndex];
  const entryKey = key(scenario.id, step);
  const entry = entries[entryKey] ?? { quantity: String(step.exampleQuantity), note: "", completed: false };
  const completed = scenario.steps.filter((item) => entries[key(scenario.id, item)]?.completed);
  const completeCount = completed.length;

  function changeEntry(patch: Partial<Entry>) {
    setEntries((current) => ({ ...current, [entryKey]: { ...entry, ...patch } }));
    setError("");
  }

  function recordStep() {
    if (parsedQuantity(entry.quantity) === null) {
      setError("Ingresa una cantidad mayor que cero para continuar.");
      return;
    }
    setEntries((current) => ({ ...current, [entryKey]: { ...entry, completed: true } }));
    setError("");
    setStepIndex((current) => Math.min(current + 1, scenario.steps.length - 1));
  }

  function resetScenario() {
    setEntries((current) => Object.fromEntries(Object.entries(current).filter(([itemKey]) => !itemKey.startsWith(`${scenario.id}:`))));
    setStepIndex(0);
    setError("");
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Simulación por áreas del taller"
        description="Recorre quién recibe, qué registra y qué entrega cada sector. Usa ejemplos de las fórmulas Fanor y cantidades que puedes cambiar para ensayar el flujo."
        actions={<Link href="/admin/recetas" className="inline-flex h-11 items-center rounded-full border border-crema-300 bg-white px-5 text-sm font-semibold text-cacao hover:border-cacao/35 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-dorado">Ver recetas</Link>}
      />

      <Notice tone="warn">
        Simulación local: lo que escribes queda solo en esta pantalla. No crea lotes, etiquetas, ventas ni movimientos de inventario.
      </Notice>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Ejemplo de producción">
        {SIMULATION_SCENARIOS.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={scenario.id === item.id}
            onClick={() => { setScenarioId(item.id); setStepIndex(0); setError(""); }}
            className={cx(
              "min-h-11 rounded-full border px-5 py-2 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-dorado",
              scenario.id === item.id ? "border-cacao bg-cacao text-white" : "border-crema-300 bg-white text-cacao hover:border-cacao/35",
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h3 className="font-display text-xl text-cacao">{scenario.product}</h3>
            <p className="mt-1 max-w-2xl text-sm text-cacao-500">{scenario.description}</p>
          </div>
          <button type="button" onClick={resetScenario} className="text-sm font-semibold text-cacao-500 underline underline-offset-2 hover:text-cacao focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-dorado">
            Reiniciar este ejemplo
          </button>
        </div>

        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label="Estado de la simulación">
          <StatCard label="Áreas simuladas" value={`${completeCount}/${scenario.steps.length}`} hint="Pasos registrados en esta pantalla" />
          <StatCard label="Etapa actual" value={stepIndex + 1} hint={step.area} />
          <StatCard label="Producto" value={scenario.id === "torta" ? "T26" : "PT9"} hint={scenario.id === "torta" ? "T26-CHNRMC" : "PT9-01EMPO"} />
        </ul>

        <div className="grid items-start gap-5 lg:grid-cols-[minmax(15rem,0.75fr)_minmax(0,1.5fr)]">
          <Section title="Recorrido" aside={`${scenario.steps.length} etapas`}>
            <ol className="divide-y divide-crema-200">
              {scenario.steps.map((item, index) => {
                const isDone = entries[key(scenario.id, item)]?.completed;
                const isCurrent = index === stepIndex;
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => { setStepIndex(index); setError(""); }}
                      aria-current={isCurrent ? "step" : undefined}
                      className={cx("flex min-h-14 w-full items-center gap-3 px-5 py-3 text-left hover:bg-crema-100 focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-dorado", isCurrent && "bg-dorado-100")}
                    >
                      <span className={cx("flex size-8 shrink-0 items-center justify-center rounded-full border text-sm font-bold", isDone ? "border-verde bg-verde text-white" : isCurrent ? "border-dorado-600 bg-white text-cacao" : "border-crema-300 text-cacao-500")}>
                        {isDone ? "✓" : index + 1}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold text-cacao">{item.area}</span>
                        <span className="block text-xs text-cacao-500">{isDone ? "Simulado" : item.existingScreen ? "Tela de operación disponible" : "Flujo por implementar"}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </Section>

          <div className="space-y-5">
            <Section title={step.title} aside={<span className="text-xs font-semibold uppercase tracking-wide">{step.actor}</span>}>
              <div className="space-y-5 p-5">
                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="rounded-xl bg-crema-100 p-4"><p className="text-xs font-bold uppercase tracking-wide text-cacao-500">Recibe</p><p className="mt-2 text-sm text-cacao">{step.receives}</p></div>
                  <div className="rounded-xl bg-crema-100 p-4"><p className="text-xs font-bold uppercase tracking-wide text-cacao-500">Registra</p><p className="mt-2 text-sm text-cacao">{step.records}</p></div>
                  <div className="rounded-xl bg-crema-100 p-4"><p className="text-xs font-bold uppercase tracking-wide text-cacao-500">Entrega</p><p className="mt-2 text-sm text-cacao">{step.sends}</p></div>
                </div>

                {step.recipeCode && <p className="text-sm text-cacao-500">Código relacionado: <strong className="font-mono text-cacao">{step.recipeCode}</strong></p>}
                {step.note && <Notice tone="info">{step.note}</Notice>}

                <div className="grid gap-4 border-t border-crema-200 pt-5 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]">
                  <div>
                    <label htmlFor="sim-quantity" className="mb-1 block text-xs font-bold uppercase tracking-wide text-cacao-500">{step.outputLabel}</label>
                    <div className="flex items-center gap-2">
                      <input id="sim-quantity" type="text" inputMode="decimal" className={inputClass} value={entry.quantity} onChange={(event) => changeEntry({ quantity: event.target.value, completed: false })} aria-describedby="sim-example" />
                      <span className="shrink-0 text-sm text-cacao-500">{step.outputUnit}</span>
                    </div>
                    <p id="sim-example" className="mt-1 text-xs text-cacao-500">Ejemplo: {number.format(step.exampleQuantity)} {step.outputUnit}</p>
                  </div>
                  <div>
                    <label htmlFor="sim-note" className="mb-1 block text-xs font-bold uppercase tracking-wide text-cacao-500">Observación del turno (opcional)</label>
                    <textarea id="sim-note" rows={3} className="w-full rounded-xl border border-crema-300 bg-white px-3 py-2 text-sm text-cacao focus-visible:border-dorado-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-dorado" placeholder="Merma, sobrante, cambio de molde…" value={entry.note} onChange={(event) => changeEntry({ note: event.target.value, completed: false })} />
                  </div>
                </div>
                {error && <Notice tone="bad">{error}</Notice>}
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <button type="button" onClick={recordStep} className="min-h-11 rounded-full bg-cacao px-5 py-2 text-sm font-semibold text-white hover:bg-cacao-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-dorado">
                    {entry.completed ? "Actualizar este paso" : "Registrar en la simulación"}
                  </button>
                  {step.existingScreen && <Link href={step.existingScreen} className="text-sm font-semibold text-cacao underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-dorado">Salir de la simulación y abrir la pantalla real</Link>}
                </div>
              </div>
            </Section>

            <Section title="Registro simulado" aside={`${completeCount} de ${scenario.steps.length}`}>
              {completed.length === 0 ? (
                <EmptyState>Registra la primera etapa para ver cómo quedaría la secuencia del turno.</EmptyState>
              ) : (
                <ol className="divide-y divide-crema-200">
                  {completed.map((item) => {
                    const saved = entries[key(scenario.id, item)];
                    return (
                      <li key={item.id} className="flex flex-wrap items-start justify-between gap-2 px-5 py-3 text-sm">
                        <span><strong className="text-cacao">{item.area}</strong><span className="block text-xs text-cacao-500">{saved.note || item.sends}</span></span>
                        <span className="font-semibold tabular-nums text-cacao">{number.format(parsedQuantity(saved.quantity) ?? 0)} {item.outputUnit}</span>
                      </li>
                    );
                  })}
                </ol>
              )}
            </Section>
          </div>
        </div>
      </div>
    </div>
  );
}
