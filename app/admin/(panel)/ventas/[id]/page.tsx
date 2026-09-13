import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { friendlyDbError, getOperator, shortStoreName } from "@/lib/gestion/server";
import { STORE_TIME_ZONE } from "@/lib/gestion/dates";
import { CONTRACT_STATUS, PAYMENT_METHOD, SALE_KIND, TONE_CLASS } from "@/lib/gestion/labels";
import { cx } from "@/lib/format";
import { Notice, Section, StatusPill } from "@/components/admin/ui";
import { money, solesToCents } from "@/components/admin/venta/money";
import { docLabel, shortDay } from "@/components/admin/venta/format";

export const metadata: Metadata = { title: "Detalle de venta" };
export const dynamic = "force-dynamic";

/**
 * Uma venda inteira: o que saiu (com a série de cada torta), como foi pago,
 * para quem e em que pé está a boleta. É a tela que responde "vendi a torta
 * G… para quem?" sem abrir o banco.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DOC_TYPE: Record<string, string> = { "01": "Factura", "03": "Boleta", "07": "Nota de crédito", "08": "Nota de débito" };

const FISCAL_STATUS: Record<string, { label: string; tone: keyof typeof TONE_CLASS }> = {
  draft: { label: "Borrador", tone: "muted" },
  sent: { label: "Enviada", tone: "info" },
  accepted: { label: "Aceptada por SUNAT", tone: "ok" },
  accepted_with_notes: { label: "Aceptada con observaciones", tone: "warn" },
  rejected: { label: "Rechazada", tone: "bad" },
  queued: { label: "En cola SUNAT", tone: "info" },
  pending: { label: "Pendiente SUNAT", tone: "warn" },
  voided: { label: "Dada de baja", tone: "muted" },
  error: { label: "Error de envío", tone: "bad" },
};

const SALE_STATUS: Record<string, { label: string; tone: keyof typeof TONE_CLASS }> = {
  paid: { label: "Cobrada", tone: "ok" },
  open: { label: "Sin cobrar", tone: "warn" },
  void: { label: "Anulada", tone: "bad" },
};

type SaleDetail = {
  id: string;
  number: number;
  sold_at: string;
  kind: string;
  status: string;
  subtotal: number | string;
  igv: number | string;
  total: number | string;
  fiscal_pending: boolean;
  notes: string | null;
  stores: { name: string } | null;
  sellers: { name: string } | null;
  customers: { id: string; name: string; doc_type: string; doc_number: string | null; phone: string | null; email: string | null } | null;
  contracts: { id: string; number: number; status: string; deliver_on: string } | null;
  sale_lines: {
    id: string;
    description: string;
    quantity: number | string;
    unit_price: number | string;
    discount: number | string;
    total: number | string;
    sort_order: number;
    expires_on: string | null;
    cake_units: { serial: string; flavors: { name: string } | null } | null;
  }[];
  sale_payments: { id: string; method: string; amount: number | string; reference: string | null; paid_at: string }[];
  fiscal_documents: { id: string; doc_type: string; serie: string; number: number; status: string; issued_on: string; last_error: string | null }[];
};

function fullDateTime(value: string) {
  return new Date(value).toLocaleString("es-PE", {
    timeZone: STORE_TIME_ZONE,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function VentaDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  const op = await getOperator();
  if (!op) return <Notice tone="bad">Sesión expirada. Vuelve a entrar.</Notice>;

  const { data, error } = await op.db
    .from("sales")
    .select(
      `id, number, sold_at, kind, status, subtotal, igv, total, fiscal_pending, notes,
       stores(name), sellers(name),
       customers(id, name, doc_type, doc_number, phone, email),
       contracts(id, number, status, deliver_on),
       sale_lines(id, description, quantity, unit_price, discount, total, sort_order, expires_on, cake_units(serial, flavors(name))),
       sale_payments(id, method, amount, reference, paid_at),
       fiscal_documents(id, doc_type, serie, number, status, issued_on, last_error)`,
    )
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return (
      <div className="space-y-4">
        <BackLink />
        <Notice tone="bad">{friendlyDbError(error)}</Notice>
      </div>
    );
  }
  if (!data) notFound();

  const sale = data as unknown as SaleDetail;
  const lines = [...(sale.sale_lines ?? [])].sort((a, b) => a.sort_order - b.sort_order);
  const discounts = lines.reduce((sum, l) => sum + solesToCents(l.discount), 0);
  const paidCents = (sale.sale_payments ?? []).reduce((sum, p) => sum + solesToCents(p.amount), 0);
  const hasCash = sale.sale_payments?.some((p) => p.method === "cash");
  const doc = sale.customers ? docLabel(sale.customers.doc_type, sale.customers.doc_number) : null;

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <BackLink />
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="font-display text-2xl">Venta N.º {sale.number}</h2>
          <StatusPill status={sale.status} map={SALE_STATUS} />
          <span className={cx("inline-flex h-7 items-center rounded-full border px-3 text-[12px] font-semibold", TONE_CLASS.info)}>
            {SALE_KIND[sale.kind] ?? sale.kind}
          </span>
          {sale.fiscal_pending && sale.status === "paid" && (
            <span className={cx("inline-flex h-7 items-center rounded-full border px-3 text-[12px] font-semibold", TONE_CLASS.warn)}>
              Boleta pendiente
            </span>
          )}
        </div>
        <p className="text-sm text-cacao-500">
          {fullDateTime(sale.sold_at)} · {shortStoreName(sale.stores?.name)}
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,360px)] lg:items-start">
        <div className="space-y-6">
          <Section title="Productos" aside={`${lines.length} ${lines.length === 1 ? "línea" : "líneas"}`}>
            {lines.length ? (
              <ul className="divide-y divide-crema-200">
                {lines.map((line) => {
                  const qty = Number(line.quantity);
                  const discount = solesToCents(line.discount);
                  return (
                    <li key={line.id} className="flex items-start gap-3 px-5 py-4">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-cacao">{line.description}</p>
                        <p className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-[13px] text-cacao-500">
                          <span className="tabular-nums">
                            {Number.isInteger(qty) ? qty : qty.toFixed(3)} × {money(solesToCents(line.unit_price))}
                          </span>
                          {discount > 0 && <span className="text-terracota">· Desc. {money(discount)}</span>}
                          {line.cake_units && (
                            <span>
                              · Serie <span className="font-mono text-cacao-700">{line.cake_units.serial}</span>
                            </span>
                          )}
                          {line.cake_units?.flavors?.name && <span>· {line.cake_units.flavors.name}</span>}
                          {line.cake_units && line.expires_on && <span>· vencía {shortDay(line.expires_on)}</span>}
                        </p>
                      </div>
                      <p className="shrink-0 font-semibold tabular-nums text-cacao">{money(solesToCents(line.total))}</p>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="px-5 py-6 text-sm text-cacao-500">La venta no tiene líneas.</p>
            )}
            <dl className="space-y-1.5 border-t border-crema-200 bg-crema-100/60 px-5 py-4 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-cacao-500">Op. gravada</dt>
                <dd className="tabular-nums text-cacao-700">{money(solesToCents(sale.subtotal))}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-cacao-500">IGV (18 %)</dt>
                <dd className="tabular-nums text-cacao-700">{money(solesToCents(sale.igv))}</dd>
              </div>
              {discounts > 0 && (
                <div className="flex justify-between gap-3">
                  <dt className="text-cacao-500">Descuentos aplicados</dt>
                  <dd className="tabular-nums text-terracota">{money(discounts)}</dd>
                </div>
              )}
              <div className="flex justify-between gap-3 border-t border-crema-300 pt-2">
                <dt className="font-semibold text-cacao">Total</dt>
                <dd className="font-display text-xl font-semibold tabular-nums text-cacao">{money(solesToCents(sale.total))}</dd>
              </div>
            </dl>
          </Section>

          <Section title="Pagos" aside={money(paidCents)}>
            {sale.sale_payments?.length ? (
              <ul className="divide-y divide-crema-200">
                {sale.sale_payments.map((p) => (
                  <li key={p.id} className="flex items-center gap-3 px-5 py-3 text-sm">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-cacao">{PAYMENT_METHOD[p.method] ?? p.method}</p>
                      {p.reference && <p className="text-[13px] text-cacao-500">Ref. {p.reference}</p>}
                    </div>
                    <p className="font-semibold tabular-nums text-cacao">{money(solesToCents(p.amount))}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-5 py-6 text-sm text-cacao-500">Sin pagos registrados.</p>
            )}
            {hasCash && (
              <p className="border-t border-crema-200 px-5 py-3 text-[13px] text-cacao-500">
                El efectivo se registra ya descontado el vuelto: es lo que quedó en caja.
              </p>
            )}
          </Section>
        </div>

        <div className="space-y-6">
          <Section title="Comprobante">
            <div className="space-y-3 p-5 text-sm">
              {sale.fiscal_documents?.map((d) => (
                <div key={d.id} className="space-y-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium text-cacao">
                      {DOC_TYPE[d.doc_type] ?? d.doc_type} {d.serie}-{String(d.number).padStart(8, "0")}
                    </p>
                    <StatusPill status={d.status} map={FISCAL_STATUS} />
                  </div>
                  <p className="text-[13px] text-cacao-500">Fecha de emisión: {shortDay(d.issued_on)}</p>
                  {d.last_error && <p className="text-[13px] text-terracota">{d.last_error}</p>}
                </div>
              ))}
              {sale.fiscal_pending ? (
                <Notice tone="warn">Boleta pendiente: se emitirá cuando se active Close2U.</Notice>
              ) : (
                !sale.fiscal_documents?.length && <p className="text-cacao-500">Sin comprobante pendiente.</p>
              )}
            </div>
          </Section>

          <Section title="Cliente">
            <div className="space-y-1 p-5 text-sm">
              {sale.customers ? (
                <>
                  <Link
                    href={`/admin/clientes/${sale.customers.id}`}
                    className="font-medium text-terracota underline underline-offset-2"
                  >
                    {sale.customers.name}
                  </Link>
                  {doc && <p className="text-cacao-700">{doc}</p>}
                  {sale.customers.phone && <p className="text-cacao-500">{sale.customers.phone}</p>}
                  {sale.customers.email && <p className="break-all text-cacao-500">{sale.customers.email}</p>}
                </>
              ) : (
                <p className="text-cacao-700">Público general</p>
              )}
            </div>
          </Section>

          <Section title="Registro">
            <dl className="space-y-2 p-5 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-cacao-500">Tienda</dt>
                <dd className="text-right text-cacao-700">{shortStoreName(sale.stores?.name)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-cacao-500">Vendedora</dt>
                <dd className="text-right text-cacao-700">{sale.sellers?.name ?? "—"}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-cacao-500">Tipo</dt>
                <dd className="text-right text-cacao-700">{SALE_KIND[sale.kind] ?? sale.kind}</dd>
              </div>
              {sale.contracts && (
                <div className="flex items-start justify-between gap-3">
                  <dt className="text-cacao-500">Encomienda</dt>
                  <dd className="text-right">
                    <Link
                      href={`/admin/encomiendas/${sale.contracts.id}`}
                      className="font-medium text-terracota underline underline-offset-2"
                    >
                      N.º {sale.contracts.number}
                    </Link>
                    <span className="block text-[13px] text-cacao-500">
                      {CONTRACT_STATUS[sale.contracts.status]?.label ?? sale.contracts.status} · entrega {shortDay(sale.contracts.deliver_on)}
                    </span>
                  </dd>
                </div>
              )}
              {sale.notes && (
                <div className="border-t border-crema-200 pt-2">
                  <dt className="text-cacao-500">Nota</dt>
                  <dd className="mt-0.5 whitespace-pre-line text-cacao-700">{sale.notes}</dd>
                </div>
              )}
            </dl>
          </Section>
        </div>
      </div>
    </div>
  );
}

function BackLink() {
  return (
    <Link href="/admin/ventas" className="inline-flex min-h-11 items-center text-sm text-terracota underline underline-offset-2">
      ← Ventas
    </Link>
  );
}
