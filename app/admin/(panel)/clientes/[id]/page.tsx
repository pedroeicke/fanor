import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getOperator, shortStoreName } from "@/lib/gestion/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { formatDuration, limaToday, minutesBetween } from "@/lib/gestion/dates";
import { CONTRACT_STATUS, LEAD_SOURCE, LEAD_STATUS, SALE_KIND } from "@/lib/gestion/labels";
import { cx, soles } from "@/lib/format";
import { EmptyState, Notice, Section, StatCard, StatusPill } from "@/components/admin/ui";
import { IconWhatsapp } from "@/components/ui/icons";
import { CustomerForm } from "@/components/admin/clientes/CustomerForm";
import { NoteForm } from "@/components/admin/clientes/NoteForm";
import { COMPLAINT_KIND, COMPLAINT_STATUS, ORDER_STATUS, SALE_STATUS, sourceLabel } from "@/components/admin/clientes/labels";
import { limaDate, limaWhen } from "@/components/admin/clientes/format";
import {
  BIRTHDAY_WINDOW_DAYS,
  DOC_LABEL,
  INACTIVE_DAYS,
  RECURRENT_MIN_PURCHASES,
  UUID_RE,
  VIP_MIN_SPENT,
  birthdayCountdown,
  birthdayLabel,
  daysUntilBirthday,
  formatPhone,
  isDocType,
  whatsappUrl,
} from "@/components/admin/clientes/rules";

export const metadata: Metadata = { title: "Ficha de cliente" };
export const dynamic = "force-dynamic";

/**
 * Tudo sobre um cliente numa tela: quem é, quanto compra, por onde compra,
 * o que gosta, e cada contato que teve com a Fanor — site, balcão,
 * encomenda, lead e reclamação — numa linha do tempo só.
 *
 * Existe para a vendedora abrir antes de responder um WhatsApp e já saber
 * que é a cliente que encomenda torta de moka todo aniversário, e que da
 * última vez reclamou da entrega.
 */

const TIMELINE_LIMIT = 100;

type Store = { name: string } | null;
type OrderRow = { code: string; status: string; total: number | string; created_at: string; delivery_date: string | null; delivery_method: string | null };
type SaleRow = { id: string; number: number; status: string; kind: string; total: number | string; sold_at: string; stores: Store };
type ContractRow = { id: string; number: number; status: string; total: number | string; deliver_on: string; created_at: string; stores: Store };
type LeadRow = { id: string; number: number; status: string; source: string; interest: string | null; created_at: string; stores: Store };
type ComplaintRow = { code: string; kind: string; status: string; created_at: string };
type NoteRow = { id: string; body: string; actor: string | null; created_at: string };
type LineRow = { name: string | null; quantity: number | string | null };

type Entry = {
  key: string;
  at: string;
  kind: string;
  title: string;
  detail: string;
  amount: number | null;
  status: string;
  map: Parameters<typeof StatusPill>[0]["map"];
  href: string | null;
};

