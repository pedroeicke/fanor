import type { Metadata } from "next";
import Link from "next/link";
import { getOperator, listStores, runOp, shortStoreName } from "@/lib/gestion/server";
import { limaDateTime } from "@/lib/gestion/dates";
import { ALERT_SEVERITY } from "@/lib/gestion/labels";
import { alertHref, notifyDestinations } from "@/lib/gestion/notify";
import { cx } from "@/lib/format";
import { AutoRefresh } from "@/components/admin/AutoRefresh";
import { EmptyState, Notice, PageHeader, Section, StatCard } from "@/components/admin/ui";
import { AlertRow, type AlertView } from "@/components/admin/alertas/AlertRow";

export const metadata: Metadata = { title: "Alertas" };
export const dynamic = "force-dynamic";

/**
 * Central de alertas: o que está atrasado na operação inteira, num lugar só.
 *
 * Os alertas não são criados à mão — `alerts_refresh()` olha leads, pedidos
 * da loja, encomendas, despachos, vitrine, reclamações e o leitor do Sisgeco,
 * abre o que estourou prazo e fecha sozinho o que foi resolvido. Por isso a
 * tela recalcula ao abrir e a cada 30 s: resolver na tela certa faz o alerta
 * sumir daqui sem ninguém "dar baixa".
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SEVERITY_ORDER = ["critical", "warn", "info"];
const OPEN_LIMIT = 500;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

type AlertDbRow = {
  id: string;
  kind: string;
  severity: string;
  store_id: string | null;
  entity: string | null;
  entity_id: string | null;
  title: string;
  detail: string | null;
  created_at: string;
  notified_at: string | null;
  resolved_at: string | null;
  stores: { name: string } | null;
};

const COLUMNS = "id, kind, severity, store_id, entity, entity_id, title, detail, created_at, notified_at, resolved_at, stores(name)";

/** Relógio lido uma vez, fora do componente: render tem de ser puro. */
function clock() {
  return Date.now();
}

