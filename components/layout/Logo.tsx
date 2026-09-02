import Image from "next/image";
import { brand } from "@/lib/config";
import { cx } from "@/lib/format";

/**
 * Logo da Fanor.
 *
 * É o arquivo oficial da marca, o mesmo que a loja usa hoje — o lockup em
 * texto que havia aqui antes era um substituto enquanto o arquivo não
 * existia no projeto.
 *
 * Fica como imagem e não como SVG inline porque o original é bitmap;
 * vetorizar mudaria o desenho das letras. Em compensação o `alt` carrega o
 * nome, então busca e leitor de tela continuam lendo "Tortas Fanor" onde
 * antes liam o texto.
 */
export function Logo({
  className,
  priority = false,
}: {
  className?: string;
  /** Só no cabeçalho: é a imagem mais visível do topo da página. */
  priority?: boolean;
}) {
  return (
    <Image
      src="/assets/marca/logo-fanor.avif"
      alt={brand.name}
      /* Tamanho real do arquivo. O Next precisa dele para reservar o espaço e
         não deixar o cabeçalho pular quando a imagem chega. */
      width={599}
      height={248}
      priority={priority}
      className={cx("h-12 w-auto sm:h-14", className)}
    />
  );
}
