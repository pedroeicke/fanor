import { NextResponse } from "next/server";
import { getStockSnapshot } from "@/lib/stock";
import type { VitrinaApiResponse, VitrinaApiStore } from "@/components/vitrina/types";

/**
 * Estoque da vitrine em JSON, para o selo da página de produto.
 *
 * A página de produto é estática; o selo pergunta daqui, pelo navegador, se
 * a torta está no balcão hoje. O CDN guarda a resposta por um minuto — o
 * mesmo ritmo de `/vitrina` —, então mil visitas a um produto custam uma
 * leitura do banco por minuto, não mil.
 *
 * Sai só o que a vitrine mostra: nome, sabor, quantidade, loja, preço e foto.
 * Série, id de loja e código do Sisgeco ficam no servidor.
 */

const CACHE_HEADERS = { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" };

/* Slug do catálogo: minúsculas, dígitos e hífen. Qualquer outra coisa é
   engano ou sonda, e não merece ida ao banco. */
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("slug")?.trim() ?? "";
  if (raw && (raw.length > 120 || !SLUG.test(raw))) {
    return NextResponse.json({ error: "Parámetro slug inválido." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  const slug = raw || null;

  const snapshot = await getStockSnapshot();
  const body: VitrinaApiResponse = { fresh: snapshot.fresh, total: 0, stores: [], generatedAt: new Date().toISOString() };

  if (snapshot.fresh) {
    for (const store of snapshot.stores) {
      const items = store.items
        .filter((item) => !slug || item.slug === slug)
        .map((item) => ({
          name: item.name,
          slug: item.slug,
          flavor: item.flavor ?? null,
          quantity: item.quantity,
          price: item.price,
          image: item.image,
          producedToday: item.producedToday === true,
        }));
      if (!items.length) continue;

      const quantity = items.reduce((sum, item) => sum + item.quantity, 0);
      const publicStore: VitrinaApiStore = {
        name: store.shortName ?? store.storeName,
        address: store.address ?? null,
        district: store.district ?? null,
        quantity,
        items,
      };
      body.stores.push(publicStore);
      body.total += quantity;
    }
  }

  return NextResponse.json(body, { headers: CACHE_HEADERS });
}
