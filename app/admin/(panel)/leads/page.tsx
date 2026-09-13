import type { Metadata } from "next";
import Link from "next/link";
import { getOperator, getSetting, listStores, runOp, shortStoreName, DEFAULT_SLA, type SlaSettings } from "@/lib/gestion/server";
import { addDays, limaDateTime, limaToday } from "@/lib/gestion/dates";
import { formatDateShort } from "@/lib/delivery";
import { parseMessageNote } from "@/lib/gestion/meta";
import { AutoRefresh } from "@/components/admin/AutoRefresh";
import { Notice, PageHeader } from "@/components/admin/ui";
import { NewLeadForm } from "@/components/admin/leads/NewLeadForm";
import { LeadFilters } from "@/components/admin/leads/LeadFilters";
import { LeadBoard } from "@/components/admin/leads/LeadBoard";
import { LeadMetrics, type LossReasonRow, type MetricsRow } from "@/components/admin/leads/LeadMetrics";
import {
  computeMetrics,
  LOST_REASONS,
  lostReasonCategory,
  lostReasonDetail,
  OPEN_STATUSES,
  type LeadEventView,
  type LeadStatus,
  type LeadView,
  type MetricLead,
  type SellerOption,
  type StoreOption,
} from "@/components/admin/leads/shared";

export const metadata: Metadata = { title: "Leads" };
export const dynamic = "force-dynamic";

/**
 * Leads: do Messenger à venda, com relógio.
 *
 * Substitui o grupo de WhatsApp das duas lojas. O Joseka registra (ou o
 * webhook da Meta registra sozinho), atribui a loja, e a vendedora escreve
 * pelo botão — que grava a hora. Embaixo, o relatório que responde "quem
 * demora" e "por que perdemos".
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_TEMPLATE = "Hola {nombre}, te escribe {vendedora} de Tortas Fanor 🎂. Vi que te interesa: {interes}. {contexto}";
/* Lead aberto passa de 300 só se o funil quebrou; aí o alerta já avisou. */
const OPEN_LIMIT = 300;
const CLOSED_LIMIT = 200;
const EVENT_CHUNK = 40;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

type LeadRow = {
  id: string;
  number: number;
  source: string;
  name: string;
  phone: string | null;
  context: string | null;
  interest: string | null;
  wanted_on: string | null;
  status: LeadStatus;
  store_id: string | null;
  seller_id: string | null;
  value: number | string | null;
  lost_reason: string | null;
  created_at: string;
  assigned_at: string | null;
  first_contact_at: string | null;
  closed_at: string | null;
  stores: { name: string } | null;
  sellers: { name: string } | null;
};

type EventRow = { id: number; lead_id: string; kind: string; notes: string | null; actor: string | null; created_at: string };
type SellerRow = { id: string; name: string; store_id: string | null; role: string; active: boolean; user_id: string | null };

const LEAD_COLUMNS =
  "id, number, source, name, phone, context, interest, wanted_on, status, store_id, seller_id, value, lost_reason, created_at, assigned_at, first_contact_at, closed_at, stores(name), sellers(name)";

