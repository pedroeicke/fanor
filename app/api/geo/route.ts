import { NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";

/**
 * Busca e reversão de endereços, sem Google.
 *
 * Duas operações:
 *   GET /api/geo?q=Av. Ejército 100      → lista de endereços com coordenadas
 *   GET /api/geo?lat=-16.4&lng=-71.5     → endereço daquele ponto
 *
 * Por trás vão dois serviços abertos sobre dados do OpenStreetMap, ambos
 * gratuitos, sem chave e sem cartão:
 *
 *   · Photon — casa pedaço de palavra ("Merca" acha Mercado), que é o que
 *     digitação incremental exige;
 *   · Nominatim — só casa palavra inteira, mas normaliza acento, então
 *     "Ejercito" acha "Avenida Ejército". Também faz a reversão.
 *
 * Os dois são consultados em paralelo porque cada um cobre o buraco do outro:
 * Photon sozinho nunca acha Ejército sem o acento; Nominatim sozinho não
 * responde nada até a palavra terminar.
 *
 * A instância pública do Photon só aceita `lang` default, de, en e fr — pedir
 * `es` devolve 400. Com `default` ele responde no idioma local, que no Peru já
 * é espanhol, então não se perde nada.
 *
 * Passa pelo servidor, e não direto do navegador, por três motivos:
 *
 *   · a política de uso do Nominatim exige `User-Agent` identificando a
 *     aplicação, e o navegador não deixa definir esse cabeçalho;
 *   · o cache abaixo evita repetir a mesma consulta — a mesma rua digitada
 *     por dez pessoas custa uma chamada, não dez;
 *   · dá para trocar o provedor, ou apontar para uma instância própria, sem
 *     tocar no componente.
 */

const SEARCH_URL = process.env.GEOCODER_SEARCH_URL || "https://photon.komoot.io/api/";
const SEARCH_FALLBACK_URL =
  process.env.GEOCODER_SEARCH_FALLBACK_URL || "https://nominatim.openstreetmap.org/search";
const REVERSE_URL =
  process.env.GEOCODER_REVERSE_URL || "https://nominatim.openstreetmap.org/reverse";

/** Identifica a aplicação, como a política do Nominatim pede. */
const USER_AGENT =
  process.env.GEOCODER_USER_AGENT || "TortasFanor/1.0 (+https://tortasfanor.com)";

/* Viés para Arequipa: sem isto, "Av. Ejército" traz resultados de Lima e do
   México antes dos daqui. */
const AREQUIPA = { lat: -16.409, lng: -71.5375 };
/* Caixa que cobre a área metropolitana com folga. */
const BBOX = { west: -71.75, south: -16.62, east: -71.35, north: -16.25 };

const TIMEOUT_MS = 6_000;

/**
 * Cache em memória.
 *
 * Consulta de endereço é altamente repetida — as mesmas dez avenidas
 * concentram a maior parte das entregas. Uma hora é curto o bastante para
 * acompanhar correções no OSM e longo o bastante para poupar o serviço
 * público, que atendemos por cortesia e não por contrato.
 */
const TTL_MS = 60 * 60 * 1_000;
const MAX_ENTRIES = 500;
const cache = new Map<string, { at: number; body: unknown }>();

function fromCache(key: string) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > TTL_MS) {
    cache.delete(key);
    return null;
  }
  /* Reinsere para o mais usado ir para o fim e sobreviver à poda. */
  cache.delete(key);
  cache.set(key, hit);
  return hit.body;
}

function toCache(key: string, body: unknown) {
  cache.set(key, { at: Date.now(), body });
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

export type GeoResult = {
  label: string;
  detail: string;
  lat: number;
  lng: number;
};

type PhotonFeature = {
  geometry?: { coordinates?: [number, number] };
  properties?: Record<string, string | undefined>;
};

/** Monta "Av. Ejército 100" e "Yanahuara, Arequipa" a partir das partes soltas. */
function describe(p: Record<string, string | undefined>) {
  const street = [p.street ?? p.name, p.housenumber].filter(Boolean).join(" ");
  const area = [p.district, p.city ?? p.county, p.state]
    .filter(Boolean)
    /* O mesmo nome costuma repetir em dois campos ("Arequipa" como cidade e
       como região); repetido na tela parece defeito. */
    .filter((value, index, all) => all.indexOf(value) === index)
    .join(", ");
  return { label: street || p.name || area || "Sin nombre", detail: area };
}

async function fetchJson(url: string) {
  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`geocoder ${response.status}`);

  /* Decodificação explícita: o Nominatim responde UTF-8 sem declarar charset,
     e aí "Perú" chega como "PerÃº" — o nome da rua da loja principal, ainda
     por cima. */
  const buffer = await response.arrayBuffer();
  return JSON.parse(new TextDecoder("utf-8").decode(buffer));
}

