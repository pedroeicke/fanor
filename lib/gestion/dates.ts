/**
 * Datas da operação, no fuso da loja.
 *
 * O servidor roda em UTC. `new Date().toISOString().slice(0, 10)` às 20h de
 * Arequipa já devolve o dia seguinte — e a torta "vence" quatro horas antes
 * da hora. Tudo que for "hoje" na operação passa por aqui. Espelha a função
 * `lima_today()` do banco.
 */

export const STORE_TIME_ZONE = "America/Lima";

/** "2026-09-13" no calendário de Lima. */
export function limaToday(now = new Date()) {
  return limaDay(now);
}

/** Dia de Lima de um instante qualquer. */
export function limaDay(value: Date | string) {
  const date = typeof value === "string" ? new Date(value) : value;
  /* en-CA formata como AAAA-MM-DD. */
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: STORE_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(date);
}

/** Soma dias a um "AAAA-MM-DD" sem passar por fuso. */
export function addDays(iso: string, days: number) {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().slice(0, 10);
}

/** "13 set, 20:14" no horário de Lima. */
export function limaDateTime(value: string | Date) {
  return new Date(value).toLocaleString("es-PE", {
    timeZone: STORE_TIME_ZONE, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

/** "20:14" no horário de Lima. */
export function limaTime(value: string | Date) {
  return new Date(value).toLocaleTimeString("es-PE", { timeZone: STORE_TIME_ZONE, hour: "2-digit", minute: "2-digit" });
}

/** Minutos inteiros entre dois instantes (b − a). */
export function minutesBetween(a: string | Date, b: string | Date = new Date()) {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60_000);
}

/** "12 min", "3 h 5 min", "2 d". */
export function formatDuration(minutes: number) {
  if (minutes < 60) return `${Math.max(0, minutes)} min`;
  if (minutes < 60 * 24) {
    const h = Math.floor(minutes / 60), m = minutes % 60;
    return m ? `${h} h ${m} min` : `${h} h`;
  }
  return `${Math.floor(minutes / (60 * 24))} d`;
}
