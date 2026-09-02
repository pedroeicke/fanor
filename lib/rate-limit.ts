import "server-only";
import { getSupabaseAdmin } from "./supabase-admin";

/**
 * Limite de requisições nas rotas públicas.
 *
 * Sem isto, qualquer pessoa pode disparar pedidos em série ou encher o balde
 * de imagens com arquivos de 8 MB até estourar a conta. É o item 296 do
 * checklist — "proteger formulários contra abuso e spam".
 *
 * A contagem vive no Postgres em vez de Redis: um serviço a menos para
 * manter, e o volume de uma confeitaria cabe com folga. Se um dia apertar,
 * trocar a implementação de `hitRateLimit` não muda nenhuma rota.
 */

export type Bucket = "orders" | "uploads" | "complaints" | "quotes" | "geocode" | "monitoring";

const LIMITS: Record<Bucket, { max: number; windowSeconds: number; message: string }> = {
  /* Pedidos: generoso o bastante para quem erra e refaz, apertado o bastante
     para não virar ferramenta de spam. */
  orders: { max: 8, windowSeconds: 600, message: "Demasiados intentos. Espera unos minutos." },
  /* Upload é o mais caro: cada arquivo ocupa espaço permanente. */
  uploads: { max: 20, windowSeconds: 600, message: "Demasiadas imágenes seguidas. Espera unos minutos." },
  complaints: { max: 3, windowSeconds: 3600, message: "Ya registramos tu reclamo. Espera nuestra respuesta." },
  quotes: { max: 30, windowSeconds: 600, message: "Demasiadas consultas de dirección. Espera un momento." },
  /* Busca de endereço é digitação: uma pessoa escrevendo "Av. Ejército 341"
     gasta quatro ou cinco chamadas, e quem corrige o endereço gasta o dobro.
     Com o teto de 30 do balde `quotes`, a lista de sugestões emudecia no
     segundo endereço — e emudecia calada, que é pior. O teto continua
     existindo para barrar raspagem, só que num patamar que uma compra real
     nunca encosta. Só o que sai para os provedores conta: resposta que veio
     do cache não gasta cota. */
  geocode: { max: 300, windowSeconds: 600, message: "Demasiadas búsquedas de dirección. Espera un momento y vuelve a intentar." },
  monitoring: { max: 20, windowSeconds: 600, message: "Demasiados reportes." },
};

/**
 * Identifica quem está chamando.
 *
 * Atrás de proxy o IP real vem em `x-forwarded-for`, e o primeiro da lista é
 * o cliente — os seguintes são os próprios proxies. `x-real-ip` cobre outros
 * provedores.
 */
export function clientIdentifier(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "desconhecido";
}

export type RateLimitResult = { ok: true } | { ok: false; message: string; retryAfter: number };

export async function checkRateLimit(bucket: Bucket, request: Request): Promise<RateLimitResult> {
  const db = getSupabaseAdmin();
  /* Sem banco não há como contar. Bloquear seria pior: derrubaria a loja
     inteira por causa do limitador. */
  if (!db) return { ok: true };

  const config = LIMITS[bucket];
  const identifier = clientIdentifier(request);

  const { data, error } = await db.rpc("hit_rate_limit", {
    p_bucket: bucket,
    p_identifier: identifier,
    p_window_seconds: config.windowSeconds,
  });

  /* Falha do limitador não pode virar falha de compra. */
  if (error) {
    console.error("[rate-limit] falha ao contar, liberando", error.message);
    return { ok: true };
  }

  if (typeof data === "number" && data > config.max) {
    return { ok: false, message: config.message, retryAfter: config.windowSeconds };
  }

  return { ok: true };
}
