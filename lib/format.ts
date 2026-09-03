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
/**
 * Larguras que o otimizador aceita — precisa espelhar `deviceSizes` +
 * `imageSizes` do next.config.ts.
 *
 * Existe porque pedir uma largura fora da lista devolve 400 e a imagem
 * desaparece sem erro no console. `next/image` respeita isso sozinho; quem
 * monta a URL na mão, como o giro 360°, não tinha nada que impedisse.
 */
const ALLOWED_WIDTHS = [
  16, 32, 48, 64, 96, 128, 256, 384, 448, 640, 750, 828, 1080, 1200, 1920, 2048, 3840,
];

/** Sobe para a menor largura permitida que ainda cubra o pedido. */
function snapWidth(width: number) {
  return ALLOWED_WIDTHS.find((w) => w >= width) ?? ALLOWED_WIDTHS[ALLOWED_WIDTHS.length - 1];
}

export function sizedImage(src: string, width: number, quality = 75) {
  if (!src) return src;
  if (src.includes("sirv.com")) return cdnImage(src, width);
  if (!src.startsWith("/")) return src;
  return `/_next/image?url=${encodeURIComponent(src)}&w=${snapWidth(width)}&q=${quality}`;
}
