import type { Metadata } from "next";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { ButtonLink } from "@/components/ui/primitives";
import { Flourish, IconClock, IconPin, IconStore } from "@/components/ui/icons";
import { FreshOnly, FreshnessGuard } from "@/components/vitrina/FreshnessGuard";
import { LiveDot } from "@/components/vitrina/LiveDot";
import { VitrinaCard } from "@/components/vitrina/VitrinaCard";
import { WhatsappLink } from "@/components/vitrina/WhatsappLink";
import { brand, siteUrl, whatsappLink } from "@/lib/config";
import { STORE_TIME_ZONE, addDays, limaToday } from "@/lib/gestion/dates";
import { getStockSnapshot, type StoreStock } from "@/lib/stock";

/**
 * Um minuto: o bastante para a vitrine acompanhar a venda do balcão sem que
 * cada visita vire consulta no banco. O selo da página de produto
 * (`/api/vitrina`) usa o mesmo prazo, para os dois nunca discordarem por mais
 * que isso.
 */
export const revalidate = 60;

const TITLE = "Tortas disponibles hoy";
const DESCRIPTION = `Tortas listas en nuestras tiendas de ${brand.city} para llevar hoy mismo. Mira cuántas quedan en cada tienda y resérvala por WhatsApp.`;

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/vitrina" },
  openGraph: {
    type: "website",
    locale: "es_PE",
    siteName: brand.name,
    url: `${siteUrl}/vitrina`,
    title: `${TITLE} — ${brand.name}`,
    description: DESCRIPTION,
    /* Declarar openGraph aqui substitui o do layout inteiro, inclusive a
       imagem gerada por app/opengraph-image.tsx — por isso ela volta
       explícita. Link colado no WhatsApp sem imagem não recebe clique. */
    images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: `${brand.name} — tortas artesanales en ${brand.city}` }],
  },
};

/** Relógio lido uma vez, fora do componente: render tem de ser puro. */
function clock() {
  const now = new Date();
  return { yesterday: addDays(limaToday(now), -1), updatedAt: atTime(now), renderedAt: now.getTime() };
}

/**
 * "a las 2:41 p. m." / "a la 1:05 p. m." no horário de Lima.
 *
 * A página é regenerada a cada minuto, então a hora dita é a do número que a
 * pessoa está vendo — nem mais nova, nem mais velha.
 */
function atTime(now: Date) {
  const parts = new Intl.DateTimeFormat("es-PE", { timeZone: STORE_TIME_ZONE, hour: "numeric", minute: "2-digit" }).formatToParts(now);
  const hour = parts.find((p) => p.type === "hour")?.value;
  return `${hour === "1" ? "a la" : "a las"} ${parts.map((p) => p.value).join("")}`;
}

