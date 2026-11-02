import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getOperator, getSetting } from "@/lib/gestion/server";
import { limaDateTime } from "@/lib/gestion/dates";
import { STAGES, formatQuantity } from "@/lib/produccion/plan";
import { formatDateShort } from "@/lib/delivery";
import { isUuid } from "@/components/admin/pedidos-tienda/catalog";
import { AutoRefresh } from "@/components/admin/AutoRefresh";
import { Notice, PageHeader, Section, StatusPill } from "@/components/admin/ui";
import { ReasonAction } from "@/components/admin/taller/ReasonAction";
import { TaskCheckout } from "@/components/admin/produccion/TaskCheckout";
import { STAGE_LABEL } from "@/components/admin/produccion/types";
import { loadWorkshopBalances } from "@/lib/produccion/server";
import { cancelOrder, checkoutTask, closeStage } from "../actions";

export const metadata: Metadata = { title: "Orden de producción" };
export const dynamic = "force-dynamic";

const TASK_STATUS = {
  pending: { label: "Pendiente", tone: "warn" },
  done: { label: "Cerrada", tone: "ok" },
  cancelled: { label: "Cancelada", tone: "muted" },
} as const;

type InputRow = {
  id: string;
  article_code: string;
  planned_quantity: number;
  actual_quantity: number | null;
  display_unit: string | null;
  display_factor: number;
  count_on_execution: boolean;
  out_of_tolerance: boolean;
  justification: string | null;
  articles: { description: string; type: string; recipe_unit: string | null } | null;
};

type TaskRow = {
  id: string;
  stage: string;
  article_code: string;
  planned_quantity: number;
  requires: string[];
  rework_of: string | null;
  status: keyof typeof TASK_STATUS;
  approved_quantity: number | null;
  rejected_quantity: number | null;
  reject_reason: string | null;
  notes: string | null;
  checked_out_at: string | null;
  articles: { description: string; recipe_unit: string | null } | null;
  production_task_inputs: InputRow[];
};

type BatchRow = {
  id: string;
  number: number;
  for_date: string;
  status: string;
  notes: string | null;
  production_batch_targets: { quantity: number; articles: { description: string } | null }[];
};

/** Na batida, o que importa é a fração da fórmula; o resto sai em unidades. */
function quantityLabel(stage: string, quantity: number, unit: string | null) {
  if (stage === "batidas") return `${Math.round(quantity * 1000) / 10}% de la fórmula`;
  return `${formatQuantity(quantity)} ${unit ?? ""}`;
}

