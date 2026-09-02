/** Moeda peruana no formato que o cliente reconhece: S/ 65.00 */
export function soles(value: number) {
  return `S/ ${value.toFixed(2)}`;
}

/** Versão compacta para cards e listas densas. */
export function solesShort(value: number) {
  return `S/ ${Number.isInteger(value) ? value : value.toFixed(2)}`;
}

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

/**
 * Imagens do catálogo vivem no Sirv, que redimensiona por querystring.
 * Servir 1080px onde o card mostra 340 era metade do peso da vitrine antiga.
 */
export function cdnImage(src: string, width: number) {
  if (!src.includes("sirv.com")) return src;
  const sep = src.includes("?") ? "&" : "?";
  return `${src}${sep}w=${width}&q=82&format=webp`;
}

/**
 * URL final da imagem, já redimensionada — remota pelo Sirv, local pelo
 * otimizador do Next.
 *
 * Existe para o giro 360°, onde `next/image` não serve: os quadros são
 * pré-carregados por script e depois renderizados. Se o pré-carregamento
 * baixasse o original e a renderização a versão otimizada, cada quadro viria
 * duas vezes — 30 quadros a 78 KB seriam 2,4 MB baixados em dobro. Com a
 * mesma URL nos dois lados, o navegador reaproveita o cache.
 *
 * `width` precisa estar em deviceSizes/imageSizes e `quality` em
 * images.qualities, senão o otimizador do Next devolve 400 — e a imagem some
 * sem erro visível no console.
 */
export function sizedImage(src: string, width: number, quality = 75) {
  if (!src) return src;
  if (src.includes("sirv.com")) return cdnImage(src, width);
  if (!src.startsWith("/")) return src;
  return `/_next/image?url=${encodeURIComponent(src)}&w=${width}&q=${quality}`;
}
