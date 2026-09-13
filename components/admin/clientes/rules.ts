import { limaToday } from "@/lib/gestion/dates";

/**
 * Regras do cadastro de cliente, as mesmas no navegador e no servidor.
 *
 * O servidor valida de novo tudo que chega (uma server action é um POST
 * como outro qualquer); o formulário usa as mesmas funções só para avisar
 * antes de enviar.
 */

/* -------------------------------------------------------------------------- */
/*  Segmentos                                                                 */
/* -------------------------------------------------------------------------- */

export const NEW_DAYS = 30;
export const INACTIVE_DAYS = 90;
export const BIRTHDAY_WINDOW_DAYS = 30;
export const RECURRENT_MIN_PURCHASES = 2;
export const VIP_MIN_SPENT = 500;

export const SEGMENTS = [
  { key: "todos", label: "Todos" },
  { key: "nuevos", label: "Nuevos", hint: `Vistos por primera vez en los últimos ${NEW_DAYS} días` },
  { key: "recurrentes", label: "Recurrentes", hint: `${RECURRENT_MIN_PURCHASES} compras o más` },
  { key: "vip", label: "VIP", hint: `S/ ${VIP_MIN_SPENT} o más en compras` },
  { key: "inactivos", label: "Inactivos", hint: `Sin comprar hace más de ${INACTIVE_DAYS} días` },
  { key: "cumpleanos", label: "Cumpleaños próximos", hint: `Cumplen en los próximos ${BIRTHDAY_WINDOW_DAYS} días` },
  { key: "reclamo", label: "Con reclamo", hint: "Registraron algo en el Libro de Reclamaciones" },
] as const;

export type Segment = (typeof SEGMENTS)[number]["key"];

export function isSegment(value: unknown): value is Segment {
  return SEGMENTS.some((s) => s.key === value);
}

/* -------------------------------------------------------------------------- */
/*  Documento                                                                 */
/* -------------------------------------------------------------------------- */

export const DOC_TYPES = ["DNI", "RUC", "CE", "PASSPORT", "NONE"] as const;
export type DocType = (typeof DOC_TYPES)[number];

export const DOC_LABEL: Record<DocType, string> = {
  DNI: "DNI",
  RUC: "RUC",
  CE: "Carné de extranjería",
  PASSPORT: "Pasaporte",
  NONE: "Sin documento",
};

export function isDocType(value: unknown): value is DocType {
  return DOC_TYPES.includes(value as DocType);
}

