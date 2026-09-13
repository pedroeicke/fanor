/**
 * Chaves de `system_settings` que o painel edita, com limites e textos.
 *
 * Código puro: a tela usa para travar o botão e mostrar a prévia; as ações
 * do servidor usam para validar de novo. Os padrões espelham a migração 0012.
 */

export const STOCK_SOURCES = ["sisgeco", "native"] as const;
export type StockSource = (typeof STOCK_SOURCES)[number];

export function isStockSource(value: unknown): value is StockSource {
  return value === "sisgeco" || value === "native";
}

/** Palavra que a pessoa digita para virar a vitrine para o sistema novo. */
export const CONFIRM_WORD = "CAMBIAR";

export function confirmsChange(value: string) {
  return value.trim().toUpperCase() === CONFIRM_WORD;
}

export type SlaKey =
  | "lead_first_contact_min"
  | "request_attend_hours"
  | "dispatch_receive_hours"
  | "complaint_response_days"
  | "sync_stale_min";

export type SlaValues = Record<SlaKey, number>;

/* Os textos dizem o que `alerts_refresh()` faz de verdade com cada número,
   para ninguém ajustar um prazo achando que ele faz outra coisa. */
export const SLA_FIELDS: { key: SlaKey; label: string; unit: string; min: number; max: number; help: string }[] = [
  {
    key: "lead_first_contact_min",
    label: "Lead sin primer contacto",
    unit: "min",
    min: 1,
    max: 240,
    help: "Desde que el lead se crea o se asigna. Pasa a urgente al cuádruple del plazo.",
  },
  {
    key: "request_attend_hours",
    label: "Pedido de tienda sin atender",
    unit: "h",
    min: 1,
    max: 48,
    help: "Pedido de reposición que el taller todavía no empezó a despachar.",
  },
  {
    key: "dispatch_receive_hours",
    label: "Despacho sin recibir",
    unit: "h",
    min: 1,
    max: 48,
    help: "Desde que el despacho sale del taller hasta que la tienda lo confirma.",
  },
  {
    key: "complaint_response_days",
    label: "Reclamo sin respuesta",
    unit: "días",
    min: 1,
    max: 30,
    help: "Libro de Reclamaciones. Avisa a los dos tercios del plazo y pasa a urgente al vencer.",
  },
  {
    key: "sync_stale_min",
    label: "Lector del Sisgeco sin enviar",
    unit: "min",
    min: 5,
    max: 240,
    /* O mesmo número decide a vitrine (lib/stock.ts): passado o prazo, ela
       esconde a disponibilidade em vez de mostrar estoque velho. */
    help: "Solo mientras la vitrina lee el Sisgeco. Pasado este plazo sin envíos se abre una alerta urgente y la vitrina deja de mostrar disponibilidad.",
  },
];

export function slaFieldError(field: (typeof SLA_FIELDS)[number], value: unknown) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < field.min || value > field.max) {
    return `${field.label}: escribe un número entero de ${field.min} a ${field.max} ${field.unit}.`;
  }
  return null;
}

export const REDECORATED_MAX = 3;
export const REDECORATED_DEFAULT = 1;

export function describeRedecorated(days: number) {
  if (days === 0) return "Vence el mismo día en que se redecora.";
  if (days === 1) return "Vence al día siguiente de la redecoración.";
  return `Vence ${days} días después de la redecoración.`;
}

export const TEMPLATE_MAX = 600;
export const DEFAULT_LEAD_TEMPLATE =
  "Hola {nombre}, te escribe {vendedora} de Tortas Fanor 🎂. Vi que te interesa: {interes}. {contexto}";

export const TEMPLATE_PLACEHOLDERS = [
  { token: "{nombre}", label: "Nombre del cliente", example: "María" },
  { token: "{vendedora}", label: "Vendedora que atiende", example: "Rosa" },
  { token: "{interes}", label: "Lo que busca", example: "torta de chocolate para 20 personas" },
  { token: "{contexto}", label: "Lo que ya se conversó", example: "La quiere para el sábado, con recojo en Calle Perú." },
] as const;

const KNOWN_TOKENS: readonly string[] = TEMPLATE_PLACEHOLDERS.map((p) => p.token);

/** Tamanho como a pessoa conta: um emoji é um caractere, não dois. */
export function templateLength(template: string) {
  return Array.from(template).length;
}

/** `{nombres}`, `{Nombre}`: marcador digitado errado sairia literal para o cliente. */
export function unknownPlaceholders(template: string) {
  const found = template.match(/\{[^{}\s]{1,30}\}/g) ?? [];
  return [...new Set(found.filter((token) => !KNOWN_TOKENS.includes(token)))];
}

export function renderTemplate(template: string, values: Record<string, string>) {
  return template.replace(/\{(nombre|vendedora|interes|contexto)\}/g, (token) => values[token] ?? token);
}

export const TEMPLATE_EXAMPLE_VALUES: Record<string, string> = Object.fromEntries(
  TEMPLATE_PLACEHOLDERS.map((p) => [p.token, p.example]),
);