/** Photon: rápido e pensado para busca enquanto se digita. */
async function searchPhoton(query: string): Promise<GeoResult[]> {
  const url = new URL(SEARCH_URL);
  url.searchParams.set("q", query);
  url.searchParams.set("limit", "12");
  url.searchParams.set("lat", String(AREQUIPA.lat));
  url.searchParams.set("lon", String(AREQUIPA.lng));
  /* Sem `bbox`: medindo, ele estrangulava o ranking — "Ejer" dentro da caixa
     devolvia duas ruas sem relação, e fora dela devolvia resultados úteis. O
     recorte geográfico fica por conta de `withinArequipa`, depois. */
  url.searchParams.set("location_bias_scale", "0.6");

  const data = (await fetchJson(url.toString())) as { features?: PhotonFeature[] };

  return withinArequipa(
    (data.features ?? []).flatMap((feature) => {
      const coordinates = feature.geometry?.coordinates;
      if (!coordinates) return [];
      const [lon, latitude] = coordinates;
      const { label, detail } = describe(feature.properties ?? {});
      return [{ label, detail, lat: latitude, lng: lon }];
    }),
  );
}

/** Nominatim: mais lento, porém devolve o nome já em espanhol e bem formado. */
async function searchNominatim(query: string): Promise<GeoResult[]> {
  const url = new URL(SEARCH_FALLBACK_URL);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("q", query);
  url.searchParams.set("countrycodes", "pe");
  url.searchParams.set("limit", "6");
  url.searchParams.set("accept-language", "es");
  url.searchParams.set("viewbox", `${BBOX.west},${BBOX.north},${BBOX.east},${BBOX.south}`);
  url.searchParams.set("bounded", "1");

  const data = (await fetchJson(url.toString())) as {
    lat: string;
    lon: string;
    name?: string;
    display_name?: string;
  }[];

  return withinArequipa(
    (Array.isArray(data) ? data : []).map((item) => {
      /* "Avenida Ejército, La Gruta, Yanahuara, Arequipa, 54174, Perú" — a
         primeira parte é o endereço e o resto é o bairro. País e CEP saem:
         quem compra em Arequipa não precisa ler "Perú" em cada linha. */
      const parts = (item.display_name ?? "").split(",").map((x) => x.trim());
      return {
        label: item.name || parts[0] || "Sin nombre",
        detail: parts.slice(1, -2).join(", "),
        lat: Number(item.lat),
        lng: Number(item.lon),
      };
    }),
  );
}

/* A caixa é só um viés nos dois serviços, não um filtro: sem isto ainda
   escapa resultado de outra cidade no fim da lista. */
function withinArequipa(items: GeoResult[]) {
  return items.filter(
    (item) =>
      Number.isFinite(item.lat) &&
      Number.isFinite(item.lng) &&
      item.lat >= BBOX.south &&
      item.lat <= BBOX.north &&
      item.lng >= BBOX.west &&
      item.lng <= BBOX.east,
  );
}

/** Sem acento e em minúsculas, para "ejercito" casar com "Ejército". */
function fold(text: string) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

/**
 * A mesma avenida aparece uma vez por trecho mapeado no OSM, e agora também
 * uma vez por provedor: sem isto a lista vira seis linhas idênticas, e
 * escolher entre elas é escolher no escuro.
 */
