import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { createGzip } from "node:zlib";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { STORE_TIME_ZONE, addDays, limaDay } from "@/lib/gestion/dates";

/**
 * Respaldo diário do banco inteiro num arquivo só.
 *
 * O Supabase guarda cópia própria, mas ela é do provedor: se a conta for
 * suspensa, o cartão falhar ou alguém apagar uma tabela por engano, o Joseka
 * não tem nada na mão. Aqui cada tabela vira JSON, comprimido, num balde
 * privado — e um script no PC dele baixa o último todo dia.
 *
 * Escrito para caber numa função serverless: as linhas vão direto para o
 * gzip, página por página, e só o arquivo comprimido fica em memória.
 */

export const BACKUP_BUCKET = "backups";
/** Dias que o arquivo fica na nuvem. O PC do Joseka guarda os seus 60. */
export const BACKUP_RETENTION_DAYS = 30;
/** Validade do link de download: o bastante para começar a baixar, curto para não vazar. */
export const BACKUP_URL_TTL_SECONDS = 10 * 60;

const PAGE_SIZE = 1000;
/** Execução "em andamento" há mais que isto morreu (a função tem 5 min de teto). */
export const STALE_RUN_MINUTES = 15;

type TableSpec =
  /* Paginação por chave: linha inserida durante a exportação não empurra as
     outras de página, então nada sai duplicado nem some na virada. */
  | { name: string; key: string }
  /* Chave composta: poucas linhas e escrita rara, a paginação por posição basta. */
  | { name: string; order: string[] };

/**
 * Tabelas exportadas, em ordem de dependência: restaurar na ordem do arquivo
 * respeita as chaves estrangeiras (loja antes de produto, venda antes da
 * linha da venda).
 *
 * Lista explícita, não "todas do schema": tabela nova entra por decisão.
 * Ficam de fora `admins` (liga a contas de login, que o respaldo não leva),
 * `rate_limits` (contagem de minutos, descartável) e `backup_runs` (o próprio
 * registro dos respaldos).
 */
export const BACKUP_TABLES: TableSpec[] = [
  { name: "stores", key: "id" },
  { name: "categories", key: "id" },
  { name: "product_families", key: "id" },
  { name: "products", key: "id" },
  { name: "product_sizes", key: "id" },
  { name: "product_flavors", key: "id" },
  { name: "product_images", key: "id" },
  { name: "product_categories", order: ["product_id", "category_id"] },
  { name: "product_stores", order: ["product_id", "store_id"] },
  { name: "delivery_zones", key: "id" },
  { name: "delivery_slots", key: "id" },
  { name: "delivery_blackouts", key: "id" },
  { name: "delivery_settings", key: "id" },
  { name: "customers", key: "id" },
  { name: "orders", key: "code" },
  { name: "order_items", key: "id" },
  { name: "complaints", key: "code" },
  { name: "email_log", key: "id" },
  { name: "payment_events", key: "id" },
  { name: "audit_log", key: "id" },
  { name: "cake_types", key: "id" },
  { name: "flavors", key: "id" },
  { name: "decorators", key: "id" },
  { name: "sellers", key: "id" },
  { name: "customer_notes", key: "id" },
  { name: "system_settings", key: "key" },
  { name: "contracts", key: "id" },
  { name: "contract_lines", key: "id" },
  { name: "production_orders", key: "id" },
  { name: "production_order_lines", key: "id" },
  { name: "dispatches", key: "id" },
  { name: "dispatch_lines", key: "id" },
  { name: "cake_units", key: "id" },
  { name: "cake_events", key: "id" },
  { name: "stock_levels", order: ["store_id", "product_id"] },
  { name: "stock_movements", key: "id" },
  { name: "stock_movement_lines", key: "id" },
  { name: "sales", key: "id" },
  { name: "sale_lines", key: "id" },
  { name: "sale_payments", key: "id" },
  { name: "fiscal_series", key: "id" },
  { name: "fiscal_documents", key: "id" },
  { name: "leads", key: "id" },
  { name: "lead_events", key: "id" },
  { name: "alerts", key: "id" },
  { name: "photo_treatments", key: "id" },
  { name: "sync_state", key: "key" },
  { name: "sync_runs", key: "id" },
];

