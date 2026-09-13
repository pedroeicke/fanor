import { cx } from "@/lib/format";

/**
 * Ponto verde pulsando: "isto é estoque de agora".
 *
 * Só aparece onde o número foi confirmado — prometer "em tempo real" em cima
 * de um dado velho é justamente o que a vitrine não pode fazer. Com
 * movimento reduzido, o CSS global congela o pulso e fica o ponto.
 */
export function LiveDot({ className }: { className?: string }) {
  return (
    <span aria-hidden="true" className={cx("relative flex h-2 w-2 shrink-0", className)}>
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-verde/50" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-verde" />
    </span>
  );
}
