import Link from "next/link";
import { cx } from "@/lib/format";
import { getOperator } from "@/lib/gestion/server";

/**
 * Sino do cabeçalho do painel: quantos alertas urgentes e de atenção estão
 * abertos, com link para a central.
 *
 * Só conta — não recalcula. `alerts_refresh()` percorre a operação inteira e
 * rodaria em cada navegação do painel; quem recalcula é a central, a tela de
 * leads e a rotina de 5 min. Sem nada aberto, não ocupa espaço: sino com
 * zero vira ruído que ninguém mais olha.
 */
export async function AlertBell({ className }: { className?: string } = {}) {
  const op = await getOperator();
  if (!op) return null;

  const [critical, warn] = await Promise.all([
    op.db.from("alerts").select("id", { count: "exact", head: true }).is("resolved_at", null).eq("severity", "critical"),
    op.db.from("alerts").select("id", { count: "exact", head: true }).is("resolved_at", null).eq("severity", "warn"),
  ]);

  const urgent = critical.count ?? 0;
  const total = urgent + (warn.count ?? 0);
  if (!total) return null;

  const label = urgent
    ? `${total} ${total === 1 ? "alerta abierta" : "alertas abiertas"}, ${urgent} ${urgent === 1 ? "urgente" : "urgentes"}`
    : `${total} ${total === 1 ? "alerta abierta" : "alertas abiertas"}`;

  return (
    <Link
      href="/admin/alertas"
      aria-label={label}
      title={label}
      className={cx(
        "inline-flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-full border px-3.5 text-sm font-semibold tabular-nums transition-colors",
        urgent
          ? "border-terracota/40 bg-terracota/10 text-terracota-700 hover:bg-terracota/15"
          : "border-dorado-600/40 bg-dorado-100 text-cacao-700 hover:bg-dorado-200",
        className,
      )}
    >
      <span aria-hidden>🔔</span>
      {total}
    </Link>
  );
}
