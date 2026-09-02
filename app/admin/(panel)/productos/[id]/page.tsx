import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase-server";
import { ProductForm } from "@/components/admin/ProductForm";
import { ImageManager } from "@/components/admin/ImageManager";
import { DeleteProduct } from "@/components/admin/DeleteProduct";
import { ProductTaxonomy } from "@/components/admin/ProductTaxonomy";
import { IconChevron } from "@/components/ui/icons";

export const metadata: Metadata = { title: "Editar producto" };

export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await getServerSupabase();
  if (!db) return <p className="card p-6">Falta configurar la base de datos.</p>;

  const [{ data }, { data: categories }] = await Promise.all([
    db
      .from("products")
      .select("*, product_sizes(*), product_flavors(*), product_images(*), product_categories(category_id)")
      .eq("id", id)
      .maybeSingle(),
    db.from("categories").select("id, slug, name, kind").order("kind").order("sort_order"),
  ]);

  if (!data) notFound();

  const selectedCategoryIds = (data.product_categories ?? []).map(
    (c: { category_id: string }) => c.category_id,
  );

  return (
    <>
      <nav aria-label="Migas de pan" className="flex items-center gap-1.5 text-sm text-cacao-300">
        <Link href="/admin/productos" className="hover:text-cacao">Productos</Link>
        <IconChevron className="h-3.5 w-3.5" />
        <span className="text-cacao-500">{data.name}</span>
      </nav>

      <div className="mt-5 space-y-6">
        <ProductForm product={data} />
        <ProductTaxonomy
          productId={data.id}
          sizes={(data.product_sizes ?? []).map((z: { price: number }) => ({
            ...z,
            price: String(z.price),
          }))}
          flavors={data.product_flavors ?? []}
          categories={categories ?? []}
          selectedCategoryIds={selectedCategoryIds}
        />
        <ImageManager productId={data.id} images={data.product_images ?? []} />
        <DeleteProduct id={data.id} name={data.name} />
      </div>
    </>
  );
}
