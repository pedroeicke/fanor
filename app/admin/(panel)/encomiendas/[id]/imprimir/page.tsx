import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PrintButton } from "@/components/admin/encomiendas/PrintButton";
import { loadContract } from "@/components/admin/encomiendas/queries";
import { DOC_LABEL, isUuid, shortTime, type DocType } from "@/components/admin/encomiendas/shared";
import { brand } from "@/lib/config";
import { formatDateLong } from "@/lib/delivery";
import { soles } from "@/lib/format";
import { limaDateTime } from "@/lib/gestion/dates";
import { CONTRACT_STATUS, PAYMENT_METHOD, SALE_KIND } from "@/lib/gestion/labels";
import { getOperator } from "@/lib/gestion/server";

export const metadata: Metadata = { title: "Comprobante de encomienda" };
export const dynamic = "force-dynamic";

/**
 * Comprovante interno da encomenda, para entregar ao cliente ou grampear na
 * caixa. Não é boleta: a boleta sai pelo Close2U, que ainda não está ligado.
 *
 * A página vive dentro do painel (sessão obrigatória) e, na impressão, tudo
 * que não é o comprovante some — menu, cabeçalho do site, rodapé, botão de
 * WhatsApp.
 */

/* Com `:has()` (navegadores atuais) os outros elementos saem do fluxo e não
   sobram páginas em branco; sem ele, ficam só invisíveis. */
const PRINT_CSS = `
@media print {
  @page { size: A4; margin: 12mm; }
  html, body { background: #fff !important; }
  body { min-height: 0 !important; }
  @supports selector(body:has(a)) {
    body *:not(:has(#comprobante)):not(#comprobante):not(#comprobante *) { display: none !important; }
    body *:has(#comprobante) {
      margin: 0 !important; padding: 0 !important; border: 0 !important; box-shadow: none !important;
      max-width: none !important; min-height: 0 !important; background: transparent !important;
    }
  }
  @supports not selector(body:has(a)) {
    body * { visibility: hidden !important; }
    #comprobante, #comprobante * { visibility: visible !important; }
    #comprobante { position: absolute; left: 0; top: 0; width: 100%; }
  }
  #comprobante { margin: 0 !important; padding: 0 !important; border: 0 !important; box-shadow: none !important; max-width: none !important; }
  #comprobante, #comprobante * { color: #000 !important; }
  #comprobante table { page-break-inside: auto; }
  #comprobante tr { page-break-inside: avoid; }
}
`;

