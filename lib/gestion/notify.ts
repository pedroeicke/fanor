import "server-only";
import { activeProvider, isValidEmail, sendEmail } from "@/lib/email/provider";
import { siteUrl } from "@/lib/config";

/**
 * Aviso de alerta fora do painel.
 *
 * O alerta existe no banco de qualquer jeito; isto só leva o urgente até quem
 * não está olhando a tela — o Joseka no celular, um canal de chat. Dois
 * destinos independentes, ambos opcionais:
 *
 *   - `ALERTS_WEBHOOK_URL`: POST JSON. Slack e Google Chat recebem `text`,
 *     Discord recebe `content`; outro endereço recebe os dois mais a lista
 *     estruturada (ver `webhookBody`).
 *   - `ALERTS_EMAIL`: um ou mais endereços separados por vírgula, pelo mesmo
 *     provedor dos e-mails de pedido.
 *
 * Um resumo por rodada, não um aviso por alerta: cinco leads atrasados às
 * 9h seriam cinco notificações seguidas, e a pessoa silencia o canal.
 */

export type NotifiableAlert = {
  id: string;
  kind: string;
  severity: string;
  title: string;
  detail: string | null;
  entity: string | null;
  entity_id: string | null;
  created_at: string;
  store_name: string | null;
};

export type NotifyOutcome = {
  /** Pelo menos um destino recebeu: pode marcar `notified_at`. */
  delivered: boolean;
  webhook: "sent" | "failed" | "off";
  email: "sent" | "failed" | "off" | "no_provider";
  errors: string[];
};

const TIMEOUT_MS = 8000;

/** Tela certa para resolver cada tipo de alerta. Null = não há tela (reclamação). */
export function alertHref(entity: string | null, entityId: string | null): string | null {
  switch (entity) {
    case "leads":
      return "/admin/leads";
    case "production_orders":
      return "/admin/taller";
    case "contracts":
      return entityId ? `/admin/encomiendas/${encodeURIComponent(entityId)}` : "/admin/encomiendas";
    case "dispatches":
      return entityId ? `/admin/recepcion/${encodeURIComponent(entityId)}` : "/admin/recepcion";
    case "stores":
      return entityId ? `/admin/tienda?tienda=${encodeURIComponent(entityId)}` : "/admin/tienda";
    case "sync_runs":
      return "/admin/estoque";
    default:
      return null;
  }
}

function alertEmails() {
  return (process.env.ALERTS_EMAIL ?? "")
    .split(",")
    .map((e) => e.trim())
    .filter((e) => e && isValidEmail(e));
}

/**
 * O que está ligado. E-mail sem provedor configurado conta como desligado:
 * o provedor "simulado" aprova sem enviar, e o alerta seria marcado como
 * avisado sem ninguém ter recebido nada.
 */
export function notifyDestinations() {
  const webhook = Boolean(process.env.ALERTS_WEBHOOK_URL?.trim());
  const emails = alertEmails();
  const emailReady = emails.length > 0 && activeProvider() !== "simulado";
  return { webhook, emails, emailReady, any: webhook || emailReady };
}

const SEVERITY_LABEL: Record<string, string> = { critical: "URGENTE", warn: "Atención", info: "Aviso" };

function absolute(href: string | null) {
  return href ? `${siteUrl}${href}` : null;
}

function line(alert: NotifiableAlert) {
  const parts = [
    `${SEVERITY_LABEL[alert.severity] ?? alert.severity}: ${alert.title}`,
    alert.detail,
    alert.store_name,
  ].filter(Boolean);
  const url = absolute(alertHref(alert.entity, alert.entity_id));
  return `• ${parts.join(" · ")}${url ? `\n  ${url}` : ""}`;
}

