import "server-only";
import type { Order } from "@/lib/orders";
import { formatDateLong, type DeliveryConfig } from "@/lib/delivery";
import { ADDONS } from "@/lib/addons";
import { brand, siteUrl } from "@/lib/config";
import { soles } from "@/lib/format";

/**
 * Modelos de e-mail em HTML de tabela, com estilo em atributo.
 *
 * Não é descuido: Gmail remove <style> do <head>, Outlook não entende flexbox
 * nem grid, e várias caixas ignoram classes. Tabela e `style=` inline é o que
 * chega igual em todas.
 */

const CACAO = "#3b2314";
const CREMA = "#fffcf5";
const CREMA_100 = "#fdf7ea";
const BORDER = "#f0e2c8";
const DORADO = "#f7c118";
const MUTED = "#806047";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function describe(order: Order, config: DeliveryConfig) {
  const slot = config.slots.find((s) => s.id === order.delivery.slotId);
  const zone = config.districts.find((d) => d.slug === order.delivery.districtSlug);
  const addonName = (id: string) => ADDONS.find((a) => a.id === id)?.name ?? id;
  const addonPrice = (id: string) => ADDONS.find((a) => a.id === id)?.price ?? 0;

  return {
    when: `${formatDateLong(order.delivery.dateISO)}, ${slot?.label ?? order.delivery.slotId}`,
    where:
      order.delivery.method === "pickup"
        ? "Recojo en tienda"
        : [order.delivery.address, zone?.name, order.delivery.reference]
            .filter(Boolean)
            .join(" — "),
    payment:
      order.paymentMethod === "card"
        ? order.status === "paid"
          ? "Tarjeta — pagado"
          : "Tarjeta — pago pendiente"
        : "Transferencia — esperando comprobante",
    addonName,
    addonPrice,
  };
}

function shell(title: string, body: string) {
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:${CREMA_100};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CREMA_100};padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:${CREMA};border:1px solid ${BORDER};border-radius:16px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${CACAO};">
<tr><td style="background:${DORADO};padding:16px 28px;text-align:center;">
  <span style="font-family:Georgia,serif;font-size:20px;font-weight:bold;color:${CACAO};">${brand.name}</span>
</td></tr>
${body}
<tr><td style="padding:20px 28px;border-top:1px solid ${BORDER};font-size:12px;color:${MUTED};line-height:1.6;">
  ${esc(brand.name)} · ${esc(brand.city)}<br>
  WhatsApp ${esc(brand.whatsappDisplay)} · <a href="mailto:${brand.email}" style="color:${MUTED};">${esc(brand.email)}</a>
</td></tr>
</table></td></tr></table></body></html>`;
}

function itemRows(order: Order, d: ReturnType<typeof describe>) {
  const lines = order.lines
    .map(
      (l) => `<tr><td style="padding:10px 0;border-bottom:1px solid ${BORDER};">
  <strong>${l.qty}× ${esc(l.name)}</strong>
  ${l.sizeSlug ? `<br><span style="color:${MUTED};font-size:13px;">${esc(l.sizeSlug)}</span>` : ""}
  ${l.flavors.length ? `<br><span style="color:${MUTED};font-size:13px;">Sabores: ${esc(l.flavors.join(", "))}</span>` : ""}
  ${l.cakeMessage ? `<br><span style="font-size:13px;">Mensaje: “${esc(l.cakeMessage)}”</span>` : ""}
</td><td align="right" style="padding:10px 0;border-bottom:1px solid ${BORDER};white-space:nowrap;">${soles(l.unitPrice * l.qty)}</td></tr>`,
    )
    .join("");

  const addons = order.addons
    .map(
      (a) => `<tr><td style="padding:10px 0;border-bottom:1px solid ${BORDER};">
  ${a.qty}× ${esc(d.addonName(a.addonId))}
  ${a.message ? `<br><span style="font-size:13px;">“${esc(a.message)}”</span>` : ""}
