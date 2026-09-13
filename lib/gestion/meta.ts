import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Mensagens que chegam da Meta (WhatsApp Cloud API, Messenger e Instagram).
 *
 * A Meta manda um envelope diferente por canal e, no mesmo envelope, coisas
 * que não são mensagem de cliente: confirmação de entrega, leitura, eco do que
 * a própria página enviou. Aqui tudo vira uma lista plana de mensagens de
 * entrada — o resto é descartado antes de tocar no banco.
 *
 * Nada aqui confia no corpo: cada campo é conferido por tipo, e o que não tem
 * o formato esperado some em silêncio (a Meta muda o payload sem avisar).
 */

export type MetaChannel = "whatsapp" | "messenger" | "instagram";

export type MetaInboundMessage = {
  channel: MetaChannel;
  /** `wamid.…` no WhatsApp, `m_…` no Messenger. Chave de idempotência. */
  messageId: string;
  /** Número (wa_id) no WhatsApp; PSID/IGSID no Messenger e Instagram. */
  senderId: string;
  /** Só o WhatsApp entrega o celular; no Messenger o cliente é um id opaco. */
  phone: string | null;
  profileName: string | null;
  text: string;
  /**
   * Pode abrir lead novo. Reação (👍 na cotação) só faz sentido dentro de uma
   * conversa aberta; sozinha viraria um lead "(Reaccionó 👍)" que ninguém
   * sabe atender.
   */
  startsLead: boolean;
};

/* -------------------------------------------------------------------------- */
/*  Formato do webhook (só o que usamos)                                      */
/* -------------------------------------------------------------------------- */

type WhatsAppContact = { wa_id?: string; profile?: { name?: string } };

type WhatsAppMessage = {
  from?: string;
  id?: string;
  type?: string;
  text?: { body?: string };
  button?: { text?: string };
  interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } };
  image?: { caption?: string };
  video?: { caption?: string };
  document?: { caption?: string; filename?: string };
  reaction?: { emoji?: string };
};

type WhatsAppValue = { messages?: WhatsAppMessage[]; contacts?: WhatsAppContact[] };

type MessengerEvent = {
  sender?: { id?: string };
  message?: {
    mid?: string;
    text?: string;
    is_echo?: boolean;
    attachments?: { type?: string }[];
  };
};

type MetaEntry = {
  changes?: { field?: string; value?: WhatsAppValue }[];
  messaging?: MessengerEvent[];
};

export type MetaWebhookPayload = { object?: string; entry?: MetaEntry[] };

/** Texto do corpo sem estourar a nota: conversa colada de 20 mensagens cabe folgada. */
const MAX_TEXT = 2000;
const MAX_NAME = 120;

const MEDIA_LABEL: Record<string, string> = {
  image: "imagen",
  audio: "audio",
  voice: "nota de voz",
  video: "video",
  document: "documento",
  sticker: "sticker",
  location: "ubicación",
  contacts: "contacto",
  file: "archivo",
  reaction: "reacción",
};