export type BackupTrigger = "cron" | "manual";

export type BackupResult =
  | { ok: true; id: number; path: string; tables: number; rows: number; bytes: number; skipped: string[]; purged: number; purgeError: string | null; ms: number }
  | { ok: false; id: number | null; error: string };

/**
 * Gera um respaldo completo e apaga os que passaram do prazo.
 *
 * Chamado pela rotina diária (`/api/cron/respaldo`) e pelo botão do painel.
 * Usa a chave de serviço de propósito: o respaldo tem de ler tudo, inclusive
 * o que o RLS esconde de quem está logado.
 */
export async function runBackup({ trigger, actor = null }: { trigger: BackupTrigger; actor?: string | null }): Promise<BackupResult> {
  const db = getSupabaseAdmin();
  if (!db) return { ok: false, id: null, error: "Falta configurar la conexión con la base de datos (clave de servicio)." };

  const started = new Date();

  /* Função morta pelo tempo limite deixa a linha "running" para sempre, e
     ela barraria todos os respaldos seguintes. */
  await db
    .from("backup_runs")
    .update({ status: "failed", finished_at: started.toISOString(), error: "Interrumpido antes de terminar (tiempo agotado)." })
    .eq("status", "running")
    .lt("started_at", new Date(started.getTime() - STALE_RUN_MINUTES * 60_000).toISOString());

  const { data: run, error: runError } = await db
    .from("backup_runs")
    .insert({ status: "running", started_at: started.toISOString() })
    .select("id")
    .single();
  if (runError || !run) {
    return { ok: false, id: null, error: `No se pudo registrar el respaldo: ${runError?.message ?? "sin respuesta"}` };
  }
  const id = Number(run.id);

  /* Cron e botão ao mesmo tempo: quem chegou depois desiste. Conferir depois
     de inserir fecha a janela em que os dois olhariam e achariam vazio. */
  const { data: earlier } = await db.from("backup_runs").select("id").eq("status", "running").lt("id", id).limit(1);
  if (earlier?.length) {
    /* A linha de quem desistiu some. Marcada como "falhou", ela teria id
       maior que o respaldo que está rodando e ficaria como "último intento"
       na tela, com aviso vermelho, mesmo depois de o outro terminar bem. */
    const { error: dropError } = await db.from("backup_runs").delete().eq("id", id);
    if (dropError) {
      await db
        .from("backup_runs")
        .update({ status: "failed", finished_at: new Date().toISOString(), error: "Ya había otro respaldo en curso." })
        .eq("id", id);
    }
    return { ok: false, id: dropError ? id : null, error: "Ya hay un respaldo en curso. Espera unos minutos y vuelve a mirar la lista." };
  }

  try {
    const dump = await exportTables(db, started);
    const path = backupPath(started);

    const { error: uploadError } = await db.storage
      .from(BACKUP_BUCKET)
      .upload(path, dump.body, { contentType: "application/gzip", upsert: false });
    if (uploadError) throw new Error(`No se pudo guardar el archivo: ${uploadError.message}`);

    const { error: updateError } = await db
      .from("backup_runs")
      .update({
        status: "done",
        finished_at: new Date().toISOString(),
        path,
        tables: dump.tables,
        rows: dump.rows,
        bytes: dump.body.byteLength,
        /* Respaldo bom, mas incompleto em relação à lista: fica o aviso. */
        error: dump.skipped.length ? `Tablas no encontradas: ${dump.skipped.join(", ")}` : null,
      })
      .eq("id", id);
    if (updateError) throw new Error(`El archivo se guardó, pero no se pudo registrar: ${updateError.message}`);

    /* Só apaga o antigo depois que o novo está guardado. Com a ordem
       inversa, uma rotina quebrada apagaria um respaldo por dia até não
       sobrar nenhum. */
    const purge = await purgeExpired(db, started);

    await audit(db, actor, id, { trigger, ok: true, path, rows: dump.rows, bytes: dump.body.byteLength, skipped: dump.skipped, purged: purge.removed });

    return {
      ok: true,
      id,
      path,
      tables: dump.tables,
      rows: dump.rows,
      bytes: dump.body.byteLength,
      skipped: dump.skipped,
      purged: purge.removed,
      purgeError: purge.error,
      ms: Date.now() - started.getTime(),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[respaldo]", message);
    await db
      .from("backup_runs")
      .update({ status: "failed", finished_at: new Date().toISOString(), error: message.slice(0, 500) })
      .eq("id", id);
    await audit(db, actor, id, { trigger, ok: false, error: message.slice(0, 500) });
    return { ok: false, id, error: message };
  }
}

class TableReadError extends Error {
  constructor(readonly table: string, readonly missing: boolean, message: string) {
    super(message);
  }
}

/** Uma página de linhas por vez, na ordem estável da tabela. */
async function* readTable(db: SupabaseClient, spec: TableSpec): AsyncGenerator<Record<string, unknown>[]> {
  const fail = (error: { code?: string; message: string }) =>
    new TableReadError(
      spec.name,
      /* 42P01 = tabela inexistente no Postgres; PGRST205 = o PostgREST não a conhece. */
      error.code === "42P01" || error.code === "PGRST205",
      `No se pudo leer la tabla ${spec.name}: ${error.message}`,
    );

  if ("key" in spec) {
    let last: unknown = null;
    for (;;) {
      let query = db.from(spec.name).select("*");
      if (last !== null) query = query.gt(spec.key, last);
      const { data, error } = await query.order(spec.key, { ascending: true }).limit(PAGE_SIZE);
      if (error) throw fail(error);
      const rows = (data ?? []) as Record<string, unknown>[];
      yield rows;
      if (rows.length < PAGE_SIZE) return;
      last = rows[rows.length - 1][spec.key];
    }
  }

  for (let offset = 0; ; offset += PAGE_SIZE) {
    let query = db.from(spec.name).select("*");
    for (const column of spec.order) query = query.order(column, { ascending: true });
    const { data, error } = await query.range(offset, offset + PAGE_SIZE - 1);
    if (error) throw fail(error);
    const rows = (data ?? []) as Record<string, unknown>[];
    yield rows;
    if (rows.length < PAGE_SIZE) return;
  }
}

/**
 * Monta `{generated_at, tables: {nome: linhas[]}}` já comprimido.
 *
 * O JSON é escrito aos pedaços no gzip em vez de montado inteiro com
 * `JSON.stringify`: com o histórico crescendo, o objeto completo mais a
 * string dele não caberiam na memória da função.
 */
async function exportTables(db: SupabaseClient, generatedAt: Date) {
  const gzip = createGzip();
  const chunks: Buffer[] = [];
  gzip.on("data", (chunk: Buffer) => chunks.push(chunk));
  const finished = new Promise<void>((resolve, reject) => {
    gzip.once("end", resolve);
    gzip.once("error", reject);
  });
  const write = (text: string) =>
    new Promise<void>((resolve) => {
      if (gzip.write(text)) resolve();
      else gzip.once("drain", () => resolve());
    });

  const counts: Record<string, number> = {};
  const skipped: string[] = [];
  let rows = 0;
  let firstTable = true;

  await write(
    `{"generated_at":${JSON.stringify(generatedAt.toISOString())},"time_zone":${JSON.stringify(STORE_TIME_ZONE)},"app":"tortas-fanor","format":1,"tables":{`,
  );

  for (const spec of BACKUP_TABLES) {
    let count = 0;
    let opened = false;
    try {
      for await (const page of readTable(db, spec)) {
        if (!opened) {
          await write(`${firstTable ? "" : ","}${JSON.stringify(spec.name)}:[`);
          firstTable = false;
          opened = true;
        }
        if (page.length) {
          await write((count ? "," : "") + page.map((row) => JSON.stringify(row)).join(","));
          count += page.length;
        }
      }
    } catch (error) {
      /* Tabela que ainda não existe nesta instalação (migração não aplicada)
         não derruba o respaldo do resto. Erro no meio de uma tabela, sim:
         arquivo com tabela pela metade é pior que nenhum. */
      if (error instanceof TableReadError && error.missing && !opened) {
        console.warn("[respaldo] tabla no encontrada, se omite:", spec.name);
        skipped.push(spec.name);
        continue;
      }
      gzip.destroy();
      throw error;
    }
    await write("]");
    counts[spec.name] = count;
    rows += count;
  }

  await write(`},"row_counts":${JSON.stringify(counts)},"skipped_tables":${JSON.stringify(skipped)}}`);
  gzip.end();
  await finished;

  return { body: Buffer.concat(chunks), tables: Object.keys(counts).length, rows, skipped };
}

/** Partes da data e hora de Lima, para o arquivo ter o nome do dia da loja. */
function limaParts(date: Date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: STORE_TIME_ZONE,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  return parts;
}

/** AAAA/MM/DD/fanor-respaldo-AAAAMMDD-HHMMSS.json.gz, no horário de Lima. */
function backupPath(date: Date) {
  const p = limaParts(date);
  return `${p.year}/${p.month}/${p.day}/fanor-respaldo-${p.year}${p.month}${p.day}-${p.hour}${p.minute}${p.second}.json.gz`;
}

/** Nome do arquivo sem as pastas. */
export function backupFileName(path: string) {
  return path.split("/").pop() ?? path;
}

/**
 * Apaga as pastas de dia mais antigas que o prazo.
 *
 * O caminho já é a data, então basta comparar nomes de pasta — sem abrir
 * arquivo por arquivo. Pega também arquivo órfão, que subiu mas não chegou a
 * ser registrado em `backup_runs`.
 */
async function purgeExpired(db: SupabaseClient, now: Date): Promise<{ removed: number; error: string | null }> {
  const cutoff = addDays(limaDay(now), -BACKUP_RETENTION_DAYS);
  const bucket = db.storage.from(BACKUP_BUCKET);

  const names = async (prefix: string) => {
    const { data, error } = await bucket.list(prefix, { limit: 1000, sortBy: { column: "name", order: "asc" } });
    if (error) throw new Error(error.message);
    return (data ?? []).map((entry) => entry.name);
  };

  let removed = 0;
  try {
    for (const year of (await names("")).filter((n) => /^\d{4}$/.test(n) && n <= cutoff.slice(0, 4))) {
      for (const month of (await names(year)).filter((n) => /^\d{2}$/.test(n) && `${year}-${n}` <= cutoff.slice(0, 7))) {
        for (const day of (await names(`${year}/${month}`)).filter((n) => /^\d{2}$/.test(n) && `${year}-${month}-${n}` < cutoff)) {
          const folder = `${year}/${month}/${day}`;
          const files = (await names(folder)).map((file) => `${folder}/${file}`);
          if (!files.length) continue;
          const { error } = await bucket.remove(files);
          if (error) throw new Error(error.message);
          removed += files.length;
        }
      }
    }
    return { removed, error: null };
  } catch (error) {
    /* Falha ao limpar não invalida o respaldo de hoje: só ocupa espaço até
       a próxima execução tentar de novo. */
    const message = error instanceof Error ? error.message : String(error);
    console.error("[respaldo] limpieza de antiguos:", message);
    return { removed, error: message };
  }
}

async function audit(db: SupabaseClient, actor: string | null, id: number, changes: Record<string, unknown>) {
  const { error } = await db.from("audit_log").insert({
    actor,
    action: "backup.run",
    entity: "backup_runs",
    entity_id: String(id),
    changes,
  });
  if (error) console.error("[respaldo] auditoría:", error.message);
}

/** Link temporário que já baixa com o nome do arquivo. */
export async function signBackupUrl(db: SupabaseClient, path: string) {
  const { data, error } = await db.storage
    .from(BACKUP_BUCKET)
    .createSignedUrl(path, BACKUP_URL_TTL_SECONDS, { download: backupFileName(path) });
  if (error || !data) return { ok: false as const, error: error?.message ?? "sin respuesta" };
  return { ok: true as const, url: data.signedUrl };
}

/**
 * Compara um segredo recebido com o configurado em tempo constante.
 *
 * `===` para no primeiro caractere diferente, e o tempo de resposta vaza
 * quanto do token alguém já acertou. O hash iguala os tamanhos, que
 * `timingSafeEqual` exige.
 */
export function secretMatches(provided: string | null | undefined, expected: string) {
  if (!provided) return false;
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}
