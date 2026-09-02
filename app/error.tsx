"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/primitives";
import { brand, whatsappLink } from "@/lib/config";
import { IconWhatsapp } from "@/components/ui/icons";

/**
 * Erro dentro de uma rota.
 *
 * Sem isto o cliente via a tela crua do Next: fundo branco, texto em inglês,
 * nenhuma saída. Numa loja isso é a compra perdida — a pessoa não sabe se o
 * pedido entrou, e não tem para onde ir.
 *
 * O `digest` é o identificador que o Next gera para o erro no servidor. É o
 * único fio que liga a reclamação do cliente ao registro do servidor, então
 * aparece na tela.
 */
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[error-boundary]", error.digest, error.message);
  }, [error]);

  return (
    <div className="mx-auto max-w-xl px-4 py-24 text-center">
      <p className="font-display text-6xl font-semibold text-dorado">Ups</p>
      <h1 className="mt-4 text-3xl">Algo salió mal de nuestro lado</h1>
      <p className="mt-3 leading-relaxed text-cacao-500">
        No es culpa tuya. Vuelve a intentarlo — y si acabas de hacer un pedido, escríbenos antes
        de pagar de nuevo: lo verificamos en el momento.
      </p>

      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Button onClick={reset} size="lg">
          Intentar de nuevo
        </Button>
        <Link
          href="/"
          className="inline-flex h-14 items-center rounded-full border border-cacao/25 px-8 text-[15px] font-semibold hover:bg-crema-100"
        >
          Ir al inicio
        </Link>
      </div>

      <a
        href={whatsappLink(
          `Hola ${brand.name}, tuve un error en la página${error.digest ? ` (código ${error.digest})` : ""}.`,
        )}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-6 inline-flex items-center gap-2 text-[15px] text-terracota underline underline-offset-4"
      >
        <IconWhatsapp className="h-[18px] w-[18px]" />
        Escríbenos por WhatsApp
      </a>

      {error.digest && (
        <p className="mt-8 font-mono text-[12px] text-cacao-300">Referencia: {error.digest}</p>
      )}
    </div>
  );
}
