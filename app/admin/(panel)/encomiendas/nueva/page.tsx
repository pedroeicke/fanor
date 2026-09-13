import type { Metadata } from "next";
import { suggestedPrice } from "@/lib/gestion/pricing";
import Link from "next/link";
import { PageHeader } from "@/components/admin/ui";
import { ContractForm } from "@/components/admin/encomiendas/ContractForm";
import { type Option, type ProductOption, type SellerOption } from "@/components/admin/encomiendas/shared";
import { limaToday } from "@/lib/gestion/dates";
import { getOperator, listStores, shortStoreName } from "@/lib/gestion/server";

export const metadata: Metadata = { title: "Nueva encomienda" };
export const dynamic = "force-dynamic";

type ProductRow = {
  id: string;
  sku: string | null;
  name: string;
  status: string;
  base_price: string | number | null;
  product_families: { tracks_serial: boolean; is_service: boolean } | null;
  product_sizes: { price: string | number; active: boolean }[];
};

function clock() {
  return { today: limaToday() };
}

/** "T26" antes de "T100": código do Sisgeco em ordem natural, como a vendedora conhece. */
const collator = new Intl.Collator("es", { numeric: true, sensitivity: "base" });

export default async function NewContractPage() {
  const op = await getOperator();
  if (!op) return <p className="card p-6">Sesión expirada. Vuelve a entrar.</p>;

  const { today } = clock();
  const [stores, sellers, products, flavors, decorators, cakeTypes] = await Promise.all([
    listStores(op.db),
    op.db.from("sellers").select("id, name, store_id").eq("active", true).order("name"),
    op.db
      .from("products")
      .select("id, sku, name, status, base_price, product_families(tracks_serial, is_service), product_sizes(price, active)")
      .eq("sold_at_counter", true)
      .order("name")
      .limit(2000),
    op.db.from("flavors").select("id, name").eq("active", true).order("sort_order").order("name"),
    op.db.from("decorators").select("id, name").eq("active", true).order("name"),
    op.db.from("cake_types").select("id, name").eq("active", true).order("sort_order").order("name"),
  ]);

  /* Adelanto e saldo (ADL/REIN) são serviço que o próprio sistema lança;
     vendê-los como linha da encomenda cobraria duas vezes. */
  const productOptions: ProductOption[] = ((products.data ?? []) as unknown as ProductRow[])
    .filter((p) => !p.product_families?.is_service)
    .map((p) => {
      const sizes = p.product_sizes.filter((s) => s.active).map((s) => Number(s.price));
      /* Sem IGV quando vem do Sisgeco: a regra mora em lib/gestion/pricing.ts,
         a mesma do balcão. Sem preço base, o menor tamanho do site. */
      const price = suggestedPrice(p) ?? (sizes.length ? Math.min(...sizes) : 0);
      return { id: p.id, sku: p.sku, name: p.name, price, isCake: Boolean(p.product_families?.tracks_serial) };
    })
    .sort((a, b) => Number(b.isCake) - Number(a.isCake) || collator.compare(a.sku ?? a.name, b.sku ?? b.name));

  const sellerOptions: SellerOption[] = ((sellers.data ?? []) as { id: string; name: string; store_id: string | null }[]).map((s) => ({
    id: s.id,
    name: s.name,
    storeId: s.store_id,
  }));

  const storeOptions: Option[] = stores.map((s) => ({ id: s.id, name: shortStoreName(s.name) }));
  const defaultStoreId = stores.find((s) => s.id === op.seller?.storeId)?.id ?? null;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Link href="/admin/encomiendas" className="inline-flex h-11 items-center text-sm text-terracota underline underline-offset-2">
        ← Encomiendas
      </Link>
      <PageHeader
        title="Nueva encomienda"
        description="Al registrar, el taller recibe la orden de producción de las tortas y el adelanto queda cobrado."
      />
      {storeOptions.length ? (
        <ContractForm
          stores={storeOptions}
          defaultStoreId={defaultStoreId}
          sellers={sellerOptions}
          defaultSellerId={op.seller?.id ?? null}
          products={productOptions}
          flavors={(flavors.data ?? []) as Option[]}
          decorators={(decorators.data ?? []) as Option[]}
          cakeTypes={(cakeTypes.data ?? []) as Option[]}
          today={today}
        />
      ) : (
        <p className="card p-6 text-sm text-cacao-500">No hay tiendas activas con prefijo de serie. Configúralas antes de registrar encomiendas.</p>
      )}
    </div>
  );
}
