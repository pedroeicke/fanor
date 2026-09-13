import Image from "next/image";
import Link from "next/link";
import type { StockItem } from "@/lib/stock";
import { brand, siteUrl, whatsappLink } from "@/lib/config";
import { cdnImage, solesShort } from "@/lib/format";
import { Flourish, IconCake } from "@/components/ui/icons";
import { CakePhotos } from "./CakePhotos";
import { WhatsappLink } from "./WhatsappLink";

/* Duas colunas no celular, três no notebook, quatro no desktop largo. */
const SIZES = "(min-width:1280px) 300px, (min-width:1024px) 33vw, 50vw";

/**
 * Card de uma torta que está na loja agora.
 *
 * Diferente do ProductCard do catálogo: aqui a ação não é "ver detalles e
 * comprar com entrega", é "reservar esta, que já existe". Por isso o botão
 * principal é o WhatsApp com a mensagem pronta — a vendedora recebe nome,
 * sabor e loja sem precisar perguntar.
 */
export function VitrinaCard({
  item,
  storeName,
  yesterday,
}: {
  item: StockItem;
  storeName: string;
  /** Ontem no calendário de Lima, calculado uma vez pela página. */
  yesterday: string;
}) {
  const photos = item.photos ?? [];
  const flavorText = item.flavor ? ` sabor ${item.flavor}` : "";
  const fresh = freshnessLabel(item, yesterday);
  const productHref = item.slug ? `/tortas/${item.slug}` : null;

  return (
    <article className="card flex flex-col overflow-hidden">
      <div className="relative aspect-[4/5] overflow-hidden bg-crema-100">
        {photos.length > 0 ? (
          <CakePhotos
            sizes={SIZES}
            label={`Fotos reales de ${item.name}${flavorText}. Desliza para ver las ${photos.length}.`}
            photos={photos.map((src, i) => ({
              src,
              alt: `Foto real de ${item.name}${flavorText} en tienda${photos.length > 1 ? `, ${i + 1} de ${photos.length}` : ""}`,
            }))}
          />
        ) : item.image ? (
          <Image
            src={cdnImage(item.image, 640)}
            alt={`${item.name}, foto referencial del catálogo`}
            fill
            sizes={SIZES}
            className="object-cover"
          />
        ) : (
          /* Torta sem foto nenhuma (cadastro do balcão ainda não vinculado ao
             site): ilustração no lugar, nunca foto de outra torta. */
          <div aria-hidden="true" className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-gradient-to-br from-crema-100 via-crema-200 to-dorado-100 text-dorado-600">
            <IconCake className="h-12 w-12" />
            <Flourish className="h-3 w-16" />
          </div>
        )}

        {/* A cliente precisa saber se o que vê é a torta dela ou uma
            referência — prometer a decoração da foto do catálogo gera
            reclamação no balcão. */}
        {(photos.length > 0 || item.image) && (
          <span className="pointer-events-none absolute left-2.5 top-2.5 rounded-full bg-cacao/85 px-2.5 py-1 text-[11px] font-semibold text-crema backdrop-blur-sm">
            {photos.length > 0 ? "Foto real" : "Foto referencial"}
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col p-3 sm:p-4">
        <h3 className="font-display text-[1rem] leading-snug sm:text-[1.05rem]">
          {productHref ? (
            <Link href={productHref} className="underline-offset-4 hover:underline">
              {item.name}
            </Link>
          ) : (
            item.name
          )}
        </h3>
        {item.flavor && <p className="mt-0.5 text-sm text-cacao-500">Sabor {item.flavor}</p>}

        <ul className="mt-2.5 flex flex-wrap gap-1.5 text-[12px] font-semibold leading-none">
          <li className="rounded-full bg-verde-100 px-2.5 py-1.5 tabular-nums text-verde">
            {item.quantity} {item.quantity === 1 ? "disponible" : "disponibles"}
          </li>
          {fresh && <li className="rounded-full bg-dorado-100 px-2.5 py-1.5 text-cacao-700">{fresh}</li>}
        </ul>

        {item.price !== null && (
          <p className="mt-2.5 font-display text-[1.05rem] font-semibold text-terracota">{solesShort(item.price)}</p>
        )}

        <div className="mt-auto pt-3">
          <WhatsappLink
            href={whatsappLink(reserveMessage(item, storeName))}
            label={`Reservar ${item.name}${flavorText} en ${storeName} por WhatsApp`}
            item={item.name}
            store={storeName}
            className="h-11 w-full px-3 text-sm"
          >
            {/* No card de 165 px do celular, o texto longo quebraria em duas linhas. */}
            <span className="sm:hidden">Reservar</span>
            <span className="hidden sm:inline">Reservar por WhatsApp</span>
          </WhatsappLink>
          {productHref && (
            <Link
              href={productHref}
              className="mt-1 flex h-11 items-center justify-center text-sm font-medium text-cacao-700 underline-offset-4 hover:text-cacao hover:underline"
            >
              Ver detalles
            </Link>
          )}
        </div>
      </div>
    </article>
  );
}

/**
 * "Preparada hoy" / "Preparada ayer", só quando é verdade para o grupo todo.
 *
 * `producedOn` é a produção mais antiga das unidades: se uma é de ontem, o
 * card diz "ayer" mesmo que as outras sejam de hoje. Redecorada não ganha
 * selo — a data dela é a da decoração nova, não a da base.
 */
function freshnessLabel(item: StockItem, yesterday: string) {
  if (item.producedToday) return "Preparada hoy";
  if (!item.redecorated && item.producedOn === yesterday) return "Preparada ayer";
  return null;
}

/** Mensagem pronta: a vendedora sabe qual torta separar sem perguntar. */
function reserveMessage(item: StockItem, storeName: string) {
  const flavor = item.flavor ? `, sabor ${item.flavor},` : "";
  const link = item.slug ? `\n${siteUrl}/tortas/${item.slug}` : "";
  return `Hola ${brand.name}, quiero reservar la torta *${item.name}*${flavor} que vi disponible hoy en su tienda de ${storeName}. ¿Me la pueden separar?${link}`;
}