export default async function VitrinaPage() {
  const snapshot = await getStockSnapshot();
  const { yesterday, updatedAt, renderedAt } = clock();

  const available = snapshot.fresh && snapshot.total > 0;
  const stores = withAnchors(snapshot.stores);
  const stocked = stores.filter((s) => s.store.items.length > 0);

  return (
    <>
      <section className="border-b border-crema-200 bg-gradient-to-b from-crema-100 to-crema">
        <div className="mx-auto max-w-7xl px-4 pb-10 pt-6 sm:px-6 lg:px-8 lg:pb-14">
          <Breadcrumbs items={[{ label: "Inicio", href: "/" }, { label: "Disponibles hoy" }]} />

          <div className="mt-8 max-w-2xl">
            {/* "En tienda ahora" só com número confirmado. Com o leitor calado
                a página não promete tempo real. */}
            {snapshot.fresh && (
              <FreshOnly renderedAt={renderedAt}>
                <p className="inline-flex items-center gap-2 rounded-full border border-verde/25 bg-verde-100 px-3.5 py-1.5 text-[13px] font-semibold text-verde">
                  <LiveDot />
                  En tienda ahora · actualizado {updatedAt}
                </p>
              </FreshOnly>
            )}
            <h1 className="mt-4 text-[2.25rem] leading-[1.08] sm:text-5xl">{TITLE}</h1>
            <Flourish className="mt-4 h-4 w-28 text-dorado-600" />
            <p className="mt-4 text-lg leading-relaxed text-cacao-500">
              Listas en nuestras tiendas para llevar hoy mismo. Las cantidades cambian durante el día: resérvala por
              WhatsApp y te la separamos.
            </p>
            <p className="mt-4 flex items-start gap-2.5 text-sm text-cacao-500">
              <IconClock className="mt-0.5 h-[18px] w-[18px] shrink-0 text-dorado-600" />
              <span>
                <span className="sr-only">Horario de las tiendas: </span>
                {brand.hours.map((h, i) => (
                  <span key={h.days} className="block sm:inline">
                    {i > 0 && <span className="hidden sm:inline"> · </span>}
                    {h.days}: {h.time}
                  </span>
                ))}
              </span>
            </p>
          </div>

          {/* Atalho por loja: no celular, a segunda loja fica várias telas
              abaixo da primeira. */}
          {available && stocked.length > 1 && (
            <FreshOnly renderedAt={renderedAt}>
              <nav aria-label="Tiendas" className="mt-7 flex flex-wrap gap-2">
                {stocked.map(({ store, anchor }) => (
                  <a
                    key={anchor}
                    href={`#${anchor}`}
                    className="inline-flex h-11 items-center gap-2 rounded-full border border-crema-300 bg-white pl-4 pr-2 text-sm font-medium text-cacao-700 transition-colors hover:border-cacao/35"
                  >
                    <IconStore className="h-[18px] w-[18px] text-dorado-600" />
                    {store.shortName ?? store.storeName}
                    <span className="grid h-7 min-w-7 place-items-center rounded-full bg-verde-100 px-2 text-[12px] font-bold tabular-nums text-verde">
                      {units(store)}
                    </span>
                  </a>
                ))}
              </nav>
            </FreshOnly>
          )}
        </div>
      </section>

      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8 lg:py-14">
        {/* O ISR pode entregar esta página horas depois do render (primeira
            visita após uma noite parada). O guarda confere a idade no
            navegador e troca o número velho pela versão nova. */}
        <FreshnessGuard renderedAt={renderedAt} fallback={<Unavailable confirmed={false} />}>
          {available ? (
            <>
              <div className="space-y-14">
                {stores.map(({ store, anchor }) => (
                  <StoreSection key={anchor} store={store} anchor={anchor} yesterday={yesterday} />
                ))}
              </div>

              <section className="mt-16 rounded-[20px] bg-crema-100 p-6 sm:p-10">
                <div className="grid gap-6 lg:grid-cols-[1fr_auto] lg:items-center lg:gap-10">
                  <div>
                    <h2 className="text-2xl sm:text-3xl">¿Buscas otro modelo o para otra fecha?</h2>
                    <p className="mt-2 max-w-xl text-cacao-500">
                      Todas nuestras tortas se piden en línea con día y horario de entrega, o puedes armar la tuya
                      paso a paso.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <ButtonLink href="/tortas">Ver todas las tortas</ButtonLink>
                    <ButtonLink href="/personalizadas" variant="outline">
                      Personaliza la tuya
                    </ButtonLink>
                  </div>
                </div>
              </section>
            </>
          ) : (
            <Unavailable confirmed={snapshot.fresh} />
          )}
        </FreshnessGuard>
      </div>
    </>
  );
}

