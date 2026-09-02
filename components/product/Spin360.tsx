"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cx, sizedImage } from "@/lib/format";
import type { ProductImage } from "@/lib/catalog";

/**
 * Giro 360° por arraste, desenhado em canvas.
 *
 * Por que canvas, e não 30 `<img>` empilhados com opacidade — que foi a
 * primeira versão e piscava a cada quadro:
 *
 *   O navegador descarta o bitmap decodificado de imagem que não está
 *   pintando, para poupar memória. Com 29 quadros em `opacity: 0`, cada troca
 *   podia exigir nova decodificação, e o quadro aparecia depois de a área já
 *   ter sido repintada. Em AVIF, que decodifica devagar, dava para ver.
 *
 *   Aqui cada quadro vira um `ImageBitmap`: já decodificado e mantido vivo
 *   por referência em JS, fora do alcance dessa heurística. Trocar de quadro
 *   é um `drawImage` — cópia direta para a GPU. Não há o que decodificar no
 *   momento da troca, então não há como piscar.
 *
 * De quebra: 30 nós a menos no DOM e uma camada de composição em vez de 30.
 *
 * Regras que o checklist impõe e que continuam valendo:
 *   · o primeiro quadro aparece imediatamente — a área nunca fica vazia;
 *   · os demais carregam em segundo plano, com indicador discreto;
 *   · funciona com mouse e com toque;
 *   · num conjunto incompleto, degrada para galeria comum em vez de travar.
 */

/**
 * Largura dos quadros. Cada bitmap ocupa `w × h × 4` bytes vivos, então 30
 * quadros a 640px são ~49 MB — demais para celular modesto. Em tela pequena o
 * giro também aparece menor, e 448px basta.
 */
const FRAME_WIDTH_DESKTOP = 640;
const FRAME_WIDTH_MOBILE = 448;

/** Pixels de arraste para avançar um quadro. Menor = giro mais sensível. */
const DRAG_SENSITIVITY = 8;

/** Abaixo disto o conjunto não é giro, é galeria. */
const MIN_FRAMES = 8;

