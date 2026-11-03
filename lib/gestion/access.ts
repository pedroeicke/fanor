/**
 * Quem vê o quê no painel.
 *
 * Sem acesso ao banco: o proxy barra a navegação com esta tabela, o menu se monta
 * com ela e cada ação do servidor confere de novo. O perfil sai de `admins.role`
 * e da ficha em `sellers`, a mesma regra de `panel_access()` no banco.
 *
 * "Taller" com áreas marcadas vira o perfil "area": só vê Producción e só fecha a
 * etapa dele. Sem áreas marcadas, é quem organiza o taller inteiro.
 */

export type Profile = "owner" | "manager" | "seller" | "workshop" | "area" | "accounting";

const OWNER: Profile[] = ["owner"];
const MANAGEMENT: Profile[] = ["owner", "manager"];
const SHOP: Profile[] = ["owner", "manager", "seller"];
const WORKSHOP: Profile[] = ["owner", "manager", "workshop"];

const ACCESS = {
  "/admin": MANAGEMENT,
  "/admin/tienda": SHOP,
  "/admin/recepcion": SHOP,
  "/admin/venta": SHOP,
  "/admin/ventas": SHOP,
  "/admin/pedidos-tienda": SHOP,
  "/admin/encomiendas": SHOP,
  "/admin/fotos": SHOP,
  "/admin/leads": SHOP,
  "/admin/clientes": SHOP,
  /* A lista inteira de clientes num arquivo não é ferramenta do balcão. */
  "/admin/clientes/exportar": MANAGEMENT,
  "/admin/taller": WORKSHOP,
  /* A encomenda aponta para o despacho dela: a vendedora vê onde a torta está. */
  "/admin/taller/despachos": ["owner", "manager", "workshop", "seller"],
  "/admin/etiquetas": WORKSHOP,
  "/admin/produccion": ["owner", "manager", "workshop", "area"],
  "/admin/produccion/nueva": WORKSHOP,
  "/admin/insumos": WORKSHOP,
  /* Tela de uma pessoa só: nem a encargada vê os gastos. */
  "/admin/gastos": ["owner", "accounting"],
  "/admin/costos": MANAGEMENT,
  "/admin/pedidos": MANAGEMENT,
  "/admin/alertas": MANAGEMENT,
  "/admin/recetas": MANAGEMENT,
  "/admin/simulacion-taller": MANAGEMENT,
  "/admin/catalogos": MANAGEMENT,
  "/admin/estoque": MANAGEMENT,
  "/admin/reportes": MANAGEMENT,
  /* Mudam o site público, a entrega ou o sistema inteiro. */
  "/admin/productos": OWNER,
  "/admin/entrega": OWNER,
  "/admin/respaldos": OWNER,
  "/admin/ajustes": OWNER,
} satisfies Record<string, Profile[]>;

export type Section = keyof typeof ACCESS;

const SECTIONS = Object.keys(ACCESS) as Section[];

const HOME: Record<Profile, string> = {
  owner: "/admin",
  manager: "/admin",
  seller: "/admin/tienda",
  workshop: "/admin/taller",
  area: "/admin/produccion",
  accounting: "/admin/gastos",
};

/** Mesma regra de `panel_access()`. Conta sem ficha ativa fica com o mínimo: ninguém perde a venda, ninguém ganha o resto. */
export function profileOf(adminRole: string, seller: { role: string; stages: string[] } | null): Profile {
  if (adminRole === "owner") return "owner";
  if (seller?.role === "manager") return "manager";
  if (seller?.role === "accounting") return "accounting";
  if (seller?.role === "workshop") return seller.stages.length > 0 ? "area" : "workshop";
  return "seller";
}

export function homeFor(profile: Profile) {
  return HOME[profile];
}

export function canAccess(profile: Profile, section: Section) {
  return (ACCESS[section] as Profile[]).includes(profile);
}

/** Por segmento inteiro: "/admin/pedidos" não pode valer para "/admin/pedidos-tienda". */
function sectionOf(pathname: string): Section | null {
  let best: Section | null = null;
  for (const section of SECTIONS) {
    const hit = section === "/admin" ? pathname === "/admin" : pathname === section || pathname.startsWith(`${section}/`);
    if (hit && (!best || section.length > best.length)) best = section;
  }
  return best;
}

/** Caminho que ninguém listou fica só com o dono: tela nova não nasce aberta para todos. */
export function canOpenPath(profile: Profile, pathname: string) {
  const section = sectionOf(pathname);
  return section ? canAccess(profile, section) : profile === "owner";
}

/** Login e saída valem para qualquer um, inclusive quem ainda não tem perfil. */
export function isPublicPanelPath(pathname: string) {
  return pathname === "/admin/login" || pathname === "/admin/salir";
}

/** A mesma regra de `access_can_stage()`: a área só fecha a própria etapa. */
export function canCloseStage(profile: Profile, stages: string[], stage: string) {
  if (profile === "area") return stages.includes(stage);
  return profile === "owner" || profile === "manager" || profile === "workshop";
}
