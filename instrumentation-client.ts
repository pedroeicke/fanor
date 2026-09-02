function sendClientError(message: string, stack?: string) {
  try {
    const body = JSON.stringify({
      message: message.slice(0, 1000),
      stack: stack?.slice(0, 4000),
      path: window.location.pathname,
    });
    if (navigator.sendBeacon) {
      navigator.sendBeacon("/api/monitoring", new Blob([body], { type: "application/json" }));
    } else {
      void fetch("/api/monitoring", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive: true,
      });
    }
  } catch {
    /* Monitoramento nunca pode quebrar a loja. */
  }
}

window.addEventListener("error", (event) => {
  sendClientError(event.message || "Error de navegador", event.error?.stack);
});

window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason;
  sendClientError(
    reason instanceof Error ? reason.message : String(reason ?? "Promise rechazada"),
    reason instanceof Error ? reason.stack : undefined,
  );
});

export function onRouterTransitionStart(url: string) {
  performance.mark(`fanor-navigation-${url}`);
}
