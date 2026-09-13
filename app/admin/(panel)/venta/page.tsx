import type { Metadata } from "next";
import Link from "next/link";
import { getOperator, listStores, shortStoreName } from "@/lib/gestion/server";
import { Notice, PageHeader } from "@/components/admin/ui";
import { SaleCounter } from "@/components/admin/venta/SaleCounter";
import type { SellerOption } from "@/components/admin/venta/types";

export const metadata: Metadata = { title: "Vender" };
export const dynamic = "force-dynamic";

/**
 * Balcão: escanear a torta ou escolher o produto, cliente opcional, cobrar
 * com pagamento misto e vuelto.
 *
 * A página só carrega o que não muda durante o atendimento (lojas e
 * vendedoras). Carrinho, busca e cobrança vivem no cliente e nas ações —
 * um F5 no meio da venda não pode custar o carrinho.
 */
export default async function VentaPage() {
  const op = await getOperator();
  if (!op) return <Notice tone="bad">Sesión expirada. Vuelve a entrar.</Notice>;

  const [stores, { data: sellerRows, error }] = await Promise.all([
    listStores(op.db),
    op.db
      .from("sellers")
      .select("id, name, store_id, role")
      .eq("active", true)
      /* Quem é do taller não vende no balcão. */
      .neq("role", "workshop")
      .order("name"),
  ]);

  const header = (
    <PageHeader
      title="Vender"
      description="Escanea la etiqueta de la torta o busca el producto. El precio incluye IGV."
      actions={
        <Link
          href="/admin/ventas"
          className="inline-flex h-11 items-center rounded-full border border-crema-300 bg-white px-5 text-sm font-semibold text-cacao-700 hover:border-cacao/35"
        >
          Ventas de hoy
        </Link>
      }
    />
  );

  if (!stores.length) {
    return (
      <div className="space-y-6">
        {header}
        <Notice tone="warn">
          No hay tiendas habilitadas para vender. Cada tienda necesita su prefijo de serie (G, D…) para vender por
          etiqueta; pide al administrador que lo configure.
        </Notice>
      </div>
    );
  }

  const sellers: SellerOption[] = ((sellerRows ?? []) as { id: string; name: string; store_id: string | null }[]).map(
    (s) => ({ id: s.id, name: s.name, storeId: s.store_id }),
  );
  const defaultStoreId = stores.find((s) => s.id === op.seller?.storeId)?.id ?? stores[0].id;

  return (
    <div className="space-y-6">
      {header}
      {error && <Notice tone="warn">No se pudo cargar la lista de vendedoras. Puedes vender igual.</Notice>}
      <SaleCounter
        stores={stores.map((s) => ({ id: s.id, name: shortStoreName(s.name) }))}
        sellers={sellers}
        defaultStoreId={defaultStoreId}
        defaultSellerId={op.seller?.id ?? null}
      />
    </div>
  );
}
