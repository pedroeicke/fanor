import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getAdminUser, getServerSupabase } from "@/lib/supabase-server";
import { shortStoreName } from "@/lib/gestion/server";
import { limaDay, limaTime } from "@/lib/gestion/dates";
import { cakeQrValue, dispatchQrValue } from "@/lib/gestion/qr";
import { qrSvg } from "@/lib/gestion/qr-svg";
import { cx } from "@/lib/format";
import { isUuid } from "@/components/admin/pedidos-tienda/catalog";
import { PrintButton } from "@/components/admin/taller/PrintButton";
import { CakeLabel } from "@/components/admin/taller/CakeLabel";
import { CAKE_LABEL_CSS, cakeLabelContent } from "@/lib/gestion/cake-label";

export const metadata: Metadata = { title: "Etiquetas" };
export const dynamic = "force-dynamic";

/**
 * Folha de etiquetas de um despacho: a guia (QR que abre o despacho inteiro
 * na recepção) e uma etiqueta por torta (QR = série).
 *
 * Fora do grupo (panel) de propósito: o menu do painel não pode sair no
 * papel. A sessão é conferida aqui mesmo, e o RLS confere de novo na leitura.
 *
 * Padrão: TSC TE200, etiquetas de 50 × 25 mm, margem interna de 3 mm.
 * A guia sai separada em A4; ?formato=a4 também conserva a grade para cortar.
 * ?formato=58 continua aceito para reimpressões no tamanho anterior.
 */

type DispatchRow = {
  id: string;
  number: number;
  code: string;
  dispatched_at: string;
  stores: { name: string } | null;
  production_orders: { number: number; kind: string; contracts: { number: number } | null } | null;
};

type CakeRow = {
  id: string;
  serial: string;
  produced_on: string;
  expires_on: string;
  redecorated: boolean;
  products: { name: string; sku: string | null; min_flavors: number; max_flavors: number } | null;
  flavors: { name: string } | null;
  cake_types: { name: string } | null;
  contracts: { number: number } | null;
};

type LineRow = { id: string; quantity: number; products: { name: string } | null };

/** "2026-09-13" → "13/09". */
function ddmm(iso: string) {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
}

/** Dias entre produção e vencimento, sem fuso: as duas são datas puras. */
function daysBetween(from: string, to: string) {
  const toUtc = (iso: string) => {
    const [y, m, d] = iso.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toUtc(to) - toUtc(from)) / 86_400_000);
}

const BASE_CSS = `
/* O layout raiz do site envolve tudo com cabeçalho, rodapé e botão de
   WhatsApp. Nesta folha só interessa o conteúdo. */
body > :not(#contenido) { display: none !important; }
body { background: #fff; }

.etq-sheet { color: #000; }
.etq-label { box-sizing: border-box; background: #fff; overflow: hidden; display: grid; align-items: center; break-inside: avoid; page-break-inside: avoid; }
.etq-qr svg { display: block; width: 100%; height: 100%; }
.etq-text { min-width: 0; line-height: 1.22; }
.etq-text p { margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.etq-text p.etq-name { white-space: normal; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; font-weight: 600; }
.etq-serial { font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, "Liberation Mono", monospace; font-weight: 800; letter-spacing: 0.02em; line-height: 1.05; }
.etq-strong { font-weight: 700; }
.etq-redeco { display: inline-block; margin-top: 0.6mm !important; padding: 0.3mm 1.2mm; background: #000; color: #fff; font-weight: 800; letter-spacing: 0.03em; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.etq-guide .etq-title { font-weight: 800; letter-spacing: 0.04em; text-transform: uppercase; }

.etq-a4 { width: 194mm; display: grid; grid-template-columns: repeat(3, 1fr); }
.etq-a4 .etq-guide { grid-column: 1 / -1; grid-template-columns: 32mm 1fr; gap: 5mm; padding: 3mm; margin-bottom: 3mm; border: 0.4mm solid #000; }
.etq-a4 .etq-guide .etq-qr { width: 32mm; height: 32mm; }
.etq-a4 .etq-guide .etq-text { font-size: 10pt; }
.etq-a4 .etq-guide .etq-title { font-size: 12pt; }
.etq-a4 .etq-guide .etq-serial { font-size: 16pt; }
.etq-a4 .etq-guide p { white-space: normal; }
.etq-a4 .etq-cake { height: 38mm; grid-template-columns: 26mm 1fr; gap: 2.5mm; padding: 2.5mm; border: 0.2mm dashed #9a9a9a; margin: -0.1mm; }
.etq-a4 .etq-cake .etq-qr { width: 26mm; height: 26mm; }
.etq-a4 .etq-cake .etq-text { font-size: 7.5pt; }
.etq-a4 .etq-cake .etq-serial { font-size: 11pt; margin-bottom: 0.6mm; }

.etq-58 { width: 58mm; display: flex; flex-direction: column; gap: 3mm; }
.etq-58 .etq-label { width: 58mm; height: 40mm; grid-template-columns: 23mm 1fr; gap: 2mm; padding: 2mm; border: 0.2mm dashed #9a9a9a; }
.etq-58 .etq-qr { width: 23mm; height: 23mm; }
.etq-58 .etq-text { font-size: 7pt; }
.etq-58 .etq-serial { font-size: 9.5pt; margin-bottom: 0.5mm; }
.etq-58 .etq-guide .etq-title { font-size: 8pt; }

@media print {
  html, body { background: #fff !important; }
  .no-print { display: none !important; }
  .etq-root { max-width: none !important; margin: 0 !important; padding: 0 !important; }
  .etq-scroll { overflow: visible !important; padding: 0 !important; }
}
`;