export function Spin360({
  frames,
  name,
  className,
}: {
  frames: ProductImage[];
  name: string;
  className?: string;
}) {
  const [index, setIndex] = useState(0);
  const [ready, setReady] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [hinted, setHinted] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bitmapsRef = useRef<(ImageBitmap | null)[]>([]);
  const dragStart = useRef<{ x: number; index: number } | null>(null);
  const total = frames.length;

  /** Desenha o quadro cobrindo o canvas, como `object-fit: cover`. */
  const paint = useCallback((i: number) => {
    const canvas = canvasRef.current;
    const bitmap = bitmapsRef.current[i];
    if (!canvas || !bitmap) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    /* Cobrir explicitamente evita distorção se algum quadro vier fora de
       proporção — o conjunto é quadrado, mas o componente não depende disso. */
    const scale = Math.max(canvas.width / bitmap.width, canvas.height / bitmap.height);
    const w = bitmap.width * scale;
    const h = bitmap.height * scale;
    ctx.drawImage(bitmap, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
  }, []);

  /* Baixa e decodifica todos os quadros. O primeiro tem prioridade: é ele que
     tira a área do vazio. */
  useEffect(() => {
    if (total < MIN_FRAMES) return;
    if (typeof createImageBitmap !== "function") return;

    let cancelled = false;
    const bitmaps = bitmapsRef.current;
    const width = window.innerWidth < 640 ? FRAME_WIDTH_MOBILE : FRAME_WIDTH_DESKTOP;

    /* Casa a resolução do canvas com a densidade da tela, senão sai borrado
       no retina. Limitado a 2× — acima disso o ganho não se vê e a memória
       dobra. */
    const canvas = canvasRef.current;
    if (canvas) {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const box = canvas.getBoundingClientRect();
      canvas.width = Math.round((box.width || width) * dpr);
      canvas.height = Math.round((box.height || width) * dpr);
    }

    async function load(i: number) {
      try {
        const response = await fetch(sizedImage(frames[i].src, width));
        if (!response.ok) return;
        const bitmap = await createImageBitmap(await response.blob());

        if (cancelled) {
          bitmap.close();
          return;
        }
        bitmaps[i] = bitmap;
        setReady((n) => n + 1);
        /* Pinta assim que o primeiro chega, sem esperar os outros 29. */
        if (i === 0) paint(0);
      } catch {
        /* Quadro que falhou fica nulo, e a roda pula esse índice em vez de
           mostrar um buraco. */
      }
    }

    void (async () => {
      await load(0);
      await Promise.all(Array.from({ length: total - 1 }, (_, k) => load(k + 1)));
    })();

    return () => {
      cancelled = true;
      /* Libera os bitmaps ao sair. Sem isto, navegar por vários produtos com
         giro acumularia dezenas de megabytes até o navegador reclamar. */
      bitmaps.forEach((b) => b?.close());
      bitmaps.length = 0;
    };
  }, [frames, total, paint]);

  /** Só mostra quadro já decodificado — nunca uma área em branco. */
  const showFrame = useCallback(
    (next: number) => {
      if (!bitmapsRef.current[next]) return;
      setIndex(next);
      paint(next);
    },
    [paint],
  );

  const move = useCallback(
    (clientX: number) => {
      const start = dragStart.current;
      if (!start) return;
      const delta = Math.round((clientX - start.x) / DRAG_SENSITIVITY);
      /* Módulo positivo: arrastar para a esquerda passa de 0 para o último. */
      showFrame((((start.index - delta) % total) + total) % total);
    },
    [total, showFrame],
  );

  const begin = (clientX: number) => {
    dragStart.current = { x: clientX, index };
    setDragging(true);
    setHinted(true);
  };

  useEffect(() => {
    if (!dragging) return;
    const end = () => {
      dragStart.current = null;
      setDragging(false);
    };
    const onMouseMove = (e: MouseEvent) => move(e.clientX);
    const onTouchMove = (e: TouchEvent) => {
      /* Impede a página de rolar enquanto o dedo gira a torta. */
      e.preventDefault();
      move(e.touches[0].clientX);
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", end);
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend", end);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", end);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", end);
    };
  }, [dragging, move]);

  if (total < MIN_FRAMES) return null;

  const progress = Math.round((ready / total) * 100);

  return (
    <div
      className={cx(
        /* `aspect-square` aqui, e não só no chamador: sem altura própria o
           container colapsaria se alguém usasse o componente sem proporção. */
        "relative aspect-square w-full select-none overflow-hidden rounded-[20px] bg-crema-100",
        dragging ? "cursor-grabbing" : "cursor-grab",
        className,
      )}
      style={{ touchAction: "pan-y" }}
      onMouseDown={(e) => {
        e.preventDefault();
        begin(e.clientX);
      }}
      onTouchStart={(e) => begin(e.touches[0].clientX)}
      role="slider"
      tabIndex={0}
      aria-label={`Vista 360° de ${name}. Usa las flechas para girar.`}
      aria-valuemin={1}
      aria-valuemax={total}
      aria-valuenow={index + 1}
      aria-valuetext={`Cuadro ${index + 1} de ${total}`}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") showFrame((index + 1) % total);
        if (e.key === "ArrowLeft") showFrame((index - 1 + total) % total);
      }}
    >
      {/* O canvas não tem conteúdo para leitor de tela nem para o robô de
          busca: a descrição está no `aria-label` do container, e a imagem
          indexável é a da galeria, logo abaixo. */}
      <canvas ref={canvasRef} className="h-full w-full" aria-hidden="true" />

      {ready < total && (
        <div className="absolute inset-x-0 bottom-0 h-1 bg-crema-200" aria-hidden>
          <div
            className="h-full bg-dorado transition-[width] duration-200"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}

      {!hinted && (
        <span className="pointer-events-none absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full bg-cacao/80 px-4 py-2 text-[13px] font-medium text-crema backdrop-blur-sm">
          <SpinIcon />
          Arrastra para girar
        </span>
      )}
    </div>
  );
}

function SpinIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M4 12a8 8 0 0 1 8-8 8 8 0 0 1 8 8" />
      <path d="M20 12a8 8 0 0 1-8 8 8 8 0 0 1-8-8" strokeDasharray="2 3" />
      <path d="m17 4 3 2.5-3 2.5M7 20l-3-2.5L7 15" />
    </svg>
  );
}
