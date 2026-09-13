"use client";

import Image from "next/image";
import { useRef, useState } from "react";
import type { PhotoRef } from "./shared";

/**
 * Foto de referência da torta, tirada ou escolhida no celular.
 *
 * A foto é reduzida no próprio aparelho antes de subir: a do celular tem
 * 4–8 MB, a hospedagem recusa corpo acima de ~4 MB e, no 4G da loja, subir
 * 8 MB faz a vendedora achar que travou. 1600 px sobra para o taller ver o
 * modelo.
 */

const MAX_SIDE = 1600;
const SHRINK_ABOVE = 1_500_000;

async function shrink(file: File): Promise<Blob> {
  if (file.size <= SHRINK_ABOVE || typeof createImageBitmap !== "function") return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    return blob && blob.size < file.size ? blob : file;
  } catch {
    /* HEIC fora do Safari não decodifica: sobe o original e o servidor decide. */
    return file;
  }
}

export function PhotoUpload({
  value,
  onChange,
  onBusyChange,
}: {
  value: PhotoRef | null;
  onChange: (photo: PhotoRef | null) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setWorking(next: boolean) {
    setBusy(next);
    onBusyChange(next);
  }

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    if (!file.type.startsWith("image/")) {
      setError("Elige una imagen (JPG, PNG o WEBP).");
      return;
    }
    setWorking(true);
    try {
      const blob = await shrink(file);
      const name = blob === file ? file.name : "referencia.jpg";
      const body = new FormData();
      body.append("file", new File([blob], name, { type: blob.type || file.type }));
      const res = await fetch("/api/admin/encomiendas/foto", { method: "POST", body });
      const json = (await res.json().catch(() => null)) as { path?: string; url?: string; error?: string } | null;
      if (!res.ok || !json?.path || !json.url) {
        setError(json?.error ?? (res.status === 413 ? "La foto es muy pesada." : "No se pudo subir la foto."));
        return;
      }
      const previous = value;
      onChange({ path: json.path, url: json.url });
      if (previous) discardPhoto(previous.path);
    } catch {
      setError("Sin conexión. Vuelve a intentar.");
    } finally {
      setWorking(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function remove() {
    if (!value) return;
    discardPhoto(value.path);
    onChange(null);
  }

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic"
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => handleFile(e.target.files?.[0])}
      />
      {value ? (
        <div className="flex items-center gap-3">
          <a href={value.url} target="_blank" rel="noopener noreferrer" className="block shrink-0 overflow-hidden rounded-xl border border-crema-300">
            <Image src={value.url} alt="Foto de referencia" width={72} height={72} unoptimized className="h-[72px] w-[72px] object-cover" />
          </a>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => inputRef.current?.click()}
              className="h-11 rounded-full border border-cacao/25 px-4 text-sm font-semibold text-cacao disabled:opacity-50"
            >
              {busy ? "Subiendo…" : "Cambiar"}
            </button>
            <button type="button" disabled={busy} onClick={remove} className="h-11 rounded-full px-4 text-sm font-semibold text-terracota disabled:opacity-50">
              Quitar
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          className="flex h-11 w-full items-center justify-center rounded-xl border border-dashed border-cacao/30 bg-crema-100 px-4 text-sm font-semibold text-cacao-700 disabled:opacity-60"
        >
          {busy ? "Subiendo foto…" : "📷 Foto de referencia (opcional)"}
        </button>
      )}
      {error && <p role="alert" className="mt-1 text-sm text-terracota">{error}</p>}
    </div>
  );
}

/** Foto trocada ou tirada antes de salvar: some do balde. Falha aqui é só espaço ocupado. */
export function discardPhoto(path: string) {
  fetch(`/api/admin/encomiendas/foto?path=${encodeURIComponent(path)}`, { method: "DELETE" }).catch(() => undefined);
}
