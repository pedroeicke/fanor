import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { AutoRefresh } from "@/components/admin/AutoRefresh";
import { EmptyState, Notice, PageHeader, Section, StatCard } from "@/components/admin/ui";
import { ExpiredCakes, type ExpiredCake } from "@/components/admin/tienda/ExpiredCakes";
import { MissingCakeActions } from "@/components/admin/tienda/MissingCakeActions";
import { StorePicker, pickStore } from "@/components/admin/tienda/StorePicker";
import { getOperator, listStores, shortStoreName } from "@/lib/gestion/server";
import { addDays, limaToday } from "@/lib/gestion/dates";
import { TONE_CLASS } from "@/lib/gestion/labels";
import { formatDateShort } from "@/lib/delivery";
import { cx } from "@/lib/format";

export const metadata: Metadata = { title: "Mi vitrina" };
export const dynamic = "force-dynamic";

/**
 * "Mi vitrina": o que a loja tem de torta agora, conferido na recepção.
 *
 * Abre pelas vencidas porque é a única coisa aqui que exige ação imediata —
 * a vitrina pública já as esconde, mas elas continuam na prateleira até
 * alguém devolvê-las ao taller.
 *
 * Só tortas do fluxo novo (`source = 'native'`). As do espelho do Sisgeco
 * continuam em Inventario: misturar as duas contaria a mesma torta física
 * duas vezes durante a convivência.
 */

type Cake = {
  id: string;
  serial: string;
  status: string;
  produced_on: string;
  expires_on: string;
  redecorated: boolean;
  photo_url: string | null;
  contract_id: string | null;
  dispatch_id: string | null;
  products: { id: string; name: string; sku: string | null } | null;
  flavors: { name: string } | null;
  decorators: { name: string } | null;
  contracts: { number: number; deliver_on: string; deliver_at: string | null } | null;
  dispatches: { number: number } | null;
};

type Level = {
  product_id: string;
  quantity: number | string;
  products: {
    name: string;
    sku: string | null;
    product_families: { is_service: boolean; tracks_serial: boolean } | null;
  } | null;
};

type FlavorGroup = { name: string; cakes: Cake[] };
type ProductGroup = { key: string; name: string; sku: string | null; count: number; flavors: FlavorGroup[] };

const NO_FLAVOR = "Sin sabor";

/** Relógio lido uma vez, fora do componente: render tem de ser puro. */
function clock() {
  const today = limaToday();
  return { today, tomorrow: addDays(today, 1) };
}

/** Dias entre dois "AAAA-MM-DD" (b − a), sem passar por fuso. */
function daysBetween(a: string, b: string) {
  const toUtc = (iso: string) => {
    const [y, m, d] = iso.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toUtc(b) - toUtc(a)) / 86_400_000);
}

function formatQty(n: number) {
  return n.toLocaleString("es-PE", { maximumFractionDigits: 3 });
}

const byName = (a: string, b: string) => a.localeCompare(b, "es", { numeric: true, sensitivity: "base" });

/** Produto → sabor → torta, com "Sin sabor" no fim de cada produto. */
function groupShowcase(cakes: Cake[]): ProductGroup[] {
  const products = new Map<string, { name: string; sku: string | null; flavors: Map<string, Cake[]> }>();
  for (const cake of cakes) {
    const key = cake.products?.id ?? "sin-producto";
    const entry = products.get(key) ?? { name: cake.products?.name ?? "Torta", sku: cake.products?.sku ?? null, flavors: new Map() };
    const flavor = cake.flavors?.name ?? NO_FLAVOR;
    entry.flavors.set(flavor, [...(entry.flavors.get(flavor) ?? []), cake]);
    products.set(key, entry);
  }
  return [...products.entries()]
    .map(([key, p]) => ({
      key,
      name: p.name,
      sku: p.sku,
      count: [...p.flavors.values()].reduce((n, list) => n + list.length, 0),
      flavors: [...p.flavors.entries()]
        .map(([name, list]) => ({ name, cakes: list }))
        .sort((a, b) => (a.name === NO_FLAVOR ? 1 : b.name === NO_FLAVOR ? -1 : byName(a.name, b.name))),
    }))
    .sort((a, b) => byName(a.name, b.name));
}

/**
 * Miniatura da foto real da torta. Só passa pelo otimizador o que vem dos
 * hosts liberados no next.config — qualquer outro endereço derrubaria a
 * imagem com erro de host, então vai direto.
 */