const A4_PRINT_CSS = `
@page { size: A4; margin: 8mm; }
`;

/* Uma etiqueta por página de 58 × 40 mm: serve tanto para rolo de etiqueta
   destacável quanto para a ticketeira comum, que corta ou avança por página. */
const THERMAL_PRINT_CSS = `
@page { size: 58mm 40mm; margin: 0; }
@media print {
  .etq-58 { gap: 0; }
  .etq-58 .etq-label { border: 0; break-after: page; page-break-after: always; }
  .etq-58 .etq-label:last-child { break-after: auto; page-break-after: auto; }
}
`;

export default async function LabelsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getAdminUser();
  if (!user) redirect("/admin/login");

  const { id } = await params;
  if (!isUuid(id)) notFound();
  const sp = await searchParams;
  const format = sp.formato === "a4" ? "a4" : sp.formato === "58" ? "58" : "50";

  const db = await getServerSupabase();
  if (!db) return <p className="p-6 text-sm">Falta configurar la base de datos.</p>;

  const [{ data: dispatchData }, { data: cakeData }, { data: lineData }] = await Promise.all([
    db.from("dispatches").select("id, number, code, dispatched_at, stores(name), production_orders(number, kind, contracts(number))").eq("id", id).maybeSingle(),
    db
      .from("cake_units")
      .select("id, serial, produced_on, expires_on, redecorated, products(name, sku, min_flavors, max_flavors), flavors(name), cake_types(name), contracts(number)")
      .eq("dispatch_id", id)
      .order("serial"),
    db.from("dispatch_lines").select("id, quantity, products(name)").eq("dispatch_id", id),
  ]);

  const dispatch = dispatchData as unknown as DispatchRow | null;
  if (!dispatch) notFound();

  const cakes = (cakeData ?? []) as unknown as CakeRow[];
  const lines = (lineData ?? []) as unknown as LineRow[];
  const store = shortStoreName(dispatch.stores?.name);
  const day = limaDay(dispatch.dispatched_at);
  const [y, m, d] = day.split("-");
  const order = dispatch.production_orders;
  const origin =
    order?.kind === "contract" && order.contracts
      ? `Encomienda #${order.contracts.number}`
      : order
        ? `Pedido #${order.number}`
        : cakes.some((c) => c.redecorated)
          ? "Redecoración"
          : null;

  const [guideQr, cakeQrs] = await Promise.all([
    qrSvg(dispatchQrValue(dispatch.code)),
    Promise.all(cakes.map((c) => qrSvg(cakeQrValue(c.serial)))),
  ]);

  return (
    <div className="etq-root mx-auto max-w-5xl px-4 py-6">
      <style dangerouslySetInnerHTML={{ __html: BASE_CSS + (format === "a4" ? A4_PRINT_CSS : format === "50" ? CAKE_LABEL_CSS : THERMAL_PRINT_CSS) }} />

      <div className="no-print mb-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link
            href={`/admin/taller/despachos/${dispatch.id}`}
            className="inline-flex h-11 items-center text-sm font-medium text-cacao-500 underline underline-offset-4 hover:text-cacao"
          >
            ← Volver al despacho
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-full border border-crema-300 bg-crema-100 p-1" role="group" aria-label="Formato de impresión">
              {(["50", "a4"] as const).map((f) => (
                <Link
                  key={f}
                  href={`/admin/etiquetas/${dispatch.id}?formato=${f}`}
                  aria-current={f === format ? "page" : undefined}
                  className={cx(
                    "flex h-10 items-center rounded-full px-4 text-sm font-semibold transition-colors",
                    f === format ? "bg-white text-cacao shadow-[0_1px_2px_rgb(59_35_20/0.1)]" : "text-cacao-500 hover:text-cacao",
                  )}
                >
                  {f === "a4" ? "Hoja A4" : "TSC · 50 × 25 mm"}
                </Link>
              ))}
            </div>
            <Link href="/admin/etiquetas/prueba" className="inline-flex h-11 items-center px-3 text-sm font-semibold underline underline-offset-4">Probar 11 etiquetas</Link>
            {cakes.length > 0 || format !== "50" ? <PrintButton label={format === "50" ? "Imprimir tortas" : "Imprimir"} /> : null}
          </div>
        </div>
        <div>
          <h1 className="font-display text-2xl">Etiquetas · Despacho #{dispatch.number}</h1>
          <p className="mt-1 text-sm text-cacao-500">
            {cakes.length} {cakes.length === 1 ? "etiqueta" : "etiquetas"} de torta para {store}. Imprime a escala 100 % y sin
            encabezados del navegador.{" "}
            {format === "a4" ? (
              <Link href={`/admin/etiquetas/${dispatch.id}?formato=50`} className="underline underline-offset-2">Usa etiquetas de 50 × 25 mm en la TSC TE200.</Link>
            ) : format === "50" ? (
              <>Elige la TSC TE200 y papel de 50 × 25 mm, sin márgenes adicionales. Margen interno: 3 mm.</>
            ) : (
              <>En la impresora, elige papel de 58 × 40 mm.</>
            )}
          </p>
          {format === "50" && <p className="mt-2 text-sm text-cacao-500">La guía de recepción se imprime en <Link href={`/admin/etiquetas/${dispatch.id}?formato=a4`} className="underline underline-offset-2">Hoja A4</Link>. Los campos Vendedora y BV / Factura quedan para completar en tienda.</p>}
        </div>
      </div>

      <div className="etq-scroll overflow-x-auto pb-2">
        <div className={cx("etq-sheet", format === "a4" ? "etq-a4" : format === "50" ? "etq-50" : "etq-58")}>
          {format !== "50" && <article className="etq-label etq-guide">
            <div className="etq-qr" dangerouslySetInnerHTML={{ __html: guideQr }} />
            <div className="etq-text">
              <p className="etq-title">Guía de despacho #{dispatch.number}</p>
              <p className="etq-strong">Para: {store}</p>
              <p>
                {d}/{m}/{y} · {limaTime(dispatch.dispatched_at)}
              </p>
              <p className="etq-serial">{dispatch.code}</p>
              <p>
                {cakes.length} {cakes.length === 1 ? "torta" : "tortas"}
                {lines.length > 0 && ` · ${lines.length} ${lines.length === 1 ? "ítem" : "ítems"} sin serie`}
                {origin && ` · ${origin}`}
              </p>
              {format === "a4" && lines.length > 0 && (
                <p>{lines.map((l) => `${Number(l.quantity)} × ${l.products?.name ?? "Producto"}`).join(" · ")}</p>
              )}
            </div>
          </article>}

          {cakes.map((c, i) => {
            const days = daysBetween(c.produced_on, c.expires_on);
            const content = cakeLabelContent({
              name: c.products?.name ?? "Torta",
              minFlavors: c.products?.min_flavors ?? 0,
              maxFlavors: c.products?.max_flavors ?? 0,
              flavorName: c.flavors?.name,
            });
            if (format === "50") return <CakeLabel key={c.id} label={{
              ...content,
              store: store.replace(/^Calle\s+/i, "").toUpperCase(),
              serial: c.serial,
              qrValue: cakeQrValue(c.serial),
              detail: c.cake_types?.name,
              redecorated: c.redecorated,
            }} />;
            return (
              <article key={c.id} className="etq-label etq-cake">
                <div className="etq-qr" dangerouslySetInnerHTML={{ __html: cakeQrs[i] }} />
                <div className="etq-text">
                  <p className="etq-serial">{c.serial}</p>
                  <p className="etq-name">{c.products?.name ?? "Torta"}</p>
                  {content.flavors && <p>{content.flavors}</p>}
                  <p>
                    Prod. {ddmm(c.produced_on)} · Vence {ddmm(c.expires_on)}
                  </p>
                  <p className="etq-strong">
                    {store}
                    {c.contracts && ` · Encomienda #${c.contracts.number}`}
                  </p>
                  {c.redecorated && (
                    <p className="etq-redeco">
                      REDECORADA · {days} {days === 1 ? "día" : "días"}
                    </p>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </div>

      {cakes.length === 0 && (
        <p className="no-print mt-6 text-sm text-cacao-500">Este despacho no lleva tortas con serie. Usa Hoja A4 para imprimir la guía.</p>
      )}
    </div>
  );
}
