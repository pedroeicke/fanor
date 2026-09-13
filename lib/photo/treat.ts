import "server-only";
import sharp, { type OutputInfo, type SharpOptions } from "sharp";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { detectImage } from "./detect";
import {
  OUTPUT_HEIGHT,
  OUTPUT_WIDTH,
  normalizeAltText,
  type PhotoCrop,
  type PhotoReport,
} from "./types";

/**
 * Tratamento da foto que a vendedora tira no balcão.
 *
 * O celular entrega uma foto torta, com a mesa, a parede e a mão de quem
 * segura. A vitrine precisa de um retrato 4:5 com a torta no meio, bem
 * exposto e nítido. O Claude olha a foto (onde está a torta, se está escura,
 * se está tremida) e o sharp faz o trabalho de pixel. Sem chave ou com a IA
 * fora do ar, o mesmo pipeline roda com o recorte por "atenção" do libvips e
 * medidas simples de exposição — a foto sai pior, mas sai.
 */

export class PhotoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PhotoError";
  }
}

export type TreatedPhoto = {
  output: Buffer;
  width: number;
  height: number;
  report: PhotoReport;
};

const MODEL = "claude-opus-5";

/* Opus 5 aceita até 2576 px, mas 1568 px bastam para achar a torta e julgar
   foco e luz — e custam menos da metade dos tokens de imagem. */
const ANALYSIS_MAX_SIDE = 1568;

/* Folga em volta da caixa da torta: sem ela o recorte encosta na decoração e
   a foto parece apertada. */
const SUBJECT_MARGIN = 0.12;

/* Recorte mais estreito que isso seria ampliado mais de 1,5× até 1080 px e
   ficaria borrado. Preferimos um pouco mais de fundo. */
const MIN_CROP_WIDTH = 720;

const RATIO = OUTPUT_WIDTH / OUTPUT_HEIGHT;

/* Foto de celular vem com orientação no EXIF; `autoOrient` gira antes de
   tudo, então coordenadas, recorte e medidas falam da mesma imagem que a
   vendedora viu na tela. `failOn: "error"` tolera JPEG com bytes sobrando no
   fim, comum em alguns Android, sem aceitar arquivo corrompido de verdade. */
const INPUT: SharpOptions = { autoOrient: true, failOn: "error" };

/* A rota tem 60 s no total, e passar disso derruba a foto inteira em vez de
   só a análise. Cada tentativa tem 20 s, mas o teto que manda é o da IA
   inteira: num 429 o SDK dorme o `retry-after` que a API pedir, sem limite,
   e só o prazo total garante que sobra tempo para baixar o original, gerar
   o WebP e gravar. */
const AI_ATTEMPT_TIMEOUT_MS = 20_000;
const AI_BUDGET_MS = 35_000;

class AiDeadlineError extends Error {}

const AnalysisSchema = z.object({
  subject_found: z.boolean().describe("true si hay una torta o postre reconocible en la foto"),
  box: z
    .object({
      x: z.number().describe("Borde izquierdo de la torta, de 0 a 1 respecto al ancho de la imagen"),
      y: z.number().describe("Borde superior de la torta, de 0 a 1 respecto al alto de la imagen"),
      width: z.number().describe("Ancho de la caja, de 0 a 1 respecto al ancho de la imagen"),
      height: z.number().describe("Alto de la caja, de 0 a 1 respecto al alto de la imagen"),
    })
    .describe("Caja que encierra la torta completa. Todo en 0 si no hay torta."),
  quality: z.object({
    score: z.number().describe("Nota de 1 a 10"),
    blurry: z.boolean(),
    too_dark: z.boolean(),
    too_bright: z.boolean(),
    cluttered_background: z.boolean(),
    issues: z.array(z.string()).describe("Hasta 4 problemas concretos, frases cortas en español"),
  }),
  suggestions: z.array(z.string()).describe("Hasta 3 consejos cortos en imperativo para la próxima foto"),
  alt_text: z.string().describe("Texto alternativo en español, máximo 125 caracteres"),
  product_guess: z.string().describe("Nombre corto de la torta, como en una carta"),
});

