"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { QrScanner } from "@/components/admin/QrScanner";
import { locateScan } from "@/app/admin/(panel)/recepcion/actions";
import { dispatchQrValue, type ParsedQr } from "@/lib/gestion/qr";
import { CAKE_STATUS, DISPATCH_STATUS, TONE_CLASS } from "@/lib/gestion/labels";
import { cx } from "@/lib/format";

type Message = { tone: "ok" | "warn" | "bad"; text: string; href?: string; linkLabel?: string };

/**
 * Leitor do topo da lista de recepção.
 *
 * Guia ou etiqueta, tanto faz: descobre o despacho e abre a conferência.
 * Só abre direto quando é o caso normal (em trânsito, para esta loja). Nos
 * outros, avisa e deixa a decisão com a vendedora — abrir sem querer o
 * despacho da outra loja e conferir é torta sumindo do estoque de lá.
 */
export function ReceptionScanner({ storeId }: { storeId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<Message | null>(null);

  function handleScan(parsed: ParsedQr) {
    const raw = parsed.type === "cake" ? parsed.serial : dispatchQrValue(parsed.code);
    setMessage(null);

    startTransition(async () => {
      let result: Awaited<ReturnType<typeof locateScan>>;
      try {
        result = await locateScan(raw);
      } catch {
        setMessage({ tone: "bad", text: "No se pudo conectar. Revisa la señal y vuelve a escanear." });
        return;
      }
      if (!result.ok) {
        setMessage({ tone: "bad", text: result.error });
        return;
      }

      const d = result.data;
      const base = `/admin/recepcion/${d.dispatchId}`;

      if (d.cake && d.cake.status !== "in_transit") {
        const label = CAKE_STATUS[d.cake.status]?.label ?? d.cake.status;
        setMessage({
          tone: "warn",
          text: `La torta ${d.cake.serial} ya no está en camino (${label}). Vino en el despacho #${d.number}.`,
          href: base,
          linkLabel: "Ver despacho",
        });
        return;
      }

      if (d.status !== "in_transit") {
        const label = DISPATCH_STATUS[d.status]?.label ?? d.status;
        setMessage({
          tone: "warn",
          text: `El despacho #${d.number} ya no está en camino (${label}).`,
          href: base,
          linkLabel: "Ver resultado",
        });
        return;
      }

      /* Etiqueta de torta: a série vai junto e já entra marcada. */
      const href = d.cake ? `${base}?serie=${encodeURIComponent(d.cake.serial)}` : base;

      if (d.storeId !== storeId) {
        setMessage({
          tone: "warn",
          text: `El despacho #${d.number} es para ${d.storeName}, no para esta tienda.`,
          href,
          linkLabel: "Abrir de todos modos",
        });
        return;
      }

      setMessage({ tone: "ok", text: `Abriendo el despacho #${d.number}…` });
      router.push(href);
    });
  }

  return (
    <div className="space-y-2">
      <QrScanner onScan={handleScan} label="Escanear guía o torta" />
      {pending && !message && (
        <p role="status" className="px-1 text-sm text-cacao-500">
          Buscando…
        </p>
      )}
      {message && (
        <div role="status" className={cx("rounded-2xl border px-4 py-3 text-sm", TONE_CLASS[message.tone])}>
          <p>{message.text}</p>
          {message.href && (
            <Link
              href={message.href}
              className="mt-2 inline-flex h-11 items-center rounded-full border border-current px-4 font-semibold"
            >
              {message.linkLabel}
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
