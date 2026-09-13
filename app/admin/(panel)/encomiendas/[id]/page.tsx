import type { Metadata } from "next";
import type { ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EmptyState, Notice, PageHeader, Section, StatusPill } from "@/components/admin/ui";
import { ButtonLink } from "@/components/ui/primitives";
import { CancelPanel } from "@/components/admin/encomiendas/CancelPanel";
import { DeliverPanel } from "@/components/admin/encomiendas/DeliverPanel";
import { loadContract, loadVitrine } from "@/components/admin/encomiendas/queries";
import { DOC_LABEL, isUuid, shortTime, whatsappNumber, type DeliverableCake, type DocType } from "@/components/admin/encomiendas/shared";
import { formatDateLong, formatDateShort } from "@/lib/delivery";
import { cx, soles } from "@/lib/format";
import { limaDateTime, limaToday } from "@/lib/gestion/dates";
import { CAKE_STATUS, CONTRACT_STATUS, DISPATCH_STATUS, PAYMENT_METHOD, REQUEST_STATUS, SALE_KIND } from "@/lib/gestion/labels";
import { getOperator, shortStoreName } from "@/lib/gestion/server";

export const metadata: Metadata = { title: "Encomienda" };
export const dynamic = "force-dynamic";

/**
 * Ficha da encomenda: o que foi combinado, quanto entrou, onde está a torta
 * e — enquanto não sai — a entrega com a torta exata e o saldo.
 */

function clock() {
  return { today: limaToday() };
}