type Analysis = z.infer<typeof AnalysisSchema>;

const SYSTEM_PROMPT = `Eres el control de calidad de fotos de Tortas Fanor, pastelería de Arequipa (Perú). Una vendedora tomó la foto con el celular para mostrar la torta en la tienda online y en la vitrina del día. El sistema recorta la foto en 4:5 alrededor de la caja que indiques y corrige luz y nitidez automáticamente.

Cómo responder:
- subject_found: si hay una torta o postre reconocible.
- box: la torta completa, con su decoración, toppers y la base o bandeja donde está apoyada; sin la mesa ni el fondo. Coordenadas normalizadas de 0 a 1 respecto a la imagen, con origen arriba a la izquierda. Si no hay torta, todo en 0.
- quality.score: si la foto sirve para vender. 9–10 lista para catálogo; 7–8 buena con detalles menores; 5–6 usable, pero conviene repetirla; 1–4 no usar.
- blurry, too_dark, too_bright, cluttered_background: marca solo lo que realmente se nota.
- quality.issues: hasta 4 problemas concretos, frases de pocas palabras ("Fondo con objetos", "Torta cortada a la derecha"). Lista vacía si no hay.
- suggestions: hasta 3 consejos prácticos para repetir la foto con celular, cortos y en imperativo ("Acércate más", "Usa luz natural", "Retira objetos del fondo"). Lista vacía si la foto ya está bien.
- alt_text: describe la torta para quien no ve la imagen, en máximo 125 caracteres: tipo, colores y decoración visibles. Sin "foto de" ni "imagen de".
- product_guess: nombre corto como en una carta ("Torta de chocolate con fresas").

Todo el texto en español de Perú, sin emojis.`;

let client: Anthropic | null = null;
let clientKey: string | null = null;

function getClient(apiKey: string) {
  if (!client || clientKey !== apiKey) {
    client = new Anthropic({ apiKey });
    clientKey = apiKey;
  }
  return client;
}

