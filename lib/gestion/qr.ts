/**
 * O que vai escrito dentro de cada QR.
 *
 * Etiqueta de torta: a série pura ("G0000100001"). Se o QR não ler, a série
 * está impressa embaixo e dá para digitar — o conteúdo é o mesmo.
 * Guia de despacho: "FANOR-D:" + código, para o leitor da recepção abrir o
 * despacho inteiro de uma vez.
 *
 * Sem "server-only": o leitor de câmera usa o `parseQr` no navegador.
 */

const SERIAL = /^[A-Z]\d{10}$/;
const DISPATCH_PREFIX = "FANOR-D:";

export type ParsedQr = { type: "cake"; serial: string } | { type: "dispatch"; code: string };

export function cakeQrValue(serial: string) {
  return serial;
}

export function dispatchQrValue(code: string) {
  return `${DISPATCH_PREFIX}${code}`;
}

export function isSerial(value: string) {
  return SERIAL.test(value.trim().toUpperCase());
}

/** Lê o conteúdo de um QR (ou o que a vendedora digitou). Null se não for nosso. */
export function parseQr(raw: string): ParsedQr | null {
  const text = raw.trim().toUpperCase();
  if (text.startsWith(DISPATCH_PREFIX)) {
    const code = text.slice(DISPATCH_PREFIX.length).trim();
    return /^[A-F0-9]{8}$/.test(code) ? { type: "dispatch", code } : null;
  }
  if (SERIAL.test(text)) return { type: "cake", serial: text };
  /* O código vem impresso embaixo do QR da guia; quem digita não põe o
     prefixo. Oito hexadecimais não colidem com série (letra + 10 dígitos). */
  return /^[A-F0-9]{8}$/.test(text) ? { type: "dispatch", code: text } : null;
}
