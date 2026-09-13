import type { Metadata } from "next";
import { getOperator } from "@/lib/gestion/server";
import { addDays, formatDuration, limaDateTime, limaDay, limaToday, minutesBetween } from "@/lib/gestion/dates";
import { BACKUP_RETENTION_DAYS, BACKUP_TABLES, STALE_RUN_MINUTES } from "@/lib/backup";
import { EmptyState, Notice, PageHeader, Section, StatusPill } from "@/components/admin/ui";
import { RunBackupButton } from "@/components/admin/respaldos/RunBackupButton";
import { DownloadBackupButton } from "@/components/admin/respaldos/DownloadBackupButton";
import { formatBytes, formatCount } from "@/components/admin/respaldos/format";

export const metadata: Metadata = { title: "Respaldos" };
export const dynamic = "force-dynamic";
/* O botão "Hacer respaldo ahora" roda o respaldo inteiro dentro da ação
   desta página; o teto da ação é o da página. */
export const maxDuration = 300;

/**
 * Histórico dos respaldos diários e o botão para gerar um na hora.
 *
 * Existe para responder "tem cópia de ontem?" sem abrir o Supabase, e para
 * o Joseka baixar um arquivo quando o PC dele não baixou sozinho.
 */

type Run = {
  id: number;
  started_at: string;
  finished_at: string | null;
  status: "running" | "done" | "failed";
  path: string | null;
  tables: number | null;
  rows: number | null;
  bytes: number | null;
  error: string | null;
};

const RUN_STATUS = {
  running: { label: "En curso", tone: "info" },
  done: { label: "Listo", tone: "ok" },
  failed: { label: "Falló", tone: "bad" },
  stale: { label: "Interrumpido", tone: "bad" },
  expired: { label: "Eliminado de la nube", tone: "muted" },
} as const;

/** Um dia e pouco: a rotina é diária, e um atraso de minutos não é alarme. */
const OVERDUE_HOURS = 26;

/** Relógio lido uma vez, fora do componente: render tem de ser puro. */
function clock() {
  const now = new Date();
  return { now: now.toISOString(), today: limaToday(now) };
}

export default async function BackupsPage() {
  const op = await getOperator();
  if (!op) return <Notice tone="bad">Sesión expirada. Vuelve a entrar.</Notice>;

  const { data, error } = await op.db
    .from("backup_runs")
    .select("id, started_at, finished_at, status, path, tables, rows, bytes, error")
    .order("id", { ascending: false })
    .limit(60);

  const runs = ((data ?? []) as Run[]).map((run) => ({ ...run, rows: run.rows === null ? null : Number(run.rows), bytes: run.bytes === null ? null : Number(run.bytes) }));
  const isOwner = op.user.role === "owner";
  const { now, today } = clock();
  const cutoffDay = addDays(today, -BACKUP_RETENTION_DAYS);

  const lastDone = runs.find((run) => run.status === "done");
  const latest = runs[0];
  const hoursSinceDone = lastDone ? minutesBetween(lastDone.started_at, now) / 60 : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Respaldos"
        description={
          <>
            Cada día a las 03:30 (hora de Lima) se guarda una copia de todas las tablas del sistema en un archivo
            comprimido privado. En la nube se conservan {BACKUP_RETENTION_DAYS} días; el descargador instalado en la PC de
            Joseka baja el último cada día y guarda los 60 más recientes.
          </>
        }
      />

      {error && <Notice tone="bad">No se pudo leer el historial de respaldos. Recarga la página.</Notice>}

      {!error && !lastDone && (
        <Notice tone="warn">Todavía no hay ningún respaldo terminado. {isOwner ? "Genera el primero con el botón de abajo." : "El dueño puede generar el primero desde esta pantalla."}</Notice>
      )}
      {lastDone && hoursSinceDone !== null && hoursSinceDone > OVERDUE_HOURS && (
        <Notice tone="warn">
          El último respaldo correcto es de hace {formatDuration(Math.round(hoursSinceDone * 60))}. La rutina diaria no está
          funcionando: revisa las rutinas programadas (cron) en Vercel.
        </Notice>
      )}
      {latest?.status === "running" && minutesBetween(latest.started_at, now) <= STALE_RUN_MINUTES && (
        <Notice tone="info">Hay un respaldo en curso desde el {limaDateTime(latest.started_at)}. Recarga la página en unos minutos.</Notice>
      )}
      {latest?.status === "failed" && (
        <Notice tone="bad">El último intento falló: {(latest.error ?? "sin detalle").replace(/\.+$/, "")}.</Notice>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <Section title="Historial" aside={runs.length ? `Últimos ${runs.length}` : undefined}>
          {runs.length ? (
            <ul className="divide-y divide-crema-200">
              {runs.map((run) => {
                const stale = run.status === "running" && minutesBetween(run.started_at, now) > STALE_RUN_MINUTES;
                const expired = run.status === "done" && limaDay(run.started_at) < cutoffDay;
                const statusKey = stale ? "stale" : expired ? "expired" : run.status;
                const when = limaDateTime(run.started_at);
                const took = run.finished_at ? Math.max(0, Math.round((new Date(run.finished_at).getTime() - new Date(run.started_at).getTime()) / 1000)) : null;
                return (
                  <li key={run.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium text-cacao">{when}</p>
                        <StatusPill status={statusKey} map={RUN_STATUS} />
                      </div>
                      {run.status === "done" && (
                        <p className="mt-1 text-[13px] text-cacao-500">
                          {formatCount(run.tables)} tablas · {formatCount(run.rows)} filas · {formatBytes(run.bytes)}
                          {took !== null && ` · ${took < 60 ? `${took} s` : formatDuration(Math.round(took / 60))}`}
                        </p>
                      )}
                      {run.error && (
                        <p className={run.status === "done" ? "mt-1 text-[13px] text-cacao-500" : "mt-1 break-words text-[13px] text-terracota"}>
                          {run.status === "done" ? `Aviso: ${run.error}` : run.error}
                        </p>
                      )}
                    </div>
                    {isOwner && run.status === "done" && run.path && !expired && <DownloadBackupButton id={run.id} label={when} />}
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState>Aún no se ha generado ningún respaldo.</EmptyState>
          )}
        </Section>

        {/* No celular o botão vem antes do histórico: com 60 linhas, ficaria no fim da rolagem. */}
        <div className="order-first space-y-6 lg:order-none">
          <Section title="Respaldo manual">
            <div className="space-y-3 px-5 py-4 text-sm text-cacao-700">
              <p>Útil antes de un cambio grande: importar el catálogo, pasar la vitrina al sistema nuevo, cerrar el mes.</p>
              {isOwner ? (
                <RunBackupButton />
              ) : (
                <p className="text-cacao-500">Solo el dueño de la cuenta puede generar o descargar respaldos.</p>
              )}
            </div>
          </Section>

          <Section title="Qué se guarda">
            <div className="space-y-2 px-5 py-4 text-sm text-cacao-700">
              <p>
                Las {BACKUP_TABLES.length} tablas de datos: productos y catálogo, tiendas, entregas, pedidos web, reclamos,
                clientes, tortas y sus movimientos, despachos, ventas y pagos, encomiendas, leads, alertas, ajustes y el
                registro del lector del Sisgeco.
              </p>
              <p className="text-cacao-500">
                No se guardan contraseñas ni cuentas de acceso, ni las fotos: esas viven en el almacenamiento de imágenes.
                El archivo es JSON comprimido (.json.gz); se abre con 7-Zip.
              </p>
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}