export async function treatPhoto(input: Buffer, options: { hint?: string | null } = {}): Promise<TreatedPhoto> {
  const meta = await readMetadata(input);
  const width = meta.autoOrient?.width ?? meta.width;
  const height = meta.autoOrient?.height ?? meta.height;
  if (!width || !height) throw unreadable(input);
  if (Math.min(width, height) < 320) {
    throw new PhotoError("La foto es muy pequeña. Tómala con la cámara del celular, no uses una captura de pantalla.");
  }

  let analysis: Buffer;
  try {
    analysis = await sharp(input, INPUT)
      .flatten({ background: "#ffffff" })
      .resize(ANALYSIS_MAX_SIDE, ANALYSIS_MAX_SIDE, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();
  } catch (error) {
    console.error("[fotos] decodificação", error);
    throw unreadable(input, meta.format === "heif" && meta.compression === "hevc");
  }

  const metrics = await measure(analysis);
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const ai = apiKey ? await analyze(apiKey, analysis, options.hint ?? null) : null;
  const analysisResult = ai && "analysis" in ai ? ai.analysis : null;

  /* Com IA, os sinais dela mandam: ela sabe que torta branca em fundo branco
     é clara de propósito. Sem IA, valem as medidas. */
  const flags = analysisResult
    ? {
        blurry: analysisResult.quality.blurry,
        tooDark: analysisResult.quality.too_dark,
        tooBright: analysisResult.quality.too_bright,
      }
    : metrics.flags;

  const subject = analysisResult?.subject_found ? subjectCrop(analysisResult.box, width, height) : null;
  const brightness = flags.tooDark ? 1.1 : flags.tooBright ? 0.93 : 1;
  /* Contraste automático só sem IA: com análise, a correção é dirigida e um
     esticão de histograma estouraria o chantilly. */
  const contrast = analysisResult ? 1 : metrics.contrastGain;

  let pipeline = sharp(input, INPUT).flatten({ background: "#ffffff" });
  if (subject) pipeline = pipeline.extract({ left: subject.left, top: subject.top, width: subject.width, height: subject.height });
  pipeline = pipeline.resize(OUTPUT_WIDTH, OUTPUT_HEIGHT, {
    fit: "cover",
    position: subject ? "centre" : sharp.strategy.attention,
  });
  /* Esticão limitado em volta do meio do histograma, e não `normalise()`:
     numa parede lisa que ocupa a foto inteira, o normalise transformava o
     cinza em preto. Aqui o ganho para em 15 %. */
  if (contrast > 1) pipeline = pipeline.linear(contrast, metrics.midtone * (1 - contrast));
  pipeline = pipeline
    .modulate({ brightness, saturation: 1.05 })
    .sharpen(flags.blurry ? { sigma: 1.2, m1: 0.8, m2: 3 } : { sigma: 0.7, m1: 0.5, m2: 1.5 });

  let rendered: { data: Buffer; info: OutputInfo };
  try {
    /* WebP sai sem EXIF: a foto do celular carrega GPS, e esta vai para um
       balde público. O original, com tudo, fica no balde privado. */
    rendered = await pipeline.webp({ quality: 82, effort: 5 }).toBuffer({ resolveWithObject: true });
  } catch (error) {
    console.error("[fotos] renderização", error);
    throw unreadable(input);
  }

  const crop = subject ?? attentionCrop(rendered.info, width, height);
  const lowResolution = crop ? crop.width < OUTPUT_WIDTH * 0.75 : Math.min(width, height * RATIO) < OUTPUT_WIDTH * 0.75;

  const adjustments = [
    subject ? "Recorte 4:5 centrado en la torta" : "Recorte 4:5 automático",
    ...(contrast > 1 ? ["Contraste automático"] : []),
    ...(brightness > 1 ? ["Brillo +10 %"] : brightness < 1 ? ["Brillo −7 %"] : []),
    "Saturación +5 %",
    flags.blurry ? "Nitidez reforzada" : "Nitidez suave",
    `WebP ${OUTPUT_WIDTH}×${OUTPUT_HEIGHT}`,
  ];

  const report: PhotoReport = analysisResult
    ? {
        aiUsed: true,
        score: clamp(Math.round(analysisResult.quality.score), 1, 10),
        scoreSource: "ai",
        issues: cleanList(analysisResult.quality.issues, 4),
        suggestions: cleanList(analysisResult.suggestions, 3),
        altText: normalizeAltText(analysisResult.alt_text) || fallbackAlt(options.hint),
        productGuess: cleanText(analysisResult.product_guess, 80) || null,
        crop,
        source: { width, height, format: meta.format, bytes: input.length },
        adjustments,
        metrics: { luminance: metrics.luminance, sharpness: metrics.sharpness },
        model: ai && "model" in ai ? ai.model : MODEL,
      }
    : {
        aiUsed: false,
        score: autoScore(flags, lowResolution),
        scoreSource: "auto",
        issues: autoIssues(flags, lowResolution),
        suggestions: autoSuggestions(flags, lowResolution),
        altText: fallbackAlt(options.hint),
        productGuess: null,
        crop,
        source: { width, height, format: meta.format, bytes: input.length },
        adjustments,
        metrics: { luminance: metrics.luminance, sharpness: metrics.sharpness },
        ...(ai && "error" in ai ? { error: ai.error } : {}),
      };

  if (analysisResult && !subject) {
    report.issues = cleanList([...report.issues, "No se encontró la torta: recorte automático"], 4);
  }
  if (analysisResult && lowResolution && !report.issues.some((i) => /resoluci/i.test(i))) {
    report.issues = cleanList([...report.issues, "Poca resolución: la foto se amplió"], 4);
  }

  return { output: rendered.data, width: rendered.info.width, height: rendered.info.height, report };
}

/* -------------------------------------------------------------------------- */
/*  Leitura e medidas                                                         */
/* -------------------------------------------------------------------------- */

async function readMetadata(input: Buffer) {
  try {
    return await sharp(input, INPUT).metadata();
  } catch (error) {
    console.error("[fotos] metadata", error);
    throw unreadable(input);
  }
}

/** Erro legível. HEIC do iPhone é o caso comum: o sharp daqui não traz decodificador HEVC. */
function unreadable(input: Buffer, knownHeic = false) {
  if (knownHeic || detectImage(input)?.format === "heif") {
    return new PhotoError("Formato HEIC no soportado: en el iPhone, Ajustes > Cámara > Formatos > Más compatible");
  }
  return new PhotoError("No se pudo leer la foto. Puede estar dañada o en un formato no soportado (usa JPG, PNG o WEBP).");
}

/**
 * Exposição e nitidez medidas na cópia reduzida.
 *
 * Luminância média sozinha acusaria torta branca em fundo claro de "estourada";
 * por isso olha também a fração de pixels queimados e as pontas do
 * histograma. Nitidez é o desvio da Laplaciana do próprio libvips.
 */
async function measure(analysis: Buffer) {
  const [{ data, info }, stats] = await Promise.all([
    sharp(analysis).resize(256, 256, { fit: "inside" }).greyscale().raw().toBuffer({ resolveWithObject: true }),
    sharp(analysis).resize(512, 512, { fit: "inside" }).greyscale().stats(),
  ]);

  const histogram = new Array<number>(256).fill(0);
  const step = info.channels;
  let total = 0;
  let sum = 0;
  for (let i = 0; i < data.length; i += step) {
    histogram[data[i]]++;
    sum += data[i];
    total++;
  }
  const percentile = (p: number) => {
    const goal = total * p;
    let acc = 0;
    for (let v = 0; v < 256; v++) {
      acc += histogram[v];
      if (acc >= goal) return v;
    }
    return 255;
  };
  let clipped = 0;
  for (let v = 250; v < 256; v++) clipped += histogram[v];

  const luminance = total ? sum / total : 0;
  const p01 = percentile(0.01);
  const p05 = percentile(0.05);
  const p95 = percentile(0.95);
  const p99 = percentile(0.99);
  const clippedShare = total ? clipped / total : 0;

  return {
    luminance: Math.round(luminance),
    sharpness: Math.round(stats.sharpness * 100) / 100,
    midtone: (p01 + p99) / 2,
    /* Quanto esticar para o histograma ocupar ~10–245. Foto que já usa a
       faixa toda fica em 1 (nada muda). */
    contrastGain: Math.round(clamp(235 / Math.max(1, p99 - p01), 1, 1.15) * 100) / 100,
    flags: {
      tooDark: luminance < 80 && p95 < 200,
      tooBright: clippedShare > 0.25 || (luminance > 200 && p05 > 130),
      blurry: stats.sharpness < BLUR_THRESHOLD,
    },
  };
}

/* Calibrado na cópia de 512 px: fotos de catálogo nítidas dão ≈ 1 a 4, as
   mesmas desfocadas com sigma 1,5 dão ≈ 0,4 a 0,9 e com sigma 3, ≈ 0,3.
   Fundo liso puxa o número para baixo, então o corte é conservador: só
   acusa o que está claramente borrado. */
const BLUR_THRESHOLD = 0.45;

/* -------------------------------------------------------------------------- */
/*  Claude                                                                    */
/* -------------------------------------------------------------------------- */

type AiOutcome = { analysis: Analysis; model: string } | { error: string };

async function analyze(apiKey: string, jpeg: Buffer, hint: string | null): Promise<AiOutcome> {
  const cleanHint = usefulHint(hint);
  const text = cleanHint
    ? `Analiza esta foto. En el sistema, la torta está registrada como "${cleanHint}"; úsalo en el texto alternativo solo si coincide con lo que se ve.`
    : "Analiza esta foto.";

  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      /* Cancela a requisição em curso; se o SDK estiver dormindo antes da
         nova tentativa, ela nasce abortada. */
      controller.abort();
      reject(new AiDeadlineError());
    }, AI_BUDGET_MS);
  });

  try {
    const request = getClient(apiKey).beta.messages.parse(
      {
        model: MODEL,
        /* Folga para o raciocínio adaptativo: cortar no teto deixa o JSON
           pela metade e a foto sai sem análise. */
        max_tokens: 8000,
        /* Se o Opus recusar por engano (acontece com fotos de pessoas ao
           fundo), o próprio servidor refaz com o modelo de reserva. */
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system: SYSTEM_PROMPT,
        output_config: { effort: "low", format: betaZodOutputFormat(AnalysisSchema) },
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: "image/jpeg", data: jpeg.toString("base64") } },
              { type: "text", text },
            ],
          },
        ],
      },
      { timeout: AI_ATTEMPT_TIMEOUT_MS, maxRetries: 1, signal: controller.signal },
    );
    const response = await Promise.race([request, deadline]);

    if (response.stop_reason === "refusal") {
      return { error: "La IA no analizó esta foto." };
    }
    if (!response.parsed_output) {
      return { error: "La IA no devolvió un análisis válido." };
    }
    return { analysis: response.parsed_output, model: response.model };
  } catch (error) {
    console.error("[fotos] análise IA", error);
    return { error: aiErrorMessage(error) };
  } finally {
    clearTimeout(timer);
  }
}

