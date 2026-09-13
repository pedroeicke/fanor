import type { Metadata } from "next";
import { getOperator, listStores, shortStoreName, type Operator } from "@/lib/gestion/server";
import { Notice, PageHeader } from "@/components/admin/ui";
import { CatalogTabs } from "@/components/admin/catalogos/CatalogTabs";
import { FamiliesCatalog } from "@/components/admin/catalogos/FamiliesCatalog";
import { SellersCatalog } from "@/components/admin/catalogos/SellersCatalog";
import { SimpleCatalog } from "@/components/admin/catalogos/SimpleCatalog";
import {
  SIMPLE_CATALOGS,
  isSimpleCatalogKind,
  parseCatalogTab,
  type CatalogItem,
  type CatalogTab,
  type FamilyRow,
  type SellerRow,
  type SimpleCatalogKind,
} from "@/components/admin/catalogos/config";

export const metadata: Metadata = { title: "Catálogos" };
export const dynamic = "force-dynamic";

/**
 * As listas que o resto da operação consome: sabores e tipos no despacho do
 * taller, decoradora na encomenda, vendedora no login e na venda, validade
 * no vencimento da torta.
 *
 * Cada aba busca só o que mostra. Leitura com a sessão (RLS); escrita nas
 * ações ao lado.
 */
export default async function CatalogosPage({ searchParams }: { searchParams: Promise<{ t?: string | string[] }> }) {
  const tab = parseCatalogTab((await searchParams).t);
  const op = await getOperator();
  if (!op) return <Notice tone="bad">Sesión expirada. Vuelve a entrar.</Notice>;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Catálogos"
        description="Sabores, tipos de torta, decoradoras, vendedoras y validez por familia. Lo que se registra aquí aparece en el taller, la recepción, el mostrador y las encomiendas."
      />
      <CatalogTabs active={tab} />
      <TabContent tab={tab} op={op} />
    </div>
  );
}

async function TabContent({ tab, op }: { tab: CatalogTab; op: Operator }) {
  if (isSimpleCatalogKind(tab)) return <SimpleTab kind={tab} op={op} />;
  if (tab === "vendedoras") return <SellersTab op={op} />;
  return <FamiliesTab op={op} />;
}

async function SimpleTab({ kind, op }: { kind: SimpleCatalogKind; op: Operator }) {
  const config = SIMPLE_CATALOGS[kind];
  let query = op.db.from(config.table).select("id, code, name, active");
  query = config.sortable ? query.order("sort_order").order("name") : query.order("name");
  const { data, error } = await query;
  if (error) return <LoadError />;

  const items = (data ?? []) as CatalogItem[];
  /* `key` pela aba: trocar de Sabores para Tipos zera o formulário pela
     metade em vez de levar o rascunho de uma lista para a outra. */
  return <SimpleCatalog key={kind} kind={kind} items={items} />;
}

async function SellersTab({ op }: { op: Operator }) {
  const [{ data, error }, stores] = await Promise.all([
    op.db.from("sellers").select("id, code, name, active, store_id, phone, role, user_id").order("name"),
    listStores(op.db),
  ]);
  if (error) return <LoadError />;

  type Row = { id: string; code: string; name: string; active: boolean; store_id: string | null; phone: string | null; role: string; user_id: string | null };
  /* O id da conta não desce para o navegador: a tela só precisa saber se
     existe acesso e se é o da própria pessoa logada. */
  const sellers: SellerRow[] = ((data ?? []) as Row[]).map((s) => ({
    id: s.id,
    code: s.code,
    name: s.name,
    active: s.active,
    storeId: s.store_id,
    phone: s.phone,
    role: s.role,
    hasAccess: Boolean(s.user_id),
    isSelf: s.user_id === op.user.id,
  }));

  return (
    <SellersCatalog
      sellers={sellers}
      stores={stores.map((store) => ({ id: store.id, label: shortStoreName(store.name) }))}
      isOwner={op.user.role === "owner"}
    />
  );
}

async function FamiliesTab({ op }: { op: Operator }) {
  const { data, error } = await op.db
    .from("product_families")
    .select("id, code, name, tracks_serial, is_service, shelf_life_days")
    .order("sort_order")
    .order("code");
  if (error) return <LoadError />;

  type Row = { id: string; code: string; name: string; tracks_serial: boolean; is_service: boolean; shelf_life_days: number | null };
  const rows = (data ?? []) as Row[];

  /* Contagem por família no banco, só cabeçalho: puxar os produtos para
     contar aqui esbarraria no limite de linhas da API quando o catálogo
     crescer. É uma aba que se abre pouco; as consultas vão em paralelo. */
  const count = (family: string) => op.db.from("products").select("id", { count: "exact", head: true }).eq("family_id", family);
  const [totals, withOwn, orphan] = await Promise.all([
    Promise.all(rows.map((f) => count(f.id))),
    /* O leitor do Sisgeco copia a validade da família para o produto quando o
       cria. Esses produtos ficam com número próprio e não seguem mudança na
       família — a tela precisa dizer quantos são. */
    Promise.all(rows.map((f) => count(f.id).not("shelf_life_days", "is", null))),
    op.db.from("products").select("id", { count: "exact", head: true }).is("family_id", null),
  ]);

  const families: FamilyRow[] = rows.map((f, i) => ({
    id: f.id,
    code: f.code,
    name: f.name,
    tracksSerial: f.tracks_serial,
    isService: f.is_service,
    shelfLifeDays: f.shelf_life_days,
    products: totals[i].count ?? 0,
    ownShelfLife: withOwn[i].count ?? 0,
  }));

  return <FamiliesCatalog families={families} withoutFamily={orphan.count ?? 0} />;
}

function LoadError() {
  return <Notice tone="bad">No se pudo cargar la lista. Recarga la página en unos segundos.</Notice>;
}
