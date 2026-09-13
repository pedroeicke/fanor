import Link from "next/link";
import { cx } from "@/lib/format";
import { formatDuration } from "@/lib/gestion/dates";
import { ALERT_SEVERITY } from "@/lib/gestion/labels";
import { StatusPill } from "@/components/admin/ui";

/**
 * Uma linha da central de alertas: o que é, onde, há quanto tempo e o botão
 * para a tela que resolve. Alerta sem tela (reclamação do Libro) mostra o
 * código, que é por onde a pessoa procura no e-mail.
 */

export type AlertView = {
  id: string;
  severity: string;
  title: string;
  detail: string | null;
  storeName: string | null;
  href: string | null;
  /** Código para achar fora do painel quando não há tela (reclamação). */
  reference: string | null;
  ageMin: number;
  /** Só nos resolvidos: quando fechou. */
  resolvedLabel: string | null;
  notified: boolean;
};

export function AlertRow({ alert }: { alert: AlertView }) {
  const resolved = alert.resolvedLabel !== null;
  return (
    <li className={cx("flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4", resolved && "opacity-70")}>
      <div className="min-w-0 flex-1 basis-64">
        <div className="flex flex-wrap items-center gap-2">
          {!resolved && <StatusPill status={alert.severity} map={ALERT_SEVERITY} />}
          <span className="text-[13px] text-cacao-500">{alert.storeName ?? "General"}</span>
          <span className="text-[13px] text-cacao-300">
            {resolved ? `resuelta ${alert.resolvedLabel}` : `hace ${formatDuration(alert.ageMin)}`}
          </span>
          {alert.notified && !resolved && <span className="text-[12px] text-cacao-300">· avisada</span>}
        </div>
        <p className="mt-1 break-words font-medium text-cacao">{alert.title}</p>
        {alert.detail && <p className="break-words text-sm text-cacao-500">{alert.detail}</p>}
      </div>

      {alert.href ? (
        <Link
          href={alert.href}
          className={cx(
            "inline-flex h-11 w-full shrink-0 items-center justify-center rounded-full px-5 text-sm font-semibold transition-colors sm:w-auto",
            resolved
              ? "border border-crema-300 bg-white text-cacao-700 hover:border-cacao/35"
              : "bg-dorado text-cacao hover:bg-dorado-600",
          )}
        >
          {resolved ? "Ver" : "Resolver"}
        </Link>
      ) : (
        alert.reference && (
          <span className="inline-flex h-11 shrink-0 items-center rounded-full border border-crema-300 bg-crema-100 px-4 font-mono text-[13px] text-cacao-700">
            {alert.reference}
          </span>
        )
      )}
    </li>
  );
}
