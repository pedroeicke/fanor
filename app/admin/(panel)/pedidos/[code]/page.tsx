import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase-server";
import { getDeliveryConfig } from "@/lib/delivery-db";
import { formatDateLong } from "@/lib/delivery";
import { soles } from "@/lib/format";
import { resolvePhotoUrl } from "@/lib/storage";
import { OrderStatusSelect } from "@/components/admin/OrderStatusSelect";
import { EmailStatus, type EmailRow } from "@/components/admin/EmailStatus";

export const metadata: Metadata = { title: "Detalle del pedido" };

export default async function AdminOrderDetail({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const db = await getServerSupabase();
  if (!db) return <p className="card p-6">Falta configurar la base de datos.</p>;

  const { data } = await db
    .from("orders")
    .select("*, stores(name, address), order_items(*), email_log(kind, status, recipient, attempts, last_error, simulated), payment_events(provider, event_type, payment_reference, processed_at)")
    .eq("code", code)
    .maybeSingle();
  if (!data) notFound();

  const config = await getDeliveryConfig();
  const slot = config.slots.find((item) => item.id === data.delivery_slot);
  const zone = config.districts.find((item) => item.slug === data.delivery_zone);
  const deliveryMapUrl =
    data.delivery_lat !== null && data.delivery_lng !== null
      ? `https://www.openstreetmap.org/?mlat=${data.delivery_lat}&mlon=${data.delivery_lng}#map=17/${data.delivery_lat}/${data.delivery_lng}`
      : null;
  const items = (data.order_items ?? []) as {
    id: string;
    product_name: string;
    size_label: string | null;
    flavors: string[];
    quantity: number;
    unit_price: string;
    cake_message: string | null;
    photo_url: string | null;
  }[];
  const photos = new Map<string, string>();
  await Promise.all(
    items.filter((item) => item.photo_url).map(async (item) => {
      const url = await resolvePhotoUrl(item.photo_url);
      if (url) photos.set(item.photo_url!, url);
    }),
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/admin/pedidos" className="text-sm text-terracota underline underline-offset-2">
          ← Pedidos
        </Link>
        <h2 className="font-mono text-xl font-semibold">{data.code}</h2>
        <OrderStatusSelect code={data.code} status={data.status} />
        {data.simulated && <span className="rounded-full bg-dorado-100 px-3 py-1 text-xs">demostración</span>}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card p-5">
          <h3 className="text-xl">Cliente</h3>
          <dl className="mt-4 space-y-2 text-sm">
            <Row label="Nombre" value={data.customer_name} />
            <Row label="Celular" value={data.customer_phone} />
            <Row label="Correo" value={data.customer_email} />
            <Row label="Creado" value={new Date(data.created_at).toLocaleString("es-PE")} />
          </dl>
        </section>

        <section className="card p-5">
          <h3 className="text-xl">Entrega</h3>
          <dl className="mt-4 space-y-2 text-sm">
            <Row label="Fecha" value={formatDateLong(data.delivery_date)} />
            <Row label="Franja" value={slot?.label ?? data.delivery_slot} />
            <Row label="Modalidad" value={data.delivery_method === "pickup" ? "Recojo" : "Delivery"} />
            <Row label="Dirección" value={data.delivery_address || "—"} />
            <Row label="Distrito" value={zone?.name ?? data.delivery_zone ?? "—"} />
            <Row label="Referencia" value={data.delivery_reference || "—"} />
            <Row label="Tienda" value={data.stores?.name ?? "Sin asignar"} />
            {deliveryMapUrl && (
              <Row
                label="Ubicación"
                value={
                  <a
                    href={deliveryMapUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-terracota underline underline-offset-2"
                  >
                    Abrir punto en el mapa
                  </a>
                }
              />
            )}
          </dl>
        </section>
      </div>

      <section className="card p-5">
        <h3 className="text-xl">Productos</h3>
        <ul className="mt-4 divide-y divide-crema-200">
          {items.map((item) => (
            <li key={item.id} className="flex flex-wrap justify-between gap-3 py-3 text-sm">
              <div>
                <p className="font-medium">{item.quantity}× {item.product_name}</p>
                {item.size_label && <p className="text-cacao-500">{item.size_label}</p>}
                {item.flavors?.length > 0 && <p className="text-cacao-500">{item.flavors.join(" · ")}</p>}
                {item.cake_message && <p className="text-terracota">“{item.cake_message}”</p>}
                {item.photo_url && photos.has(item.photo_url) && (
                  <a href={photos.get(item.photo_url)} target="_blank" rel="noopener noreferrer" className="text-terracota underline">
                    Ver foto del cliente
                  </a>
                )}
              </div>
              <strong>{soles(Number(item.unit_price) * item.quantity)}</strong>
            </li>
          ))}
        </ul>
        <dl className="ml-auto mt-4 max-w-xs space-y-2 border-t border-crema-200 pt-4 text-sm">
          <Row label="Subtotal" value={soles(Number(data.subtotal))} />
          <Row label="Delivery" value={soles(Number(data.shipping))} />
          <Row label="Total" value={soles(Number(data.total))} strong />
        </dl>
      </section>

      <section className="card p-5">
        <h3 className="text-xl">Pago y comunicaciones</h3>
        <p className="mt-2 text-sm text-cacao-500">
          {data.payment_method} · {data.payment_provider ?? "manual"} · {data.payment_reference ?? "sin referencia"}
        </p>
        <EmailStatus code={data.code} emails={(data.email_log ?? []) as EmailRow[]} />
        {(data.payment_events ?? []).length > 0 && (
          <ul className="mt-4 space-y-2 border-t border-crema-200 pt-4 text-xs">
            {(data.payment_events as { provider: string; event_type: string; payment_reference: string | null; processed_at: string }[]).map((event, index) => (
              <li key={`${event.event_type}-${index}`} className="flex flex-wrap justify-between gap-2">
                <span>{event.provider} · {event.event_type}</span>
                <span className="text-cacao-500">{new Date(event.processed_at).toLocaleString("es-PE")}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Row({ label, value, strong = false }: { label: string; value: ReactNode; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-cacao-500">{label}</dt>
      <dd className={strong ? "font-semibold" : "text-right"}>{value}</dd>
    </div>
  );
}
