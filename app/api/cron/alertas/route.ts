import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { notifyAlerts, notifyDestinations, type NotifiableAlert } from "@/lib/gestion/notify";

/**
 * Recalcula os alertas e avisa os urgentes fora do painel.
 *
 * O painel já recalcula quando alguém abre Leads ou Alertas — mas o lead que
 * espera às 7h, com ninguém logado, só apareceria quando alguém entrasse.
 * Esta rotina roda a cada 5 min e leva o aviso até quem não está olhando.
 *
 * Quem entra no aviso: todo alerta crítico ainda não avisado, e o de atenção
 * que já dura mais de 1 h (o de atenção recente costuma se resolver sozinho
 * — a vendedora conferiu o despacho dez minutos depois). Cada alerta é
 * avisado uma vez por gravidade: de novo só se subir para urgente depois do
 * aviso. `notified_at` só é gravado quando algum destino recebeu, então uma
 * falha do provedor tenta de novo na rodada seguinte.
 *
 * Protegido por CRON_SECRET (Authorization: Bearer ou ?secret=).
 */

export const dynamic = "force-dynamic";

const WARN_AFTER_MS = 60 * 60_000;
/* Um resumo com cem linhas não é lido; o que sobrar vai na rodada seguinte. */
const MAX_PER_RUN = 50;

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const provided =
    request.headers.get("authorization")?.replace("Bearer ", "") ??
    new URL(request.url).searchParams.get("secret") ??
    "";
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

type AlertRow = Omit<NotifiableAlert, "store_name"> & { stores: { name: string } | null };

const ALERT_COLUMNS = "id, kind, severity, title, detail, entity, entity_id, created_at, stores(name)";
const NOTICE_ACTION = "alert.notified";

/**
 * Urgentes já avisados, mas nunca como urgentes.
 *
 * `alerts_upsert` sobe a gravidade sem zerar `notified_at`: a encomenda de
 * amanhã é avisada como "Atención" e, no dia da entrega, vira "Urgente" em
 * silêncio. O registro de cada aviso em `audit_log` diz com que gravidade
 * ele saiu; reavisa só quem tem aviso registrado e nenhum deles urgente.
 * Sem registro (consulta ou gravação falhou), não reavisa — melhor calar uma
 * vez do que repetir o mesmo alerta a cada rodada.
 */
async function escalatedSinceNotice(db: SupabaseClient, candidates: AlertRow[]) {
  if (!candidates.length) return [];
  const { data, error } = await db
    .from("audit_log")
    .select("entity_id, severity:changes->>severity")
    .eq("action", NOTICE_ACTION)
    .eq("entity", "alerts")
    .in("entity_id", candidates.map((a) => a.id));
  if (error) {
    console.error("[cron/alertas] escalada", error.code, error.message);
    return [];
  }
  const noticed = new Set<string>();
  const noticedAsCritical = new Set<string>();
  for (const row of (data ?? []) as { entity_id: string; severity: string | null }[]) {
    noticed.add(row.entity_id);
    if (row.severity === "critical") noticedAsCritical.add(row.entity_id);
  }
  return candidates.filter((a) => noticed.has(a.id) && !noticedAsCritical.has(a.id));
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Sin conexión." }, { status: 503 });

  /* A função aceita a chave de serviço (op_guard): é a mesma conta que o
     painel faz, sem sessão de usuário. */
  const { data: open, error: refreshError } = await db.rpc("alerts_refresh");
  if (refreshError) {
    console.error("[cron/alertas] alerts_refresh", refreshError.code, refreshError.message);
    return NextResponse.json({ error: "No se pudo recalcular las alertas." }, { status: 502 });
  }

  const destinations = notifyDestinations();
  if (!destinations.any) {
    return NextResponse.json({
      open,
      notified: 0,
      destinations: { webhook: false, email: destinations.emails.length ? "no_provider" : false },
    });
  }

  const warnBefore = new Date(Date.now() - WARN_AFTER_MS).toISOString();
  const [fresh, notifiedCritical] = await Promise.all([
    db
      .from("alerts")
      .select(ALERT_COLUMNS)
      .is("resolved_at", null)
      .is("notified_at", null)
      .or(`severity.eq.critical,and(severity.eq.warn,created_at.lt."${warnBefore}")`)
      .order("created_at", { ascending: true })
      .limit(MAX_PER_RUN),
    /* Candidatos a escalada: urgentes que já foram avisados alguma vez. */
    db
      .from("alerts")
      .select(ALERT_COLUMNS)
      .is("resolved_at", null)
      .not("notified_at", "is", null)
      .eq("severity", "critical")
      .order("created_at", { ascending: true })
      .limit(MAX_PER_RUN),
  ]);

  if (fresh.error) {
    console.error("[cron/alertas] select", fresh.error.code, fresh.error.message);
    return NextResponse.json({ error: "No se pudo leer las alertas." }, { status: 502 });
  }

  const escalated = await escalatedSinceNotice(db, (notifiedCritical.data ?? []) as unknown as AlertRow[]);
  const rows = [...((fresh.data ?? []) as unknown as AlertRow[]), ...escalated].slice(0, MAX_PER_RUN);

  /* Crítico primeiro no resumo: é o que a pessoa lê antes de largar o celular. */
  const alerts: NotifiableAlert[] = rows
    .map(({ stores, ...a }) => ({ ...a, store_name: stores?.name ?? null }))
    .sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "critical" ? -1 : 1));

  if (!alerts.length) {
    return NextResponse.json({ open, notified: 0, pending: 0 });
  }

  const outcome = await notifyAlerts(alerts);
  if (outcome.errors.length) console.error("[cron/alertas] aviso", outcome.errors.join(" | "));

  let marked = 0;
  if (outcome.delivered) {
    const { error: markError, count } = await db
      .from("alerts")
      .update({ notified_at: new Date().toISOString() }, { count: "exact" })
      .in("id", alerts.map((a) => a.id));
    if (markError) console.error("[cron/alertas] notified_at", markError.code, markError.message);
    else marked = count ?? alerts.length;

    /* Com que gravidade cada um foi avisado: é o que permite reavisar quando
       "Atención" vira "Urgente" sem repetir o urgente a cada 5 min. */
    const { error: logError } = await db.from("audit_log").insert(
      alerts.map((a) => ({
        actor: null,
        action: NOTICE_ACTION,
        entity: "alerts",
        entity_id: a.id,
        changes: { severity: a.severity, kind: a.kind, webhook: outcome.webhook, email: outcome.email },
      })),
    );
    if (logError) console.error("[cron/alertas] audit_log", logError.code, logError.message);
  }

  return NextResponse.json({
    open,
    pending: alerts.length,
    escalated: escalated.length,
    notified: marked,
    webhook: outcome.webhook,
    email: outcome.email,
    errors: outcome.errors.length,
  });
}
