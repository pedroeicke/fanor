import type { NextRequest } from "next/server";
import { getAdminUser } from "@/lib/supabase-server";
import { getOperator } from "@/lib/gestion/server";
import { PAYMENT_METHOD, SALE_KIND } from "@/lib/gestion/labels";
import { PAYMENT_ORDER, SALE_KIND_ORDER, bucketOf, loadOperationReport, parseFilters, type CakeCounts } from "../data";

/**
 * Planilha do relatório de operação, com o mesmo recorte da tela.
 *
 * `?datos=tortas` — período × loja × produto × sabor, cada coisa que
 * aconteceu com as tortas. `?datos=ventas` — período × loja, dinheiro por
 * tipo de venda e forma de pagamento.
 *
 * Feita para abrir com dois cliques no Excel de Lima: BOM UTF-8 (senão
 * "Pasión" vira "PasiÃ³n") e ponto e vírgula como separador.
 */

export const dynamic = "force-dynamic";
/* Três meses de venda são dezenas de páginas do banco. */
export const maxDuration = 60;

/* Escrito como código e não como caractere: um BOM literal é invisível e some na primeira edição. */
const BOM = String.fromCharCode(0xfeff);

/**
 * Célula de CSV. Texto que começa com = + - @ abriria como fórmula no Excel.
 * Número já formatado ("-12.50") passa como está: com o apóstrofo, o Excel
 * o leria como texto e a soma da coluna daria zero.
 */
function cell(value: string | number | null | undefined) {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return String(value);
  if (/^-?\d+(\.\d+)?$/.test(value)) return value;
  const text = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[";\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csv(rows: (string | number | null | undefined)[][]) {
  return BOM + rows.map((row) => row.map(cell).join(";")).join("\r\n") + "\r\n";
}

/** "Av. EE.UU." → "av-ee-uu", para o nome do arquivo. */
function slug(text: string) {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

/** Dinheiro sempre com duas casas: a coluna fica alinhada e o Excel lê como número. */
const amount = (value: number) => (Math.round(value * 100) / 100).toFixed(2);

export async function GET(request: NextRequest) {
  const user = await getAdminUser();
  if (!user) return new Response("Sesión expirada. Vuelve a entrar.", { status: 401 });
  const op = await getOperator();
  if (!op) return new Response("Sesión expirada. Vuelve a entrar.", { status: 401 });

  const params = request.nextUrl.searchParams;
  const datos = params.get("datos") === "ventas" ? "ventas" : "tortas";
  const filters = parseFilters((key) => params.get(key));

  const result = await loadOperationReport(op, filters, { cakes: datos === "tortas", sales: datos === "ventas" });
  if (!result.ok) return new Response(result.error, { status: 502, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  const r = result.report;

  const periodHeader = filters.group === "semana" ? "Semana (desde el lunes)" : "Fecha";
  let body: string;

  if (datos === "tortas") {
    const grouped = new Map<string, CakeCounts & { bucket: string; storeId: string | null; productId: string; flavorId: string | null }>();
    for (const row of r.cakeRows) {
      const bucket = bucketOf(row.day, filters.group);
      const key = `${bucket}|${row.storeId}|${row.productId}|${row.flavorId}`;
      const g = grouped.get(key) ?? {
        bucket, storeId: row.storeId, productId: row.productId, flavorId: row.flavorId,
        dispatched: 0, received: 0, sold: 0, staffSold: 0, returned: 0, redecorated: 0, discarded: 0, missing: 0,
      };
      g.dispatched += row.dispatched;
      g.received += row.received;
      g.sold += row.sold;
      g.staffSold += row.staffSold;
      g.returned += row.returned;
      g.redecorated += row.redecorated;
      g.discarded += row.discarded;
      g.missing += row.missing;
      grouped.set(key, g);
    }

    const lines = [...grouped.values()]
      .map((g) => ({ ...g, store: r.storeName(g.storeId), product: r.productName(g.productId), flavor: r.flavorName(g.flavorId) }))
      .sort((a, b) =>
        a.bucket.localeCompare(b.bucket) ||
        a.store.localeCompare(b.store, "es") ||
        a.product.name.localeCompare(b.product.name, "es") ||
        a.flavor.localeCompare(b.flavor, "es"),
      );

    body = csv([
      [periodHeader, "Tienda", "Código", "Producto", "Sabor", "Despachadas", "Recibidas", "Vendidas", "Vendidas al personal", "Devueltas", "Redecoradas", "Descartadas", "Faltantes"],
      ...lines.map((l) => [
        l.bucket, l.store, l.product.sku, l.product.name, l.flavor,
        l.dispatched, l.received, l.sold, l.staffSold, l.returned, l.redecorated, l.discarded, l.missing,
      ]),
    ]);
  } else {
    body = csv([
      [
        periodHeader, "Tienda", "Ventas", "Facturación",
        ...SALE_KIND_ORDER.map((kind) => SALE_KIND[kind]),
        ...PAYMENT_ORDER.map((method) => PAYMENT_METHOD[method]),
      ],
      ...r.sales.table.map((t) => [
        t.bucket, r.storeName(t.storeId), t.count, amount(t.revenue),
        ...SALE_KIND_ORDER.map((kind) => amount(t.byKind[kind] ?? 0)),
        ...PAYMENT_ORDER.map((method) => amount(t.methods[method] ?? 0)),
      ]),
    ]);
  }

  const store = filters.storeId ? `-${slug(r.storeName(filters.storeId))}` : "";
  const fileName = `fanor-${datos}-${filters.from}_a_${filters.to}${store}.csv`;

  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "no-store",
    },
  });
}
