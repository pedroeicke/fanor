import type { Metadata } from "next";
import { getOperator } from "@/lib/gestion/server";
import { limaDateTime } from "@/lib/gestion/dates";
import { isSerial } from "@/lib/gestion/qr";
import { getCakeOption, getProductOption, isPhotoAiEnabled } from "@/lib/photo/queries";
import { PHOTO_RECORD_COLUMNS, UUID_RE, type PhotoHistoryItem, type PhotoRecord } from "@/lib/photo/types";
import { Notice, PageHeader } from "@/components/admin/ui";
import { PhotoStudio } from "@/components/admin/fotos/PhotoStudio";

export const metadata: Metadata = { title: "Fotos con IA" };
export const dynamic = "force-dynamic";

/**
 * Fotos com IA: a vendedora fotografa a torta no celular e o sistema devolve
 * a foto pronta para a vitrine, com nota e conselho para a próxima.
 *
 * Aceita destino pela URL, para outras telas mandarem direto para cá:
 * `?serie=G0000100001` (botão "Foto" da vitrina da loja) ou
 * `?producto=<id>` (ficha do produto).
 */
export default async function PhotosPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const op = await getOperator();
  if (!op) return <p className="card p-6">Sesión expirada. Vuelve a entrar.</p>;

  const serial = first(params.serie)?.trim().toUpperCase() ?? "";
  const productId = first(params.producto)?.trim() ?? "";

  const [{ data: rows, error }, initialProduct, initialCake] = await Promise.all([
    op.db.from("photo_treatments").select(PHOTO_RECORD_COLUMNS).order("created_at", { ascending: false }).limit(30),
    UUID_RE.test(productId) ? getProductOption(op.db, productId) : Promise.resolve(null),
    isSerial(serial) ? getCakeOption(op.db, serial) : Promise.resolve(null),
  ]);

  const history: PhotoHistoryItem[] = ((rows ?? []) as PhotoRecord[]).map((row) => ({
    ...row,
    createdLabel: limaDateTime(row.created_at),
  }));

  const aiEnabled = isPhotoAiEnabled();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Fotos con IA"
        description="Toma la foto de la torta con el celular: sale recortada en 4:5, con luz y nitidez corregidas, lista para el sitio o la vitrina."
      />

      {!aiEnabled && <Notice tone="warn">IA desactivada: se aplica solo el ajuste automático.</Notice>}
      {error && <Notice tone="bad">No se pudo cargar el historial de fotos. Recarga la página.</Notice>}
      {productId && !initialProduct && <Notice tone="warn">El producto del enlace no existe. Búscalo abajo.</Notice>}
      {serial && !initialCake && (
        <Notice tone="warn">
          {isSerial(serial) ? `No existe la torta ${serial}.` : "La serie del enlace no es válida."} Escanea la etiqueta abajo.
        </Notice>
      )}

      {/* A chave remonta a tela quando outro link traz outro destino; o
          refresh depois de cada foto não muda a chave e preserva o estado. */}
      <PhotoStudio
        key={`${initialProduct?.id ?? ""}|${initialCake?.serial ?? ""}`}
        aiEnabled={aiEnabled}
        history={history}
        initialProduct={initialProduct}
        initialCake={initialCake}
      />
    </div>
  );
}

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
