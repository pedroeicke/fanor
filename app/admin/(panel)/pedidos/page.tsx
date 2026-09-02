import type { Metadata } from "next";
import { getServerSupabase } from "@/lib/supabase-server";
import { formatDateShort } from "@/lib/delivery";
import { soles } from "@/lib/format";
import { getDeliveryConfig } from "@/lib/delivery-db";
import { resolvePhotoUrl } from "@/lib/storage";
import { EmailStatus, type EmailRow } from "@/components/admin/EmailStatus";
import { OrderStatusSelect } from "@/components/admin/OrderStatusSelect";
import Link from "next/link";

export const metadata: Metadata = { title: "Pedidos" };

type Row = {
  code: string;
  status: string;
  created_at: string;
  total: string;
  delivery_date: string;
  delivery_slot: string;
  delivery_method: string;
  delivery_zone: string | null;
  delivery_address: string | null;
  customer_name: string;
  customer_phone: string;
  simulated: boolean;
  email_log: EmailRow[];
  order_items: {
    product_name: string;
    quantity: number;
    size_label: string | null;
    cake_message: string | null;
    photo_url: string | null;
  }[];
};

export default async function OrdersPage() {
  const db = await getServerSupabase();
  if (!db) return <p className="card p-6">Falta configurar la base de datos.</p>;

  const { slots: SLOTS, districts: DISTRICTS } = await getDeliveryConfig();

  const { data } = await db
    .from("orders")
    .select("*, order_items(product_name, quantity, size_label, cake_message, photo_url), email_log(kind, status, recipient, attempts, last_error, simulated)")
    .order("created_at", { ascending: false })
    .limit(100);

  const orders = (data ?? []) as unknown as Row[];

  /* O que está gravado é o caminho no balde privado, que não abre no
     navegador. O link "ver foto" precisa da URL assinada, gerada aqui. */
  const photoLinks = new Map<string, string>();
  await Promise.all(
    orders.flatMap((order) =>
      order.order_items
        .filter((item) => item.photo_url)
        .map(async (item) => {
          const url = await resolvePhotoUrl(item.photo_url);
          if (url) photoLinks.set(item.photo_url!, url);
        }),
    ),
  );

  if (!orders.length) {
    return (
      <p className="rounded-2xl border border-dashed border-crema-300 px-6 py-16 text-center text-cacao-500">
        Todavía no hay pedidos.
      </p>
    );
  }

  return (
    <ul className="space-y-3">
      {orders.map((order) => {
        const slot = SLOTS.find((s) => s.id === order.delivery_slot);
        const zone = DISTRICTS.find((d) => d.slug === order.delivery_zone);
        return (
          <li key={order.code} className="card p-4">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <span className="font-mono text-sm font-semibold">{order.code}</span>
              <Link
                href={`/admin/pedidos/${order.code}`}
                className="text-[13px] text-terracota underline underline-offset-2"
              >
                Ver detalle
              </Link>
              <OrderStatusSelect code={order.code} status={order.status} />
              {order.simulated && (
                <span className="rounded-full bg-crema-200 px-2.5 py-1 text-[11px] font-semibold text-cacao-500">
                  demostración
                </span>
              )}
              <span className="ml-auto font-display text-lg font-semibold">
                {soles(Number(order.total))}
              </span>
            </div>

            <div className="mt-3 grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
              <p>
                <span className="text-cacao-300">Cliente: </span>
                {order.customer_name} · {order.customer_phone}
              </p>
              <p>
                <span className="text-cacao-300">
                  {order.delivery_method === "pickup" ? "Recojo: " : "Entrega: "}
                </span>
                {formatDateShort(order.delivery_date)}, {slot?.label ?? order.delivery_slot}
              </p>
              {order.delivery_method === "delivery" && (
                <p className="sm:col-span-2">
                  <span className="text-cacao-300">Dirección: </span>
                  {order.delivery_address}
                  {zone && ` — ${zone.name}`}
                </p>
              )}
            </div>

            <ul className="mt-3 space-y-1 border-t border-crema-200 pt-3 text-sm">
              {order.order_items.map((item, i) => (
                <li key={i} className="flex flex-wrap gap-x-2">
                  <span className="font-medium">
                    {item.quantity}× {item.product_name}
                  </span>
                  {item.size_label && <span className="text-cacao-500">({item.size_label})</span>}
                  {item.cake_message && (
                    <span className="text-terracota">“{item.cake_message}”</span>
                  )}
                  {item.photo_url &&
                    (photoLinks.has(item.photo_url) ? (
                      <a
                        href={photoLinks.get(item.photo_url)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-terracota underline underline-offset-2"
                      >
                        ver foto
                      </a>
                    ) : (
                      <span className="text-cacao-300">foto no disponible</span>
                    ))}
                </li>
              ))}
            </ul>

            <EmailStatus code={order.code} emails={order.email_log ?? []} />
          </li>
        );
      })}
    </ul>
  );
}