</td><td align="right" style="padding:10px 0;border-bottom:1px solid ${BORDER};white-space:nowrap;">${soles(d.addonPrice(a.addonId) * a.qty)}</td></tr>`,
    )
    .join("");

  return lines + addons;
}

/* -------------------------------------------------------------------------- */
/*  Confirmação ao cliente                                                    */
/* -------------------------------------------------------------------------- */

export function customerEmail(order: Order, config: DeliveryConfig) {
  const d = describe(order, config);
  const awaiting = order.paymentMethod === "transfer" && order.status !== "paid";
  const firstName = order.customer.name.split(" ")[0];

  const subject = awaiting
    ? `Recibimos tu pedido ${order.code} — falta el comprobante`
    : `¡Pedido ${order.code} confirmado!`;

  const html = shell(
    subject,
    `<tr><td style="padding:28px;">
  <h1 style="margin:0 0 8px;font-family:Georgia,serif;font-size:24px;">${awaiting ? "Recibimos tu pedido" : "¡Pedido confirmado!"}</h1>
  <p style="margin:0 0 20px;color:${MUTED};line-height:1.6;">
    ${esc(firstName)}, ${
      awaiting
        ? `reservamos tu torta. Envíanos el comprobante por WhatsApp al ${esc(brand.whatsappDisplay)} y la ponemos en producción.`
        : "ya estamos con las manos en la masa."
    }
  </p>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CREMA_100};border-radius:10px;padding:14px 16px;margin-bottom:20px;">
    <tr><td style="font-size:13px;color:${MUTED};">Número de pedido</td></tr>
    <tr><td style="font-family:monospace;font-size:18px;font-weight:bold;letter-spacing:1px;">${esc(order.code)}</td></tr>
  </table>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;">
    ${itemRows(order, d)}
    <tr><td style="padding:10px 0;color:${MUTED};">Subtotal</td><td align="right" style="padding:10px 0;">${soles(order.totals.subtotal)}</td></tr>
    <tr><td style="padding:0 0 10px;color:${MUTED};">${order.delivery.method === "pickup" ? "Recojo" : "Delivery"}</td><td align="right" style="padding:0 0 10px;">${order.totals.shipping === 0 ? "Gratis" : soles(order.totals.shipping)}</td></tr>
    <tr><td style="padding:12px 0;border-top:2px solid ${CACAO};font-family:Georgia,serif;font-size:18px;">Total</td><td align="right" style="padding:12px 0;border-top:2px solid ${CACAO};font-family:Georgia,serif;font-size:20px;font-weight:bold;">${soles(order.totals.total)}</td></tr>
  </table>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:20px;font-size:14px;line-height:1.7;">
    <tr><td style="color:${MUTED};width:110px;">${order.delivery.method === "pickup" ? "Recojo" : "Entrega"}</td><td><strong>${esc(d.when)}</strong></td></tr>
    <tr><td style="color:${MUTED};">Dirección</td><td>${esc(d.where)}</td></tr>
    <tr><td style="color:${MUTED};">Pago</td><td>${esc(d.payment)}</td></tr>
  </table>

  <p style="margin:24px 0 0;font-size:13px;color:${MUTED};line-height:1.6;">
    Guarda el código <strong style="color:${CACAO};">${esc(order.code)}</strong> para cualquier consulta.
    Puedes ver tu pedido en <a href="${siteUrl}/pedido/${esc(order.code)}" style="color:#c23a17;">${siteUrl}/pedido/${esc(order.code)}</a>
  </p>
