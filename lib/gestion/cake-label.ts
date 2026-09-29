import QRCode from "qrcode";

/** TSC TE200: 8 pontos/mm. Área útil de 44 × 19 mm, dentro de 50 × 25 mm. */
export const CAKE_LABEL = { widthMm: 50, heightMm: 25, marginMm: 3, dotsPerMm: 8 } as const;

export type CakeLabelContent = { name: string; flavors: string | null };

/** A regra vem do cadastro do produto; um sabor fixo (Moca, por exemplo) não é uma combinação. */
export function cakeLabelContent(product: {
  name: string;
  minFlavors: number;
  maxFlavors: number;
  flavorName?: string | null;
}): CakeLabelContent {
  return {
    name: product.name.trim(),
    flavors: product.minFlavors === 3 && product.maxFlavors === 3
      ? product.flavorName?.trim() || "Sabores por confirmar"
      : null,
  };
}

export type CakeLabel = CakeLabelContent & {
  store: string;
  serial: string;
  /** Nas provas, o QR é FANOR-TEST:NN: não corresponde a uma torta de estoque. */
  qrValue: string;
  detail?: string | null;
  redecorated?: boolean;
};

function xml(value: string) {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);
}

// Larguras aproximadas em Arial Narrow a 6 pt. textLength fixa a largura
// efetiva no SVG, inclusive quando o computador usa uma fonte de fallback.
function textWidth(text: string) {
  return [...text].reduce((width, char) => width + (
    /[ilI1.,:!|' ]/.test(char) ? 0.43
      : /[mwMW@%]/.test(char) ? 1.4
        : /[A-ZÁÉÍÓÚÑ0-9]/.test(char) ? 1.1 : 0.86
  ), 0);
}

function nameLines(text: string) {
  if (textWidth(text) <= 22.7) return [text];
  const words = text.split(/\s+/);
  let best = [text];
  let width = Infinity;
  for (let i = 1; i < words.length; i++) {
    const candidate = [words.slice(0, i).join(" "), words.slice(i).join(" ")];
    const longest = Math.max(...candidate.map(textWidth));
    if (longest < width) { best = candidate; width = longest; }
  }
  return best;
}

function textLine(value: string, x: number, y: number, maxWidth: number, bold = false) {
  // Ajusta a largura, sem reticências, corte ou perda de acentos.
  const width = Math.min(textWidth(value), maxWidth);
  return `<text x="${x}" y="${y}" font-size="2.116667"${bold ? ' font-weight="700"' : ""} textLength="${width.toFixed(3)}" lengthAdjust="spacingAndGlyphs">${xml(value)}</text>`;
}

/** SVG em medidas físicas: o PDF e a impressão do painel usam o mesmo desenho. */
export function cakeLabelSvg(label: CakeLabel) {
  const qr = QRCode.create(label.qrValue, { errorCorrectionLevel: "M" });
  const quietModules = 4;
  // Módulos inteiros na TE200, com zona branca de 4 módulos em todos os lados.
  const moduleDots = Math.floor(19 * CAKE_LABEL.dotsPerMm / (qr.modules.size + quietModules * 2));
  if (moduleDots < 3) throw new Error("El contenido del QR es demasiado largo para la etiqueta de 50 × 25 mm.");
  const moduleMm = moduleDots / CAKE_LABEL.dotsPerMm;
  const qrMm = (qr.modules.size + quietModules * 2) * moduleMm;
  const qrX = 47 - qrMm;
  const qrY = Math.round((3 + (19 - qrMm) / 2) * 8) / 8;
  let squares = "";
  for (let row = 0; row < qr.modules.size; row++) {
    for (let col = 0; col < qr.modules.size; col++) {
      if (qr.modules.get(row, col)) {
        const x = qrX + (col + quietModules) * moduleMm;
        const y = qrY + (row + quietModules) * moduleMm;
        squares += `M${x},${y}h${moduleMm}v${moduleMm}h-${moduleMm}z`;
      }
    }
  }
  const title = [label.name, label.detail, label.redecorated ? "REDECORADA" : null].filter(Boolean).join(" · ");
  const names = nameLines(title);
  const text = [
    // 0,3 mm de respiro compensam a saliência à esquerda de alguns glifos.
    textLine(`${label.store} - ${label.serial}`, 3.3, 4.9, 22.7),
    ...names.map((line, i) => textLine(line, 3.3, 7.35 + i * 2.5, 22.7, true)),
    label.flavors ? textLine(label.flavors, 3.3, 12.4, 22.7) : "",
    textLine("Vendedora", 4, 16, 21, true),
    textLine("BV / Factura", 4, 20.5, 21, true),
  ].join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="50mm" height="25mm" viewBox="0 0 50 25" role="img" aria-label="${xml(`${label.store}, ${label.serial}, ${title}${label.flavors ? `, ${label.flavors}` : ""}`)}"><rect width="50" height="25" fill="white"/><g fill="black" font-family="Arial Narrow, Liberation Sans Narrow, Arial, sans-serif">${text}</g><path d="M3.075,13.075h22.85v8.85H3.075z M3,17.5h23" fill="none" stroke="black" stroke-width="0.15"/><path d="${squares}" fill="black" shape-rendering="crispEdges"/></svg>`;
}

export const CAKE_LABEL_CSS = `
.etq-50 { width: 50mm; display: flex; flex-direction: column; gap: 3mm; }
.etq-50 .etq-cake { display: block; width: 50mm; height: 25mm; padding: 0; outline: 1px dashed #aaa; }
.etq-50 .etq-cake > svg { display: block; width: 50mm; height: 25mm; }
@page { size: 50mm 25mm; margin: 0; }
@media print {
  html, body { width: 50mm; min-height: 0 !important; margin: 0 !important; padding: 0 !important; }
  #contenido { flex: none !important; width: 50mm; }
  .etq-50 { gap: 0; }
  .etq-50 .etq-cake { outline: none; break-after: page; page-break-after: always; }
  .etq-50 .etq-cake:last-child { break-after: auto; page-break-after: auto; }
}
`;
