import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { getServerSupabase } from "@/lib/supabase-server";
import { cdnImage, soles } from "@/lib/format";
import { StatusToggle } from "@/components/admin/StatusToggle";
import { IconChevron, IconPlus, IconSearch } from "@/components/ui/icons";

export const metadata: Metadata = { title: "Productos" };

type Row = {
  id: string;
  slug: string;
  sku: string | null;
  name: string;
  status: string;
  kind: string;
  base_price: string | null;
  product_sizes: { price: string }[];
  product_images: { url: string; kind: string; sort_order: number }[];
};

const STATUS_LABEL: Record<string, string> = {
  active: "Publicado",
  draft: "Borrador",
  unavailable: "Agotado",
};

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; estado?: string }>;
}) {
  const { q, estado } = await searchParams;
  const db = await getServerSupabase();

  if (!db) {
    return (
      <p className="card p-6 text-[15px]">
        Falta configurar la conexión con la base de datos.
      </p>
    );
  }

  let query = db
    .from("products")
    .select("id, slug, sku, name, status, kind, base_price, product_sizes(price), product_images(url, kind, sort_order)")
    .order("name", { ascending: true });

  /* O painel lista rascunhos e esgotados também — por isso lê a tabela
     inteira, e não o catálogo público. */
  if (estado && estado !== "todos") query = query.eq("status", estado);
  if (q) query = query.ilike("name", `%${q}%`);

  const { data, error } = await query;
  const products = (data ?? []) as unknown as Row[];

  if (error) {
    return (
      <p role="alert" className="card p-6 text-[15px] text-terracota-700">
        No pudimos cargar los productos: {error.message}
      </p>
    );
  }

  const counts = { todos: products.length };

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <form className="relative flex h-11 flex-1 items-center sm:max-w-xs">
          <IconSearch className="pointer-events-none absolute left-3.5 h-4 w-4 text-cacao-300" />
          <input
            name="q"
            type="search"
            defaultValue={q ?? ""}
            placeholder="Buscar por nombre..."
            className="h-full w-full rounded-full border border-crema-300 bg-white pl-10 pr-4 text-sm placeholder:text-cacao-300 focus:border-dorado-600"
          />
          {estado && <input type="hidden" name="estado" value={estado} />}
        </form>

        <div className="flex gap-2">
          {["todos", "active", "draft", "unavailable"].map((s) => (
            <Link
              key={s}
              href={`/admin/productos?estado=${s}${q ? `&q=${encodeURIComponent(q)}` : ""}`}
              className={`h-9 rounded-full border px-4 text-[13px] font-medium leading-[2.15rem] transition-colors ${
                (estado ?? "todos") === s
                  ? "border-cacao bg-cacao text-crema"
                  : "border-crema-300 bg-white text-cacao-700 hover:border-cacao/35"
              }`}
            >
              {s === "todos" ? "Todos" : STATUS_LABEL[s]}
            </Link>
          ))}
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between gap-4">
        <p className="text-sm text-cacao-500">
          {counts.todos} {counts.todos === 1 ? "producto" : "productos"}
        </p>
        <Link
          href="/admin/productos/nuevo"
          className="inline-flex h-10 items-center gap-1.5 rounded-full bg-dorado px-5 text-sm font-semibold text-cacao transition-colors hover:bg-dorado-600"
        >
          <IconPlus className="h-4 w-4" />
          Nuevo producto
        </Link>
      </div>

      <ul className="mt-3 space-y-2">
        {products.map((p) => {
          const cover = p.product_images
            .filter((i) => i.kind === "gallery")
            .sort((a, b) => a.sort_order - b.sort_order)[0];
          const prices = p.product_sizes.map((s) => Number(s.price));
          const from = prices.length ? Math.min(...prices) : Number(p.base_price ?? 0);
          const spin = p.product_images.some((i) => i.kind === "spin360");

          return (
            <li key={p.id} className="card flex items-center gap-4 p-3">
              <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-crema-100">
                {cover && (
                  <Image
                    src={cdnImage(cover.url, 128)}
                    alt=""
                    fill
                    sizes="56px"
                    className="object-cover"
                  />
                )}
              </div>

              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-baseline gap-x-2 font-display text-[1.05rem] leading-snug">
                  {p.name}
                  {spin && (
                    <span className="rounded-full bg-dorado-100 px-2 py-0.5 font-sans text-[10px] font-bold text-dorado-600">
                      360°
                    </span>
                  )}
                </p>
                <p className="mt-0.5 text-[13px] text-cacao-300">
                  {p.sku ? `SKU ${p.sku}` : "sin SKU"} · {p.kind === "variable" ? "variable" : p.kind === "custom" ? "personalizado" : "simple"}
                </p>
              </div>

              <p className="hidden shrink-0 text-sm font-medium sm:block">
                {prices.length > 1 && <span className="text-cacao-300">desde </span>}
                {soles(from)}
              </p>

              <StatusToggle id={p.id} status={p.status} name={p.name} />

              <Link
                href={`/admin/productos/${p.id}`}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-crema-300 text-cacao-700 hover:border-cacao/35"
                aria-label={`Editar ${p.name}`}
              >
                <IconChevron className="h-4 w-4" />
              </Link>
            </li>
          );
        })}
      </ul>

      {products.length === 0 && (
        <p className="mt-6 rounded-2xl border border-dashed border-crema-300 px-6 py-14 text-center text-cacao-500">
          Ningún producto coincide con esa búsqueda.
        </p>
      )}
    </>
  );
}
