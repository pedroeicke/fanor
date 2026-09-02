import "server-only";

export type MonitoringEvent = {
  source: "server" | "client";
  message: string;
  path?: string;
  method?: string;
  digest?: string;
  stack?: string;
  context?: Record<string, unknown>;
};

/** Envia para Sentry/Better Stack/Slack via webhook; sem URL, fica no log do host. */
export async function reportError(event: MonitoringEvent) {
  const safe = { ...event, timestamp: new Date().toISOString(), service: "fanor-web" };
  const url = process.env.MONITORING_WEBHOOK_URL?.trim();
  if (!url) {
    console.error("[monitoring]", JSON.stringify(safe));
    return;
  }
  try {
    await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.MONITORING_WEBHOOK_TOKEN
          ? { Authorization: `Bearer ${process.env.MONITORING_WEBHOOK_TOKEN}` }
          : {}),
      },
      body: JSON.stringify(safe),
      signal: AbortSignal.timeout(4000),
    });
  } catch (error) {
    console.error("[monitoring] proveedor no disponible", error);
  }
}
