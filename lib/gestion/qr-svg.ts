import "server-only";
import { toString as qrToString } from "qrcode";

/**
 * QR em SVG, gerado no servidor.
 *
 * SVG em vez de PNG: é vetor, então sai nítido tanto na impressora térmica
 * de 203 dpi quanto na laser em A4, sem o navegador borrar ao escalar. E
 * gerar aqui poupa o celular do taller de carregar a biblioteca inteira só
 * para desenhar quadradinhos.
 *
 * O conteúdo do QR vem de `lib/gestion/qr.ts` (série da torta ou
 * "FANOR-D:" + código da guia) — este arquivo só desenha.
 */

type Options = {
  /** Borda branca em módulos. A etiqueta já tem respiro; 2 basta para o jsQR achar o código. */
  margin?: number;
  /** "M" aguenta ~15% da etiqueta riscada ou amassada sem aumentar demais o desenho. */
  level?: "L" | "M" | "Q" | "H";
};

export async function qrSvg(value: string, { margin = 2, level = "M" }: Options = {}) {
  return qrToString(value, {
    type: "svg",
    margin,
    errorCorrectionLevel: level,
    color: { dark: "#000000", light: "#ffffff" },
  });
}