function CakeThumb({ url, alt }: { url: string | null; alt: string }) {
  if (!url) return null;
  let optimizable = false;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    optimizable =
      u.protocol === "https:" &&
      ((u.hostname.endsWith(".supabase.co") && u.pathname.startsWith("/storage/v1/object/")) || u.hostname === "tortasfanor.sirv.com");
  } catch {
    return null;
  }
  return (
    <Image
      src={url}
      alt={alt}
      width={48}
      height={60}
      sizes="48px"
      unoptimized={!optimizable}
      className="h-15 w-12 shrink-0 rounded-lg border border-crema-200 object-cover"
    />
  );
}

function ExpiryBadge({ expiresOn, today, tomorrow }: { expiresOn: string; today: string; tomorrow: string }) {
  if (expiresOn === today) {
    return <span className={cx("rounded-full border px-2 py-0.5 text-[11px] font-bold", TONE_CLASS.bad)}>vence hoy</span>;
  }
  if (expiresOn === tomorrow) {
    return <span className={cx("rounded-full border px-2 py-0.5 text-[11px] font-bold", TONE_CLASS.warn)}>vence mañana</span>;
  }
  return null;
}

export default async function StorePage({ searchParams }: { searchParams: Promise<{ tienda?: string | string[] }> }) {
  const op = await getOperator();
  if (!op) return <Notice tone="bad">Sesión expirada. Vuelve a entrar.</Notice>;

  const [{ tienda }, stores] = await Promise.all([searchParams, listStores(op.db)]);
  const store = pickStore(stores, tienda, op.seller?.storeId);

  if (!store) {
    return (
      <div className="space-y-6">
        <PageHeader title="Mi vitrina" />
        <Notice tone="warn">Ninguna tienda tiene prefijo de serie configurado. Sin eso no llegan tortas del taller.</Notice>
      </div>
    );
  }

  const [{ data: cakeData, error: cakeError }, { data: levelData }, { count: inTransit }] = await Promise.all([
    op.db
      .from("cake_units")
      .select(
        "id, serial, status, produced_on, expires_on, redecorated, photo_url, contract_id, dispatch_id, products(id, name, sku), flavors(name), decorators(name), contracts(number, deliver_on, deliver_at), dispatches(number)",
      )
      .eq("source", "native")
      .eq("store_id", store.id)
      .in("status", ["in_stock", "reserved", "missing"])
      .order("expires_on", { ascending: true })
      .order("serial", { ascending: true }),
    op.db
      .from("stock_levels")
      .select("product_id, quantity, products(name, sku, product_families(is_service, tracks_serial))")
      .eq("store_id", store.id)
      .neq("quantity", 0),
    op.db.from("dispatches").select("id", { count: "exact", head: true }).eq("store_id", store.id).eq("status", "in_transit"),
  ]);

  const { today, tomorrow } = clock();
  const cakes = (cakeData ?? []) as unknown as Cake[];
  const storeName = shortStoreName(store.name);

  const inStock = cakes.filter((c) => c.status === "in_stock");
  const expired = inStock.filter((c) => c.expires_on < today);
  const showcase = inStock.filter((c) => c.expires_on >= today);
  const dueToday = showcase.filter((c) => c.expires_on === today);
  const reserved = cakes
    .filter((c) => c.status === "reserved")
    .sort((a, b) => (a.contracts?.deliver_on ?? "9999").localeCompare(b.contracts?.deliver_on ?? "9999"));
  const missing = cakes.filter((c) => c.status === "missing");
  const groups = groupShowcase(showcase);
  /* Serviço (adelanto, saldo de encomienda) não é estoque, e família com série
     se conta pelas tortas acima: o espelho do Sisgeco deixa saldo negativo
     nos dois, que aqui só confundiria a vendedora. */
  const levels = ((levelData ?? []) as unknown as Level[])
    .filter((l) => !l.products?.product_families?.is_service && !l.products?.product_families?.tracks_serial)
    .sort((a, b) => byName(a.products?.name ?? "", b.products?.name ?? ""));

  const expiredItems: ExpiredCake[] = expired.map((c) => {
    const late = daysBetween(c.expires_on, today);
    return {
      serial: c.serial,
      product: c.products?.name ?? "Torta",
      flavor: c.flavors?.name ?? null,
      redecorated: c.redecorated,
      expiredLabel: `Venció ${late <= 1 ? "ayer" : `hace ${late} días`} (${formatDateShort(c.expires_on)})`,
    };
  });

  return (
    <div className="space-y-6">
      {/* Aberta no balcão: o que se vende ou se recebe em outro celular aparece sozinho. */}
      <AutoRefresh everyMs={15_000} />

      <PageHeader
        title="Mi vitrina"
        description={`Tortas conferidas en ${storeName}. Las vencidas no se muestran a los clientes: devuélvelas al taller.`}
        actions={
          <Link
            href={`/admin/recepcion?tienda=${store.id}`}
            className="inline-flex h-11 items-center gap-2 rounded-full border border-crema-300 bg-white px-4 text-sm font-semibold text-cacao-700 hover:border-cacao/35"
          >
            Recepción
            {!!inTransit && <span className="grid h-6 min-w-6 place-items-center rounded-full bg-dorado px-1.5 text-[12px] text-cacao">{inTransit}</span>}
          </Link>
        }
      />

      <StorePicker stores={stores} currentId={store.id} basePath="/admin/tienda" />

      {cakeError && <Notice tone="bad">No se pudieron cargar las tortas. Inténtalo de nuevo en unos segundos.</Notice>}

      {!!inTransit && (
        <Notice tone="info">
          {inTransit === 1 ? "Hay 1 despacho en camino" : `Hay ${inTransit} despachos en camino`}. Las tortas suben a la vitrina al confirmar la{" "}
          <Link href={`/admin/recepcion?tienda=${store.id}`} className="font-semibold underline underline-offset-4">
            recepción
          </Link>
          .
        </Notice>
      )}

      {/* Com a leitura falhando, zeros e "no hay tortas" seriam mentira: a
          vendedora concluiria que a vitrina está vazia. Só o aviso fica. */}
      {!cakeError && (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <StatCard label="En vitrina" value={showcase.length} tone={showcase.length ? "ok" : undefined} />
          <StatCard label="Vencen hoy" value={dueToday.length} tone={dueToday.length ? "warn" : undefined} />
          <StatCard label="Vencidas" value={expired.length} tone={expired.length ? "warn" : undefined} />
          <StatCard label="Reservadas" value={reserved.length} />
          <StatCard label="Faltantes" value={missing.length} tone={missing.length ? "warn" : undefined} />
        </ul>
      )}

      {/* Sempre montado: guarda a confirmação depois que a última vencida sai. */}
      <ExpiredCakes cakes={expiredItems} />

      <div className="space-y-4">
        <h3 className="font-display text-xl">En vitrina</h3>
        {cakeError ? (
          <div className="card">
            <EmptyState>No se pudo cargar la vitrina. La página vuelve a intentarlo sola.</EmptyState>
          </div>
        ) : groups.length === 0 ? (
          <div className="card">
            <EmptyState>
              No hay tortas en vitrina en {storeName}. Llegan al confirmar una{" "}
              <Link href={`/admin/recepcion?tienda=${store.id}`} className="font-semibold text-cacao underline underline-offset-4">
                recepción
              </Link>
              .
            </EmptyState>
          </div>
        ) : (
          groups.map((group) => (
            <Section
              key={group.key}
              title={
                <>
                  {group.name}
                  {group.sku && <span className="ml-2 font-sans text-sm font-normal text-cacao-300">{group.sku}</span>}
                </>
              }
              aside={`${group.count} en vitrina`}
            >
              {group.flavors.map((flavor) => (
                <div key={flavor.name}>
                  <p className="flex items-center justify-between bg-crema-100 px-4 py-2 text-[12px] font-bold uppercase tracking-[0.1em] text-cacao-500 sm:px-5">
                    <span>{flavor.name}</span>
                    <span className="tabular-nums">{flavor.cakes.length}</span>
                  </p>
                  <ul className="divide-y divide-crema-200">
                    {flavor.cakes.map((c) => (
                      <li key={c.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                        <CakeThumb url={c.photo_url} alt={`${group.name} ${flavor.name}, serie ${c.serial}`} />
                        <div className="min-w-0 flex-1">
                          <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span className="font-mono text-[14px] font-semibold text-cacao">{c.serial}</span>
                            <ExpiryBadge expiresOn={c.expires_on} today={today} tomorrow={tomorrow} />
                            {c.redecorated && (
                              <span className={cx("rounded-full border px-2 py-0.5 text-[11px] font-bold tracking-wide", TONE_CLASS.warn)}>
                                REDECORADA
                              </span>
                            )}
                          </p>
                          <p className="text-[13px] text-cacao-500">
                            Producida {formatDateShort(c.produced_on)} · vence {formatDateShort(c.expires_on)}
                          </p>
                          {c.decorators && <p className="text-[12px] text-cacao-300">Decoró: {c.decorators.name}</p>}
                        </div>
                        <Link
                          href={`/admin/fotos?serie=${encodeURIComponent(c.serial)}`}
                          className="inline-flex h-11 shrink-0 items-center rounded-full border border-crema-300 px-3.5 text-sm font-semibold text-cacao-700 hover:border-cacao/35"
                        >
                          Foto
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </Section>
          ))
        )}
      </div>

      {reserved.length > 0 && (
        <Section title="Reservadas para encomiendas" aside={`${reserved.length}`}>
          <ul className="divide-y divide-crema-200">
            {reserved.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 sm:px-5">
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-[14px] font-semibold text-cacao">{c.serial}</p>
                  <p className="text-[13px] text-cacao-700">
                    {c.products?.name ?? "Torta"} · {c.flavors?.name ?? NO_FLAVOR}
                  </p>
                  {c.contracts && (
                    <p className={cx("text-[13px]", c.contracts.deliver_on <= today ? "font-semibold text-terracota" : "text-cacao-500")}>
                      Encomienda #{c.contracts.number} · entrega {c.contracts.deliver_on === today ? "hoy" : formatDateShort(c.contracts.deliver_on)}
                      {c.contracts.deliver_at && ` ${c.contracts.deliver_at.slice(0, 5)}`}
                    </p>
                  )}
                </div>
                {c.contract_id && (
                  <Link
                    href={`/admin/encomiendas/${c.contract_id}`}
                    className="inline-flex h-11 shrink-0 items-center rounded-full border border-crema-300 px-4 text-sm font-semibold text-cacao-700 hover:border-cacao/35"
                  >
                    Ver encomienda
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {missing.length > 0 && (
        <Section title={<span id="faltantes" className="scroll-mt-4">Faltantes por aclarar</span>} aside={`${missing.length}`}>
          <p className="border-b border-crema-200 px-4 py-2.5 text-[13px] text-cacao-500 sm:px-5">
            Estaban en un despacho y no llegaron. Si aparece, márcala; si no, dala por perdida.
          </p>
          <ul className="divide-y divide-crema-200">
            {missing.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 sm:px-5">
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-[14px] font-semibold text-cacao">{c.serial}</p>
                  <p className="text-[13px] text-cacao-700">
                    {c.products?.name ?? "Torta"} · {c.flavors?.name ?? NO_FLAVOR}
                    {c.contracts && ` · Encomienda #${c.contracts.number}`}
                  </p>
                  {c.dispatch_id && c.dispatches && (
                    <Link
                      href={`/admin/recepcion/${c.dispatch_id}`}
                      className="text-[13px] font-medium text-cacao-500 underline underline-offset-4 hover:text-cacao"
                    >
                      Despacho #{c.dispatches.number}
                    </Link>
                  )}
                </div>
                <MissingCakeActions serial={c.serial} forContract={Boolean(c.contract_id)} />
              </li>
            ))}
          </ul>
        </Section>
      )}

      {levels.length > 0 && (
        <Section title="Saldos sin serie" aside={`${levels.length} productos`}>
          <ul className="grid gap-x-8 px-4 py-2 text-sm sm:grid-cols-2 sm:px-5">
            {levels.map((l) => {
              const q = Number(l.quantity);
              return (
                <li key={l.product_id} className="flex items-baseline justify-between gap-3 border-b border-crema-200 py-2 last:border-b-0">
                  <span className="min-w-0">
                    <span className="font-medium text-cacao">{l.products?.name ?? "Producto"}</span>
                    {l.products?.sku && <span className="ml-1.5 text-[12px] text-cacao-300">{l.products.sku}</span>}
                  </span>
                  <span className={cx("shrink-0 tabular-nums", q < 0 ? "font-semibold text-terracota" : "text-cacao-700")}>{formatQty(q)}</span>
                </li>
              );
            })}
          </ul>
        </Section>
      )}
    </div>
  );
}
