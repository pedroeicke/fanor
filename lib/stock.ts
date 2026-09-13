import "server-only";
import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "./supabase-admin";
import { limaToday } from "./gestion/dates";
import { DEFAULT_SLA, shortStoreName, type SlaSettings } from "./gestion/server";

/**
 * O que existe para vender agora, por loja.
 *
 * Alimenta a vitrine em tempo real: quem abre o site vê a torta que está no
 * balcão neste momento, não o catálogo inteiro. Os dados vêm do espelho do
 * Sisgeco ou do fluxo novo (despacho → conferência na loja) — esta camada só
 * lê. Qual das duas manda é `system_settings.stock_source`.
 *
 * A regra que manda em tudo aqui: **estoque velho é pior que estoque
 * nenhum.** Vender uma torta que saiu há duas horas custa uma ligação, um
 * cliente irritado e a confiança na vitrine. Por isso:
 * - no espelho, se o leitor está calado há mais que o prazo do SLA, `fresh`
 *   volta falso e a vitrine mostra o catálogo normal em vez de números que
 *   já não valem;
 * - em qualquer fonte, torta vencida (`expires_on` antes de hoje em Lima)
 *   nunca aparece, mesmo que ninguém a tenha devolvido — o espelho tem
 *   dezenas assim, que o Sisgeco nunca baixou;
 * - erro de leitura vira `fresh: false`, nunca "zero tortas".
 */

/** Prazo padrão, se o SLA não estiver gravado. O leitor fala a cada 5 s. */
const STALE_AFTER_MIN = DEFAULT_SLA.sync_stale_min;

/** Fotos reais por grupo: o card mostra poucas, e o JSON público fica leve. */
const MAX_PHOTOS = 3;

export type StockSource = "sisgeco" | "native";

export type StockItem = {
  /** Código no Sisgeco (T14, PS12). É a chave que liga ao produto do site. */
  sku: string;
  name: string;
  /** Produto do site correspondente, quando o `sku` já foi vinculado. */
  slug: string | null;
  /** Foto real da torta, senão a imagem do produto publicado. */
  image: string | null;
  price: number | null;
  quantity: number;
  /** Data de vencimento mais próxima entre as unidades disponíveis. */
  soonestExpiry: string | null;
  /** Quantas vencem hoje: é a que a loja quer girar primeiro. */
  expiringToday: number;
  /** Sabor decidido no taller. Null no espelho, que não sabe o sabor. */
  flavor?: string | null;
  /** Até 3 fotos reais das unidades, da produção mais nova para a mais velha. */
  photos?: string[];
  /**
   * Todas as unidades do grupo saíram hoje e nenhuma é redecorada. A
   * redecorada ganha `produced_on` do dia em que foi refeita — "preparada
   * hoy" prometeria uma base que não é de hoje.
   */
  producedToday?: boolean;
  /** Produção mais antiga do grupo: a promessa conservadora de frescor. */
  producedOn?: string | null;
  /** Alguma unidade do grupo é redecorada (vale um dia). */
  redecorated?: boolean;
};

export type StoreStock = {
  storeId: string;
  storeName: string;
  /** "Calle Perú": o nome sem a marca, como a cliente fala. */
  shortName?: string;
  address?: string | null;
  district?: string | null;
  items: StockItem[];
};

export type StockSnapshot = {
  /** Falso quando o leitor está calado: a vitrine deve se calar também. */
  fresh: boolean;
  /** Minutos desde a última notícia do leitor; null se nunca houve. No fluxo novo, 0. */
  minutesAgo: number | null;
  stores: StoreStock[];
  total: number;
  /** De onde a vitrine leu. */
  source?: StockSource;
};

type CakeRow = {
  product_id: string;
  store_id: string;
  produced_on: string;
  expires_on: string;
  flavor_id?: string | null;
  redecorated?: boolean;
  photo_url?: string | null;
  products: { sku: string | null; name: string; slug: string; status: string; base_price: string | number | null } | null;
  flavors?: { name: string } | null;
};

type StoreRow = {
  id: string;
  name: string;
  address: string | null;
  district: string | null;
  serial_prefix: string | null;
  sort_order: number | null;
};

