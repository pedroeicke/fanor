import "server-only";
import { cache } from "react";
import { getSupabaseAdmin } from "./supabase-admin";

/**
 * O que existe para vender agora, por loja.
 *
 * Alimenta a vitrine em tempo real: quem abre o site vê a torta que está no
 * balcão neste momento, não o catálogo inteiro. Os dados vêm do espelho do
 * Sisgeco (ou, depois, do balcão novo) — esta camada só lê.
 *
 * A regra que manda em tudo aqui: **estoque velho é pior que estoque
 * nenhum.** Vender uma torta que saiu há duas horas custa uma ligação, um
 * cliente irritado e a confiança na vitrine. Por isso, se o leitor está
 * calado há mais que `STALE_AFTER_MIN`, `fresh` volta falso e a vitrine
 * mostra o catálogo normal em vez de números que já não valem.
 */

/** Acima disto, o número deixa de ser confiável. O leitor fala a cada 5 s. */
const STALE_AFTER_MIN = 15;

export type StockItem = {
  /** Código no Sisgeco (T14, PS12). É a chave que liga ao produto do site. */
  sku: string;
  name: string;
  /** Produto do site correspondente, quando o `sku` já foi vinculado. */
  slug: string | null;
  image: string | null;
  price: number | null;
  quantity: number;
  /** Data de vencimento mais próxima entre as unidades disponíveis. */
  soonestExpiry: string | null;
  /** Quantas vencem hoje: é a que a loja quer girar primeiro. */
  expiringToday: number;
};

export type StoreStock = {
  storeId: string;
  storeName: string;
  items: StockItem[];
};

export type StockSnapshot = {
  /** Falso quando o leitor está calado: a vitrine deve se calar também. */
  fresh: boolean;
  /** Minutos desde a última notícia do leitor; null se nunca houve. */
  minutesAgo: number | null;
  stores: StoreStock[];
  total: number;
};

type CakeRow = {
  expires_on: string;
  store_id: string;
  products: { sku: string | null; name: string; slug: string; status: string } | null;
  stores: { name: string } | null;
};

export const getStockSnapshot = cache(async (): Promise<StockSnapshot> => {
  const db = getSupabaseAdmin();
  const empty: StockSnapshot = { fresh: false, minutesAgo: null, stores: [], total: 0 };
  if (!db) return empty;

  const [{ data: run }, { data: cakes }] = await Promise.all([
    db.from("sync_runs").select("finished_at").not("finished_at", "is", null).order("id", { ascending: false }).limit(1).maybeSingle(),
    db.from("cake_units").select("expires_on, store_id, products(sku, name, slug, status), stores(name)").eq("status", "in_stock"),
  ]);

  const finishedAt = run?.finished_at as string | undefined;
  const minutesAgo = finishedAt ? Math.round((Date.now() - new Date(finishedAt).getTime()) / 60_000) : null;
  /* Sem notícia do leitor não há vitrine em tempo real — nem com estoque no
     banco, porque esse estoque pode ser de ontem. */
  const fresh = minutesAgo !== null && minutesAgo <= STALE_AFTER_MIN;
  if (!fresh) return { ...empty, minutesAgo };

  const rows = (cakes ?? []) as unknown as CakeRow[];
  const today = new Date().toISOString().slice(0, 10);

  /* Agrupa por loja e, dentro dela, por produto. A vitrine é por loja porque
     a pessoa vai buscar num endereço, não "na Fanor". */
  const byStore = new Map<string, { name: string; items: Map<string, StockItem> }>();

  for (const row of rows) {
    const product = row.products;
    if (!product) continue;
    /* Produto ainda em rascunho aparece pelo nome: é melhor dizer "temos uma
       T26 Moka" do que esconder porque a foto não foi vinculada. */
    const sku = product.sku ?? product.slug;

    const store = byStore.get(row.store_id) ?? { name: row.stores?.name ?? "Tienda", items: new Map() };
    const item = store.items.get(sku) ?? {
      sku, name: product.name, slug: product.status === "active" ? product.slug : null,
      image: null, price: null, quantity: 0, soonestExpiry: null, expiringToday: 0,
    };

    item.quantity += 1;
    if (!item.soonestExpiry || row.expires_on < item.soonestExpiry) item.soonestExpiry = row.expires_on;
    if (row.expires_on <= today) item.expiringToday += 1;

    store.items.set(sku, item);
    byStore.set(row.store_id, store);
  }

  /* Foto e preço vêm do produto publicado, que é onde a curadoria mora. Uma
     consulta só, depois do agrupamento. */
  const slugs = [...byStore.values()].flatMap((s) => [...s.items.values()]).map((i) => i.slug).filter((s): s is string => Boolean(s));
  if (slugs.length) {
    const { data: published } = await db
      .from("products")
      .select("slug, base_price, product_images(url, sort_order)")
      .in("slug", slugs)
      .eq("status", "active");

    const info = new Map((published ?? []).map((p) => {
      const images = (p.product_images ?? []) as { url: string; sort_order: number }[];
      const first = [...images].sort((a, b) => a.sort_order - b.sort_order)[0];
      return [p.slug as string, { price: p.base_price == null ? null : Number(p.base_price), image: first?.url ?? null }];
    }));

    for (const store of byStore.values()) {
      for (const item of store.items.values()) {
        const extra = item.slug ? info.get(item.slug) : undefined;
        if (extra) { item.price = extra.price; item.image = extra.image; }
      }
    }
  }

  const stores = [...byStore.entries()]
    .map(([storeId, s]) => ({
      storeId, storeName: s.name,
      /* Mais unidades primeiro: é o que a loja tem sobrando e quer girar. */
      items: [...s.items.values()].sort((a, b) => b.quantity - a.quantity || a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => a.storeName.localeCompare(b.storeName));

  return { fresh: true, minutesAgo, stores, total: rows.length };
});
