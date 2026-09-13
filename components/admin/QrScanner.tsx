"use client";

import { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import { parseQr, type ParsedQr } from "@/lib/gestion/qr";
import { cx } from "@/lib/format";

/**
 * Leitor de QR pela câmera do celular, com campo para digitar a série.
 *
 * jsQR em vez do `BarcodeDetector` do navegador: o Safari do iPhone não tem
 * `BarcodeDetector`, e a vendedora usa o celular que tiver. Lê um quadro a
 * cada 200 ms — suficiente para quem aponta a câmera, sem esquentar o aparelho.
 *
 * O mesmo código lido duas vezes seguidas conta uma vez só: a câmera fica
 * parada em cima da etiqueta e leria dez vezes por segundo.
 */
export function QrScanner({
  onScan,
  label = "Escanear etiqueta",
  placeholder = "O escribe la serie, ej. G0000100001",
}: {
  onScan: (value: ParsedQr) => void;
  label?: string;
  placeholder?: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lastRef = useRef<{ value: string; at: number } | null>(null);
  const onScanRef = useRef(onScan);
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState("");
  const [flash, setFlash] = useState<string | null>(null);

  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  useEffect(() => {
    if (!active) return;
    let stream: MediaStream | null = null;
    let timer: number | undefined;
    let cancelled = false;

    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } },
          audio: false,
        });
        if (cancelled) return;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();
        timer = window.setInterval(tick, 200);
      } catch (e) {
        const name = e instanceof DOMException ? e.name : "";
        setError(
          name === "NotAllowedError"
            ? "Sin permiso para usar la cámara. Actívalo en el navegador o escribe la serie."
            : "No se pudo abrir la cámara. Escribe la serie abajo.",
        );
        setActive(false);
      }
    }

    function tick() {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || video.readyState < 2) return;
      const w = video.videoWidth, h = video.videoHeight;
      if (!w || !h) return;
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, w, h);
      const code = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: "dontInvert" });
      if (code?.data) emit(code.data);
    }

    start();
    return () => {
      cancelled = true;
      if (timer) window.clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [active]);

  function emit(raw: string) {
    const parsed = parseQr(raw);
    if (!parsed) {
      setFlash("Código no reconocido");
      return;
    }
    const value = parsed.type === "cake" ? parsed.serial : parsed.code;
    const last = lastRef.current;
    const now = Date.now();
    if (last && last.value === value && now - last.at < 2500) return;
    lastRef.current = { value, at: now };
    navigator.vibrate?.(60);
    setFlash(value);
    onScanRef.current(parsed);
  }

  function submitManual(e: React.FormEvent) {
    e.preventDefault();
    if (!manual.trim()) return;
    const parsed = parseQr(manual);
    if (!parsed) {
      setFlash("Serie inválida");
      return;
    }
    lastRef.current = null;
    emit(manual);
    setManual("");
  }

  return (
    <div className="card overflow-hidden">
      {active ? (
        <div className="relative bg-cacao">
          <video ref={videoRef} className="aspect-[4/3] w-full object-cover" playsInline muted />
          <canvas ref={canvasRef} className="hidden" />
          <div className="pointer-events-none absolute inset-0 m-auto h-1/2 w-1/2 rounded-2xl border-4 border-dorado/80" />
          <button
            type="button"
            onClick={() => setActive(false)}
            className="absolute right-3 top-3 h-11 rounded-full bg-white/90 px-4 text-sm font-semibold text-cacao"
          >
            Cerrar cámara
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            setError(null);
            setActive(true);
          }}
          className="flex h-16 w-full items-center justify-center gap-2 bg-dorado text-base font-semibold text-cacao hover:bg-dorado-600"
        >
          📷 {label}
        </button>
      )}

      <form onSubmit={submitManual} className="flex gap-2 border-t border-crema-200 p-3">
        <input
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          placeholder={placeholder}
          autoCapitalize="characters"
          autoComplete="off"
          className="h-11 min-w-0 flex-1 rounded-full border border-crema-300 bg-white px-4 font-mono text-sm uppercase"
          aria-label="Serie o código"
        />
        <button type="submit" className="h-11 shrink-0 rounded-full border border-cacao/25 px-4 text-sm font-semibold text-cacao">
          Agregar
        </button>
      </form>

      {(error || flash) && (
        <p
          role="status"
          className={cx("px-4 pb-3 text-sm", error || flash === "Código no reconocido" || flash === "Serie inválida" ? "text-terracota" : "text-verde")}
        >
          {error ?? `Leído: ${flash}`}
        </p>
      )}
    </div>
  );
}