/**
 * Nome do cadastro do balcão em forma legível.
 *
 * O Sisgeco grava tudo em maiúsculas e com espaço dobrado ("T26  TRES LECHES
 * LUCUMA"). Nome curado no painel já vem como a marca quer e passa intacto.
 * Palavra com número ou de até duas letras é código (T26, 3½, P) e fica como
 * está; conectivos vão em minúscula.
 */
const CONNECTORS = new Set(["de", "del", "la", "las", "el", "los", "y", "o", "con", "en", "a", "al", "para", "por", "sin", "x"]);

export function tidyCounterName(raw: string) {
  const name = raw
    .replace(/\s+/g, " ")
    /* O leitor às vezes perde o Ñ na conversão de página de código do
       Sisgeco ("PI�A", "PEQUE�AS"). Entre duas letras, nesses nomes, o
       caractere perdido foi Ñ em todos os casos vistos — e "Pi�a" na vitrine
       pública é pior que o palpite. */
    .replace(/(\p{L})�(?=\p{L})/gu, (_, before: string) => `${before}${before === before.toLowerCase() ? "ñ" : "Ñ"}`)
    .trim();
  if (!name || name !== name.toUpperCase()) return name;
  return name
    .split(" ")
    .map((word, i) => {
      const lower = word.toLowerCase();
      if (i > 0 && CONNECTORS.has(lower)) return lower;
      /* "C/" é "con" abreviado; "MANGO/LUCUMA" são dois sabores, cada um com
         a sua maiúscula. */
      if (word.includes("/") && !/\d/.test(word)) return word.split("/").map((part) => (part.length > 2 ? titleCase(part) : part.toLowerCase())).join("/");
      if (/\d/.test(word) || word.length <= 2) return word;
      return titleCase(word);
    })
    .join(" ");
}

function titleCase(word: string) {
  const lower = word.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/**
 * Só URL que o `next/image` aceita.
 *
 * Espelha `images.remotePatterns` do next.config.ts: um host fora da lista
 * faz o componente lançar e derruba a vitrine inteira por causa de uma foto.
 * O que não passa aqui cai para a imagem do produto ou para a ilustração.
 */
function usableImage(url: string | null | undefined) {
  const value = url?.trim();
  if (!value) return null;
  if (value.startsWith("/") && !value.startsWith("//")) return value;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:") return null;
    if (parsed.hostname === "tortasfanor.sirv.com") return value;
    const supabaseHost = parsed.hostname.endsWith(".supabase.co") && parsed.hostname.split(".").length === 3;
    if (supabaseHost && parsed.pathname.startsWith("/storage/v1/object/")) return value;
  } catch {
    return null;
  }
  return null;
}

