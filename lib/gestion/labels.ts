/**
 * Nomes e cores dos estados, em espanhol, como a vendedora lê.
 *
 * Um lugar só: a mesma torta aparece no taller, na recepção, na vitrine e no
 * relatório, e "Reservada" não pode virar "Apartada" numa tela e "En espera"
 * noutra.
 */

type Tone = "ok" | "warn" | "bad" | "info" | "muted";

export const TONE_CLASS: Record<Tone, string> = {
  ok: "border-verde/35 bg-verde-100 text-verde",
  warn: "border-dorado-600/40 bg-dorado-100 text-cacao-700",
  bad: "border-terracota/30 bg-terracota/10 text-terracota-700",
  info: "border-cacao/20 bg-crema-100 text-cacao-700",
  muted: "border-crema-300 bg-crema-100 text-cacao-300",
};

export const CAKE_STATUS: Record<string, { label: string; tone: Tone }> = {
  in_transit: { label: "En camino", tone: "info" },
  in_stock: { label: "En vitrina", tone: "ok" },
  reserved: { label: "Reservada", tone: "warn" },
  sold: { label: "Vendida", tone: "muted" },
  missing: { label: "Faltante", tone: "bad" },
  returned: { label: "Devuelta al taller", tone: "warn" },
  discarded: { label: "Descartada", tone: "muted" },
};

export const CAKE_EVENT: Record<string, string> = {
  dispatched: "Despachada del taller",
  received: "Recibida en tienda",
  missing: "No llegó",
  found: "Apareció",
  returned: "Devuelta al taller",
  redecorated: "Redecorada",
  discarded: "Descartada",
  sold: "Vendida",
  staff_sale: "Comprada por el personal",
  reserved: "Reservada",
  released: "Liberada",
  photo: "Foto actualizada",
};

export const REQUEST_STATUS: Record<string, { label: string; tone: Tone }> = {
  planned: { label: "Pendiente", tone: "warn" },
  in_progress: { label: "Despacho parcial", tone: "info" },
  done: { label: "Atendido", tone: "ok" },
  cancelled: { label: "Cancelado", tone: "muted" },
};

export const DISPATCH_STATUS: Record<string, { label: string; tone: Tone }> = {
  in_transit: { label: "En camino", tone: "info" },
  received: { label: "Recibido", tone: "ok" },
  received_with_issues: { label: "Recibido con faltantes", tone: "bad" },
  cancelled: { label: "Anulado", tone: "muted" },
};

export const CONTRACT_STATUS: Record<string, { label: string; tone: Tone }> = {
  open: { label: "Registrada", tone: "info" },
  in_production: { label: "En producción", tone: "warn" },
  ready: { label: "Lista para entregar", tone: "ok" },
  delivered: { label: "Entregada", tone: "muted" },
  cancelled: { label: "Cancelada", tone: "muted" },
};

export const LEAD_STATUS: Record<string, { label: string; tone: Tone }> = {
  new: { label: "Sin asignar", tone: "bad" },
  assigned: { label: "Asignado", tone: "warn" },
  contacted: { label: "Contactado", tone: "info" },
  won: { label: "Ganado", tone: "ok" },
  lost: { label: "Perdido", tone: "muted" },
};

export const LEAD_SOURCE: Record<string, string> = {
  messenger: "Messenger",
  instagram: "Instagram",
  facebook: "Facebook",
  whatsapp: "WhatsApp",
  web: "Sitio web",
  phone: "Llamada",
  store: "En tienda",
  other: "Otro",
};

export const PAYMENT_METHOD: Record<string, string> = {
  cash: "Efectivo",
  card: "Tarjeta",
  yape: "Yape",
  plin: "Plin",
  transfer: "Transferencia",
  deposit: "Depósito",
  credit: "Crédito",
};

export const SALE_KIND: Record<string, string> = {
  counter: "Mostrador",
  staff: "Personal",
  contract_advance: "Adelanto de encomienda",
  contract_balance: "Saldo de encomienda",
};

export const ALERT_SEVERITY: Record<string, { label: string; tone: Tone }> = {
  critical: { label: "Urgente", tone: "bad" },
  warn: { label: "Atención", tone: "warn" },
  info: { label: "Aviso", tone: "info" },
};
