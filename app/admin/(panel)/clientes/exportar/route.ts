import { getAdminUser, getServerSupabase } from "@/lib/supabase-server";
import { limaToday, STORE_TIME_ZONE } from "@/lib/gestion/dates";
import { sourceLabel } from "@/components/admin/clientes/labels";
import { birthdayLabel } from "@/components/admin/clientes/rules";
import { listAllCustomers, parseFilters, type CustomerRow } from "../query";

export const dynamic = "force-dynamic";
/* A base inteira sai em lotes de 1000; o limite padrão da função cortaria o download no meio. */
export const maxDuration = 60;

/* Escrito como código e não como caractere: um BOM literal é invisível e some na primeira edição. */
const BOM = String.fromCharCode(0xfeff);

/**
 * CSV da carteira de clientes, com a busca e o segmento da tela.
 *
 * Só o dono exporta: é a base inteira de celulares e documentos, e uma
 * planilha sai do sistema sem deixar rastro de quem a repassou.
 *
 * Feito para abrir no Excel em espanhol com dois cliques: BOM UTF-8 (sem ele
 * "Pérez" vira "PÃ©rez"), ponto e vírgula como separador (a vírgula é o
 * decimal) e valores em S/ com vírgula decimal.
 */
export async function GET(request: Request) {
  const user = await getAdminUser();
  if (!user) return new Response("Sesión expirada. Vuelve a entrar.", { status: 401 });
  if (user.role !== "owner") return new Response("Solo el dueño puede exportar clientes.", { status: 403 });

  const db = await getServerSupabase();
  if (!db) return new Response("Sin conexión con la base de datos.", { status: 503 });

  const url = new URL(request.url);
  const filters = parseFilters(Object.fromEntries(url.searchParams));
  const result = await listAllCustomers(db, filters);
  if ("error" in result) return new Response(result.error, { status: 500 });

  const header = [
    "Nombre", "Tipo de documento", "Número de documento", "Celular", "Celular internacional", "Correo",
    "Cumpleaños", "Compras", "Total gastado (S/)", "Ticket promedio (S/)", "Primera vez", "Última compra",
    "Origen", "Etiquetas", "Acepta marketing", "ID",
  ];
  const lines = [header.map(textCell).join(";")];
  for (const c of result.rows) lines.push(row(c).join(";"));
  if (result.truncated) lines.push(textCell("Exportación recortada: afina el filtro para obtener el resto."));

  /* Quem exportou e com que filtro. O resultado não é conferido de propósito:
     falhar o registro não pode impedir o download. */
  await db.from("audit_log").insert({
    actor: user.id,
    action: "customers.export",
    entity: "customers",
    entity_id: null,
    changes: { q: filters.q, segment: filters.segment, tag: filters.tag, rows: result.rows.length },
  });

  const body = `${BOM}${lines.join("\r\n")}\r\n`;
  const suffix = filters.segment === "todos" ? "" : `-${filters.segment}`;
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="clientes${suffix}-${limaToday()}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}

function row(c: CustomerRow) {
  const spent = Number(c.total_spent) || 0;
  return [
    textCell(c.name),
    textCell(c.doc_type === "NONE" ? "" : c.doc_type),
    codeCell(c.doc_type === "NONE" ? null : c.doc_number),
    codeCell(c.phone_norm ?? c.phone),
    codeCell(c.phone_norm && /^9\d{8}$/.test(c.phone_norm) ? `51${c.phone_norm}` : null),
    textCell(c.email),
    textCell(c.birthday ? birthdayLabel(c.birthday) : ""),
    textCell(String(c.orders_count)),
    textCell(decimal(spent)),
    textCell(c.orders_count > 0 ? decimal(spent / c.orders_count) : ""),
    textCell(excelDate(c.first_seen_at)),
    textCell(c.last_purchase_at ? excelDate(c.last_purchase_at) : ""),
    textCell(sourceLabel(c.source) === "—" ? "" : sourceLabel(c.source)),
    textCell((c.tags ?? []).join(", ")),
    textCell(c.marketing_opt_in ? "Sí" : "No"),
    textCell(c.id),
  ];
}

/**
 * Célula de texto entre aspas.
 *
 * Nome e e-mail vêm do checkout público: alguém pode se cadastrar como
 * `=HYPERLINK(...)` e o Excel executaria a fórmula ao abrir. O apóstrofo na
 * frente faz a célula ser lida como texto (recomendação da OWASP).
 */
function textCell(value: string | null | undefined) {
  let text = (value ?? "").replace(/\r?\n/g, " ");
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

/**
 * Documento e celular como texto no Excel.
 *
 * Sem isto o DNI 04512345 perde o zero e o 51987654321 vira 5,19877E+10. O
 * `="…"` é a forma que o Excel respeita; só é usado quando o valor é
 * alfanumérico puro, então não abre porta para fórmula.
 */
function codeCell(value: string | null | undefined) {
  const text = (value ?? "").trim();
  if (!text) return '""';
  if (/^[0-9A-Za-z-]{1,20}$/.test(text)) return `"=""${text}"""`;
  return textCell(text);
}

function decimal(value: number) {
  return value.toFixed(2).replace(".", ",");
}

/** "13/09/2026 20:14" em Lima — o Excel em espanhol reconhece como data. */
function excelDate(value: string) {
  const date = new Date(value);
  const day = new Intl.DateTimeFormat("es-PE", { timeZone: STORE_TIME_ZONE, day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
  /* `hourCycle: "h23"` e não `hour12: false`: este último sai "24:05" à meia-noite em alguns motores, e o Excel não lê como hora. */
  const time = new Intl.DateTimeFormat("es-PE", { timeZone: STORE_TIME_ZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
  return `${day} ${time}`;
}