function daysLate(from: string, to: string) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export default async function ContractPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const op = await getOperator();
  if (!op) return <p className="card p-6">Sesión expirada. Vuelve a entrar.</p>;

  const contract = await loadContract(op.db, id, { photos: true });
  if (!contract) notFound();

  const { today } = clock();
  const isOpen = contract.status !== "delivered" && contract.status !== "cancelled";
  const vitrine = isOpen ? await loadVitrine(op.db, contract.store.id, today) : [];
  const late = isOpen && contract.deliverOn < today ? daysLate(contract.deliverOn, today) : 0;
  const time = shortTime(contract.deliverAt);

  const reserved: DeliverableCake[] = contract.cakes
    .filter((u) => u.status === "reserved")
    .map((u) => ({ serial: u.serial, productId: u.productId, product: u.product, flavor: u.flavor, expiresOn: u.expiresOn, reserved: true }));
  const inTransit = contract.cakes.filter((u) => u.status === "in_transit").length;
  /* Encomenda fechada com OP aberta ou torta ainda presa a ela (chegou depois
     da entrega/cancelamento): ninguém mais olha esta ficha, então ela avisa. */
  const openOrders = isOpen ? [] : contract.orders.filter((o) => o.status === "planned" || o.status === "in_progress");
  const stuckCakes = isOpen ? [] : contract.cakes.filter((u) => u.status === "reserved" || u.status === "in_transit");
  const expectedProducts = [...new Set(contract.lines.filter((l) => l.isCake && l.productId).map((l) => l.productId as string))];

  const wa = whatsappNumber(contract.customer?.phoneNorm ?? contract.customer?.phone);
  const waText = contract.customer
    ? `Hola ${contract.customer.name.split(" ")[0]}, te escribimos de Tortas Fanor por tu encomienda #${contract.number} para el ${formatDateLong(contract.deliverOn).toLowerCase()}.`
    : "";

  return (
    <div className="space-y-6">
      <Link href="/admin/encomiendas" className="inline-flex h-11 items-center text-sm text-terracota underline underline-offset-2">
        ← Encomiendas
      </Link>

      <PageHeader
        title={`Encomienda #${contract.number}`}
        description={`${shortStoreName(contract.store.name)} · registrada ${limaDateTime(contract.createdAt)}`}
        actions={
          <>
            <StatusPill status={contract.status} map={CONTRACT_STATUS} />
            <ButtonLink href={`/admin/encomiendas/${contract.id}/imprimir`} variant="outline" size="md">
              Imprimir comprobante
            </ButtonLink>
          </>
        }
      />

      {late > 0 && (
        <Notice tone="bad">
          <strong>Atrasada:</strong> debía entregarse el {formatDateLong(contract.deliverOn).toLowerCase()}
          {late === 1 ? " (ayer)" : ` (hace ${late} días)`}.
        </Notice>
      )}
      {contract.status === "delivered" && (
        <Notice tone="ok">Entregada{contract.closedAt ? ` el ${limaDateTime(contract.closedAt)}` : ""}.</Notice>
      )}
      {contract.status === "cancelled" && (
        <Notice tone="info">
          Cancelada{contract.closedAt ? ` el ${limaDateTime(contract.closedAt)}` : ""}.
          {contract.paid > 0 && ` Tiene ${soles(contract.paid)} cobrados: la devolución, si corresponde, se registra aparte.`}
        </Notice>
      )}
      {openOrders.length > 0 && (
        <Notice tone="warn">
          {openOrders.length === 1 ? `La orden del taller #${openOrders[0].number} sigue abierta` : `Las órdenes del taller ${openOrders.map((o) => `#${o.number}`).join(", ")} siguen abiertas`}{" "}
          aunque la encomienda está cerrada. {openOrders.length === 1 ? "Ciérrala" : "Ciérralas"} en el{" "}
          <Link href="/admin/taller" className="font-semibold underline underline-offset-2">Taller</Link> para que no se produzca de más.
        </Notice>
      )}
      {stuckCakes.length > 0 && (
        <Notice tone="warn">
          {stuckCakes.length === 1
            ? `La torta ${stuckCakes[0].serial} sigue ligada a esta encomienda cerrada y no aparece en la vitrina.`
            : `Las tortas ${stuckCakes.map((u) => u.serial).join(", ")} siguen ligadas a esta encomienda cerrada y no aparecen en la vitrina.`}{" "}
          {stuckCakes.some((u) => u.status === "in_transit") && "La que está en camino quedará reservada al recibirse. "}
          Avisa al administrador para liberar{stuckCakes.length === 1 ? "la" : "las"}.
        </Notice>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <section className={cx("card space-y-2 p-5", late > 0 && "border-terracota/40")}>
          <h3 className="font-display text-lg">Entrega</h3>
          <p className={cx("font-display text-2xl font-semibold", late > 0 ? "text-terracota" : "text-cacao")}>
            {formatDateLong(contract.deliverOn)}
            {time && <span className="text-cacao-500"> · {time}</span>}
          </p>
          <dl className="space-y-1 text-sm">
            <Row label="Lugar" value={contract.deliverPlace ?? "Sin definir"} />
            <Row label="Tienda" value={shortStoreName(contract.store.name)} />
            <Row label="Vendedora" value={contract.seller ?? "—"} />
          </dl>
        </section>

        <section className="card space-y-2 p-5">
          <h3 className="font-display text-lg">Cliente</h3>
          {contract.customer ? (
            <>
              <Link href={`/admin/clientes/${contract.customer.id}`} className="block font-semibold text-cacao underline underline-offset-2">
                {contract.customer.name}
              </Link>
              <dl className="space-y-1 text-sm">
                {contract.customer.phone && (
                  <Row label="Celular" value={<a href={`tel:${contract.customer.phone.replace(/[^\d+]/g, "")}`} className="underline underline-offset-2">{contract.customer.phone}</a>} />
                )}
                {contract.customer.docNumber && (
                  <Row label={DOC_LABEL[contract.customer.docType as DocType] ?? contract.customer.docType} value={contract.customer.docNumber} />
                )}
                {contract.customer.email && <Row label="Correo" value={contract.customer.email} />}
              </dl>
              {wa && (
                <a
                  href={`https://wa.me/${wa}?text=${encodeURIComponent(waText)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 inline-flex h-11 items-center rounded-full bg-[#25D366] px-5 text-sm font-semibold text-[#0b3d20] hover:bg-[#1fbb59]"
                >
                  Escribir por WhatsApp
                </a>
              )}
            </>
          ) : (
            <p className="text-sm text-cacao-500">Sin cliente registrado.</p>
          )}
        </section>

        <section className="card space-y-2 p-5">
          <h3 className="font-display text-lg">Cuenta</h3>
          <dl className="space-y-1 text-sm">
            <Row label="Total" value={soles(contract.total)} />
            <Row label="Pagado" value={soles(contract.paid)} />
          </dl>
          <p className="flex items-baseline justify-between border-t border-crema-200 pt-2">
            <span className="text-sm font-semibold text-cacao-700">Saldo</span>
            <span className={cx("font-display text-2xl font-semibold tabular-nums", contract.balance > 0 && isOpen ? "text-terracota" : "text-verde")}>
              {soles(contract.balance)}
            </span>
          </p>
        </section>
      </div>

      {isOpen && (
        <section className="card space-y-4 p-4 sm:p-5">
          <DeliverPanel
            contractId={contract.id}
            balance={contract.balance}
            expectedCakes={contract.expectedCakes}
            expectedProducts={expectedProducts}
            reserved={reserved}
            vitrine={vitrine}
            inTransit={inTransit}
            today={today}
          />
          <div className="border-t border-crema-200 pt-2">
            <CancelPanel contractId={contract.id} number={contract.number} paid={contract.paid} reserved={reserved.length} inTransit={inTransit} />
          </div>
        </section>
      )}

      <Section title="Productos" aside={`${contract.lines.length} ${contract.lines.length === 1 ? "línea" : "líneas"}`}>
        {contract.lines.length ? (
          <ul className="divide-y divide-crema-200">
            {contract.lines.map((l) => (
              <li key={l.id} className="flex flex-wrap gap-4 px-5 py-4">
                {l.photoUrl && (
                  <a href={l.photoUrl} target="_blank" rel="noopener noreferrer" className="block shrink-0 overflow-hidden rounded-xl border border-crema-300" title="Ver foto de referencia">
                    <Image src={l.photoUrl} alt={`Referencia de ${l.description}`} width={88} height={88} unoptimized className="h-22 w-22 object-cover" />
                  </a>
                )}
                <div className="min-w-0 flex-1 space-y-1 text-sm">
                  <p className="font-semibold text-cacao">
                    {l.quantity}× {l.description}
                    {l.sku && <span className="ml-2 font-normal text-cacao-300">{l.sku}</span>}
                  </p>
                  <p className="text-cacao-700">
                    {[l.flavor && `Sabor: ${l.flavor}`, l.cakeType && `Tipo: ${l.cakeType}`, l.decorator && `Decoradora: ${l.decorator}`].filter(Boolean).join(" · ") ||
                      (l.isCake ? "Sin sabor ni decoración indicados" : "")}
                  </p>
                  {l.message && <p className="text-terracota">“{l.message}”</p>}
                  {l.hasPhoto && !l.photoUrl && <p className="text-cacao-500">Foto de referencia no disponible.</p>}
                </div>
                <div className="text-right text-sm">
                  <p className="font-semibold tabular-nums">{soles(l.total)}</p>
                  {l.quantity > 1 && <p className="text-cacao-500 tabular-nums">{soles(l.unitPrice)} c/u</p>}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState>Sin productos.</EmptyState>
        )}
      </Section>

      <Section title="Pagos" aside={`Pagado ${soles(contract.paid)} de ${soles(contract.total)}`}>
        {contract.payments.length ? (
          <ul className="divide-y divide-crema-200">
            {contract.payments.map((s) => (
              <li key={s.id} className={cx("flex flex-wrap items-start justify-between gap-3 px-5 py-3 text-sm", s.status !== "paid" && "opacity-60")}>
                <div className="space-y-0.5">
                  <p className="font-semibold text-cacao">
                    {SALE_KIND[s.kind] ?? s.kind} <span className="font-mono font-normal text-cacao-300">· venta #{s.number}</span>
                    {s.status === "void" && <span className="ml-2 text-terracota">anulada</span>}
                  </p>
                  <p className="text-cacao-500">{limaDateTime(s.soldAt)}</p>
                  <p className="text-cacao-700">
                    {s.methods.map((m) => `${PAYMENT_METHOD[m.method] ?? m.method} ${soles(m.amount)}${m.reference ? ` (op. ${m.reference})` : ""}`).join(" + ") || "—"}
                  </p>
                </div>
                <p className="font-semibold tabular-nums">{soles(s.total)}</p>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState>Sin pagos registrados.</EmptyState>
        )}
        <div className="flex justify-between border-t border-crema-200 px-5 py-3 text-sm">
          <span className="font-semibold text-cacao-700">Saldo</span>
          <span className={cx("font-semibold tabular-nums", contract.balance > 0 && isOpen ? "text-terracota" : "text-verde")}>{soles(contract.balance)}</span>
        </div>
      </Section>

      <Section title="Producción">
        <div className="space-y-5 px-5 py-4 text-sm">
          <div className="space-y-2">
            <p className="text-[12px] font-bold uppercase tracking-[0.12em] text-cacao-300">Orden para el taller</p>
            {contract.orders.length ? (
              contract.orders.map((o) => (
                <div key={o.id} className="rounded-2xl border border-crema-300 px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">OP #{o.number}</span>
                    <StatusPill status={o.status} map={REQUEST_STATUS} />
                    <span className="text-cacao-500">para el {formatDateShort(o.forDate)}</span>
                  </div>
                  <ul className="mt-2 space-y-1 text-cacao-700">
                    {o.lines.map((l) => (
                      <li key={l.id}>{l.product}: {l.produced} de {l.quantity} despachada{l.quantity === 1 ? "" : "s"}</li>
                    ))}
                  </ul>
                </div>
              ))
            ) : (
              <p className="text-cacao-500">Sin orden de producción: la encomienda no lleva tortas con serie.</p>
            )}
          </div>

          <div className="space-y-2">
            <p className="text-[12px] font-bold uppercase tracking-[0.12em] text-cacao-300">Tortas de la encomienda</p>
            {contract.cakes.length ? (
              <ul className="divide-y divide-crema-200 rounded-2xl border border-crema-300">
                {contract.cakes.map((u) => (
                  <li key={u.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                    <span className="min-w-0">
                      <span className="font-mono text-[13px] text-cacao-700">{u.serial}</span>{" "}
                      <span className="text-cacao">{u.product}{u.flavor ? ` · ${u.flavor}` : ""}</span>
                      <span className="block text-[12px] text-cacao-500">
                        {[u.decorator && `Decoró ${u.decorator}`, `vence ${formatDateShort(u.expiresOn)}`].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                    <StatusPill status={u.status} map={CAKE_STATUS} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-cacao-500">
                {contract.orders.length ? "El taller todavía no despachó ninguna torta." : "Ninguna torta ligada a esta encomienda."}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <p className="text-[12px] font-bold uppercase tracking-[0.12em] text-cacao-300">Despachos</p>
            {contract.dispatches.length ? (
              <ul className="divide-y divide-crema-200 rounded-2xl border border-crema-300">
                {contract.dispatches.map((d) => (
                  <li key={d.id}>
                    <Link href={`/admin/taller/despachos/${d.id}`} className="flex min-h-11 flex-wrap items-center justify-between gap-2 px-4 py-2.5 hover:bg-crema-100">
                      <span>
                        <span className="font-semibold">Despacho #{d.number}</span>{" "}
                        <span className="font-mono text-[12px] text-cacao-300">{d.code}</span>
                        <span className="block text-[12px] text-cacao-500">
                          Salió {limaDateTime(d.dispatchedAt)}{d.receivedAt ? ` · recibido ${limaDateTime(d.receivedAt)}` : ""}
                        </span>
                      </span>
                      <StatusPill status={d.status} map={DISPATCH_STATUS} />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-cacao-500">Sin despachos todavía.</p>
            )}
          </div>
        </div>
      </Section>

      {contract.notes && (
        <Section title="Observaciones">
          <p className="whitespace-pre-line px-5 py-4 text-sm text-cacao-700">{contract.notes}</p>
        </Section>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="shrink-0 text-cacao-500">{label}</dt>
      <dd className="min-w-0 break-words text-right text-cacao">{value}</dd>
    </div>
  );
}