function aiErrorMessage(error: unknown) {
  if (error instanceof AiDeadlineError || error instanceof Anthropic.APIUserAbortError) {
    return "La IA tardó demasiado en responder.";
  }
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    return "La clave de la IA no es válida.";
  }
  if (error instanceof Anthropic.RateLimitError) return "La IA está saturada en este momento.";
  if (error instanceof Anthropic.APIConnectionTimeoutError) return "La IA tardó demasiado en responder.";
  if (error instanceof Anthropic.APIConnectionError) return "Sin conexión con la IA.";
  if (error instanceof Anthropic.BadRequestError) return "La IA no aceptó esta foto.";
  if (error instanceof Anthropic.APIError) return "La IA no está disponible ahora.";
  return "La IA devolvió un análisis inválido.";
}

/* -------------------------------------------------------------------------- */
/*  Recorte                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Retângulo 4:5 que contém a caixa da torta com folga, centrado nela e
 * preso dentro da foto. Caixa minúscula ou degenerada volta null e o
 * recorte cai para o automático.
 */
function subjectCrop(box: Analysis["box"], width: number, height: number): PhotoCrop | null {
  const x0 = clamp(box.x, 0, 1);
  const y0 = clamp(box.y, 0, 1);
  const x1 = clamp(box.x + box.width, 0, 1);
  const y1 = clamp(box.y + box.height, 0, 1);
  if (!Number.isFinite(x0 + y0 + x1 + y1) || x1 - x0 < 0.05 || y1 - y0 < 0.05) return null;

  const centerX = ((x0 + x1) / 2) * width;
  const centerY = ((y0 + y1) / 2) * height;
  let cropWidth = (x1 - x0) * width * (1 + 2 * SUBJECT_MARGIN);
  const cropHeight = (y1 - y0) * height * (1 + 2 * SUBJECT_MARGIN);
  if (cropWidth / cropHeight < RATIO) cropWidth = cropHeight * RATIO;

  /* Maior 4:5 que cabe na foto: nunca passa dele, e só desce até o mínimo
     que evita ampliar demais. */
  const maxWidth = Math.min(width, height * RATIO);
  cropWidth = clamp(cropWidth, Math.min(maxWidth, MIN_CROP_WIDTH), maxWidth);

  const w = Math.max(1, Math.min(width, Math.floor(cropWidth)));
  const h = Math.max(1, Math.min(height, Math.floor(w / RATIO)));
  const left = Math.round(clamp(centerX - w / 2, 0, width - w));
  const top = Math.round(clamp(centerY - h / 2, 0, height - h));
  return { strategy: "subject", left, top, width: w, height: h };
}

