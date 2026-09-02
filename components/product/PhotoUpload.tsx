"use client";

import Image from "next/image";
import { useRef, useState } from "react";
import { IconCamera, IconClose } from "@/components/ui/icons";
import { cx } from "@/lib/format";

const MAX_BYTES = 8 * 1024 * 1024;
const ACCEPTED = ["image/jpeg", "image/png", "image/webp", "image/heic"];

/**
 * Upload da foto do cliente.
 *
 * O produto "FotoTorta" do site atual — que existe para receber uma imagem —
 * não tem campo de imagem nenhum. O cliente compra às cegas e só depois manda
 * a foto por WhatsApp, o que trava a produção e derruba a conversão.
 */
export function PhotoUpload({
  photoUrl,
  photoName,
  onChange,
  error,
}: {
  photoUrl: string | null;
  photoName: string | null;
  /** `path` é o que persiste; `url` é assinada e só serve para a prévia. */
  onChange: (photo: { path: string; url: string; name: string } | null) => void;
  error?: string | null;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  async function upload(file: File) {
    setLocalError(null);

    if (!ACCEPTED.includes(file.type)) {
      setLocalError("Formato no soportado. Usa JPG, PNG o WEBP.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setLocalError("La imagen supera los 8 MB. Prueba con una versión más liviana.");
      return;
    }

    setBusy(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/uploads", { method: "POST", body });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as { path: string; url: string };
      onChange({ path: data.path, url: data.url, name: file.name });
    } catch {
      setLocalError("No pudimos subir la imagen. Intenta de nuevo o envíanosla por WhatsApp.");
    } finally {
      setBusy(false);
    }
  }

  const message = error ?? localError;

  return (
    <div>
      <span className="mb-2 block text-[15px] font-semibold">
        Tu foto <span className="text-[13px] font-normal text-terracota">obligatoria</span>
      </span>

      {photoUrl ? (
        <div className="flex items-center gap-4 rounded-xl border border-crema-300 bg-white p-3">
          <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-lg bg-crema-100">
            <Image src={photoUrl} alt="Vista previa de tu foto" fill sizes="80px" className="object-cover" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{photoName}</p>
            <p className="mt-0.5 text-[13px] text-verde">Imagen lista para imprimir</p>
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="mt-1 text-[13px] text-terracota underline underline-offset-4"
            >
              Cambiar imagen
            </button>
          </div>
          <button
            type="button"
            onClick={() => onChange(null)}
            className="p-2 text-cacao-300 hover:text-cacao"
            aria-label="Quitar imagen"
          >
            <IconClose className="h-5 w-5" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const file = e.dataTransfer.files?.[0];
            if (file) void upload(file);
          }}
          disabled={busy}
          className={cx(
            "flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed px-6 py-7 text-center transition-colors",
            dragging ? "border-dorado-600 bg-dorado-100" : "border-crema-300 bg-white hover:border-cacao/30",
            message && "border-terracota",
          )}
        >
          <IconCamera className="h-7 w-7 text-dorado-600" />
          <span className="text-[15px] font-medium">
            {busy ? "Subiendo tu imagen..." : "Sube tu foto"}
          </span>
          <span className="text-[13px] text-cacao-300">JPG, PNG o WEBP · hasta 8 MB</span>
        </button>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED.join(",")}
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
          e.target.value = "";
        }}
      />

      {message && (
        <p role="alert" className="mt-2 text-sm font-medium text-terracota">
          {message}
        </p>
      )}
      <p className="mt-2 text-[13px] leading-relaxed text-cacao-300">
        La imprimimos en papel de azúcar comestible. Para el mejor resultado usa una foto
        bien iluminada y sin filtros.
      </p>
    </div>
  );
}
