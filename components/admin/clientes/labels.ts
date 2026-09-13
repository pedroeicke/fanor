import type { TONE_CLASS } from "@/lib/gestion/labels";
import { LEAD_SOURCE } from "@/lib/gestion/labels";

/**
 * Rótulos que só a ficha do cliente usa: estados de tabelas antigas (pedido
 * do site, venda, reclamação) que as telas de operação não mostram.
 */

type Tone = keyof typeof TONE_CLASS;

export const ORDER_STATUS: Record<string, { label: string; tone: Tone }> = {
  pending_payment: { label: "Esperando pago", tone: "warn" },
  paid: { label: "Pagado", tone: "ok" },
  failed: { label: "Pago fallido", tone: "bad" },
  cancelled: { label: "Cancelado", tone: "muted" },
  abandoned: { label: "Abandonado", tone: "muted" },
};

export const SALE_STATUS: Record<string, { label: string; tone: Tone }> = {
  open: { label: "Sin cobrar", tone: "warn" },
  paid: { label: "Pagada", tone: "ok" },
  void: { label: "Anulada", tone: "muted" },
};

export const COMPLAINT_STATUS: Record<string, { label: string; tone: Tone }> = {
  recibido: { label: "Recibido", tone: "bad" },
  en_proceso: { label: "En proceso", tone: "warn" },
  respondido: { label: "Respondido", tone: "ok" },
};

export const COMPLAINT_KIND: Record<string, string> = {
  reclamo: "Reclamo",
  queja: "Queja",
};

/** De onde o cliente veio pela primeira vez (`customers.source`). */
const SOURCE_LABEL: Record<string, string> = {
  ...LEAD_SOURCE,
  web: "Sitio web",
  reclamaciones: "Libro de reclamaciones",
  panel: "Panel",
  sisgeco: "Sisgeco",
  counter: "Mostrador",
};

export function sourceLabel(source: string | null | undefined) {
  if (!source) return "—";
  return SOURCE_LABEL[source] ?? source.charAt(0).toUpperCase() + source.slice(1);
}
