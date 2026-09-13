"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { applyPhotoToCake, applyPhotoToProduct } from "@/app/admin/(panel)/fotos/actions";
import { cx } from "@/lib/format";
import type { CakeOption, PhotoHistoryItem, PhotoRecord, ProductOption } from "@/lib/photo/types";
import { Notice, Section } from "@/components/admin/ui";
import { IconCamera } from "@/components/ui/icons";
import { BeforeAfter } from "./BeforeAfter";
import { DestinationPanel, type DestinationMode } from "./DestinationPanel";
import { PhotoHistory } from "./PhotoHistory";
import { PhotoReportPanel } from "./PhotoReportPanel";
import { initialAlt } from "./shared";
import { UploadError, sendPhoto, type UploadProgress, type UploadTarget } from "./upload";

/**
 * Tela inteira de fotos: tirar, ver o resultado, usar.
 *
 * Três passos numa coluna, porque é usada no celular com a torta na frente:
 * o botão grande de câmera é a ação até existir foto; depois disso a ação
 * passa a ser "usar a foto", e a câmera vira "tomar otra".
 */
export function PhotoStudio({
  aiEnabled,
  history,
  initialProduct,
  initialCake,
}: {
  aiEnabled: boolean;
  history: PhotoHistoryItem[];
  initialProduct: ProductOption | null;
  initialCake: CakeOption | null;
}) {
  const router = useRouter();
  const resultRef = useRef<HTMLElement>(null);
  const previewRef = useRef<string | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [photo, setPhoto] = useState<PhotoRecord | null>(null);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const [mode, setMode] = useState<DestinationMode>(initialCake && !initialProduct ? "cake" : "product");
  const [product, setProduct] = useState<ProductOption | null>(initialProduct);
  const [cake, setCake] = useState<CakeOption | null>(initialCake);
  const [alt, setAlt] = useState("");
  const [applying, startApply] = useTransition();
  const [applyError, setApplyError] = useState<string | null>(null);
  const [applied, setApplied] = useState<{ message: string; href: string; linkLabel: string } | null>(null);
  /* Enquanto sobe ou aplica, nada troca a foto da tela: o aviso de sucesso
     cairia sobre a foto errada. */
  const busy = uploading || applying;

  /* A URL local da foto segura o arquivo inteiro na memória do celular. */
  useEffect(() => () => {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
  }, []);

  function replacePreview(next: File | null) {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = next ? URL.createObjectURL(next) : null;
    setPreview(previewRef.current);
  }

  function uploadTarget(): UploadTarget {
    if (mode === "product" && product) return { type: "product", productId: product.id };
    if (mode === "cake" && cake && !cake.blockedReason) return { type: "cake_unit", serial: cake.serial };
    return { type: "none" };
  }

  async function start(next: File) {
    if (busy) return;
    replacePreview(next);
    setFile(next);
    setPhoto(null);
    setUploadError(null);
    setApplyError(null);
    setApplied(null);
    setUploading(true);
    setProgress({ stage: "uploading", progress: 0 });
    window.requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));

    try {
      const record = await sendPhoto(next, uploadTarget(), setProgress);
      setPhoto(record);
      setAlt(initialAlt(record));
      router.refresh();
    } catch (error) {
      const failure = error instanceof UploadError ? error : null;
      setUploadError(failure?.message ?? "No se pudo tratar la foto. Inténtalo de nuevo.");
      if (failure?.photo) {
        setPhoto(failure.photo);
        router.refresh();
      }
    } finally {
      setUploading(false);
      setProgress(null);
    }
  }

  function onPick(event: React.ChangeEvent<HTMLInputElement>) {
    const next = event.target.files?.[0];
    /* Zera o campo: escolher a mesma foto de novo precisa disparar outra vez. */
    event.target.value = "";
    if (next) void start(next);
  }

  function openFromHistory(item: PhotoHistoryItem) {
    if (busy) return;
    replacePreview(null);
    setFile(null);
    setPhoto(item);
    setAlt(initialAlt(item));
    setUploadError(item.status === "failed" ? item.error ?? "No se pudo tratar esta foto." : null);
    setApplyError(null);
    setApplied(null);
    window.requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  function reset() {
    replacePreview(null);
    setFile(null);
    setPhoto(null);
    setAlt("");
    setUploadError(null);
    setApplyError(null);
    setApplied(null);
  }

  const ready = photo?.status === "done" && Boolean(photo.processed_url);
  const destinationBlocked = mode === "cake" && Boolean(cake?.blockedReason);
  const hasDestination = mode === "product" ? Boolean(product) : Boolean(cake) && !destinationBlocked;
  const canApply = ready && hasDestination && !busy;

  function apply() {
    if (!photo || !canApply) return;
    setApplyError(null);
    setApplied(null);
    const current = photo;
    const altText = alt;

    startApply(async () => {
      try {
        await applyTo(current, altText);
      } catch (error) {
        /* Ação que nem chegou ao servidor (4G caiu) lança erro. Sem este
           catch o React levaria a tela ao limite de erro e a vendedora
           perderia a foto, o destino e o texto que já tinha revisado. */
        console.error("[fotos] aplicar", error);
        setApplyError("Sin conexión. Revisa tu internet y vuelve a tocar el botón.");
      }
    });
  }

  async function applyTo(current: PhotoRecord, altText: string) {
    if (mode === "product" && product) {
      const result = await applyPhotoToProduct({ photoId: current.id, productId: product.id, alt: altText });
      if (!result.ok) {
        setApplyError(result.error);
        return;
      }
      markUsed(current.id, { type: "product", id: product.id, label: product.name, alt: altText });
      setApplied({
        message: `Listo: la foto ya está en la galería de ${result.data.productName}.`,
        href: `/admin/productos/${result.data.productId}`,
        linkLabel: "Ver producto",
      });
    } else if (mode === "cake" && cake) {
      const result = await applyPhotoToCake({ photoId: current.id, serial: cake.serial, alt: altText });
      if (!result.ok) {
        setApplyError(result.error);
        return;
      }
      if (!result.data.unchanged) {
        markUsed(current.id, { type: "cake_unit", id: cake.id, label: cake.serial, alt: altText });
        setCake({ ...cake, photoUrl: current.processed_url });
      }
      setApplied({
        message: result.data.unchanged
          ? `La torta ${result.data.serial} ya tenía esta foto.`
          : `Listo: la torta ${result.data.serial} (${result.data.productName}) ya muestra esta foto.`,
        href: "/admin/tienda",
        linkLabel: "Ver mi vitrina",
      });
    }
    router.refresh();
  }

  /* Reflete o uso na hora, sem esperar o refresh do servidor. Atualização
     por função: se a foto na tela já for outra, ela não é sobrescrita. */
  function markUsed(photoId: string, use: { type: "product" | "cake_unit"; id: string; label: string; alt: string }) {
    const entry = { ...use, at: new Date().toISOString() };
    setPhoto((prev) =>
      prev?.id === photoId && prev.report
        ? { ...prev, report: { ...prev.report, applied: [...(prev.report.applied ?? []), entry] } }
        : prev,
    );
  }

  const hasResult = Boolean(preview || photo || uploading);
  const percent = progress?.stage === "uploading" ? Math.round(progress.progress * 100) : null;
  const applyLabel = applying
    ? "Guardando…"
    : mode === "product"
      ? product
        ? `Agregar a la galería de ${product.name}`
        : "Elige un producto"
      : cake && !destinationBlocked
        ? `Usar como foto de la torta ${cake.serial}`
        : "Escanea una torta";

  return (
    <div className="space-y-6">
      {/* 1. Foto ------------------------------------------------------------ */}
      <section className="card space-y-4 p-4 sm:p-5">
        <div>
          <h3 className="font-display text-lg">1. Toma la foto</h3>
          <p className="mt-1 text-[13px] text-cacao-500">
            Torta entera, de frente y un poco desde arriba. Luz natural y fondo limpio.
          </p>
        </div>

        <div className={cx("grid gap-2", hasResult && "sm:grid-cols-2")}>
          <label
            aria-disabled={busy}
            className={cx(
              "flex cursor-pointer items-center justify-center gap-2 rounded-2xl font-semibold transition-colors",
              hasResult
                ? "h-12 border border-cacao/25 bg-white text-cacao hover:border-cacao/40"
                : "h-16 bg-dorado text-base text-cacao hover:bg-dorado-600",
              busy && "pointer-events-none opacity-50",
            )}
          >
            <IconCamera className="h-5 w-5" />
            {hasResult ? "Tomar otra foto" : "Tomar foto"}
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              disabled={busy}
              onChange={onPick}
            />
          </label>
          <label
            aria-disabled={busy}
            className={cx(
              "flex h-12 cursor-pointer items-center justify-center rounded-2xl border border-crema-300 bg-white text-[15px] font-medium text-cacao-700 transition-colors hover:border-cacao/35",
              busy && "pointer-events-none opacity-50",
            )}
          >
            Elegir de la galería
            <input type="file" accept="image/*" className="sr-only" disabled={busy} onChange={onPick} />
          </label>
        </div>

        {progress && (
          <div role="status" aria-live="polite" className="space-y-2">
            <p className="flex items-center justify-between gap-3 text-sm text-cacao-700">
              <span>
                {progress.stage === "uploading"
                  ? "Subiendo la foto…"
                  : aiEnabled
                    ? "La IA revisa encuadre, luz y nitidez…"
                    : "Ajustando recorte, luz y nitidez…"}
              </span>
              {percent !== null && <span className="tabular-nums text-cacao-500">{percent}%</span>}
            </p>
            <div className="h-2 overflow-hidden rounded-full bg-crema-200">
              {percent !== null ? (
                <div className="h-full rounded-full bg-dorado transition-[width] duration-200" style={{ width: `${percent}%` }} />
              ) : (
                <div className="h-full w-full animate-pulse rounded-full bg-dorado/70" />
              )}
            </div>
            {progress.stage === "processing" && (
              <p className="text-[12px] text-cacao-300">Suele tardar entre 10 y 30 segundos. No cierres la pantalla.</p>
            )}
          </div>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
        {/* 2. Resultado ------------------------------------------------------ */}
        {hasResult && (
          <section ref={resultRef} className="card scroll-mt-4 space-y-4 p-4 sm:p-5">
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-display text-lg">2. Resultado</h3>
              {photo && !busy && (
                <button
                  type="button"
                  onClick={reset}
                  className="h-11 rounded-full px-3 text-sm font-medium text-cacao-500 hover:text-cacao"
                >
                  Limpiar
                </button>
              )}
            </div>

            <BeforeAfter preview={preview} photo={photo} processing={uploading} />

            {uploadError && (
              <Notice tone="bad">
                <p>{uploadError}</p>
                {file && !busy && (
                  <button
                    type="button"
                    onClick={() => void start(file)}
                    className="mt-2 h-11 rounded-full border border-terracota/40 bg-white px-4 text-sm font-semibold text-terracota-700"
                  >
                    Intentar de nuevo
                  </button>
                )}
              </Notice>
            )}

            {ready && photo?.report && (
              <>
                <PhotoReportPanel report={photo.report} alt={alt} onAltChange={setAlt} disabled={applying} />
                {photo.processed_url && (
                  <a
                    href={photo.processed_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-11 items-center text-sm font-medium text-cacao-500 underline underline-offset-4 hover:text-cacao"
                  >
                    Ver en tamaño real ({photo.width}×{photo.height})
                  </a>
                )}
              </>
            )}
          </section>
        )}

        {/* 3. Destino -------------------------------------------------------- */}
        <section className={cx("card space-y-4 p-4 sm:p-5", !hasResult && "lg:col-span-2")}>
          <div>
            <h3 className="font-display text-lg">{hasResult ? "3." : "2."} Usar la foto en</h3>
            <p className="mt-1 text-[13px] text-cacao-500">
              {mode === "product"
                ? "Se agrega al final de la galería del producto en el sitio."
                : "Es la foto que la vitrina muestra para esa torta."}
            </p>
          </div>

          <DestinationPanel
            mode={mode}
            onModeChange={(next) => {
              setMode(next);
              setApplyError(null);
              setApplied(null);
            }}
            product={product}
            onProductChange={(next) => {
              setProduct(next);
              setApplyError(null);
              setApplied(null);
            }}
            cake={cake}
            onCakeChange={(next) => {
              setCake(next);
              setApplyError(null);
              setApplied(null);
            }}
            disabled={applying}
          />

          {applyError && <Notice tone="bad">{applyError}</Notice>}
          {applied && (
            <Notice tone="ok">
              <p>{applied.message}</p>
              <Link href={applied.href} className="mt-1 inline-flex h-11 items-center font-semibold underline underline-offset-4">
                {applied.linkLabel}
              </Link>
            </Notice>
          )}

          <button
            type="button"
            onClick={apply}
            disabled={!canApply}
            className={cx(
              "flex min-h-14 w-full items-center justify-center rounded-2xl px-4 py-3 text-center text-base font-semibold transition-colors",
              canApply ? "bg-cacao text-crema hover:bg-cacao-700" : "bg-crema-200 text-cacao-300",
            )}
          >
            {ready ? applyLabel : uploading ? "Esperando la foto tratada…" : "Primero toma la foto"}
          </button>
        </section>
      </div>

      <Section title="Últimas fotos" aside={history.length ? `${history.length} más recientes` : undefined}>
        <PhotoHistory items={history} currentId={photo?.id ?? null} onSelect={openFromHistory} />
      </Section>
    </div>
  );
}
