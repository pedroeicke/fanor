/**
 * Tipos e limites do tratamento de foto, sem "server-only".
 *
 * A tela do celular precisa dos mesmos números que o servidor confere: se o
 * limite de 15 MB morasse só na rota, a vendedora esperaria o upload inteiro
 * para descobrir que a foto era grande demais.
 */

/** Saída padrão da vitrine e da galeria: retrato 4:5, o formato do feed. */
export const OUTPUT_WIDTH = 1080;
export const OUTPUT_HEIGHT = 1350;

/** Teto do original. É o mesmo `file_size_limit` do balde `photo-originals`. */
export const MAX_ORIGINAL_BYTES = 15 * 1024 * 1024;

/**
 * Até aqui a foto vai direto no corpo da requisição. A função da Vercel
 * recusa corpo acima de 4,5 MB (com a moldura do multipart), e foto de
 * celular moderno passa disso fácil — acima deste valor o original sobe
 * direto para o Storage por URL assinada.
 */
export const DIRECT_UPLOAD_MAX_BYTES = 4 * 1024 * 1024;

/** Limite de leitor de tela para texto alternativo. */
export const ALT_TEXT_MAX = 125;

export const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"] as const;
export type AcceptedType = (typeof ACCEPTED_TYPES)[number];

export function isAcceptedType(type: string): type is AcceptedType {
  return (ACCEPTED_TYPES as readonly string[]).includes(type);
}

export const PHOTO_TARGETS = ["none", "product", "cake_unit"] as const;
export type PhotoTarget = (typeof PHOTO_TARGETS)[number];

/** Recorte escolhido, em pixels da foto já orientada (EXIF aplicado). */
export type PhotoCrop = {
  strategy: "subject" | "attention";
  left: number;
  top: number;
  width: number;
  height: number;
};

/** Onde a foto já foi usada. Guardado no relatório com o nome da época. */
export type PhotoUse = {
  type: "product" | "cake_unit";
  id: string;
  label: string;
  at: string;
  alt?: string;
};

export type PhotoReport = {
  aiUsed: boolean;
  /** 1–10. Com IA vem do Claude; sem IA é estimada pela exposição e nitidez. */
  score: number;
  scoreSource: "ai" | "auto";
  issues: string[];
  suggestions: string[];
  altText: string;
  productGuess: string | null;
  crop: PhotoCrop | null;
  source: { width: number; height: number; format: string; bytes: number };
  /** Ajustes aplicados, em palavras ("Brillo +10 %"). */
  adjustments: string[];
  metrics: { luminance: number; sharpness: number };
  /** Modelo que respondeu (pode ser o de reserva, se o principal recusou). */
  model?: string;
  /** Por que a IA não entrou, quando havia chave e mesmo assim falhou. */
  error?: string;
  applied?: PhotoUse[];
};

export type PhotoStatus = "processing" | "done" | "failed";

/** Linha de `photo_treatments` como a tela usa. */
export type PhotoRecord = {
  id: string;
  status: PhotoStatus;
  processed_url: string | null;
  width: number | null;
  height: number | null;
  ai_used: boolean;
  report: PhotoReport | null;
  target: PhotoTarget;
  target_id: string | null;
  error: string | null;
  created_at: string;
};

export const PHOTO_RECORD_COLUMNS =
  "id, status, processed_url, width, height, ai_used, report, target, target_id, error, created_at";

/**
 * Item do histórico com a data já escrita no servidor: formatar no navegador
 * daria "13 set." num lado e "13 sept." no outro, e o React acusaria
 * diferença na hidratação.
 */
export type PhotoHistoryItem = PhotoRecord & { createdLabel: string };

export type ProductOption = {
  id: string;
  name: string;
  sku: string | null;
  slug: string;
  status: string;
  cover: string | null;
};

export type CakeOption = {
  id: string;
  serial: string;
  status: string;
  productName: string;
  storeName: string;
  expiresOn: string;
  /** "14 set." — escrito no servidor, pelo mesmo motivo do histórico. */
  expiresLabel: string;
  photoUrl: string | null;
  /**
   * Por que esta torta não pode receber foto (vendida, descartada, do
   * Sisgeco). Null quando pode.
   */
  blockedReason: string | null;
};

/** Estados em que a torta ainda vai aparecer para alguém — os únicos em que foto faz sentido. */
export const CAKE_PHOTO_STATUSES = ["in_stock", "reserved", "in_transit"] as const;

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Texto alternativo limpo: uma linha, sem "Foto de…", até 125 caracteres
 * cortados em palavra inteira. O mesmo corte vale para o que a IA sugere e
 * para o que a vendedora edita — o leitor de tela não sabe quem escreveu.
 */
export function normalizeAltText(value: string) {
  const text = value
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(foto|imagen|fotografía)\s+(de|del)\s+/i, "");
  const capitalized = text.charAt(0).toUpperCase() + text.slice(1);
  if (capitalized.length <= ALT_TEXT_MAX) return capitalized;
  const cut = capitalized.slice(0, ALT_TEXT_MAX + 1);
  const space = cut.lastIndexOf(" ");
  return (space > 60 ? cut.slice(0, space) : cut.slice(0, ALT_TEXT_MAX)).replace(/[\s,;:.–-]+$/, "");
}