export default async function ProductionOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const op = await getOperator();
  if (!op) return <Notice tone="bad">Sesión expirada. Vuelve a entrar.</Notice>;
  const { db } = op;

  const [batchRes, tasksRes, tolerancePct] = await Promise.all([
    db.from("production_batches").select("id, number, for_date, status, notes, production_batch_targets(quantity, articles(description))").eq("id", id).maybeSingle(),
    db
      .from("production_tasks")
      .select(
        "id, stage, article_code, planned_quantity, requires, rework_of, status, approved_quantity, rejected_quantity, reject_reason, notes, checked_out_at, articles(description, recipe_unit), production_task_inputs(id, article_code, planned_quantity, actual_quantity, display_unit, display_factor, count_on_execution, out_of_tolerance, justification, articles(description, type, recipe_unit))",
      )
      .eq("batch_id", id)
      .order("created_at"),
    getSetting<number>(db, "production_tolerance_pct", 5),
  ]);

  if (batchRes.error || tasksRes.error) return <Notice tone="bad">No se pudo cargar la orden. Recarga la página.</Notice>;
  if (!batchRes.data) notFound();

  const batch = batchRes.data as unknown as BatchRow;
  const tasks = (tasksRes.data ?? []) as unknown as TaskRow[];
  const isOpen = batch.status === "open";

  const pendingCodes = new Map(tasks.filter((t) => t.status === "pending").map((t) => [t.article_code, t.articles?.description ?? t.article_code]));
  const lostTasks = tasks.filter((t) => Number(t.rejected_quantity ?? 0) > 0);

  /* Saldo só do que o taller produz; matéria-prima ainda não tem inventário inicial. */
  const intermediateCodes = [
    ...new Set(tasks.flatMap((t) => t.production_task_inputs.filter((i) => i.articles?.type === "PI").map((i) => i.article_code))),
  ];
  const [{ data: withFormula }, balances] = isOpen && intermediateCodes.length
    ? await Promise.all([
        db.from("formulas").select("output_code").eq("active", true).in("output_code", intermediateCodes.slice(0, 150)),
        loadWorkshopBalances(db, intermediateCodes),
      ])
    : [{ data: [] as { output_code: string }[] }, new Map<string, number>()];
  const hasFormula = new Set((withFormula ?? []).map((row) => row.output_code as string));

  /* O que vem de fora da ordem: do almacén, ou do saldo que o taller já tinha. */
  const produced = new Set(tasks.map((t) => t.article_code));
  const totals = new Map<string, { description: string; unit: string | null; planned: number; actual: number; open: boolean }>();
  const fromWorkshop = new Map<string, { description: string; unit: string | null; planned: number; actual: number; open: boolean }>();
  for (const task of tasks) {
    if (task.status === "cancelled") continue;
    for (const input of task.production_task_inputs) {
      if (produced.has(input.article_code)) continue;
      const group = input.articles?.type === "PI" ? fromWorkshop : totals;
      const row = group.get(input.article_code) ?? {
        description: input.articles?.description ?? input.article_code,
        unit: input.articles?.recipe_unit ?? null,
        planned: 0,
        actual: 0,
        open: false,
      };
      row.planned += Number(input.planned_quantity);
      row.actual += Number(input.actual_quantity ?? 0);
      if (input.actual_quantity === null) row.open = true;
      group.set(input.article_code, row);
    }
  }
  const rawMaterials = [...totals.values()].sort((a, b) => a.description.localeCompare(b.description));
  const workshopMaterials = [...fromWorkshop.values()].sort((a, b) => a.description.localeCompare(b.description));
  const targetsText = batch.production_batch_targets.map((t) => `${formatQuantity(Number(t.quantity))} ${t.articles?.description ?? ""}`).join(" · ");

  return (
    <div className="space-y-6">
      {isOpen && <AutoRefresh everyMs={15_000} />}

      <PageHeader
        title={`Orden #${batch.number}`}
        description={`${formatDateShort(batch.for_date)} · ${targetsText}`}
        actions={
          <Link href="/admin/produccion" className="inline-flex h-11 items-center justify-center rounded-full border border-cacao/25 bg-white px-5 text-sm font-semibold text-cacao transition-colors hover:border-cacao">
            Volver
          </Link>
        }
      />

      {batch.notes && <Notice>{batch.notes}</Notice>}
      {batch.status === "done" && <Notice tone="ok">Orden terminada. Todas las etapas están cerradas.</Notice>}
      {batch.status === "cancelled" && <Notice tone="warn">Orden cancelada. Lo ya consumido no vuelve al inventario.</Notice>}

      {STAGES.map((stage) => {
        const stageTasks = tasks.filter((t) => t.stage === stage && t.status !== "cancelled");
        if (stageTasks.length === 0) return null;
        const left = stageTasks.filter((t) => t.status === "pending").length;
        return (
          <Section key={stage} title={STAGE_LABEL[stage]} aside={left ? `${left} por cerrar` : "Completa"}>
            {isOpen && left > 1 && (
              <div className="border-b border-crema-200 px-4 py-3 sm:px-5">
                <ReasonAction
                  action={closeStage.bind(null, batch.id, stage)}
                  label="Salió todo como estaba previsto"
                  confirmLabel="Sí, cerrar"
                  prompt={`¿Cerrar las ${left} etapas de ${STAGE_LABEL[stage]} como estaban previstas? Lo que necesite un dato tuyo queda abierto.`}
                  placeholder="Comentario"
                  tone="ok"
                />
              </div>
            )}
            <ul className="divide-y divide-crema-200">
              {stageTasks.map((task) => {
                const unit = task.articles?.recipe_unit ?? null;
                const waitingFor = task.requires.filter((code) => pendingCodes.has(code)).map((code) => pendingCodes.get(code));
                const plannedLabel = quantityLabel(task.stage, Number(task.planned_quantity), unit);
                return (
                  <li key={task.id} className="space-y-3 px-4 py-4 sm:px-5">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-semibold text-cacao">
                          {task.articles?.description ?? task.article_code}
                          {task.rework_of && <span className="ml-2 rounded-full bg-terracota/10 px-2 py-0.5 text-[12px] font-semibold text-terracota-700">Rehacer</span>}
                        </p>
                        <p className="text-sm text-cacao-700">
                          {task.status === "done" ? (
                            <>
                              Se pidió {plannedLabel} · salió bien {formatQuantity(Number(task.approved_quantity))}
                              {Number(task.rejected_quantity) > 0 && (
                                <span className="font-semibold text-terracota-700">
                                  {" "}
                                  · se perdió {formatQuantity(Number(task.rejected_quantity))} ({task.reject_reason})
                                </span>
                              )}
                            </>
                          ) : (
                            plannedLabel
                          )}
                        </p>
                        {task.checked_out_at && <p className="text-[12px] text-cacao-300">Cerrada {limaDateTime(task.checked_out_at)}</p>}
                        {task.notes && <p className="text-[13px] text-cacao-500">{task.notes}</p>}
                      </div>
                      <StatusPill status={task.status} map={TASK_STATUS} />
                    </div>

                    <ul className="grid gap-x-6 gap-y-1 text-[13px] sm:grid-cols-2">
                      {task.production_task_inputs.map((input) => {
                        const factor = Number(input.display_factor);
                        return (
                          <li key={input.id} className="flex justify-between gap-3">
                            <span className="min-w-0 text-cacao-500">{input.articles?.description ?? input.article_code}</span>
                            <span className="shrink-0 tabular-nums text-cacao-700">
                              {input.actual_quantity === null ? (
                                <>
                                  {formatQuantity(Number(input.planned_quantity) / factor)} {input.display_unit}
                                </>
                              ) : (
                                <span className={input.out_of_tolerance ? "font-semibold text-terracota-700" : undefined} title={input.justification ?? undefined}>
                                  {formatQuantity(Number(input.actual_quantity) / factor)} {input.display_unit}
                                  {input.out_of_tolerance && ` · receta ${formatQuantity(Number(input.planned_quantity) / factor)}`}
                                </span>
                              )}
                            </span>
                          </li>
                        );
                      })}
                    </ul>

                    {task.status === "pending" && isOpen && (
                      waitingFor.length > 0 ? (
                        <p className="rounded-xl bg-crema-100 px-3 py-2 text-[13px] text-cacao-500">Espera: {waitingFor.join(", ")}</p>
                      ) : (
                        <TaskCheckout
                          taskId={task.id}
                          stage={task.stage}
                          recipeUnit={unit}
                          plannedQuantity={Number(task.planned_quantity)}
                          unit={task.stage === "batidas" ? "fórmula" : unit}
                          tolerancePct={Number(tolerancePct) || 5}
                          action={checkoutTask}
                          inputs={task.production_task_inputs.map((input) => ({
                            id: input.id,
                            articleCode: input.article_code,
                            articleType: input.articles?.type ?? null,
                            description: input.articles?.description ?? input.article_code,
                            plannedQuantity: Number(input.planned_quantity),
                            displayUnit: input.display_unit,
                            displayFactor: Number(input.display_factor),
                            countOnExecution: input.count_on_execution,
                            available: input.articles?.type === "PI" && hasFormula.has(input.article_code) ? (balances.get(input.article_code) ?? 0) : null,
                          }))}
                        />
                      )
                    )}
                  </li>
                );
              })}
            </ul>
          </Section>
        );
      })}

      {lostTasks.length > 0 && (
        <Section title="Pérdidas de esta orden">
          <ul className="divide-y divide-crema-200">
            {lostTasks.map((task) => (
              <li key={task.id} className="flex flex-wrap justify-between gap-x-3 px-4 py-2 text-sm sm:px-5">
                <span className="text-cacao-700">{task.articles?.description ?? task.article_code}</span>
                <span className="tabular-nums font-medium text-terracota-700">
                  {formatQuantity(Number(task.rejected_quantity))} · {task.reject_reason}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {workshopMaterials.length > 0 && (
        <Section title="Sale de lo que ya hay en el taller" aside="Previsto y usado">
          <ul className="divide-y divide-crema-200">
            {workshopMaterials.map((row) => (
              <li key={row.description} className="flex justify-between gap-3 px-4 py-2 text-sm sm:px-5">
                <span className="min-w-0 text-cacao-700">{row.description}</span>
                <span className="shrink-0 tabular-nums text-cacao">
                  {formatQuantity(row.planned)} {row.unit}
                  {row.actual > 0 && <span className="text-cacao-500"> · usado {formatQuantity(row.actual)}</span>}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Insumos del almacén" aside="Previsto y usado">
        <ul className="divide-y divide-crema-200">
          {rawMaterials.map((row) => (
            <li key={row.description} className="flex justify-between gap-3 px-4 py-2 text-sm sm:px-5">
              <span className="min-w-0 text-cacao-700">{row.description}</span>
              <span className="shrink-0 tabular-nums text-cacao">
                {formatQuantity(row.planned)} {row.unit}
                {row.actual > 0 && (
                  <span className="text-cacao-500">
                    {" "}
                    · usado {formatQuantity(row.actual)}
                    {row.open && " hasta ahora"}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      </Section>

      {isOpen && (
        <ReasonAction
          action={cancelOrder.bind(null, batch.id)}
          label="Cancelar orden"
          confirmLabel="Sí, cancelar"
          prompt={`¿Cancelar la orden #${batch.number}? Las etapas pendientes se cierran y lo ya consumido no vuelve.`}
          suggestions={["Pedido anulado", "Falta de insumo", "Orden equivocada"]}
          requireReason
          tone="danger"
        />
      )}
    </div>
  );
}