export default async function PrintContractPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const op = await getOperator();
  if (!op) return <p className="card p-6">Sesión expirada. Vuelve a entrar.</p>;

  const c = await loadContract(op.db, id);
  if (!c) notFound();

  const time = shortTime(c.deliverAt);
  const paidSales = c.payments.filter((s) => s.status === "paid");

  return (
    <div className="space-y-4">
      <style dangerouslySetInnerHTML={{ __html: PRINT_CSS }} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href={`/admin/encomiendas/${c.id}`} className="inline-flex h-11 items-center text-sm text-terracota underline underline-offset-2">
          ← Volver a la encomienda
        </Link>
        <PrintButton />
      </div>

      <article id="comprobante" className="card mx-auto max-w-3xl space-y-5 bg-white p-5 text-[13px] leading-snug text-cacao sm:p-8">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-crema-300 pb-4">
          <div>
            <p className="font-display text-2xl font-semibold">{brand.name}</p>
            <p>{brand.legalName}</p>
            <p>{c.store.name}</p>
            {c.store.address && <p>{c.store.address}</p>}
            {c.store.phone && <p>Tel. {c.store.phone}</p>}
          </div>
          <div className="text-right">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em]">Comprobante interno</p>
            <p className="font-display text-xl font-semibold">Encomienda N.º {c.number}</p>
            <p>Registrada: {limaDateTime(c.createdAt)}</p>
            <p>Estado: {CONTRACT_STATUS[c.status]?.label ?? c.status}</p>
          </div>
        </header>

        <p className="rounded-lg border border-crema-300 px-3 py-2 text-[12px]">
          Documento de control interno. No es boleta ni factura.
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.12em]">Cliente</p>
            <p className="font-semibold">{c.customer?.name ?? "—"}</p>
            {c.customer?.docNumber && (
              <p>{DOC_LABEL[c.customer.docType as DocType] ?? c.customer.docType}: {c.customer.docNumber}</p>
            )}
            {c.customer?.phone && <p>Cel.: {c.customer.phone}</p>}
          </div>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.12em]">Entrega</p>
            <p className="font-semibold">{formatDateLong(c.deliverOn)}{time ? ` · ${time}` : ""}</p>
            <p>{c.deliverPlace ?? "Lugar sin definir"}</p>
            {c.seller && <p>Atendió: {c.seller}</p>}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-cacao/40 text-[11px] uppercase tracking-[0.08em]">
                <th className="py-1.5 pr-2">Cant.</th>
                <th className="py-1.5 pr-2">Descripción</th>
                <th className="py-1.5 pr-2 text-right">P. unit.</th>
                <th className="py-1.5 text-right">Importe</th>
              </tr>
            </thead>
            <tbody>
              {c.lines.map((l) => (
                <tr key={l.id} className="border-b border-crema-300 align-top">
                  <td className="py-2 pr-2 tabular-nums">{l.quantity}</td>
                  <td className="py-2 pr-2">
                    <p className="font-semibold">{l.description}</p>
                    {(l.flavor || l.cakeType || l.decorator) && (
                      <p>{[l.flavor && `Sabor: ${l.flavor}`, l.cakeType && `Tipo: ${l.cakeType}`, l.decorator && `Decoradora: ${l.decorator}`].filter(Boolean).join(" · ")}</p>
                    )}
                    {l.message && <p>Mensaje: “{l.message}”</p>}
                    {l.hasPhoto && <p>Con foto de referencia</p>}
                  </td>
                  <td className="py-2 pr-2 text-right tabular-nums">{soles(l.unitPrice)}</td>
                  <td className="py-2 text-right tabular-nums">{soles(l.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <dl className="ml-auto max-w-xs space-y-1 text-[14px]">
          <div className="flex justify-between"><dt>Total</dt><dd className="tabular-nums">{soles(c.total)}</dd></div>
          <div className="flex justify-between"><dt>Pagado</dt><dd className="tabular-nums">{soles(c.paid)}</dd></div>
          <div className="flex justify-between border-t border-cacao/40 pt-1 text-[16px] font-bold">
            <dt>Saldo</dt><dd className="tabular-nums">{soles(c.balance)}</dd>
          </div>
        </dl>

        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.12em]">Pagos</p>
          {paidSales.length ? (
            <table className="mt-1 w-full border-collapse text-left">
              <tbody>
                {paidSales.map((s) => (
                  <tr key={s.id} className="border-b border-crema-300 align-top">
                    <td className="py-1.5 pr-2 whitespace-nowrap">{limaDateTime(s.soldAt)}</td>
                    <td className="py-1.5 pr-2">
                      {SALE_KIND[s.kind] ?? s.kind}
                      <span className="block text-[12px]">
                        {s.methods.map((m) => `${PAYMENT_METHOD[m.method] ?? m.method}${m.reference ? ` op. ${m.reference}` : ""}`).join(" + ")}
                      </span>
                    </td>
                    <td className="py-1.5 text-right tabular-nums">{soles(s.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p>Sin pagos registrados.</p>
          )}
        </div>

        {c.notes && (
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.12em]">Observaciones</p>
            <p className="whitespace-pre-line">{c.notes}</p>
          </div>
        )}

        <div className="grid gap-8 pt-10 sm:grid-cols-2">
          <p className="border-t border-cacao/60 pt-1 text-center text-[12px]">Firma del cliente</p>
          <p className="border-t border-cacao/60 pt-1 text-center text-[12px]">{brand.name}</p>
        </div>
      </article>
    </div>
  );
}
