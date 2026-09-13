/**
 * Formato real do arquivo, pelos primeiros bytes.
 *
 * O `type` que o navegador manda é o que a extensão sugere — um PDF renomeado
 * para .jpg chega como image/jpeg. O original vai para o balde com o tipo que
 * os bytes dizem, e o caminho ganha a extensão certa.
 */

export type DetectedImage = { format: "jpeg" | "png" | "webp" | "heif"; ext: string; mime: string };

/* Marcas ISO-BMFF de HEIC/HEIF. AVIF ("avif", "avis") fica de fora: não é
   formato aceito, e o balde recusaria. */
const HEIF_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs", "mif1", "msf1"]);

export function detectImage(bytes: Uint8Array): DetectedImage | null {
  if (bytes.length < 12) return null;

  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { format: "jpeg", ext: "jpg", mime: "image/jpeg" };
  }
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return { format: "png", ext: "png", mime: "image/png" };
  }
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") {
    return { format: "webp", ext: "webp", mime: "image/webp" };
  }
  if (ascii(4, 8) === "ftyp") {
    const brand = ascii(8, 12);
    if (HEIF_BRANDS.has(brand)) {
      const heic = brand.startsWith("he");
      return { format: "heif", ext: heic ? "heic" : "heif", mime: heic ? "image/heic" : "image/heif" };
    }
  }
  return null;
}
