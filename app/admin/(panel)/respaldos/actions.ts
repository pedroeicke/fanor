"use server";

import { revalidatePath } from "next/cache";
import { getAdminUser, getServerSupabase } from "@/lib/supabase-server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { backupFileName, runBackup, signBackupUrl } from "@/lib/backup";
import type { ActionResult } from "@/lib/gestion/server";

/**
 * Ações da tela de respaldos.
 *
 * O arquivo é o banco inteiro — clientes, telefones, vendas. Gerar e baixar
 * ficam com o dono (`admins.role = 'owner'`): a vendedora que entra no
 * painel para vender não precisa levar a base de clientes num pendrive.
 */

const ONLY_OWNER = "Solo el dueño de la cuenta puede generar o descargar respaldos.";

export async function runBackupNow(): Promise<ActionResult<{ tables: number; rows: number; bytes: number; skipped: string[] }>> {
  const user = await getAdminUser();
  if (!user) return { ok: false, error: "Sesión expirada. Vuelve a entrar." };
  if (user.role !== "owner") return { ok: false, error: ONLY_OWNER };

  const result = await runBackup({ trigger: "manual", actor: user.id });
  revalidatePath("/admin/respaldos");

  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, data: { tables: result.tables, rows: result.rows, bytes: result.bytes, skipped: result.skipped } };
}

export async function getBackupDownload(id: number): Promise<ActionResult<{ url: string; filename: string }>> {
  if (!Number.isSafeInteger(id) || id <= 0) return { ok: false, error: "Respaldo inválido." };

  const user = await getAdminUser();
  if (!user) return { ok: false, error: "Sesión expirada. Vuelve a entrar." };
  if (user.role !== "owner") return { ok: false, error: ONLY_OWNER };

  /* A linha é lida com a sessão (RLS de administrador); só a assinatura do
     link usa a chave de serviço, porque o balde é privado. */
  const session = await getServerSupabase();
  if (!session) return { ok: false, error: "Sin conexión con la base de datos." };
  const { data: run, error } = await session
    .from("backup_runs")
    .select("id, status, path")
    .eq("id", id)
    .maybeSingle();
  if (error) return { ok: false, error: "No se pudo consultar el respaldo." };
  if (!run) return { ok: false, error: "Respaldo no encontrado." };
  if (run.status !== "done" || !run.path) return { ok: false, error: "Este respaldo no terminó bien; no hay archivo para descargar." };

  const admin = getSupabaseAdmin();
  if (!admin) return { ok: false, error: "Falta configurar el almacenamiento." };

  const signed = await signBackupUrl(admin, run.path);
  if (!signed.ok) {
    console.error("[respaldos] firma:", signed.error);
    return { ok: false, error: "El archivo ya no está en la nube (se guardan 30 días) o no se pudo generar el enlace." };
  }

  /* Quem levou uma cópia do banco, e quando. `audit_log` só aceita escrita
     pela chave de serviço. */
  const { error: auditError } = await admin.from("audit_log").insert({
    actor: user.id,
    action: "backup.download",
    entity: "backup_runs",
    entity_id: String(id),
    changes: { path: run.path },
  });
  if (auditError) console.error("[respaldos] auditoría:", auditError.message);

  return { ok: true, data: { url: signed.url, filename: backupFileName(run.path) } };
}