function one(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

/** Relógio lido uma vez, fora do componente: render tem de ser puro. */
function clock() {
  const now = new Date();
  return { nowMs: now.getTime(), today: limaToday(now) };
}

export default async function LeadsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const op = await getOperator();
  if (!op) return <Notice tone="bad">Sesión expirada. Vuelve a entrar.</Notice>;

  /* Recalcula os alertas a cada abertura: o sino e a central refletem o lead
     que acabou de estourar o prazo. Falha aqui não pode esconder a fila. */
  await runOp("alerts_refresh", {});

  const storeParam = one(params.tienda);
  const sellerParam = one(params.vendedora);
  const storeFilter = storeParam && UUID_RE.test(storeParam) ? storeParam : null;
  const sellerFilter = sellerParam && UUID_RE.test(sellerParam) ? sellerParam : null;
  const period = one(params.periodo) === "30" ? 30 : 7;

  const { nowMs, today } = clock();
  const closedSince = new Date(nowMs - 7 * 86_400_000).toISOString();
  /* Lima não tem horário de verão: meia-noite local é sempre -05:00. */
  const metricsSince = `${addDays(today, -(period - 1))}T00:00:00-05:00`;

  let openQuery = op.db.from("leads").select(LEAD_COLUMNS).in("status", OPEN_STATUSES);
  let closedQuery = op.db.from("leads").select(LEAD_COLUMNS).in("status", ["won", "lost"]).gte("closed_at", closedSince);
  let metricsQuery = op.db
    .from("leads")
    .select("status, store_id, seller_id, created_at, assigned_at, first_contact_at, value, lost_reason")
    .gte("created_at", metricsSince);
  if (storeFilter) {
    openQuery = openQuery.eq("store_id", storeFilter);
    closedQuery = closedQuery.eq("store_id", storeFilter);
    metricsQuery = metricsQuery.eq("store_id", storeFilter);
  }
  if (sellerFilter) {
    openQuery = openQuery.eq("seller_id", sellerFilter);
    closedQuery = closedQuery.eq("seller_id", sellerFilter);
    metricsQuery = metricsQuery.eq("seller_id", sellerFilter);
  }

  const [storeList, { data: sellerData }, sla, templateSetting, openRes, closedRes, metricsRes] = await Promise.all([
    listStores(op.db),
    op.db.from("sellers").select("id, name, store_id, role, active, user_id").order("name"),
    getSetting<Partial<SlaSettings>>(op.db, "sla", DEFAULT_SLA),
    getSetting<unknown>(op.db, "lead_whatsapp_template", DEFAULT_TEMPLATE),
    openQuery.order("created_at", { ascending: true }).limit(OPEN_LIMIT),
    closedQuery.order("closed_at", { ascending: false }).limit(CLOSED_LIMIT),
    metricsQuery.limit(5000),
  ]);

  if (openRes.error || closedRes.error || metricsRes.error) {
    console.error("[leads]", openRes.error?.message ?? closedRes.error?.message ?? metricsRes.error?.message);
    return <Notice tone="bad">No se pudieron cargar los leads. Actualiza la página en un momento.</Notice>;
  }

  const slaMin = Number(sla?.lead_first_contact_min) > 0 ? Number(sla.lead_first_contact_min) : DEFAULT_SLA.lead_first_contact_min;
  const template = typeof templateSetting === "string" && templateSetting.trim() ? templateSetting : DEFAULT_TEMPLATE;

  const allSellers = (sellerData ?? []) as SellerRow[];
  /* Taller não atende cliente: fica fora da lista de quem recebe lead. */
  const sellers: SellerOption[] = allSellers
    .filter((s) => s.active && s.role !== "workshop")
    .map((s) => ({ id: s.id, name: s.name, storeId: s.store_id }));
  const stores: StoreOption[] = storeList.map((s) => ({ id: s.id, name: shortStoreName(s.name) }));

  const openRows = (openRes.data ?? []) as unknown as LeadRow[];
  const closedRows = (closedRes.data ?? []) as unknown as LeadRow[];

  /* Histórico de todos os cards visíveis de uma vez, em lotes: a lista de ids
     vai na URL da consulta e não pode crescer sem limite. */
  const ids = [...openRows, ...closedRows].map((l) => l.id);
  const eventBatches = await Promise.all(
    Array.from({ length: Math.ceil(ids.length / EVENT_CHUNK) }, (_, i) =>
      op.db
        .from("lead_events")
        .select("id, lead_id, kind, notes, actor, created_at")
        .in("lead_id", ids.slice(i * EVENT_CHUNK, (i + 1) * EVENT_CHUNK))
        .order("created_at", { ascending: true }),
    ),
  );

  const sellerByUser = new Map(allSellers.filter((s) => s.user_id).map((s) => [s.user_id as string, s.name]));
  const eventsByLead = new Map<string, LeadEventView[]>();
  for (const batch of eventBatches) {
    for (const e of (batch.data ?? []) as EventRow[]) {
      /* Nota sem autor com marcador = mensagem que chegou pela Meta. */
      const inbound = e.kind === "note" && !e.actor ? parseMessageNote(e.notes) : null;
      const view: LeadEventView = {
        id: e.id,
        kind: e.kind,
        inbound: Boolean(inbound),
        notes: inbound ? inbound.text : e.notes,
        actor: !e.actor
          ? inbound
            ? "Cliente"
            : "Automático"
          : e.actor === op.user.id
            ? op.user.name
            : (sellerByUser.get(e.actor) ?? "Equipo"),
        at: limaDateTime(e.created_at),
      };
      eventsByLead.set(e.lead_id, [...(eventsByLead.get(e.lead_id) ?? []), view]);
    }
  }

  const toView = (row: LeadRow): LeadView => ({
    id: row.id,
    number: Number(row.number),
    source: row.source,
    name: row.name,
    phone: row.phone,
    context: row.context,
    interest: row.interest,
    wantedOn: row.wanted_on,
    status: row.status,
    storeId: row.store_id,
    storeName: row.stores ? shortStoreName(row.stores.name) : null,
    sellerId: row.seller_id,
    sellerName: row.sellers?.name ?? null,
    value: row.value === null ? null : Number(row.value),
    lostReason: row.lost_reason,
    createdAt: row.created_at,
    assignedAt: row.assigned_at,
    firstContactAt: row.first_contact_at,
    closedAt: row.closed_at,
    createdLabel: limaDateTime(row.created_at),
    closedLabel: row.closed_at ? limaDateTime(row.closed_at) : null,
    wantedLabel: row.wanted_on ? formatDateShort(row.wanted_on) : null,
    events: eventsByLead.get(row.id) ?? [],
  });

  const openLeads = openRows.map(toView);
  const columns = {
    new: openLeads.filter((l) => l.status === "new"),
    assigned: openLeads.filter((l) => l.status === "assigned"),
    contacted: openLeads.filter((l) => l.status === "contacted"),
    closed: closedRows.map(toView),
  };

  /* ---------------------------------------------------------------- métricas */
  type MetricRow = {
    status: LeadStatus;
    store_id: string | null;
    seller_id: string | null;
    created_at: string;
    assigned_at: string | null;
    first_contact_at: string | null;
    value: number | string | null;
    lost_reason: string | null;
  };
  const metricLeads: MetricLead[] = ((metricsRes.data ?? []) as MetricRow[]).map((r) => ({
    status: r.status,
    storeId: r.store_id,
    sellerId: r.seller_id,
    createdAt: r.created_at,
    assignedAt: r.assigned_at,
    firstContactAt: r.first_contact_at,
    value: r.value === null ? null : Number(r.value),
    lostReason: r.lost_reason,
  }));

  const storeName = new Map(storeList.map((s) => [s.id, shortStoreName(s.name)]));
  const sellerName = new Map(allSellers.map((s) => [s.id, s.name]));

  function breakdown(key: (l: MetricLead) => string | null, label: (id: string | null) => string): MetricsRow[] {
    const groups = new Map<string, MetricLead[]>();
    for (const lead of metricLeads) {
      const id = key(lead) ?? "";
      groups.set(id, [...(groups.get(id) ?? []), lead]);
    }
    return [...groups.entries()]
      .map(([id, list]) => ({ key: id || "none", label: label(id || null), metrics: computeMetrics(list, slaMin) }))
      .sort((a, b) => b.metrics.received - a.metrics.received);
  }

  const byStore = breakdown(
    (l) => l.storeId,
    (id) => (id ? (storeName.get(id) ?? "Otra tienda") : "Sin tienda"),
  );
  const bySeller = breakdown(
    (l) => l.sellerId,
    (id) => (id ? (sellerName.get(id) ?? "Vendedora retirada") : "Sin vendedora"),
  );

  const reasons = new Map<string, LossReasonRow>(LOST_REASONS.map((r) => [r, { reason: r, count: 0, details: [] }]));
  for (const lead of metricLeads) {
    if (lead.status !== "lost") continue;
    const row = reasons.get(lostReasonCategory(lead.lostReason))!;
    row.count += 1;
    const detail = lostReasonDetail(lead.lostReason);
    /* Só os detalhes de "Otro" aparecem: nos demais a categoria já diz tudo. */
    if (row.reason === "Otro" && detail && row.details.length < 8) row.details.push(detail);
  }
  const lossReasons = [...reasons.values()].filter((r) => r.count > 0).sort((a, b) => b.count - a.count);

  const linkFor = (days: number) => {
    const q = new URLSearchParams();
    if (storeFilter) q.set("tienda", storeFilter);
    if (sellerFilter) q.set("vendedora", sellerFilter);
    if (days !== 7) q.set("periodo", String(days));
    const s = q.toString();
    return s ? `/admin/leads?${s}` : "/admin/leads";
  };

  const waitingNew = columns.new.length;

  return (
    <div className="space-y-6">
      {/* Lead do webhook aparece sem F5; o relógio de cada card corre sozinho. */}
      <AutoRefresh everyMs={30_000} />

      <PageHeader
        title="Leads"
        description="Del Messenger a la venta, con reloj: a quién se pasó, cuánto tardó el primer mensaje y cómo terminó."
        actions={
          <Link
            href="/admin/alertas"
            className="inline-flex h-11 items-center rounded-full border border-crema-300 bg-white px-5 text-sm font-medium text-cacao-700 hover:border-cacao/35"
          >
            Ver alertas
          </Link>
        }
      />

      {waitingNew > 0 && (
        <Notice tone="bad">
          {waitingNew === 1 ? "1 lead espera que se le asigne" : `${waitingNew} leads esperan que se les asigne`} una tienda.
        </Notice>
      )}

      <NewLeadForm stores={stores} sellers={sellers} today={today} />

      <LeadFilters
        stores={stores}
        sellers={sellers}
        store={storeFilter}
        seller={sellerFilter}
        period={period}
        mySellerId={op.seller && op.seller.role !== "workshop" ? op.seller.id : null}
      />

      {openRows.length >= OPEN_LIMIT && (
        <Notice tone="warn">Se muestran los {OPEN_LIMIT} leads abiertos más antiguos. Cierra los que ya no avanzan.</Notice>
      )}

      <LeadBoard
        columns={columns}
        stores={stores}
        sellers={sellers}
        slaMin={slaMin}
        serverNow={nowMs}
        template={template}
        writerName={op.seller?.name ?? null}
        userName={op.user.name.split(" ")[0] || "Tortas Fanor"}
        defaultStoreId={op.seller?.storeId ?? null}
      />

      <LeadMetrics
        period={period}
        periodHrefs={[7, 30].map((days) => ({ days, href: linkFor(days) }))}
        slaMin={slaMin}
        total={computeMetrics(metricLeads, slaMin)}
        byStore={byStore}
        bySeller={bySeller}
        lossReasons={lossReasons}
      />
    </div>
  );
}