/** Mensagem de erro do número, ou null se está certo. */
export function docNumberError(type: DocType, number: string) {
  if (type === "NONE") return null;
  if (type === "DNI" && !/^\d{8}$/.test(number)) return "El DNI tiene 8 dígitos.";
  if (type === "RUC" && !/^\d{11}$/.test(number)) return "El RUC tiene 11 dígitos.";
  if ((type === "CE" || type === "PASSPORT") && !/^[A-Z0-9]{5,15}$/.test(number)) {
    return `El ${DOC_LABEL[type].toLowerCase()} tiene entre 5 y 15 letras o números.`;
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/*  Celular e e-mail                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Celular peruano só com dígitos, sem o 51.
 *
 * Espelha `normalize_phone()` da migração 0012. Tem de ser idêntica: é por
 * esta chave que o banco junta o mesmo cliente vindo do site, do Messenger e
 * do balcão — uma regra diferente aqui criaria o cliente em dobro na próxima
 * compra.
 */
export function normalizePhone(raw: string | null | undefined) {
  if (raw == null) return null;
  let digits = raw.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("51")) digits = digits.slice(2);
  if (digits.length < 6) return null;
  return digits;
}

/** Mesma regra de `crm_upsert_customer`: minúsculas, sem espaço nas pontas. */
export function normalizeEmail(raw: string | null | undefined) {
  const value = (raw ?? "").trim().toLowerCase();
  return value || null;
}

/** Só celular peruano (9 dígitos, começa com 9) abre conversa no WhatsApp. */
export function whatsappUrl(phoneNorm: string | null | undefined) {
  return phoneNorm && /^9\d{8}$/.test(phoneNorm) ? `https://wa.me/51${phoneNorm}` : null;
}

/** "987 654 321" — lido em voz alta ao telefone sem errar. */
export function formatPhone(phoneNorm: string | null | undefined, raw?: string | null) {
  if (phoneNorm && /^\d{9}$/.test(phoneNorm)) return phoneNorm.replace(/(\d{3})(\d{3})(\d{3})/, "$1 $2 $3");
  return raw?.trim() || phoneNorm || "";
}

/* -------------------------------------------------------------------------- */
/*  Aniversário                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Ano gravado quando o cliente diz o dia e o mês mas não o ano.
 *
 * A coluna é `date` e exige ano; perguntar a idade no balcão constrange e
 * quase ninguém responde. 1904 é bissexto (aceita 29 de fevereiro) e nenhum
 * cliente real nasceu nele, então a tela sabe que o ano não foi informado.
 */
export const UNKNOWN_BIRTH_YEAR = 1904;

export const MONTHS = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

function isLeap(year: number) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(month: number, year: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Dias até o próximo aniversário, contando hoje como 0.
 *
 * Compara só mês e dia, no calendário de Lima, e atravessa a virada do ano
 * (em 20 de dezembro, quem faz em 5 de janeiro está a 16 dias). Quem nasceu
 * em 29 de fevereiro comemora no dia 28 nos anos que não são bissextos.
 */
export function daysUntilBirthday(birthday: string, today = limaToday()) {
  const [, bm, bd] = birthday.split("-").map(Number);
  const [ty, tm, td] = today.split("-").map(Number);
  const start = Date.UTC(ty, tm - 1, td);
  for (const year of [ty, ty + 1]) {
    const day = bm === 2 && bd === 29 && !isLeap(year) ? 28 : bd;
    const next = Date.UTC(year, bm - 1, day);
    if (next >= start) return Math.round((next - start) / 86_400_000);
  }
  return 365;
}

/** "14 de marzo" ou "14 de marzo de 1990". */
export function birthdayLabel(birthday: string) {
  const [y, m, d] = birthday.split("-").map(Number);
  const base = `${d} de ${MONTHS[m - 1]}`;
  return y === UNKNOWN_BIRTH_YEAR ? base : `${base} de ${y}`;
}

/** "Cumple hoy", "Cumple mañana", "Cumple en 12 días". */
export function birthdayCountdown(days: number) {
  if (days === 0) return "Cumple hoy";
  if (days === 1) return "Cumple mañana";
  return `Cumple en ${days} días`;
}

/* -------------------------------------------------------------------------- */
/*  Etiquetas                                                                 */
/* -------------------------------------------------------------------------- */

export const MAX_TAGS = 20;
export const MAX_TAG_LENGTH = 30;

/**
 * Etiqueta em minúsculas, só letras, números, espaço, hífen e sublinhado.
 *
 * Minúsculas porque "VIP" e "vip" viravam dois filtros diferentes. Os
 * caracteres ficam restritos porque a etiqueta vai parar no filtro de array
 * do banco (`{…}`) e no CSV — vírgula, chave ou aspas quebrariam os dois.
 */
export function normalizeTag(raw: string) {
  return raw
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N} _-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TAG_LENGTH)
    .trim();
}

/* -------------------------------------------------------------------------- */
/*  Ficha                                                                     */
/* -------------------------------------------------------------------------- */

/** O que o formulário envia. Tudo texto: o servidor converte e valida. */
export type CustomerInput = {
  name: string;
  phone: string;
  email: string;
  docType: string;
  docNumber: string;
  birthDay: string;
  birthMonth: string;
  birthYear: string;
  tags: string[];
  marketingOptIn: boolean;
};

/** Linha pronta para gravar em `customers`. */
export type CustomerPatch = {
  name: string;
  phone: string | null;
  phone_norm: string | null;
  email: string | null;
  email_norm: string | null;
  doc_type: DocType;
  doc_number: string | null;
  birthday: string | null;
  tags: string[];
  marketing_opt_in: boolean;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.normalize("NFC").replace(/\s+/g, " ").trim().slice(0, max) : "";
}

/** O que já está gravado e pode ter vindo de outro caminho (checkout, balcão, Sisgeco). */
export type StoredIdentity = {
  phone: string | null;
  phone_norm: string | null;
  doc_type: string;
  doc_number: string | null;
  email: string | null;
};

/**
 * Confere e normaliza a ficha.
 *
 * Recebe `unknown` de propósito: o que chega numa server action não passou
 * pelo TypeScript de ninguém.
 *
 * `stored` é a ficha atual. Celular, documento e correio que a pessoa não
 * mexeu não são reprovados de novo: um lead que chegou com celular "N/A" ou
 * um DNI de 7 dígitos não pode impedir a vendedora de anotar o aniversário
 * ou uma etiqueta. O formato só é cobrado de quem digita um valor novo.
 */