function dedupe(items: GeoResult[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = fold(`${item.label}|${item.detail}`);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Ordena por quanto o resultado parece com o que foi digitado.
 *
 * Necessário porque juntamos duas listas com critérios de relevância
 * diferentes — concatenar sem reordenar deixaria tudo do Photon na frente,
 * inclusive o que ele achou por semelhança fonética, empurrando para baixo o
 * acerto exato do Nominatim.
 *
 * Conta palavras casadas em vez de exigir todas: quem escreve "Ejercito
 * Arequipa" acerta a via em uma palavra e a cidade na outra, e um resultado
 * que casa uma das duas ainda é melhor do que um que não casa nenhuma. Exigir
 * as duas empatava tudo em zero e devolvia a ordem crua do provedor, que
 * chegou a pôr "Calle Jorge Chávez" no topo de uma busca por "Ejercito".
 */
function rank(items: GeoResult[], query: string) {
  const terms = fold(query).split(/\s+/).filter(Boolean);

  const score = (item: GeoResult) => {
    const label = fold(item.label);
    /* O detalhe entra na conta para "Ejercito Yanahuara" pontuar o bairro,
       mas vale menos: casar no nome da via é o que a pessoa quer. */
    const haystack = [...label.split(/\s+/), ...fold(item.detail).split(/\s+/)];

    let points = 0;
    for (const term of terms) {
      if (haystack.some((word) => word.startsWith(term))) points += 2;
      else if (haystack.some((word) => word.includes(term))) points += 1;
    }
    /* Desempate: o nome que começa pelo que foi digitado vem antes. */
    if (label.startsWith(terms[0] ?? "")) points += 1;
    return points;
  };

  return items
    .map((item, index) => ({ item, points: score(item), index }))
    /* `index` como desempate mantém estável a ordem que cada provedor deu. */
    .sort((a, b) => b.points - a.points || a.index - b.index)
    .map((x) => x.item);
}

/**
 * Barra excesso de chamadas — mas só as que realmente saem para os
 * provedores. Consulta servida pelo cache não gasta cota: as mesmas dez
 * avenidas concentram a maior parte das entregas, e cobrá-las de novo a cada
 * cliente esgotaria o teto sem gerar um único pedido de rede.
 */
async function guard(request: Request) {
  const limited = await checkRateLimit("geocode", request);
  if (limited.ok) return null;
  return NextResponse.json(
    { error: limited.message },
    { status: 429, headers: { "Retry-After": String(limited.retryAfter) } },
  );
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const query = params.get("q")?.trim();
  /* `Number(null)` é 0, não NaN — testar só `isFinite` faria toda busca cair
     no ramo da reversão, apontando para a costa da Guiné. */
  const rawLat = params.get("lat");
  const rawLng = params.get("lng");
  const lat = rawLat === null ? NaN : Number(rawLat);
  const lng = rawLng === null ? NaN : Number(rawLng);

  try {
    /* ---- reversão: ponto no mapa vira nome de rua ---- */
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      const key = `r:${lat.toFixed(5)},${lng.toFixed(5)}`;
      const cached = fromCache(key);
      if (cached) return NextResponse.json(cached);

      const limited = await guard(request);
      if (limited) return limited;

      const url = new URL(REVERSE_URL);
      url.searchParams.set("format", "jsonv2");
      url.searchParams.set("lat", String(lat));
      url.searchParams.set("lon", String(lng));
      /* 18 = nível de rua com número. Mais fundo devolve o nome do prédio,
         que confunde mais do que ajuda. */
      url.searchParams.set("zoom", "18");
      url.searchParams.set("accept-language", "es");

      const data = (await fetchJson(url.toString())) as {
        display_name?: string;
        address?: Record<string, string>;
      };
      const a = data.address ?? {};
      const body = {
        address:
          [[a.road, a.house_number].filter(Boolean).join(" "), a.suburb ?? a.city_district]
            .filter(Boolean)
            .join(", ") ||
          data.display_name ||
          "",
      };
      toCache(key, body);
      return NextResponse.json(body);
    }

    /* ---- busca: texto vira lista de pontos ---- */
    if (!query || query.length < 3) return NextResponse.json({ results: [] });

    const key = `s:${query.toLowerCase()}`;
    const cached = fromCache(key);
    if (cached) return NextResponse.json(cached);

    const limited = await guard(request);
    if (limited) return limited;

    const [photon, nominatim] = await Promise.allSettled([
      searchPhoton(query),
      searchNominatim(query),
    ]);
    const merged = [
      ...(photon.status === "fulfilled" ? photon.value : []),
      ...(nominatim.status === "fulfilled" ? nominatim.value : []),
    ];
    /* Se os dois caírem, é falha de rede e não ausência de resultado. */
    if (photon.status === "rejected" && nominatim.status === "rejected") {
      throw new Error("geocoders indisponíveis");
    }
    const results = rank(dedupe(merged), query).slice(0, 6);

    const body = { results };
    toCache(key, body);
    return NextResponse.json(body);
  } catch {
    /* Serviço público fora do ar não pode derrubar o checkout: o mapa
       continua clicável e o endereço escrito à mão continua valendo. */
    return NextResponse.json({ results: [], address: "", unavailable: true });
  }
}
