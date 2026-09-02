import type { Metadata } from "next";
import { getServerSupabase } from "@/lib/supabase-server";
import { soles } from "@/lib/format";

export const metadata: Metadata = { title: "Reportes de ventas" };

type ReportOrder = {
  code: string;
  created_at: string;
  subtotal: string;
  shipping: string;
  total: string;
  order_items: { product_name: string; quantity: number; unit_price: string }[];
};

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ desde?: string; hasta?: string }>;
}) {
  const query = await searchParams;
  const today = new Date();
  const monthAgo = new Date(today);
  monthAgo.setDate(monthAgo.getDate() - 29);
  const from = /^\d{4}-\d{2}-\d{2}$/.test(query.desde ?? "") ? query.desde! : isoDate(monthAgo);
  const to = /^\d{4}-\d{2}-\d{2}$/.test(query.hasta ?? "") ? query.hasta! : isoDate(today);

  const db = await getServerSupabase();
  if (!db) return <p className="card p-6">Falta configurar la base de datos.</p>;
  const { data, error } = await db
    .from("orders")
    .select("code, created_at, subtotal, shipping, total, order_items(product_name, quantity, unit_price)")
    .eq("status", "paid")
    .gte("created_at", `${from}T00:00:00`)
    .lte("created_at", `${to}T23:59:59.999`)
    .order("created_at", { ascending: true })
    .limit(5000);
  if (error) return <p className="card p-6 text-terracota">{error.message}</p>;

  const orders = (data ?? []) as unknown as ReportOrder[];
  const revenue = orders.reduce((sum, order) => sum + Number(order.total), 0);
  const shipping = orders.reduce((sum, order) => sum + Number(order.shipping), 0);
  const pieces = orders.reduce(
    (sum, order) => sum + order.order_items.reduce((count, item) => count + item.quantity, 0),
    0,
  );
  const daily = new Map<string, number>();
  const products = new Map<string, { quantity: number; revenue: number }>();
  for (const order of orders) {
    const day = order.created_at.slice(0, 10);
    daily.set(day, (daily.get(day) ?? 0) + Number(order.total));
    for (const item of order.order_items) {
      const current = products.get(item.product_name) ?? { quantity: 0, revenue: 0 };
      current.quantity += item.quantity;
      current.revenue += Number(item.unit_price) * item.quantity;
      products.set(item.product_name, current);
    }
  }
  const topProducts = [...products.entries()].sort((a, b) => b[1].revenue - a[1].revenue).slice(0, 10);
  const days = [...daily.entries()];
  const maxDay = Math.max(...days.map(([, value]) => value), 1);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl">Reportes de ventas</h2>
          <p className="mt-1 text-sm text-cacao-500">Solo pedidos pagados; demostraciones siguen identificadas en pedidos.</p>
        </div>
        <form className="flex flex-wrap items-end gap-2" method="get">
          <label className="text-xs text-cacao-500">Desde<input className="mt-1 block h-10 rounded-lg border border-crema-300 px-3" type="date" name="desde" defaultValue={from} /></label>
          <label className="text-xs text-cacao-500">Hasta<input className="mt-1 block h-10 rounded-lg border border-crema-300 px-3" type="date" name="hasta" defaultValue={to} /></label>
          <button className="h-10 rounded-full bg-dorado px-5 text-sm font-semibold" type="submit">Aplicar</button>
        </form>
      </div>

      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Ventas" value={soles(revenue)} />
        <Stat label="Pedidos" value={String(orders.length)} />
        <Stat label="Ticket promedio" value={soles(orders.length ? revenue / orders.length : 0)} />
        <Stat label="Piezas vendidas" value={String(pieces)} hint={`Delivery cobrado: ${soles(shipping)}`} />
      </ul>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card p-5">
          <h3 className="text-xl">Ventas por día</h3>
          {days.length ? (
            <ul className="mt-4 space-y-2">
              {days.map(([day, value]) => (
                <li key={day} className="grid grid-cols-[6rem_1fr_auto] items-center gap-3 text-sm">
                  <span>{new Date(`${day}T12:00:00`).toLocaleDateString("es-PE", { day: "2-digit", month: "short" })}</span>
                  <span className="h-2 overflow-hidden rounded-full bg-crema-200"><span className="block h-full rounded-full bg-dorado" style={{ width: `${Math.max(3, (value / maxDay) * 100)}%` }} /></span>
                  <strong>{soles(value)}</strong>
                </li>
              ))}
            </ul>
          ) : <Empty />}
        </section>

        <section className="card p-5">
          <h3 className="text-xl">Productos con mayor venta</h3>
          {topProducts.length ? (
            <ol className="mt-4 divide-y divide-crema-200">
              {topProducts.map(([name, values], index) => (
                <li key={name} className="flex items-center gap-3 py-2.5 text-sm">
                  <span className="w-5 text-cacao-300">{index + 1}</span>
                  <span className="min-w-0 flex-1">{name}</span>
                  <span className="text-cacao-500">{values.quantity} uds.</span>
                  <strong>{soles(values.revenue)}</strong>
                </li>
              ))}
            </ol>
          ) : <Empty />}
        </section>
      </div>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return <li className="card p-5"><p className="text-sm text-cacao-500">{label}</p><p className="mt-1 font-display text-3xl font-semibold">{value}</p>{hint && <p className="text-xs text-cacao-300">{hint}</p>}</li>;
}

function Empty() {
  return <p className="mt-5 text-sm text-cacao-300">No hay ventas pagadas en este período.</p>;
}
