import {
  DIRECT_UPLOAD_MAX_BYTES,
  MAX_ORIGINAL_BYTES,
  isAcceptedType,
  type PhotoRecord,
} from "@/lib/photo/types";

/**
 * Envio da foto a partir do celular, com progresso de verdade.
 *
 * XMLHttpRequest e não fetch: só ele informa quanto do arquivo já subiu, e
 * no 4G do balcão uma foto de 6 MB leva tempo suficiente para a vendedora
 * achar que travou.
 *
 * Dois caminhos, pelo tamanho:
 *   · até 4 MB, a foto vai no corpo da própria rota de tratamento;
 *   · acima disso, sobe direto para o Storage por URL assinada (a função da
 *     Vercel recusa corpo maior que 4,5 MB) e a rota busca de lá.
 * Se a subida direta falhar, a foto é reduzida no próprio celular e vai
 * pelo primeiro caminho — melhor uma foto de 3000 px que nenhuma.
 */

export type UploadTarget =
  | { type: "none" }
  | { type: "product"; productId: string }
  | { type: "cake_unit"; serial: string };

export type UploadProgress = { stage: "uploading"; progress: number } | { stage: "processing" };

export class UploadError extends Error {
  /** Registro de tratamento que falhou, quando a rota chegou a gravar. */
  photo: PhotoRecord | null;
  /** Erro que não adianta contornar reduzindo a foto (sessão, formato). */
  final: boolean;
  constructor(message: string, options: { photo?: PhotoRecord | null; final?: boolean } = {}) {
    super(message);
    this.name = "UploadError";
    this.photo = options.photo ?? null;
    this.final = options.final ?? false;
  }
}

const TYPE_BY_EXTENSION: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
};

/* Alguns Android entregam HEIC com `type` vazio. */
function resolveType(file: File) {
  if (file.type) return file.type;
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return TYPE_BY_EXTENSION[ext] ?? "";
}

export async function sendPhoto(
  file: File,
  target: UploadTarget,
  onProgress: (progress: UploadProgress) => void,
): Promise<PhotoRecord> {
  if (file.size === 0) throw new UploadError("La foto está vacía. Tómala de nuevo.", { final: true });
  if (file.size > MAX_ORIGINAL_BYTES) throw new UploadError("La foto supera los 15 MB.", { final: true });
  const type = resolveType(file);
  if (!isAcceptedType(type)) {
    throw new UploadError("Formato no soportado. Usa JPG, PNG, WEBP o HEIC.", { final: true });
  }

  /* O sharp do servidor não decodifica HEIC (HEVC). O Safari decodifica:
     convertendo aqui, a foto do iPhone escolhida em "Archivos" sai tratada
     em vez de voltar com erro. Onde o navegador também não lê, segue como
     está e o servidor devolve a instrução de trocar o formato na câmera. */
  if (type === "image/heic" || type === "image/heif") {
    const converted = await shrink(file);
    if (converted) return submit({ file: converted }, target, onProgress);
  }

  if (file.size <= DIRECT_UPLOAD_MAX_BYTES) {
    return submit({ file }, target, onProgress);
  }

  let originalPath: string;
  try {
    originalPath = await uploadSigned(file, type, onProgress);
  } catch (error) {
    if (error instanceof UploadError && error.final) throw error;
    const reduced = await shrink(file);
    if (!reduced) {
      throw new UploadError("No se pudo subir la foto. Revisa tu conexión e inténtalo de nuevo.");
    }
    return submit({ file: reduced }, target, onProgress);
  }
  return submit({ originalPath }, target, onProgress);
}

