import { limaDateTime, limaDay, limaToday, STORE_TIME_ZONE } from "@/lib/gestion/dates";

/** "13 set 2026" no calendário de Lima. */
export function limaDate(value: string | Date) {
  return new Date(value).toLocaleDateString("es-PE", {
    timeZone: STORE_TIME_ZONE, day: "2-digit", month: "short", year: "numeric",
  });
}

/**
 * "13 set, 20:14" quando é deste ano; "13 set 2025" quando não é.
 *
 * `limaDateTime` não mostra o ano — numa lista de clientes, "última compra
 * 13 set" de um ano atrás pareceria de ontem.
 */
export function limaWhen(value: string | Date, today = limaToday()) {
  return limaDay(value).slice(0, 4) === today.slice(0, 4) ? limaDateTime(value) : limaDate(value);
}

/** Dinheiro sem centavos para os cards de resumo, onde o espaço é curto. */
export function solesRound(value: number) {
  return `S/ ${Math.round(value).toLocaleString("es-PE")}`;
}
