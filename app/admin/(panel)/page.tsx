import Link from "next/link";
import { getServerSupabase } from "@/lib/supabase-server";
import { formatDateLong, toISO } from "@/lib/delivery";
import { getDeliveryConfig } from "@/lib/delivery-db";
import { soles } from "@/lib/format";
import { IconArrowRight, IconCake, IconCalendar, IconTruck } from "@/components/ui/icons";

/**
 * Resumo operacional.
 *
 * A pergunta que a cozinha tem toda manhã é "o que sai hoje e o que sai
 * amanhã". Por isso a tela abre pela produção por data de entrega, e não por
 * um gráfico de faturamento.
 */
type OrderRow = {
  code: string;
  status: string;
  total: string;
  delivery_date: string;
  delivery_slot: string;
  delivery_method: string;
  customer_name: string;
  order_items: { product_name: string; quantity: number; cake_message: string | null }[];
};

/* Mesmos rótulos do seletor em /admin/pedidos. Um pago recusado não é
   "esperando pago": é um pedido que precisa de outra ação. */
const STATUS_LABEL: Record<string, string> = {
  pending_payment: "Esperando pago",
  paid: "Pagado",
  failed: "Pago fallido",
  cancelled: "Cancelado",
  abandoned: "Abandonado",
};

export default async function AdminHome() {
  const db = await getServerSupabase();
  if (!db) return <EmptyState />;

  const { slots: SLOTS } = await getDeliveryConfig();

  const today = toISO(new Date());
  const horizon = new Date();
  horizon.setDate(horizon.getDate() + 7);

  const { data } = await db
    .from("orders")
    .select("code, status, total, delivery_date, delivery_slot, delivery_method, customer_name, order_items(product_name, quantity, cake_message)")
    .gte("delivery_date", today)
    .lte("delivery_date", toISO(horizon))
    .neq("status", "cancelled")
    .neq("status", "abandoned")
    .order("delivery_date", { ascending: true });

  const orders = (data ?? []) as unknown as OrderRow[];

  const byDate = new Map<string, OrderRow[]>();
  orders.forEach((o) => {
    const list = byDate.get(o.delivery_date) ?? [];
    list.push(o);
    byDate.set(o.delivery_date, list);
  });

  const revenue = orders
    .filter((o) => o.status === "paid")
    .reduce((sum, o) => sum + Number(o.total), 0);

  const awaiting = orders.filter((o) => o.status === "pending_payment").length;
  const cakes = orders.reduce(
    (n, o) => n + o.order_items.reduce((k, i) => k + i.quantity, 0),
    0,
  );

  return (
    <>
      <ul className="grid gap-3 sm:grid-cols-3">
        <Stat icon={<IconCake className="h-5 w-5" />} label="Piezas a producir" value={String(cakes)} hint="próximos 7 días" />
        <Stat icon={<IconTruck className="h-5 w-5" />} label="Pedidos pagados" value={soles(revenue)} hint="próximos 7 días" />
        <Stat
          icon={<IconCalendar className="h-5 w-5" />}
          label="Esperando pago"
          value={String(awaiting)}
          hint={awaiting ? "requieren seguimiento" : "todo al día"}
          alert={awaiting > 0}
        />
      </ul>

      {byDate.size === 0 ? (
        <p className="mt-8 rounded-2xl border border-dashed border-crema-300 px-6 py-14 text-center text-cacao-500">
          No hay pedidos programados para los próximos 7 días.
        </p>
      ) : (
        <div className="mt-8 space-y-6">
          {[...byDate.entries()].map(([date, list]) => (
            <section key={date}>
              <h2 className="flex items-baseline gap-3 text-xl">
                {formatDateLong(date)}
                {date === today && (
                  <span className="rounded-full bg-dorado px-2.5 py-0.5 font-sans text-[11px] font-bold uppercase tracking-wide text-cacao">
                    hoy
                  </span>
                )}
                <span className="font-sans text-sm font-normal text-cacao-300">
                  {list.length} {list.length === 1 ? "pedido" : "pedidos"}
                </span>
              </h2>

              <ul className="mt-3 space-y-2">
                {list.map((order) => {
                  const slot = SLOTS.find((s) => s.id === order.delivery_slot);
                  return (
                    <li key={order.code} className="card flex flex-wrap items-center gap-x-5 gap-y-2 p-4">
                      <span className="font-mono text-sm font-semibold">{order.code}</span>
                      <span className="text-sm text-cacao-500">{slot?.label ?? order.delivery_slot}</span>
                      <span className="text-sm">{order.customer_name}</span>
                      <span className="text-[13px] text-cacao-500">
                        {order.order_items.map((i) => `${i.quantity}× ${i.product_name}`).join(" · ")}
                      </span>
                      <span
                        className={`ml-auto rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                          order.status === "paid"
                            ? "bg-verde-100 text-verde"
                            : order.status === "failed"
                              ? "bg-terracota/10 text-terracota-700"
                              : "bg-dorado-100 text-cacao-700"
                        }`}
                      >
                        {STATUS_LABEL[order.status] ?? order.status}
                      </span>
                      <span className="font-medium">{soles(Number(order.total))}</span>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}

      <Link
        href="/admin/pedidos"
        className="mt-8 inline-flex items-center gap-2 text-[15px] font-medium text-terracota underline underline-offset-4"
      >
        Ver todos los pedidos
        <IconArrowRight className="h-4 w-4" />
      </Link>
    </>
  );
}

function Stat({
  icon,
  label,
  value,
  hint,
  alert = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint: string;
  alert?: boolean;
}) {
  return (
    <li className="card p-5">
      <span className="flex items-center gap-2 text-sm text-cacao-500">
        <span className={alert ? "text-terracota" : "text-dorado-600"}>{icon}</span>
        {label}
      </span>
      <p className="mt-2 font-display text-3xl font-semibold">{value}</p>
      <p className="mt-0.5 text-[13px] text-cacao-300">{hint}</p>
    </li>
  );
}

function EmptyState() {
  return (
    <p className="card p-6 text-[15px] text-cacao-700">
      El panel necesita conexión con la base de datos. Configura las variables del Supabase en{" "}
      <code className="font-mono text-[13px]">.env.local</code>.
    </p>
  );
}
