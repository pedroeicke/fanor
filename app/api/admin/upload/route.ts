import { NextResponse } from "next/server";
import { getAdminUser, getServerSupabase } from "@/lib/supabase-server";
import { PRODUCT_BUCKET, uploadImage } from "@/lib/storage";

/**
 * Upload de imagem de produto pelo painel.
 *
 * É rota e não server action porque server actions não recebem arquivo grande
 * com conforto — o corpo passa serializado e o limite padrão é apertado.
 *
 * Aceita um conjunto inteiro de uma vez: os 30 quadros de um giro 360° não
 * podem exigir 30 uploads manuais.
 */
export async function POST(request: Request) {
  const user = await getAdminUser();
  if (!user) return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  const db = await getServerSupabase();
  if (!db) return NextResponse.json({ error: "Sin conexión." }, { status: 503 });

  const form = await request.formData();
  const productId = String(form.get("productId") ?? "");
  const kind = form.get("kind") === "spin360" ? "spin360" : "gallery";
  const files = form.getAll("files").filter((f): f is File => f instanceof File);

  if (!productId) return NextResponse.json({ error: "Falta el producto." }, { status: 400 });
  if (!files.length) return NextResponse.json({ error: "No hay archivos." }, { status: 400 });

  const { data: product } = await db
    .from("products")
    .select("id, slug")
    .eq("id", productId)
    .maybeSingle();

  if (!product) return NextResponse.json({ error: "Producto no encontrado." }, { status: 404 });

  /* Nome do arquivo define a ordem do giro (RV_01 … RV_30). Ordenação
     numérica: sem ela, "10" viria antes de "2". */
  const ordered = [...files].sort((a, b) =>
    a.name.localeCompare(b.name, "en", { numeric: true }),
  );

  /* Um conjunto 360° substitui o anterior por inteiro: misturar quadros de
     duas sessões de foto produz um giro que salta. */
  if (kind === "spin360") {
    await db.from("product_images").delete().eq("product_id", productId).eq("kind", "spin360");
  }

  const { data: last } = await db
    .from("product_images")
    .select("sort_order")
    .eq("product_id", productId)
    .eq("kind", kind)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  let next = (last?.sort_order ?? -1) + 1;
  const uploaded: string[] = [];
  const failures: string[] = [];

  for (const file of ordered) {
    const result = await uploadImage(PRODUCT_BUCKET, file, `${product.slug}/${kind}`);
    if (!result.ok) {
      failures.push(`${file.name}: ${result.error}`);
      continue;
    }

    const { error } = await db.from("product_images").insert({
      product_id: productId,
      url: result.url,
      alt: kind === "spin360" && next > 0 ? null : product.slug.replace(/-/g, " "),
      kind,
      width: 1080,
      height: 1080,
      sort_order: next++,
    });

    if (error) failures.push(`${file.name}: ${error.message}`);
    else uploaded.push(result.url);
  }

  return NextResponse.json({ uploaded: uploaded.length, failures });
}