async function submit(
  source: { file: File } | { originalPath: string },
  target: UploadTarget,
  onProgress: (progress: UploadProgress) => void,
) {
  const form = new FormData();
  form.append("target", target.type);
  if (target.type === "product") form.append("productId", target.productId);
  if (target.type === "cake_unit") form.append("serial", target.serial);
  if ("file" in source) form.append("file", source.file, source.file.name || "foto.jpg");
  else form.append("originalPath", source.originalPath);

  if ("file" in source) onProgress({ stage: "uploading", progress: 0 });
  else onProgress({ stage: "processing" });

  let response: { status: number; text: string };
  try {
    response = await request("POST", "/api/admin/fotos", form, {
      onUpload: "file" in source ? (p) => onProgress({ stage: "uploading", progress: p }) : undefined,
      onUploaded: () => onProgress({ stage: "processing" }),
    });
  } catch {
    throw new UploadError("Se perdió la conexión mientras se trataba la foto. Inténtalo de nuevo.");
  }

  const body = parseJson(response.text) as { photo?: PhotoRecord | null; error?: string };
  if (response.status >= 200 && response.status < 300 && body.photo) return body.photo;
  throw new UploadError(body.error ?? statusMessage(response.status), {
    photo: body.photo ?? null,
    final: true,
  });
}

async function uploadSigned(file: File, type: string, onProgress: (progress: UploadProgress) => void) {
  let sign: Response;
  try {
    sign = await fetch("/api/admin/fotos/subida", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type, size: file.size }),
    });
  } catch {
    throw new UploadError("Sin conexión. Revisa tu internet e inténtalo de nuevo.", { final: true });
  }
  const data = parseJson(await sign.text()) as { path?: string; signedUrl?: string; error?: string };
  if (!sign.ok || !data.path || !data.signedUrl) {
    throw new UploadError(data.error ?? statusMessage(sign.status), { final: sign.status < 500 });
  }

  /* Mesmo formato que o supabase-js usa: multipart com o arquivo num campo
     sem nome. O tipo vai explícito para o balde aceitar HEIC sem `type`. */
  const typed = file.type === type ? file : new File([file], file.name || "foto", { type });
  const body = new FormData();
  body.append("cacheControl", "3600");
  body.append("", typed);

  onProgress({ stage: "uploading", progress: 0 });
  const headers: Record<string, string> = { "x-upsert": "false" };
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (anonKey) headers.apikey = anonKey;

  const response = await request("PUT", data.signedUrl, body, {
    headers,
    onUpload: (p) => onProgress({ stage: "uploading", progress: p }),
  });
  if (response.status < 200 || response.status >= 300) {
    console.error("[fotos] storage", response.status, response.text);
    throw new UploadError("El almacenamiento rechazó la foto.");
  }
  return data.path;
}

function request(
  method: string,
  url: string,
  body: FormData,
  options: { headers?: Record<string, string>; onUpload?: (fraction: number) => void; onUploaded?: () => void },
) {
  return new Promise<{ status: number; text: string }>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, url);
    /* Cinco minutos: 15 MB em 3G fraco ainda cabem; mais que isso é rede caída. */
    xhr.timeout = 5 * 60_000;
    for (const [key, value] of Object.entries(options.headers ?? {})) xhr.setRequestHeader(key, value);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) options.onUpload?.(Math.min(1, event.loaded / event.total));
    };
    xhr.upload.onload = () => options.onUploaded?.();
    xhr.onload = () => resolve({ status: xhr.status, text: xhr.responseText });
    xhr.onerror = () => reject(new Error("network"));
    xhr.ontimeout = () => reject(new Error("timeout"));
    xhr.send(body);
  });
}

function parseJson(text: string): Record<string, unknown> {
  try {
    const value = JSON.parse(text);
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

/* Respostas que não vêm do nosso código (proxy da Vercel, queda) chegam sem JSON. */
function statusMessage(status: number) {
  if (status === 401) return "Sesión expirada. Vuelve a entrar.";
  if (status === 413) return "La foto es demasiado pesada para enviarla. Inténtalo de nuevo.";
  if (status === 504) return "El tratamiento tardó demasiado. Inténtalo de nuevo.";
  return "No se pudo tratar la foto. Inténtalo de nuevo.";
}

/**
 * Reduz a foto no navegador para caber no envio direto. `createImageBitmap`
 * já aplica a orientação do EXIF, e o Safari decodifica HEIC — então o JPEG
 * que sai daqui está em pé e em formato que o servidor lê.
 */
async function shrink(file: File): Promise<File | null> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, 3024 / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    for (const quality of [0.9, 0.82, 0.72]) {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
      if (blob && blob.size <= DIRECT_UPLOAD_MAX_BYTES) return new File([blob], "foto.jpg", { type: "image/jpeg" });
    }
    return null;
  } catch {
    return null;
  }
}
