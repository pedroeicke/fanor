"use client";

import Image from "next/image";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteProductImage, reorderProductImages } from "@/app/admin/actions";
import { cdnImage, cx } from "@/lib/format";
import { IconCamera, IconChevron, IconClose } from "@/components/ui/icons";

export type ProductImageRow = {
  id: string;
  url: string;
  kind: string;
  sort_order: number;
};

/**
 * Gestão de imagens do produto.
 *
 * Reordenação por botões, não por arrastar: arrastar é hostil no celular e
 * exige biblioteca. Aqui o Joseka move a foto uma posição por vez, com o
 * teclado ou o dedo, e funciona em qualquer tela.
 */
export function ImageManager({
  productId,
  images,
}: {
  productId: string;
  images: ProductImageRow[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"gallery" | "spin360">("gallery");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  const current = images
    .filter((i) => i.kind === tab)
    .sort((a, b) => a.sort_order - b.sort_order);

  async function upload(files: FileList) {
    setError(null);
    setBusy(true);
    try {
      const body = new FormData();
      body.append("productId", productId);
      body.append("kind", tab);
      Array.from(files).forEach((f) => body.append("files", f));

      const res = await fetch("/api/admin/upload", { method: "POST", body });
      const data = await res.json();

      if (!res.ok) setError(data.error ?? "No se pudo subir.");
      else if (data.failures?.length) setError(data.failures.join(" · "));

      router.refresh();
    } catch {
      setError("Fallo de conexión al subir.");
    } finally {
      setBusy(false);
    }
  }

  function move(index: number, direction: -1 | 1) {
    const next = [...current];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];

    startTransition(async () => {
      const result = await reorderProductImages(
        productId,
        next.map((i) => i.id),
      );
      if (!result.ok) setError(result.error);
      router.refresh();
    });
  }

  function remove(id: string) {
    startTransition(async () => {
      const result = await deleteProductImage(id);
      if (!result.ok) setError(result.error);
      router.refresh();
    });
  }

  return (
    <section className="card p-5 sm:p-6">
      <h2 className="text-xl">Imágenes</h2>

      <div className="mt-4 flex gap-2">
        {(
          [
            { id: "gallery", label: "Galería" },
            { id: "spin360", label: "Vista 360°" },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            aria-pressed={tab === t.id}
            className={cx(
              "h-9 rounded-full border px-4 text-[13px] font-medium transition-colors",
              tab === t.id
                ? "border-cacao bg-cacao text-crema"
                : "border-crema-300 bg-white text-cacao-700 hover:border-cacao/35",
            )}
          >
            {t.label} ({images.filter((i) => i.kind === t.id).length})
          </button>
        ))}
      </div>

      <p className="mt-3 text-[13px] leading-relaxed text-cacao-500">
        {tab === "gallery"
          ? "La primera imagen es la portada que se ve en el catálogo y al compartir el enlace."
          : "Sube el conjunto completo de una vez (mínimo 8, ideal 30). El orden lo define el nombre del archivo, así que numéralos: _01, _02… Subir un conjunto nuevo reemplaza el anterior."}
      </p>

      {current.length > 0 && (
        <ul className={cx("mt-4 grid gap-2", tab === "spin360" ? "grid-cols-5 sm:grid-cols-8" : "grid-cols-3 sm:grid-cols-4")}>
          {current.map((image, i) => (
            <li key={image.id} className="group relative">
              <div
                className={cx(
                  "relative aspect-square overflow-hidden rounded-lg bg-crema-100 ring-1",
                  i === 0 && tab === "gallery" ? "ring-2 ring-dorado-600" : "ring-crema-200",
                )}
              >
                <Image
                  src={cdnImage(image.url, 200)}
                  alt=""
                  fill
                  sizes="120px"
                  className="object-cover"
                />
                {i === 0 && tab === "gallery" && (
                  <span className="absolute inset-x-0 bottom-0 bg-dorado px-1 py-0.5 text-center text-[9px] font-bold uppercase text-cacao">
                    portada
                  </span>
                )}
              </div>

              {tab === "gallery" && (
                <div className="mt-1 flex items-center justify-between gap-1">
                  <span className="flex gap-0.5">
                    <button
                      type="button"
                      onClick={() => move(i, -1)}
                      disabled={i === 0 || pending}
                      className="grid h-6 w-6 place-items-center rounded border border-crema-300 disabled:opacity-30"
                      aria-label="Mover antes"
                    >
                      <IconChevron className="h-3 w-3 rotate-180" />
                    </button>
                    <button
                      type="button"
                      onClick={() => move(i, 1)}
                      disabled={i === current.length - 1 || pending}
                      className="grid h-6 w-6 place-items-center rounded border border-crema-300 disabled:opacity-30"
                      aria-label="Mover después"
                    >
                      <IconChevron className="h-3 w-3" />
                    </button>
                  </span>
                  <button
                    type="button"
                    onClick={() => remove(image.id)}
                    disabled={pending}
                    className="grid h-6 w-6 place-items-center rounded border border-crema-300 text-cacao-300 hover:border-terracota hover:text-terracota"
                    aria-label="Eliminar imagen"
                  >
                    <IconClose className="h-3 w-3" />
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        className="mt-4 flex w-full flex-col items-center gap-1.5 rounded-xl border-2 border-dashed border-crema-300 bg-white px-6 py-6 text-center transition-colors hover:border-cacao/30"
      >
        <IconCamera className="h-6 w-6 text-dorado-600" />
        <span className="text-[15px] font-medium">
          {busy ? "Subiendo..." : tab === "spin360" ? "Subir conjunto 360°" : "Subir imágenes"}
        </span>
        <span className="text-[13px] text-cacao-300">JPG, PNG o WEBP · hasta 8 MB c/u</span>
      </button>

      <input
        ref={inputRef}
        type="file"
        multiple
        accept="image/jpeg,image/png,image/webp,image/avif"
        className="sr-only"
        onChange={(e) => {
          if (e.target.files?.length) void upload(e.target.files);
          e.target.value = "";
        }}
      />

      {error && (
        <p role="alert" className="mt-3 rounded-lg bg-terracota/10 px-3.5 py-2.5 text-[13px] text-terracota-700">
          {error}
        </p>
      )}
    </section>
  );
}