export function validateCustomerInput(
  input: unknown,
  stored: StoredIdentity | null = null,
  today = limaToday(),
): { ok: true; patch: CustomerPatch } | { ok: false; error: string } {
  if (!input || typeof input !== "object") return { ok: false, error: "Datos inválidos." };
  const raw = input as Record<string, unknown>;

  const name = text(raw.name, 200);
  if (name.length < 2) return { ok: false, error: "Escribe el nombre del cliente." };
  if (name.length > 120) return { ok: false, error: "El nombre es demasiado largo (máximo 120 caracteres)." };

  const phone = text(raw.phone, 40);
  const phoneNorm = normalizePhone(phone);
  const phoneKept = Boolean(stored?.phone) && phone === text(stored?.phone, 40);
  if (phone && !phoneKept && !phoneNorm) return { ok: false, error: "El celular debe tener al menos 6 dígitos." };
  if (phoneNorm && !phoneKept && phoneNorm.length > 15) return { ok: false, error: "El celular tiene demasiados dígitos." };

  const email = text(raw.email, 300).replace(/\s/g, "");
  const emailKept = Boolean(stored?.email) && email === stored?.email;
  if (email && !emailKept && (email.length > 254 || !EMAIL_RE.test(email))) return { ok: false, error: "El correo no es válido." };

  if (!isDocType(raw.docType)) return { ok: false, error: "Tipo de documento inválido." };
  const docType = raw.docType;
  const docRaw = docType === "NONE" ? "" : text(raw.docNumber, 20);
  /* Mesmo tipo e mesmo número já gravados: fica como está, sem limpar nem reprovar. */
  const docKept = docType !== "NONE" && stored?.doc_type === docType && Boolean(stored.doc_number) && docRaw === stored.doc_number;
  const docNumber = docKept ? docRaw : docRaw.replace(/[\s.-]/g, "").toUpperCase();
  if (docType !== "NONE" && !docNumber) return { ok: false, error: `Escribe el número de ${DOC_LABEL[docType]}.` };
  const docError = docKept ? null : docNumberError(docType, docNumber);
  if (docError) return { ok: false, error: docError };

  const birthday = parseBirthday(raw.birthDay, raw.birthMonth, raw.birthYear, today);
  if (typeof birthday === "object" && birthday !== null) return { ok: false, error: birthday.error };

  /* Teto antes de normalizar: o laço abaixo não pode rodar sobre uma lista enorme forjada no POST. */
  if (!Array.isArray(raw.tags) || raw.tags.length > MAX_TAGS * 3 || raw.tags.some((t) => typeof t !== "string")) {
    return { ok: false, error: "Etiquetas inválidas." };
  }
  const tags: string[] = [];
  for (const t of raw.tags as string[]) {
    const tag = normalizeTag(t);
    if (tag && !tags.includes(tag)) tags.push(tag);
  }
  if (tags.length > MAX_TAGS) return { ok: false, error: `Máximo ${MAX_TAGS} etiquetas por cliente.` };

  if (typeof raw.marketingOptIn !== "boolean") return { ok: false, error: "Datos inválidos." };

  return {
    ok: true,
    patch: {
      name,
      phone: phone || null,
      /* Celular intacto conserva a chave gravada: o banco pode ter preenchido `phone_norm` numa
         compra posterior enquanto `phone` ficou com o valor antigo ("N/A"). Recalcular apagaria a chave. */
      phone_norm: phoneKept && stored?.phone_norm ? stored.phone_norm : phoneNorm,
      email: email || null,
      email_norm: normalizeEmail(email),
      doc_type: docType,
      doc_number: docType === "NONE" ? null : docNumber,
      birthday,
      tags,
      marketing_opt_in: raw.marketingOptIn,
    },
  };
}

/** "AAAA-MM-DD", null (não informado) ou o erro. */
function parseBirthday(dayRaw: unknown, monthRaw: unknown, yearRaw: unknown, today: string): string | null | { error: string } {
  const dayText = text(dayRaw, 4);
  const monthText = text(monthRaw, 4);
  const yearText = text(yearRaw, 6);
  if (!dayText && !monthText && !yearText) return null;
  if (!dayText || !monthText) return { error: "Para el cumpleaños elige el día y el mes." };

  const day = Number(dayText);
  const month = Number(monthText);
  if (!Number.isInteger(month) || month < 1 || month > 12) return { error: "Mes de cumpleaños inválido." };

  let year = UNKNOWN_BIRTH_YEAR;
  if (yearText) {
    const currentYear = Number(today.slice(0, 4));
    year = Number(yearText);
    if (!/^\d{4}$/.test(yearText) || year < 1900 || year > currentYear) {
      return { error: `El año de nacimiento debe estar entre 1900 y ${currentYear}.` };
    }
  }
  if (!Number.isInteger(day) || day < 1 || day > daysInMonth(month, year)) {
    return { error: "Ese día no existe en el mes elegido." };
  }

  const iso = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  if (iso > today) return { error: "El cumpleaños no puede ser una fecha futura." };
  return iso;
}

/** Separa a data gravada nos três campos do formulário. */
export function splitBirthday(birthday: string | null) {
  if (!birthday) return { birthDay: "", birthMonth: "", birthYear: "" };
  const [y, m, d] = birthday.split("-").map(Number);
  return { birthDay: String(d), birthMonth: String(m), birthYear: y === UNKNOWN_BIRTH_YEAR ? "" : String(y) };
}

export const MAX_NOTE_LENGTH = 2000;

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