function str(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function clip(value: string, max: number) {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/* -------------------------------------------------------------------------- */
/*  Assinatura                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Confere `X-Hub-Signature-256` (HMAC-SHA256 do corpo cru com o App Secret).
 *
 * Tem de ser o corpo cru, byte a byte: reserializar o JSON muda espaços e
 * escapes, e a assinatura legítima deixaria de bater. Comparação em tempo
 * constante para não vazar, por tempo de resposta, quantos bytes acertaram.
 */
export function verifyMetaSignature(rawBody: Buffer, header: string | null, appSecret: string) {
  if (!header?.startsWith("sha256=")) return false;
  const received = Buffer.from(header.slice("sha256=".length).trim(), "hex");
  const expected = createHmac("sha256", appSecret).update(rawBody).digest();
  return received.length === expected.length && timingSafeEqual(received, expected);
}

/** Igualdade de segredo em tempo constante (token de verificação do GET). */
export function safeEqualText(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/* -------------------------------------------------------------------------- */
/*  Parse                                                                     */
/* -------------------------------------------------------------------------- */

function whatsappText(message: WhatsAppMessage) {
  const body =
    str(message.text?.body) ||
    str(message.button?.text) ||
    str(message.interactive?.button_reply?.title) ||
    str(message.interactive?.list_reply?.title);
  if (body) return body;

  const type = str(message.type);
  if (type === "reaction") {
    const emoji = str(message.reaction?.emoji);
    return emoji ? `(Reaccionó ${emoji})` : "(Quitó su reacción)";
  }

  /* Foto de modelo de torta com legenda é comum: a legenda é o pedido. */
  const caption = str(message.image?.caption) || str(message.video?.caption) || str(message.document?.caption);
  const label = MEDIA_LABEL[type] ?? (type || "mensaje");
  return caption ? `(${label}) ${caption}` : `(Envió ${label})`;
}

function messengerText(event: MessengerEvent) {
  const text = str(event.message?.text);
  if (text) return text;
  const types = (event.message?.attachments ?? []).map((a) => MEDIA_LABEL[str(a.type)] ?? (str(a.type) || "archivo"));
  return types.length ? `(Envió ${types.join(", ")})` : "(Mensaje sin texto)";
}

/**
 * Lista plana de mensagens de cliente.
 *
 * `object` diz o canal: `whatsapp_business_account`, `page` (Messenger) ou
 * `instagram`. Status de entrega/leitura e ecos da própria página ficam de fora
 * — virariam lead do nada.
 */
export function parseMetaWebhook(payload: unknown): MetaInboundMessage[] {
  if (!payload || typeof payload !== "object") return [];
  const { object, entry } = payload as MetaWebhookPayload;
  if (!Array.isArray(entry)) return [];

  const out: MetaInboundMessage[] = [];

  if (object === "whatsapp_business_account") {
    for (const e of entry) {
      for (const change of Array.isArray(e?.changes) ? e.changes : []) {
        const value = change?.value;
        const messages = Array.isArray(value?.messages) ? value.messages : [];
        const contacts = Array.isArray(value?.contacts) ? value.contacts : [];
        for (const message of messages) {
          const id = str(message?.id);
          const from = str(message?.from);
          if (!id || !from) continue;
          const contact = contacts.find((c) => str(c?.wa_id) === from) ?? contacts[0];
          out.push({
            channel: "whatsapp",
            messageId: id,
            senderId: from,
            phone: from,
            profileName: clip(str(contact?.profile?.name), MAX_NAME) || null,
            text: clip(whatsappText(message), MAX_TEXT),
            startsLead: str(message.type) !== "reaction",
          });
        }
      }
    }
    return out;
  }

  if (object === "page" || object === "instagram") {
    const channel: MetaChannel = object === "page" ? "messenger" : "instagram";
    for (const e of entry) {
      for (const event of Array.isArray(e?.messaging) ? e.messaging : []) {
        const id = str(event?.message?.mid);
        const sender = str(event?.sender?.id);
        /* Eco = mensagem que a própria página mandou ao cliente. */
        if (!id || !sender || event.message?.is_echo) continue;
        out.push({
          channel,
          messageId: id,
          senderId: sender,
          phone: null,
          profileName: null,
          text: clip(messengerText(event), MAX_TEXT),
          startsLead: true,
        });
      }
    }
  }

  return out;
}

/* -------------------------------------------------------------------------- */
/*  Marcador na nota                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Cada mensagem vira uma nota `[<id>] texto` no histórico do lead.
 *
 * O id entre colchetes é a idempotência (a Meta reenvia o mesmo evento) e,
 * no Messenger, carrega também quem mandou (`psid:`), porque ali não há
 * celular para achar o lead aberto da mesma pessoa.
 */
export function messageNote(message: MetaInboundMessage) {
  const sender = message.channel === "whatsapp" ? "" : ` psid:${message.senderId}`;
  return `[${message.messageId}${sender}] ${message.text}`;
}

/* `_` e `%` são curinga no LIKE, e id do Messenger é cheio de `_` ("m_Ab…").
   Sem escapar, um id casaria com outro que difere justo nessa posição. */
function likeLiteral(value: string) {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Trecho procurado em `lead_events.notes` para saber se a mensagem já entrou.
 * Fecha o marcador (`]` ou ` psid:`) para um id não casar com outro mais
 * longo que comece igual.
 */
export function messageIdPattern(message: Pick<MetaInboundMessage, "channel" | "messageId">) {
  const tail = message.channel === "whatsapp" ? "]" : " psid:";
  return `%[${likeLiteral(message.messageId)}${tail}%`;
}

/** Trecho procurado para achar a conversa aberta do mesmo remetente do Messenger. */
export function senderPattern(senderId: string) {
  return `% psid:${likeLiteral(senderId)}]%`;
}

const MARKER_RE = /^\[([^\]\s]+)(?: psid:([^\]\s]+))?\]\s*/;

/**
 * Separa o marcador da nota para a tela mostrar só o texto. Quem chama só
 * deve usar em nota sem autor (gravada pelo webhook): uma nota digitada que
 * comece com "[URGENTE]" não é mensagem da Meta.
 */
export function parseMessageNote(notes: string | null): { messageId: string; text: string } | null {
  if (!notes) return null;
  const match = MARKER_RE.exec(notes);
  if (!match) return null;
  return { messageId: match[1], text: notes.slice(match[0].length) };
}

/* -------------------------------------------------------------------------- */
/*  Celular                                                                   */
/* -------------------------------------------------------------------------- */

/** Mesma regra de `normalize_phone()` do banco: só dígitos, sem o 51. */
export function normalizePhone(value: string | null | undefined) {
  if (!value) return null;
  let digits = value.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("51")) digits = digits.slice(2);
  return digits.length < 6 ? null : digits;
}

/** "51987654321" → "+51 987654321". Legível no card, e o banco normaliza igual. */
export function displayPhone(waId: string) {
  const digits = waId.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("51")) return `+51 ${digits.slice(2)}`;
  return `+${digits}`;
}