export default async function AlertsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const op = await getOperator();
  if (!op) return <Notice tone="bad">Sesión expirada. Vuelve a entrar.</Notice>;

  /* Recalcular antes de ler. Se falhar, mostra o último estado conhecido e
     avisa, em vez de uma tela vazia que pareceria "tudo em ordem". */
  const refresh = await runOp<number>("alerts_refresh", {});

  const raw = params.tienda;
  const storeParam = Array.isArray(raw) ? raw[0] : raw;
  const storeFilter = storeParam && UUID_RE.test(storeParam) ? storeParam : null;

  const nowMs = clock();
  const resolvedSince = new Date(nowMs - 24 * 3_600_000).toISOString();

  let openQuery = op.db.from("alerts").select(COLUMNS).is("resolved_at", null);
  let resolvedQuery = op.db.from("alerts").select(COLUMNS).gte("resolved_at", resolvedSince);
  if (storeFilter) {
    openQuery = openQuery.eq("store_id", storeFilter);
    resolvedQuery = resolvedQuery.eq("store_id", storeFilter);
  }

  const [stores, openRes, resolvedRes, countsRes] = await Promise.all([
    listStores(op.db),
    openQuery.order("created_at", { ascending: true }).limit(OPEN_LIMIT),
    resolvedQuery.order("resolved_at", { ascending: false }).limit(100),
    /* Contagem por loja para os filtros, sem o filtro aplicado. */
    op.db.from("alerts").select("store_id").is("resolved_at", null).limit(OPEN_LIMIT),
  ]);

  if (openRes.error) {
    console.error("[alertas]", openRes.error.message);
    return <Notice tone="bad">No se pudieron cargar las alertas. Actualiza la página en un momento.</Notice>;
  }

  const toView = (a: AlertDbRow): AlertView => ({
    id: a.id,
    severity: a.severity,
    title: a.title,
    detail: a.detail,
    storeName: a.stores ? shortStoreName(a.stores.name) : null,
    href: alertHref(a.entity, a.entity_id),
    reference: a.entity === "complaints" ? a.entity_id : null,
    ageMin: Math.max(0, Math.floor((nowMs - new Date(a.created_at).getTime()) / 60_000)),
    resolvedLabel: a.resolved_at ? limaDateTime(a.resolved_at) : null,
    notified: Boolean(a.notified_at),
  });

  const open = ((openRes.data ?? []) as unknown as AlertDbRow[]).map(toView);
  const resolved = ((resolvedRes.data ?? []) as unknown as AlertDbRow[]).map(toView);

  /* Mais grave primeiro; dentro da gravidade, quem espera há mais tempo. A
     coluna só aceita estes três valores (check da 0012). */
  const groups = SEVERITY_ORDER.map((severity) => ({
    severity,
    alerts: open.filter((a) => a.severity === severity).sort((a, b) => b.ageMin - a.ageMin),
  })).filter((g) => g.alerts.length);

  const critical = open.filter((a) => a.severity === "critical").length;
  const warn = open.filter((a) => a.severity === "warn").length;

  const perStore = new Map<string, number>();
  let totalOpen = 0;
  for (const row of (countsRes.data ?? []) as { store_id: string | null }[]) {
    totalOpen += 1;
    if (row.store_id) perStore.set(row.store_id, (perStore.get(row.store_id) ?? 0) + 1);
  }

  const destinations = notifyDestinations();
  /* Só o canal, nunca o endereço: vendedora também abre esta tela. */
  const channels = [destinations.webhook && "webhook", destinations.emailReady && "correo"].filter(Boolean);

  return (
    <div className="space-y-6">
      <AutoRefresh everyMs={30_000} />

      <PageHeader
        title="Alertas"
        description="Lo que está atrasado en leads, taller, recepción, vitrina, encomiendas y reclamos. Se cierran solas cuando se resuelve el problema en su pantalla."
      />

      {!refresh.ok && (
        <Notice tone="warn">No se pudo recalcular ahora ({refresh.error}). Se muestra el último estado guardado.</Notice>
      )}

      <nav aria-label="Filtrar por tienda" className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        <FilterChip href="/admin/alertas" active={!storeFilter} label="Todas" count={totalOpen} />
        {stores.map((s) => (
          <FilterChip
            key={s.id}
            href={`/admin/alertas?tienda=${s.id}`}
            active={storeFilter === s.id}
            label={shortStoreName(s.name)}
            count={perStore.get(s.id) ?? 0}
          />
        ))}
      </nav>

      <ul className="grid gap-3 sm:grid-cols-2">
        <StatCard label="Urgentes" value={critical} tone={critical ? "warn" : "ok"} hint={critical ? "Resolver ahora" : "Nada urgente"} />
        <StatCard label="Atención" value={warn} hint={warn ? "Revisar hoy" : "Todo al día"} />
      </ul>

      {groups.map((group) => (
        <Section
          key={group.severity}
          title={ALERT_SEVERITY[group.severity]?.label ?? group.severity}
          aside={`${group.alerts.length} ${group.alerts.length === 1 ? "alerta" : "alertas"}`}
          className={cx(group.severity === "critical" && "border-terracota/40")}
        >
          <ul className="divide-y divide-crema-200">
            {group.alerts.map((alert) => (
              <AlertRow key={alert.id} alert={alert} />
            ))}
          </ul>
        </Section>
      ))}

      {!open.length && (
        <Section title="Sin alertas abiertas">
          <EmptyState>
            {storeFilter ? "Esta tienda no tiene nada atrasado." : "Nada atrasado en la operación."} La página se actualiza sola.
          </EmptyState>
        </Section>
      )}

      {resolved.length > 0 && (
        <details className="card overflow-hidden">
          <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-5 py-3">
            <span className="font-display text-lg">Resueltas en las últimas 24 h</span>
            <span className="text-sm text-cacao-500">{resolved.length}</span>
          </summary>
          <ul className="divide-y divide-crema-200 border-t border-crema-200">
            {resolved.map((alert) => (
              <AlertRow key={alert.id} alert={alert} />
            ))}
          </ul>
        </details>
      )}

      <p className="text-[13px] text-cacao-500">
        {channels.length
          ? `Las urgentes (y las de atención con más de 1 h) se avisan fuera del panel por ${channels.join(" y ")}.`
          : "Las alertas solo se ven aquí: no hay correo ni webhook de aviso configurado."}
      </p>
    </div>
  );
}

function FilterChip({ href, active, label, count }: { href: string; active: boolean; label: string; count: number }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cx(
        "inline-flex h-11 shrink-0 items-center gap-2 rounded-full border px-5 text-sm font-medium transition-colors",
        active ? "border-dorado bg-dorado text-cacao" : "border-crema-300 bg-white text-cacao-700 hover:border-cacao/35",
      )}
    >
      {label}
      <span className={cx("rounded-full px-2 text-[12px] font-semibold tabular-nums", active ? "bg-white/70" : "bg-crema-100")}>{count}</span>
    </Link>
  );
}
