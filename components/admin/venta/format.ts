/**
 * Datas de calendário ("AAAA-MM-DD") das telas de venda.
 *
 * `expires_on` é um dia, não um instante: formatar passando por fuso faria
 * a torta que vence dia 13 aparecer como 12 no celular. Aqui a conta é em
 * UTC puro, só com o calendário.
 */

function utcDate(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1));
}

/** "12 sept." */
export function shortDay(iso: string) {
  return utcDate(iso).toLocaleDateString("es-PE", { timeZone: "UTC", day: "numeric", month: "short" });
}

/** "sábado, 12 de septiembre de 2026" */
export function longDay(iso: string) {
  return utcDate(iso).toLocaleDateString("es-PE", {
    timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric",
  });
}

/** Dias de `from` até `to` (positivo quando `to` é depois). */
export function daysBetween(from: string, to: string) {
  return Math.round((utcDate(to).getTime() - utcDate(from).getTime()) / 86_400_000);
}

/** "Venció ayer", "Venció hace 3 días", "Vence hoy". */
export function expiryLabel(daysExpired: number) {
  if (daysExpired <= 0) return daysExpired === 0 ? "Vence hoy" : "Vigente";
  return daysExpired === 1 ? "Venció ayer" : `Venció hace ${daysExpired} días`;
}

/** Documento para mostrar: "DNI 12345678". */
export function docLabel(docType: string | null | undefined, docNumber: string | null | undefined) {
  if (!docNumber || !docType || docType === "NONE") return null;
  return `${docType === "PASSPORT" ? "Pasaporte" : docType} ${docNumber}`;
}