</td></tr>`,
  );

  const text = [
    awaiting ? "Recibimos tu pedido" : "¡Pedido confirmado!",
    "",
    `Pedido: ${order.code}`,
    "",
    ...order.lines.map((l) => `- ${l.qty}x ${l.name}${l.cakeMessage ? ` — "${l.cakeMessage}"` : ""}  ${soles(l.unitPrice * l.qty)}`),
    ...order.addons.map((a) => `- ${a.qty}x ${d.addonName(a.addonId)}  ${soles(d.addonPrice(a.addonId) * a.qty)}`),
    "",
    `Subtotal: ${soles(order.totals.subtotal)}`,
    `${order.delivery.method === "pickup" ? "Recojo" : "Delivery"}: ${order.totals.shipping === 0 ? "Gratis" : soles(order.totals.shipping)}`,
    `Total: ${soles(order.totals.total)}`,
    "",
    `${order.delivery.method === "pickup" ? "Recojo" : "Entrega"}: ${d.when}`,
    `Dirección: ${d.where}`,
    `Pago: ${d.payment}`,
    "",
    awaiting ? `Envíanos el comprobante por WhatsApp al ${brand.whatsappDisplay}.` : "",
    `${siteUrl}/pedido/${order.code}`,
  ]
    .filter((l) => l !== "")
    .join("\n");

  return { subject, html, text };
}

/* -------------------------------------------------------------------------- */
/*  Ordem de produção                                                         */
/*                                                                            */
/*  Tudo que a cozinha precisa para produzir sem abrir o painel: mensagem      */
/*  sobre a torta, sabores, tamanho, link da foto, endereço e telefone.        */
/* -------------------------------------------------------------------------- */

export function opsEmail(order: Order, config: DeliveryConfig) {
  const d = describe(order, config);
  const urgent = order.paymentMethod === "transfer" && order.status !== "paid";

  const subject = `[${order.delivery.dateISO}] Pedido ${order.code} — ${order.lines.reduce((n, l) => n + l.qty, 0)} pieza(s)${urgent ? " · ESPERANDO PAGO" : ""}`;

  const html = shell(
    subject,
    `<tr><td style="padding:28px;">
  <h1 style="margin:0 0 4px;font-family:Georgia,serif;font-size:22px;">Nuevo pedido ${esc(order.code)}</h1>
  <p style="margin:0 0 20px;font-size:14px;color:${MUTED};">
    ${urgent ? '<strong style="color:#c23a17;">Esperando comprobante de transferencia.</strong> ' : ""}
    Entrega ${esc(d.when)}
  </p>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;line-height:1.7;background:${CREMA_100};border-radius:10px;padding:14px 16px;">
    <tr><td style="color:${MUTED};width:110px;">Cliente</td><td><strong>${esc(order.customer.name)}</strong></td></tr>
    <tr><td style="color:${MUTED};">Celular</td><td><a href="tel:+51${esc(order.customer.phone)}" style="color:${CACAO};">${esc(order.customer.phone)}</a></td></tr>
    <tr><td style="color:${MUTED};">Correo</td><td>${esc(order.customer.email)}</td></tr>
    <tr><td style="color:${MUTED};">${order.delivery.method === "pickup" ? "Recojo" : "Dirección"}</td><td>${esc(d.where)}</td></tr>
    <tr><td style="color:${MUTED};">Pago</td><td>${esc(d.payment)}</td></tr>
  </table>

  <h2 style="margin:22px 0 8px;font-family:Georgia,serif;font-size:17px;">A producir</h2>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;">
    ${order.lines
      .map(
        (l) => `<tr><td style="padding:12px 14px;border:2px solid ${BORDER};border-radius:10px;line-height:1.7;">
      <strong style="font-size:15px;">${l.qty}× ${esc(l.name)}</strong>
      ${l.sizeSlug ? `<br><span style="color:${MUTED};">Tamaño: ${esc(l.sizeSlug)}</span>` : ""}
      ${l.flavors.length ? `<br><span style="color:${MUTED};">Sabores: ${esc(l.flavors.join(", "))}</span>` : ""}
      ${l.cakeMessage ? `<br><span style="background:${DORADO};padding:3px 8px;border-radius:5px;display:inline-block;margin-top:4px;">Escribir: “${esc(l.cakeMessage)}”</span>` : ""}
      ${l.photoUrl ? `<br><a href="${esc(l.photoUrl)}" style="color:#c23a17;">Descargar foto del cliente</a>` : ""}
    </td></tr><tr><td style="height:8px;"></td></tr>`,
      )
      .join("")}
    ${order.addons.map((a) => `<tr><td style="padding:10px 14px;border:1px solid ${BORDER};border-radius:10px;">${a.qty}× ${esc(d.addonName(a.addonId))}${a.message ? ` — “${esc(a.message)}”` : ""}</td></tr><tr><td style="height:8px;"></td></tr>`).join("")}
  </table>

  ${order.notes ? `<p style="margin:16px 0 0;padding:12px 14px;background:${CREMA_100};border-radius:10px;font-size:14px;"><strong>Nota del cliente:</strong> ${esc(order.notes)}</p>` : ""}

  <p style="margin:22px 0 0;font-size:14px;">Total cobrado: <strong>${soles(order.totals.total)}</strong></p>
</td></tr>`,
  );

  const text = [
    `NUEVO PEDIDO ${order.code}`,
    urgent ? "*** ESPERANDO COMPROBANTE DE TRANSFERENCIA ***" : "",
    "",
    `Entrega: ${d.when}`,
    `Cliente: ${order.customer.name} — ${order.customer.phone}`,
    `${order.delivery.method === "pickup" ? "Recojo" : "Dirección"}: ${d.where}`,
    `Pago: ${d.payment}`,
    "",
    "A PRODUCIR:",
    ...order.lines.flatMap((l) =>
      [
        `- ${l.qty}x ${l.name}`,
        l.sizeSlug ? `  Tamaño: ${l.sizeSlug}` : "",
        l.flavors.length ? `  Sabores: ${l.flavors.join(", ")}` : "",
        l.cakeMessage ? `  ESCRIBIR: "${l.cakeMessage}"` : "",
        l.photoUrl ? `  Foto: ${l.photoUrl}` : "",
      ].filter(Boolean),
    ),
    ...order.addons.map((a) => `- ${a.qty}x ${d.addonName(a.addonId)}${a.message ? ` — "${a.message}"` : ""}`),
    "",
    order.notes ? `Nota del cliente: ${order.notes}` : "",
    `Total: ${soles(order.totals.total)}`,
  ]
    .filter((l) => l !== "")
    .join("\n");

  return { subject, html, text };
}