function StoreSection({ store, anchor, yesterday }: { store: StoreStock; anchor: string; yesterday: string }) {
  const name = store.shortName ?? store.storeName;
  const count = units(store);
  const place = [store.address, store.district].filter(Boolean).join(" · ");
  const maps = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    [brand.name, store.address, store.district, brand.city].filter(Boolean).join(", "),
  )}`;

  return (
    <section id={anchor} aria-labelledby={`${anchor}-titulo`} className="scroll-mt-28">
      <div className="flex flex-col gap-4 border-b border-crema-300 pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-cacao-300">Tienda</p>
          <h2 id={`${anchor}-titulo`} className="mt-1 text-2xl sm:text-3xl">
            {name}
          </h2>
          {place && (
            <p className="mt-1.5 flex items-start gap-2 text-[15px] text-cacao-500">
              <IconPin className="mt-0.5 h-[18px] w-[18px] shrink-0 text-dorado-600" />
              {place}
            </p>
          )}
        </div>
        <div className="flex items-center justify-between gap-4 sm:justify-end">
          <p className="text-sm font-medium text-cacao-700">
            {count === 0 ? "Sin tortas listas" : `${count} ${count === 1 ? "torta lista" : "tortas listas"}`}
          </p>
          {store.address && (
            <a
              href={maps}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-11 shrink-0 items-center rounded-full border border-cacao/25 px-4 text-sm font-semibold text-cacao transition-colors hover:border-cacao hover:bg-crema-100"
            >
              Cómo llegar
            </a>
          )}
        </div>
      </div>

      {store.items.length > 0 ? (
        <div className="mt-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4">
          {store.items.map((item, i) => (
            <VitrinaCard key={`${item.sku}|${item.flavor ?? ""}|${i}`} item={item} storeName={name} yesterday={yesterday} />
          ))}
        </div>
      ) : (
        /* Loja vazia continua na página: quem ia sair de casa para essa loja
           precisa saber antes. */
        <div className="mt-6 flex flex-col gap-4 rounded-2xl border border-crema-300 bg-white p-5 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[15px] text-cacao-500">Por ahora no quedan tortas listas en esta tienda.</p>
          <WhatsappLink
            href={whatsappLink(`Hola ${brand.name}, ¿tienen alguna torta lista hoy en su tienda de ${name}?`)}
            store={name}
            className="h-11 px-5 text-sm"
          >
            Consultar por WhatsApp
          </WhatsappLink>
        </div>
      )}
    </section>
  );
}

/**
 * Sem estoque confirmado, a página diz isso — nunca inventa número.
 *
 * Dois casos: o leitor está calado (não sabemos) ou sabemos e não há nada.
 * Nos dois, a saída é a mesma: perguntar no WhatsApp ou comprar do catálogo
 * com entrega programada.
 */
function Unavailable({ confirmed }: { confirmed: boolean }) {
  return (
    <section className="card mx-auto max-w-2xl px-6 py-10 text-center sm:px-10">
      <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-dorado-100 text-dorado-600">
        <IconStore className="h-7 w-7" />
      </span>
      <h2 className="mt-5 text-2xl sm:text-3xl">
        {confirmed ? "Por ahora no hay tortas listas en tienda" : "Consulta disponibilidad por WhatsApp"}
      </h2>
      <p className="mx-auto mt-3 max-w-md text-[15px] leading-relaxed text-cacao-500">
        {confirmed
          ? "Las de hoy ya se vendieron o todavía están en camino a la tienda. Escríbenos y te decimos si llega alguna, o elige tu torta del catálogo con entrega programada."
          : "En este momento no podemos confirmar qué tortas quedan en nuestras tiendas. Escríbenos y te decimos qué hay listo para hoy, o elige tu torta del catálogo con entrega programada."}
      </p>
      <div className="mt-7 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
        <WhatsappLink
          href={whatsappLink(`Hola ${brand.name}, ¿qué tortas tienen listas hoy en tienda?`)}
          className="h-12 px-6 text-[15px]"
        >
          {confirmed ? "Consultar por WhatsApp" : "Consultar disponibilidad"}
        </WhatsappLink>
        <ButtonLink href="/tortas" variant="outline">
          Ver catálogo
        </ButtonLink>
      </div>
    </section>
  );
}

function units(store: StoreStock) {
  return store.items.reduce((sum, item) => sum + item.quantity, 0);
}

/** Âncora legível por loja ("calle-peru"), única mesmo com nomes repetidos. */
function withAnchors(stores: StoreStock[]) {
  const used = new Set<string>();
  return stores.map((store) => {
    const base =
      (store.shortName ?? store.storeName)
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "tienda";
    let anchor = base;
    for (let n = 2; used.has(anchor); n += 1) anchor = `${base}-${n}`;
    used.add(anchor);
    return { store, anchor };
  });
}