function toNumber(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

async function readSettings(db: SupabaseClient) {
  const { data, error } = await db.from("system_settings").select("key, value").in("key", ["stock_source", "sla"]);
  const byKey = new Map((data ?? []).map((row) => [row.key as string, row.value as unknown]));

  /* Qualquer valor que não seja exatamente "native" mantém o espelho: a
     chave só vira de propósito, pelo painel. */
  const source: StockSource = byKey.get("stock_source") === "native" ? "native" : "sisgeco";
  const staleMin = Number((byKey.get("sla") as Partial<SlaSettings> | undefined)?.sync_stale_min);
  return { error, source, staleAfterMin: Number.isFinite(staleMin) && staleMin > 0 ? staleMin : STALE_AFTER_MIN };
}

/**
 * Frescor do espelho: minutos desde a última sincronização que deu certo.
 *
 * Execução com erro também grava `finished_at`. Um leitor preso num lote
 * que falha escreve uma a cada poucos segundos sem aplicar nenhuma venda —
 * contá-la como notícia deixaria a vitrine "ao vivo" mostrando torta que já
 * saiu do balcão.
 */
async function mirrorAge(db: SupabaseClient) {
  const { data, error } = await db
    .from("sync_runs")
    .select("finished_at")
    .eq("source", "sisgeco")
    .is("error", null)
    .not("finished_at", "is", null)
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  const finishedAt = data?.finished_at as string | undefined;
  return {
    error,
    minutesAgo: finishedAt ? Math.round((Date.now() - new Date(finishedAt).getTime()) / 60_000) : null,
  };
}

function cakesQuery(db: SupabaseClient, source: StockSource, today: string) {
  if (source === "sisgeco") {
    /* Só o que veio do espelho: o fluxo novo grava na mesma tabela, e
       misturar as duas fontes contaria a mesma torta duas vezes. */
    return db
      .from("cake_units")
      .select("product_id, store_id, produced_on, expires_on, products(sku, name, slug, status, base_price)")
      .eq("source", "sisgeco")
      .eq("status", "in_stock")
      .gte("expires_on", today);
  }
  /* Fluxo novo: a torta só chega a `in_stock` quando a vendedora confere na
     loja. Mais nova primeiro, para as fotos saírem nessa ordem. */
  return db
    .from("cake_units")
    .select("product_id, store_id, produced_on, expires_on, flavor_id, redecorated, photo_url, products(sku, name, slug, status, base_price), flavors(name)")
    .eq("source", "native")
    .eq("status", "in_stock")
    .gte("expires_on", today)
    .order("produced_on", { ascending: false });
}

export const getStockSnapshot = cache(async (): Promise<StockSnapshot> => {
  const db = getSupabaseAdmin();
  const empty: StockSnapshot = { fresh: false, minutesAgo: null, stores: [], total: 0 };
  if (!db) return empty;

  const settings = await readSettings(db);
  /* Sem saber qual fonte manda, não há o que mostrar: cair para o espelho
     depois da virada exibiria o estoque de um sistema que ninguém mais
     alimenta. */
  if (settings.error) {
    console.error("[stock] system_settings:", settings.error.message);
    return empty;
  }
  const { source, staleAfterMin } = settings;
  const today = limaToday();

  const [age, cakes, storesResult] = await Promise.all([
    /* O fluxo novo não tem leitor para ficar calado: o dado nasce em dia. */
    source === "sisgeco" ? mirrorAge(db) : Promise.resolve({ error: null, minutesAgo: 0 }),
    cakesQuery(db, source, today),
    db.from("stores").select("id, name, address, district, serial_prefix, sort_order").eq("active", true),
  ]);

  const minutesAgo = age.minutesAgo;
  /* Loja também: sem ela a torta aparece em "Tienda", sem endereço, e a
     mensagem do WhatsApp não diz onde separar. */
  const readError = age.error ?? cakes.error ?? storesResult.error;
  if (readError) {
    console.error("[stock] leitura do estoque:", readError.message);
    return { ...empty, minutesAgo, source };
  }
  /* Sem notícia do leitor não há vitrine em tempo real — nem com estoque no
     banco, porque esse estoque pode ser de ontem. */
  if (minutesAgo === null || minutesAgo > staleAfterMin) return { ...empty, minutesAgo, source };

  const storeInfo = new Map(storeRows(storesResult.data).map((s) => [s.id, s]));
  const rows = (cakes.data ?? []) as unknown as CakeRow[];

  /* Agrupa por loja e, dentro dela, por produto + sabor. A vitrine é por loja
     porque a pessoa vai buscar num endereço, não "na Fanor"; e "T26 fresa" e
     "T26 moka" são tortas diferentes para quem compra. */
  const byStore = new Map<string, Map<string, StockItem>>();
  let total = 0;

  for (const row of rows) {
    const product = row.products;
    if (!product) continue;
    /* Loja desativada não vende: torta que ficou registrada lá não pode
       aparecer como "Tienda", sem endereço, para alguém ir buscar. */
    if (!storeInfo.has(row.store_id)) continue;
    const active = product.status === "active";
    const key = `${row.product_id}|${row.flavor_id ?? ""}`;

    const items = byStore.get(row.store_id) ?? new Map<string, StockItem>();
    let item = items.get(key);
    if (!item) {
      item = {
        /* Produto ainda em rascunho aparece pelo nome: é melhor dizer "temos
           uma T26 Moka" do que esconder porque a foto não foi vinculada. */
        sku: product.sku ?? product.slug,
        name: active ? product.name : tidyCounterName(product.name),
        slug: active ? product.slug : null,
        image: null,
        /* O preço do cadastro do balcão não serve ao público: o do Sisgeco
           vem sem IGV (a T26 a 131,36 é a torta de S/ 155). Só o produto
           publicado, curado no painel, mostra preço. */
        price: active ? toNumber(product.base_price) : null,
        quantity: 0,
        soonestExpiry: null,
        expiringToday: 0,
        flavor: row.flavors?.name?.trim() || null,
        photos: [],
        producedToday: true,
        producedOn: null,
        redecorated: false,
      };
      items.set(key, item);
      byStore.set(row.store_id, items);
    }

    item.quantity += 1;
    total += 1;
    if (!item.soonestExpiry || row.expires_on < item.soonestExpiry) item.soonestExpiry = row.expires_on;
    if (row.expires_on === today) item.expiringToday += 1;
    if (!item.producedOn || row.produced_on < item.producedOn) item.producedOn = row.produced_on;
    if (row.redecorated) item.redecorated = true;
    item.producedToday = item.producedToday === true && row.produced_on === today && !row.redecorated;

    const photo = usableImage(row.photo_url);
    const photos = item.photos ?? [];
    if (photo && photos.length < MAX_PHOTOS && !photos.includes(photo)) photos.push(photo);
    item.photos = photos;
  }

  /* Imagem de catálogo vem do produto publicado, que é onde a curadoria mora.
     Uma consulta só, depois do agrupamento. */
  const allItems = [...byStore.values()].flatMap((items) => [...items.values()]);
  const catalogImage = await publishedImages(db, allItems);

  for (const item of allItems) {
    /* Foto real ganha da foto de catálogo: é a torta que a pessoa vai levar. */
    item.image = item.photos?.[0] ?? (item.slug ? catalogImage.get(item.slug) : null) ?? null;
  }

  const stores: StoreStock[] = [...byStore.entries()].map(([storeId, items]) => toStore(storeId, storeInfo.get(storeId), [...items.values()]));
  /* Loja que recebe torta aparece mesmo vazia: "aqui não sobrou nada" é
     informação para quem ia sair de casa. */
  for (const store of storeInfo.values()) {
    if (store.serial_prefix && !byStore.has(store.id)) stores.push(toStore(store.id, store, []));
  }

  const order = (id: string) => storeInfo.get(id)?.sort_order ?? Number.MAX_SAFE_INTEGER;
  stores.sort((a, b) =>
    Number(b.items.length > 0) - Number(a.items.length > 0)
    || order(a.storeId) - order(b.storeId)
    || a.storeName.localeCompare(b.storeName, "es"),
  );

  return { fresh: true, minutesAgo, stores, total, source };
});

function storeRows(data: unknown) {
  return (Array.isArray(data) ? data : []) as StoreRow[];
}

async function publishedImages(db: SupabaseClient, items: StockItem[]) {
  const images = new Map<string, string | null>();
  const slugs = [...new Set(items.map((i) => i.slug).filter((s): s is string => Boolean(s)))];
  if (!slugs.length) return images;

  const { data, error } = await db
    .from("products")
    .select("slug, product_images(url, kind, sort_order)")
    .in("slug", slugs)
    .eq("status", "active");
  if (error) console.error("[stock] imagens do catálogo:", error.message);

  for (const product of data ?? []) {
    /* Só a galeria: quadro do giro 360° é um ângulo qualquer, não capa. */
    const gallery = ((product.product_images ?? []) as { url: string; kind: string; sort_order: number }[])
      .filter((i) => i.kind === "gallery")
      .sort((a, b) => a.sort_order - b.sort_order);
    images.set(product.slug as string, usableImage(gallery[0]?.url));
  }
  return images;
}

function toStore(storeId: string, info: StoreRow | undefined, items: StockItem[]): StoreStock {
  const storeName = info?.name ?? "Tienda";
  return {
    storeId,
    storeName,
    shortName: shortStoreName(storeName),
    address: info?.address?.trim() || null,
    district: info?.district?.trim() || null,
    /* Mais unidades primeiro: é o que a loja tem sobrando e quer girar. */
    items: items.sort((a, b) =>
      b.quantity - a.quantity
      || a.name.localeCompare(b.name, "es")
      || (a.flavor ?? "").localeCompare(b.flavor ?? "", "es"),
    ),
  };
}
