/**
 * Regras e rótulos dos catálogos, num lugar só.
 *
 * O mesmo arquivo serve à tela (para travar o botão antes de enviar) e às
 * ações do servidor (que validam de novo — a tela é conveniência, o servidor
 * é a regra). Sem "use client" nem "server-only": é código puro.
 */

export const CATALOG_TABS = [
  { key: "sabores", label: "Sabores" },
  { key: "tipos", label: "Tipos de torta" },
  { key: "decoradoras", label: "Decoradoras" },
  { key: "vendedoras", label: "Vendedoras" },
  { key: "familias", label: "Familias" },
] as const;

export type CatalogTab = (typeof CATALOG_TABS)[number]["key"];

export function parseCatalogTab(value: string | string[] | undefined): CatalogTab {
  const raw = Array.isArray(value) ? value[0] : value;
  return CATALOG_TABS.find((tab) => tab.key === raw)?.key ?? "sabores";
}

/**
 * Listas simples: código + nome + ativo. Sabor e tipo têm ordem porque
 * aparecem como opções no despacho do taller, e a mais usada tem de vir
 * primeiro. Decoradora é gente: ordem alfabética basta.
 */
export const SIMPLE_CATALOGS = {
  sabores: {
    table: "flavors",
    title: "Sabores",
    singular: "sabor",
    article: "el",
    sortable: true,
    active: "Activo",
    inactive: "Inactivo",
    empty: "Todavía no hay sabores. Agrega el primero con el código que usa el Sisgeco.",
    namePlaceholder: "Fresa",
    codePlaceholder: "FRE",
  },
  tipos: {
    table: "cake_types",
    title: "Tipos de torta",
    singular: "tipo de torta",
    article: "el",
    sortable: true,
    active: "Activo",
    inactive: "Inactivo",
    empty: "Todavía no hay tipos de torta. Agrega el primero con el código que usa el Sisgeco.",
    namePlaceholder: "Tres leches",
    codePlaceholder: "TL",
  },
  decoradoras: {
    table: "decorators",
    title: "Decoradoras",
    singular: "decoradora",
    article: "la",
    sortable: false,
    active: "Activa",
    inactive: "Inactiva",
    empty: "Todavía no hay decoradoras. Agrega la primera con el código que usa el Sisgeco.",
    namePlaceholder: "Lucía Quispe",
    codePlaceholder: "LQ",
  },
} as const;

export type SimpleCatalogKind = keyof typeof SIMPLE_CATALOGS;

export function isSimpleCatalogKind(value: unknown): value is SimpleCatalogKind {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(SIMPLE_CATALOGS, value);
}

export type CatalogItem = { id: string; code: string; name: string; active: boolean };

export const SELLER_ROLES = {
  seller: "Vendedora",
  workshop: "Taller",
  manager: "Encargada",
} as const;

export type SellerRole = keyof typeof SELLER_ROLES;

export function isSellerRole(value: unknown): value is SellerRole {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(SELLER_ROLES, value);
}

export type SellerRow = {
  id: string;
  code: string;
  name: string;
  active: boolean;
  storeId: string | null;
  phone: string | null;
  role: string;
  hasAccess: boolean;
  /** A conta ligada é a de quem está usando o painel agora. */
  isSelf: boolean;
};

export type SellerInput = {
  code: string;
  name: string;
  storeId: string;
  role: string;
  phone: string;
};

export type FamilyRow = {
  id: string;
  code: string;
  name: string;
  tracksSerial: boolean;
  isService: boolean;
  shelfLifeDays: number | null;
  products: number;
  /** Produtos da família com validade própria: a da família não vale para eles. */
  ownShelfLife: number;
};

export type StoreOption = { id: string; label: string };

/* -------------------------------------------------------------------------- */
/*  Validação                                                                 */
/* -------------------------------------------------------------------------- */

export const CODE_MAX = 20;
export const NAME_MAX = 60;
export const SELLER_NAME_MAX = 80;
export const EMAIL_MAX = 254;
/** Validade de família: além de um mês já não é produto fresco. */
export const SHELF_LIFE_MAX = 30;
/** O que `product_shelf_life()` usa quando nem produto nem família dizem. */
export const DEFAULT_SHELF_LIFE = 2;

/* Código do Sisgeco: sem espaço nem acento, em maiúsculas, como aparece no
   comprovante. O Ñ é letra do teclado em espanhol; barrá-lo só faria alguém
   inventar um código diferente do que já usa. */
const CODE_PATTERN = /^[A-Z0-9Ñ][A-Z0-9Ñ._-]*$/;

export function normalizeCode(raw: string) {
  return raw.trim().toUpperCase();
}

/** Devolve a mensagem de erro, ou null se o código serve. */
export function codeError(code: string) {
  if (!code) return "Escribe el código.";
  if (code.length > CODE_MAX) return `El código admite hasta ${CODE_MAX} caracteres.`;
  if (!CODE_PATTERN.test(code)) return "El código solo admite letras, números, punto, guion y guion bajo, sin espacios.";
  return null;
}

export function nameError(name: string, max = NAME_MAX) {
  if (name.length < 2) return "Escribe el nombre.";
  if (name.length > max) return `El nombre admite hasta ${max} caracteres.`;
  return null;
}

/* Celular com o formato que a vendedora digitar (espaço, +51, hífen), desde
   que os dígitos façam sentido. O CRM normaliza depois; aqui só barra lixo. */
export function phoneError(phone: string) {
  if (!phone) return null;
  if (!/^[+\d\s()-]+$/.test(phone)) return "El celular solo admite números.";
  const digits = phone.replace(/\D/g, "").length;
  if (digits < 6 || digits > 15) return "Revisa el número de celular.";
  return null;
}

export function emailError(email: string) {
  if (!email) return "Escribe el correo.";
  if (email.length > EMAIL_MAX || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return "Correo inválido.";
  return null;
}

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
