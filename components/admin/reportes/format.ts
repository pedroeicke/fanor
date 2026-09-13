/**
 * Formatos dos relatórios. Somas de três meses passam de mil: sem separador
 * de milhar, "S/ 48213.50" se lê errado de relance.
 */

export function money(value: number) {
  return `S/ ${value.toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Eixo e rótulos curtos: "S/ 1,200", sem centavos. */
export function moneyShort(value: number) {
  return `S/ ${Math.round(value).toLocaleString("es-PE")}`;
}

export function int(value: number) {
  return Math.round(value).toLocaleString("es-PE");
}

/** "12%" ou "—" quando não há base para dividir. */
export function pct(part: number, whole: number) {
  if (!whole) return "—";
  const value = (part / whole) * 100;
  return `${value < 10 && value > 0 ? value.toFixed(1) : Math.round(value)}%`;
}

/**
 * Cores das formas de pagamento, na ordem fixa da paleta validada (CVD entre
 * vizinhas >= 9, contraste corrigido por legenda e tabela). A cor segue a
 * forma de pagamento, nunca a posição no ranking: Yape é sempre verde-água,
 * mesmo quando filtrar a loja faz ele subir para o primeiro lugar.
 */
export const PAYMENT_COLOR: Record<string, string> = {
  cash: "#2a78d6",
  card: "#eb6834",
  yape: "#1baf7a",
  plin: "#eda100",
  transfer: "#e87ba4",
  deposit: "#008300",
  credit: "#4a3aa7",
};