/**
 * Onde o libvips cortou, de volta em pixels da foto. Ele devolve o
 * deslocamento na imagem já redimensionada; dividir pela escala dá o
 * retângulo que a tela desenha sobre o "antes".
 */
function attentionCrop(info: OutputInfo, width: number, height: number): PhotoCrop | null {
  if (info.cropOffsetLeft === undefined || info.cropOffsetTop === undefined) return null;
  const scale = Math.max(OUTPUT_WIDTH / width, OUTPUT_HEIGHT / height);
  const w = Math.min(width, Math.round(OUTPUT_WIDTH / scale));
  const h = Math.min(height, Math.round(OUTPUT_HEIGHT / scale));
  return {
    strategy: "attention",
    left: Math.round(clamp(Math.abs(info.cropOffsetLeft) / scale, 0, width - w)),
    top: Math.round(clamp(Math.abs(info.cropOffsetTop) / scale, 0, height - h)),
    width: w,
    height: h,
  };
}

/* -------------------------------------------------------------------------- */
/*  Relatório sem IA                                                          */
/* -------------------------------------------------------------------------- */

type Flags = { blurry: boolean; tooDark: boolean; tooBright: boolean };

/* Sem IA não dá para saber se a torta está inteira nem se o fundo ajuda:
   a nota estimada para em 8. */