export default async function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();

  const op = await getOperator();
  if (!op) return <Notice tone="bad">Sesión expirada. Vuelve a entrar.</Notice>;
  const db = op.db;

  const [
    customerRes,
    ordersRes,
    salesRes,
    contractsRes,
    leadsRes,
    complaintsRes,
    notesRes,
    itemsRes,
    saleLinesRes,
    contractLinesRes,
    webCount,
    counterCount,
    contractCount,
    tagsRes,
  ] = await Promise.all([
    db.from("customers")
      .select("id, name, trade_name, phone, phone_norm, email, doc_type, doc_number, address, district, birthday, tags, source, first_seen_at, last_purchase_at, orders_count, total_spent, marketing_opt_in")
      .eq("id", id)
      .maybeSingle(),
    db.from("orders").select("code, status, total, created_at, delivery_date, delivery_method")
      .eq("customer_id", id).order("created_at", { ascending: false }).limit(TIMELINE_LIMIT),
    db.from("sales").select("id, number, status, kind, total, sold_at, stores(name)")
      .eq("customer_id", id).order("sold_at", { ascending: false }).limit(TIMELINE_LIMIT),
    db.from("contracts").select("id, number, status, total, deliver_on, created_at, stores(name)")
      .eq("customer_id", id).order("created_at", { ascending: false }).limit(TIMELINE_LIMIT),
    db.from("leads").select("id, number, status, source, interest, created_at, stores(name)")
      .eq("customer_id", id).order("created_at", { ascending: false }).limit(TIMELINE_LIMIT),
    db.from("complaints").select("code, kind, status, created_at")
      .eq("customer_id", id).order("created_at", { ascending: false }).limit(TIMELINE_LIMIT),
    db.from("customer_notes").select("id, body, actor, created_at")
      .eq("customer_id", id).order("created_at", { ascending: false }).limit(200),
    /* Favoritos: o que foi de fato comprado. Pedido não pago e venda anulada não contam. */
    db.from("order_items").select("name:product_name, quantity, orders!inner(customer_id, status)")
      .eq("orders.customer_id", id).eq("orders.status", "paid").limit(2000),
    /* Só balcão e pessoal: as linhas de adiantamento e saldo dizem "Adelanto encomienda #12", não o produto. */
    db.from("sale_lines").select("name:description, quantity, sales!inner(customer_id, status, kind)")
      .eq("sales.customer_id", id).eq("sales.status", "paid").in("sales.kind", ["counter", "staff"]).limit(2000),
    /* O produto da encomenda está no contrato. */
    db.from("contract_lines").select("name:description, quantity, contracts!inner(customer_id, status)")
      .eq("contracts.customer_id", id).neq("contracts.status", "cancelled").limit(2000),
    /* Mesmas regras de `crm_refresh_customer_stats`, para o canal bater com o nº de compras. */
    db.from("orders").select("code", { count: "exact", head: true }).eq("customer_id", id).eq("status", "paid"),
    db.from("sales").select("id", { count: "exact", head: true }).eq("customer_id", id).eq("status", "paid").in("kind", ["counter", "staff"]),
    db.from("contracts").select("id", { count: "exact", head: true }).eq("customer_id", id).neq("status", "cancelled"),
    db.from("customers").select("tags").neq("tags", "{}").limit(1000),
  ]);

  if (customerRes.error) return <Notice tone="bad">No se pudo cargar el cliente. Inténtalo de nuevo.</Notice>;
  const customer = customerRes.data;
  if (!customer) notFound();

  const today = limaToday();
  const spent = Number(customer.total_spent) || 0;
  const purchases = Number(customer.orders_count) || 0;
  const phoneLabel = formatPhone(customer.phone_norm, customer.phone);
  const whatsapp = whatsappUrl(customer.phone_norm);
  const birthdayDays = customer.birthday ? daysUntilBirthday(customer.birthday, today) : null;
  const inactive = customer.last_purchase_at ? minutesBetween(customer.last_purchase_at) > INACTIVE_DAYS * 24 * 60 : false;
  const docType = isDocType(customer.doc_type) ? customer.doc_type : "NONE";

  const notes = (notesRes.data ?? []) as NoteRow[];
  const authors = await noteAuthors(db, notes, op.user.id, op.user.name);

  const channels = [
    { label: "Sitio web", count: webCount.count ?? 0 },
    { label: "Mostrador", count: counterCount.count ?? 0 },
    { label: "Encomiendas", count: contractCount.count ?? 0 },
  ].sort((a, b) => b.count - a.count);
  const channelTotal = channels.reduce((sum, c) => sum + c.count, 0);
  const topChannel = channelTotal > 0 ? channels[0] : null;

  /* Falha de leitura não pode aparecer como "sin notas": a nota é justamente o aviso que a vendedora precisa ver. */
  const notesFailed = Boolean(notesRes.error);
  const favoritesFailed = [itemsRes, saleLinesRes, contractLinesRes].some((r) => r.error);
  const favorites = topProducts([
    ...((itemsRes.data ?? []) as unknown as LineRow[]),
    ...((saleLinesRes.data ?? []) as unknown as LineRow[]),
    ...((contractLinesRes.data ?? []) as unknown as LineRow[]),
  ]);

  const timeline = buildTimeline({
    orders: (ordersRes.data ?? []) as unknown as OrderRow[],
    sales: (salesRes.data ?? []) as unknown as SaleRow[],
    contracts: (contractsRes.data ?? []) as unknown as ContractRow[],
    leads: (leadsRes.data ?? []) as unknown as LeadRow[],
    complaints: (complaintsRes.data ?? []) as unknown as ComplaintRow[],
  });
  const shownTimeline = timeline.slice(0, TIMELINE_LIMIT);
  const timelineFailed = [ordersRes, salesRes, contractsRes, leadsRes, complaintsRes].some((r) => r.error);

  const tagSuggestions = popularTags((tagsRes.data ?? []) as { tags: string[] | null }[]);

  return (
    <div className="space-y-6">
      <Link href="/admin/clientes" className="inline-flex h-11 items-center text-sm text-terracota underline underline-offset-2">
        ← Clientes
      </Link>

      {/* Cabeçalho: quem é e como falar com ele */}
      <section className="card p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="break-words font-display text-2xl">{customer.name}</h2>
            {customer.trade_name && <p className="text-sm text-cacao-500">{customer.trade_name}</p>}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {spent >= VIP_MIN_SPENT && <Badge tone="gold">VIP</Badge>}
              {purchases >= RECURRENT_MIN_PURCHASES && <Badge>Recurrente</Badge>}
              {inactive && <Badge tone="warn">Inactivo</Badge>}
              {birthdayDays !== null && birthdayDays <= BIRTHDAY_WINDOW_DAYS && <Badge tone="red">{birthdayCountdown(birthdayDays)}</Badge>}
              {customer.marketing_opt_in && <Badge tone="ok">Acepta promociones</Badge>}
              {((customer.tags ?? []) as string[]).map((tag) => (
                <Link
                  key={tag}
                  href={`/admin/clientes?tag=${encodeURIComponent(tag)}`}
                  className="inline-flex h-7 items-center rounded-full bg-crema-100 px-2.5 text-[12px] font-medium text-cacao-700 hover:bg-crema-200"
                >
                  #{tag}
                </Link>
              ))}
            </div>
          </div>

          <div className="flex w-full flex-wrap gap-2 sm:w-auto">
            {whatsapp && (
              <a
                href={whatsapp}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-full bg-[#25D366] px-4 text-[15px] font-semibold text-[#0b3d20] transition-colors hover:bg-[#1fbb59] sm:flex-none sm:px-6"
              >
                <IconWhatsapp className="h-5 w-5 shrink-0" />
                WhatsApp
              </a>
            )}
            {customer.phone_norm && (
              <a
                href={`tel:${customer.phone_norm}`}
                className="inline-flex h-12 flex-1 items-center justify-center rounded-full border border-cacao/25 px-4 text-[15px] font-semibold text-cacao transition-colors hover:border-cacao hover:bg-crema-100 sm:flex-none sm:px-6"
              >
                Llamar
              </a>
            )}
          </div>
        </div>

        <dl className="mt-4 grid gap-x-8 gap-y-2 border-t border-crema-200 pt-4 text-sm sm:grid-cols-2">
          <Field label="Celular" value={phoneLabel || "—"} />
          <Field
            label="Correo"
            value={customer.email ? <a href={`mailto:${customer.email}`} className="break-all text-terracota underline underline-offset-2">{customer.email}</a> : "—"}
          />
          <Field label="Documento" value={docType === "NONE" || !customer.doc_number ? "—" : `${DOC_LABEL[docType]} ${customer.doc_number}`} />
          <Field label="Cumpleaños" value={customer.birthday ? birthdayLabel(customer.birthday) : "—"} />
          <Field label="Origen" value={sourceLabel(customer.source)} />
          {(customer.address || customer.district) && (
            <Field label="Dirección" value={[customer.address, customer.district].filter(Boolean).join(" — ")} />
          )}
        </dl>
      </section>

      {/* Indicadores */}
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 xl:grid-cols-6">
        <StatCard label="Compras" value={purchases} />
        <StatCard label="Total gastado" value={<Small>{soles(spent)}</Small>} />
        <StatCard label="Ticket promedio" value={<Small>{purchases ? soles(spent / purchases) : "—"}</Small>} />
        <StatCard label="Cliente desde" value={<Small>{limaDate(customer.first_seen_at)}</Small>} />
        <StatCard
          label="Última compra"
          value={<Small>{customer.last_purchase_at ? limaWhen(customer.last_purchase_at, today) : "—"}</Small>}
          hint={customer.last_purchase_at ? agoLabel(customer.last_purchase_at) : "Aún no compra"}
          tone={inactive ? "warn" : undefined}
        />
        <StatCard
          label="Canal principal"
          value={<Small>{topChannel ? topChannel.label : "—"}</Small>}
          hint={topChannel ? `${topChannel.count} de ${channelTotal} ${channelTotal === 1 ? "compra" : "compras"}` : `Llegó por: ${sourceLabel(customer.source)}`}
        />
      </ul>

      <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] lg:items-start">
        {/* Linha do tempo: no celular vem depois das notas (a nota é o que se lê antes de responder). */}
        <div className="order-2 space-y-6 lg:order-none">
          <Section title="Productos favoritos" aside={favorites.length ? "Por cantidad comprada" : undefined}>
            {favoritesFailed && <div className="px-5 pt-4"><Notice tone="warn">No se pudieron leer todas las compras. Recarga la página.</Notice></div>}
            {favorites.length ? (
              <ol className="divide-y divide-crema-200">
                {favorites.map((f, i) => (
                  <li key={f.name} className="flex items-center gap-3 px-5 py-3 text-sm">
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-dorado-100 text-[12px] font-bold text-cacao-700">{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate font-medium text-cacao">{f.name}</span>
                    <span className="shrink-0 tabular-nums text-cacao-500">× {formatQty(f.quantity)}</span>
                  </li>
                ))}
              </ol>
            ) : (
              !favoritesFailed && <EmptyState>Todavía no hay compras pagadas con detalle de productos.</EmptyState>
            )}
          </Section>

          <Section
            title="Historial"
            aside={
              timeline.length > TIMELINE_LIMIT
                ? `Últimos ${TIMELINE_LIMIT} movimientos`
                : timeline.length
                  ? `${timeline.length} ${timeline.length === 1 ? "movimiento" : "movimientos"}`
                  : undefined
            }
          >
            {timelineFailed && <div className="px-5 pt-4"><Notice tone="warn">Parte del historial no se pudo cargar. Recarga la página.</Notice></div>}
            {shownTimeline.length ? (
              <ol className="divide-y divide-crema-200">
                {shownTimeline.map((entry) => (
                  <li key={entry.key}>
                    <TimelineItem entry={entry} today={today} />
                  </li>
                ))}
              </ol>
            ) : (
              !timelineFailed && <EmptyState>Sin pedidos, ventas, encomiendas, leads ni reclamos todavía.</EmptyState>
            )}
          </Section>
        </div>

        {/* No celular: notas no topo, ficha no fim. No computador: coluna da direita. */}
        <div className="contents lg:flex lg:flex-col lg:gap-6">
          <Section title="Notas internas" aside={notes.length ? String(notes.length) : undefined} className="order-1 lg:order-none">
            <NoteForm customerId={customer.id} />
            {notesFailed && <div className="px-5 pt-4"><Notice tone="warn">No se pudieron cargar las notas. Recarga la página.</Notice></div>}
            {notes.length ? (
              <ul className="divide-y divide-crema-200">
                {notes.map((note) => (
                  <li key={note.id} className="px-5 py-3">
                    <p className="whitespace-pre-line break-words text-sm text-cacao">{note.body}</p>
                    <p className="mt-1 text-[12px] text-cacao-300">
                      {authors.get(note.actor ?? "") ?? "Equipo Fanor"} · {limaWhen(note.created_at, today)}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              !notesFailed && <EmptyState>Sin notas. Anota lo que el equipo debería saber antes de atenderlo.</EmptyState>
            )}
          </Section>

          <Section title="Ficha" className="order-3 lg:order-none">
            <CustomerForm
              customerId={customer.id}
              initial={{
                name: customer.name,
                phone: customer.phone,
                email: customer.email,
                doc_type: customer.doc_type,
                doc_number: customer.doc_number,
                birthday: customer.birthday,
                tags: (customer.tags ?? []) as string[],
                marketing_opt_in: Boolean(customer.marketing_opt_in),
              }}
              tagSuggestions={tagSuggestions}
            />
          </Section>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function TimelineItem({ entry, today }: { entry: Entry; today: string }) {
  const body = (
    <div className="flex items-start gap-3 px-5 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-cacao-300">{entry.kind}</p>
        <p className={cx("break-words font-medium text-cacao", entry.href && "underline-offset-2 group-hover:underline")}>{entry.title}</p>
        <p className="text-[13px] text-cacao-500">
          {limaWhen(entry.at, today)}
          {entry.detail && ` · ${entry.detail}`}
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        {entry.amount !== null && <span className="font-semibold tabular-nums text-cacao">{soles(entry.amount)}</span>}
        <StatusPill status={entry.status} map={entry.map} />
      </div>
    </div>
  );
  return entry.href ? (
    <Link href={entry.href} className="group block transition-colors hover:bg-crema-100/60 active:bg-crema-100">
      {body}
    </Link>
  ) : (
    body
  );
}

function buildTimeline(data: { orders: OrderRow[]; sales: SaleRow[]; contracts: ContractRow[]; leads: LeadRow[]; complaints: ComplaintRow[] }) {
  const entries: Entry[] = [];

  for (const o of data.orders) {
    entries.push({
      key: `order-${o.code}`,
      at: o.created_at,
      kind: "Pedido web",
      title: o.code,
      detail: o.delivery_date ? `${o.delivery_method === "pickup" ? "Recojo" : "Entrega"} ${limaDate(`${o.delivery_date}T12:00:00-05:00`)}` : "",
      amount: Number(o.total) || 0,
      status: o.status,
      map: ORDER_STATUS,
      href: `/admin/pedidos/${encodeURIComponent(o.code)}`,
    });
  }
  for (const s of data.sales) {
    entries.push({
      key: `sale-${s.id}`,
      at: s.sold_at,
      kind: SALE_KIND[s.kind] ?? "Venta",
      title: `Venta #${s.number}`,
      detail: s.stores ? shortStoreName(s.stores.name) : "",
      amount: Number(s.total) || 0,
      status: s.status,
      map: SALE_STATUS,
      href: `/admin/ventas/${s.id}`,
    });
  }
  for (const c of data.contracts) {
    entries.push({
      key: `contract-${c.id}`,
      at: c.created_at,
      kind: "Encomienda",
      title: `Encomienda #${c.number}`,
      detail: [`Entrega ${limaDate(`${c.deliver_on}T12:00:00-05:00`)}`, c.stores ? shortStoreName(c.stores.name) : ""].filter(Boolean).join(" · "),
      amount: Number(c.total) || 0,
      status: c.status,
      map: CONTRACT_STATUS,
      href: `/admin/encomiendas/${c.id}`,
    });
  }
  for (const l of data.leads) {
    entries.push({
      key: `lead-${l.id}`,
      at: l.created_at,
      kind: `Lead · ${LEAD_SOURCE[l.source] ?? l.source}`,
      title: l.interest ? `#${l.number} · ${l.interest}` : `Lead #${l.number}`,
      detail: l.stores ? shortStoreName(l.stores.name) : "",
      amount: null,
      status: l.status,
      map: LEAD_STATUS,
      href: "/admin/leads",
    });
  }
  for (const r of data.complaints) {
    entries.push({
      key: `complaint-${r.code}`,
      at: r.created_at,
      kind: COMPLAINT_KIND[r.kind] ?? "Reclamo",
      title: r.code,
      detail: "Libro de reclamaciones",
      amount: null,
      status: r.status,
      map: COMPLAINT_STATUS,
      href: null,
    });
  }

  return entries.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
}

/**
 * Top 5 por quantidade, juntando site, balcão e encomenda.
 *
 * O nome é comparado sem diferença de maiúsculas e espaços: o site grava
 * "Torta de Moka" e o balcão pode gravar "TORTA DE MOKA". Mostra a grafia
 * que mais apareceu.
 */
function topProducts(lines: LineRow[]) {
  const groups = new Map<string, { quantity: number; spellings: Map<string, number> }>();
  for (const line of lines) {
    const name = (line.name ?? "").replace(/\s+/g, " ").trim();
    if (!name) continue;
    const key = name.toLocaleLowerCase("es");
    const quantity = Number(line.quantity) || 1;
    const group = groups.get(key) ?? { quantity: 0, spellings: new Map<string, number>() };
    group.quantity += quantity;
    group.spellings.set(name, (group.spellings.get(name) ?? 0) + quantity);
    groups.set(key, group);
  }
  return [...groups.values()]
    .map((g) => ({ name: [...g.spellings.entries()].sort((a, b) => b[1] - a[1])[0][0], quantity: g.quantity }))
    .sort((a, b) => b.quantity - a.quantity || a.name.localeCompare(b.name, "es"))
    .slice(0, 5);
}

/** Etiquetas mais usadas na base, para sugerir e evitar "cumpleañera" e "cumpleañero" como filtros diferentes. */
function popularTags(rows: { tags: string[] | null }[]) {
  const counts = new Map<string, number>();
  for (const row of rows) for (const tag of row.tags ?? []) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "es")).slice(0, 40).map(([tag]) => tag);
}

/**
 * Nome de quem escreveu cada nota.
 *
 * A tabela `admins` só deixa cada usuário ler a própria linha, então o nome
 * dos colegas vem do cadastro de vendedoras (`sellers.user_id`). O próprio
 * usuário aparece com o nome da sessão.
 */
async function noteAuthors(db: SupabaseClient, notes: NoteRow[], userId: string, userName: string) {
  const names = new Map<string, string>([[userId, userName]]);
  const others = [...new Set(notes.map((n) => n.actor).filter((a): a is string => Boolean(a) && a !== userId))];
  if (others.length) {
    const { data } = await db.from("sellers").select("user_id, name").in("user_id", others);
    for (const s of (data ?? []) as { user_id: string; name: string }[]) names.set(s.user_id, s.name);
  }
  return names;
}

function agoLabel(iso: string) {
  const minutes = minutesBetween(iso);
  if (minutes < 60 * 24) return `Hace ${formatDuration(minutes)}`;
  const days = Math.floor(minutes / (60 * 24));
  return days === 1 ? "Hace 1 día" : `Hace ${days} días`;
}

function formatQty(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, "");
}

function Small({ children }: { children: ReactNode }) {
  return <span className="block text-xl leading-tight">{children}</span>;
}

function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex justify-between gap-4 sm:justify-start">
      <dt className="shrink-0 text-cacao-500 sm:w-24">{label}</dt>
      <dd className="min-w-0 text-right text-cacao sm:text-left">{value}</dd>
    </div>
  );
}

function Badge({ children, tone }: { children: ReactNode; tone?: "gold" | "warn" | "red" | "ok" }) {
  return (
    <span
      className={cx(
        "inline-flex h-7 items-center rounded-full border px-2.5 text-[12px] font-semibold",
        tone === "gold" && "border-dorado bg-dorado text-cacao",
        tone === "warn" && "border-dorado-600/40 bg-dorado-100 text-cacao-700",
        tone === "red" && "border-terracota/30 bg-terracota/10 text-terracota-700",
        tone === "ok" && "border-verde/35 bg-verde-100 text-verde",
        !tone && "border-cacao/20 bg-crema-100 text-cacao-700",
      )}
    >
      {children}
    </span>
  );
}