function summaryText(alerts: NotifiableAlert[]) {
  const critical = alerts.filter((a) => a.severity === "critical").length;
  const head = `Tortas Fanor · ${alerts.length} alerta${alerts.length === 1 ? "" : "s"} sin resolver` +
    (critical ? ` (${critical} urgente${critical === 1 ? "" : "s"})` : "");
  return `${head}\n\n${alerts.map(line).join("\n")}\n\nCentral de alertas: ${siteUrl}/admin/alertas`;
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/* HTML de tabela com estilo inline, como os e-mails de pedido: é o que chega
   igual no Gmail e no Outlook. */
function summaryHtml(alerts: NotifiableAlert[]) {
  const rows = alerts
    .map((a) => {
      const url = absolute(alertHref(a.entity, a.entity_id));
      const color = a.severity === "critical" ? "#c23a17" : "#806047";
      const meta = [a.detail, a.store_name].filter(Boolean).map((v) => esc(String(v))).join(" · ");
      return `<tr><td style="padding:12px 0;border-bottom:1px solid #f0e2c8;font-family:Arial,sans-serif">
<div style="font-size:11px;font-weight:bold;letter-spacing:1px;color:${color}">${esc(SEVERITY_LABEL[a.severity] ?? a.severity)}</div>
<div style="font-size:15px;color:#3b2314;margin-top:2px">${esc(a.title)}</div>
${meta ? `<div style="font-size:13px;color:#806047;margin-top:2px">${meta}</div>` : ""}
${url ? `<div style="margin-top:6px"><a href="${esc(url)}" style="color:#c23a17;font-size:13px">Abrir</a></div>` : ""}
</td></tr>`;
    })
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#fffcf5;padding:24px">
<tr><td style="font-family:Arial,sans-serif;font-size:20px;color:#3b2314;padding-bottom:8px">Alertas sin resolver</td></tr>
${rows}
<tr><td style="padding-top:16px;font-family:Arial,sans-serif"><a href="${esc(`${siteUrl}/admin/alertas`)}" style="display:inline-block;background:#f7c118;color:#3b2314;padding:10px 18px;border-radius:999px;text-decoration:none;font-weight:bold;font-size:14px">Ver central de alertas</a></td></tr>
</table>`;
}

/**
 * Corpo do POST conforme o destino.
 *
 * Google Chat recusa com 400 qualquer campo que não conhece, e o Discord só
 * lê `content` (até 2000 caracteres). Para esses dois, e para o Slack, vai só
 * o que cada um aceita; qualquer outro endereço (n8n, Make, um script) recebe
 * o JSON completo, com a lista estruturada.
 */
function webhookBody(url: string, alerts: NotifiableAlert[]) {
  const text = summaryText(alerts);
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    /* Endereço torto: o fetch falha adiante e o erro vai para o log. */
  }

  if (host === "chat.googleapis.com") return { text: clipText(text, 4000) };
  if (host === "hooks.slack.com") return { text };
  if (host === "discord.com" || host === "discordapp.com" || host.endsWith(".discord.com")) {
    return { content: clipText(text, 2000) };
  }

  return {
    source: "tortas-fanor",
    text,
    content: clipText(text, 2000),
    alerts: alerts.map((a) => ({
      id: a.id,
      kind: a.kind,
      severity: a.severity,
      title: a.title,
      detail: a.detail,
      store: a.store_name,
      created_at: a.created_at,
      url: absolute(alertHref(a.entity, a.entity_id)),
    })),
  };
}

/* Corta numa quebra de linha, para não partir um link ao meio. */
function clipText(text: string, max: number) {
  if (text.length <= max) return text;
  const tail = `\n…\n${siteUrl}/admin/alertas`;
  const cut = text.slice(0, max - tail.length);
  const newline = cut.lastIndexOf("\n");
  return `${newline > 0 ? cut.slice(0, newline) : cut}${tail}`;
}

async function postWebhook(url: string, alerts: NotifiableAlert[]) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(webhookBody(url, alerts)),
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`El webhook respondió ${response.status}`);
}

/** Envia o resumo para os destinos ligados. Nunca lança: devolve o que aconteceu. */
export async function notifyAlerts(alerts: NotifiableAlert[]): Promise<NotifyOutcome> {
  const outcome: NotifyOutcome = { delivered: false, webhook: "off", email: "off", errors: [] };
  if (!alerts.length) return outcome;

  const { webhook, emails, emailReady } = notifyDestinations();

  if (webhook) {
    try {
      await postWebhook(process.env.ALERTS_WEBHOOK_URL!.trim(), alerts);
      outcome.webhook = "sent";
      outcome.delivered = true;
    } catch (error) {
      outcome.webhook = "failed";
      outcome.errors.push(`webhook: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (emails.length && !emailReady) {
    outcome.email = "no_provider";
  } else if (emailReady) {
    const critical = alerts.filter((a) => a.severity === "critical").length;
    const subject = critical
      ? `🔔 ${critical} alerta${critical === 1 ? "" : "s"} urgente${critical === 1 ? "" : "s"} · Tortas Fanor`
      : `🔔 ${alerts.length} alerta${alerts.length === 1 ? "" : "s"} · Tortas Fanor`;
    const text = summaryText(alerts);
    const html = summaryHtml(alerts);

    let sent = 0;
    for (const to of emails) {
      const result = await sendEmail({ to, subject, text, html });
      if (result.ok) sent += 1;
      else outcome.errors.push(`email ${to}: ${result.error}`);
    }
    outcome.email = sent ? "sent" : "failed";
    if (sent) outcome.delivered = true;
  }

  return outcome;
}