function autoScore(flags: Flags, lowResolution: boolean) {
  let score = 8;
  if (flags.blurry) score -= 3;
  if (flags.tooDark || flags.tooBright) score -= 2;
  if (lowResolution) score -= 1;
  return clamp(score, 1, 10);
}

function autoIssues(flags: Flags, lowResolution: boolean) {
  return [
    ...(flags.blurry ? ["Foto movida o desenfocada"] : []),
    ...(flags.tooDark ? ["Foto oscura"] : []),
    ...(flags.tooBright ? ["Foto con zonas quemadas"] : []),
    ...(lowResolution ? ["Poca resolución: la foto se amplió"] : []),
  ];
}

function autoSuggestions(flags: Flags, lowResolution: boolean) {
  return [
    ...(flags.blurry ? ["Apoya el celular y toca la torta en la pantalla para enfocar"] : []),
    ...(flags.tooDark ? ["Usa luz natural, cerca de una ventana"] : []),
    ...(flags.tooBright ? ["Evita el sol directo y el flash"] : []),
    ...(lowResolution ? ["Acércate más a la torta"] : []),
  ].slice(0, 3);
}

function fallbackAlt(hint: string | null | undefined) {
  const name = usefulHint(hint);
  return normalizeAltText(name ? `${name}, torta de Tortas Fanor` : "Torta de Tortas Fanor");
}

/**
 * Nome do produto que ajuda a descrever a torta. Produto vindo do Sisgeco
 * chama "T 26" — é tamanho, não sabor, e num texto alternativo não diz nada
 * a quem não vê a foto.
 */
function usefulHint(hint: string | null | undefined) {
  const text = hint ? cleanText(hint.replace(/["\n\r]/g, " "), 80) : "";
  return /^[a-z]{1,4}\s*-?\s*\d+[a-z]?$/i.test(text) ? "" : text;
}

/* -------------------------------------------------------------------------- */
/*  Utilitários                                                               */
/* -------------------------------------------------------------------------- */

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function cleanText(value: string, max: number) {
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

function cleanList(list: string[], max: number) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of list) {
    const text = cleanText(item, 90).replace(/\.$/, "");
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length === max) break;
  }
  return out;
}
