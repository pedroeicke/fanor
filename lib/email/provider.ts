import "server-only";
import nodemailer, { type Transporter } from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";

/**
 * Envio de e-mail transacional.
 *
 * Três caminhos, escolhidos por variável de ambiente, nesta ordem:
 *
 *   1. **SMTP** (`SMTP_HOST`) — usa a caixa que a loja já tem. Não exige
 *      cadastro em serviço novo nem verificar domínio: o provedor de
 *      hospedagem normalmente já publicou SPF e DKIM para esse endereço.
 *   2. **Resend** (`RESEND_API_KEY`) — HTTP, melhor entregabilidade e
 *      rastreio de bounce.
 *   3. **Simulado** — sem nenhuma das duas. Aprova, marca como simulado e não
 *      envia nada, para o funil ser percorrível sem credenciais.
 *
 * O resto do sistema só conhece `sendEmail()`; trocar de caminho não toca em
 * nenhuma rota.
 */

export type EmailPayload = {
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
};

export type EmailResult =
  | { ok: true; providerId: string | null; simulated: boolean; provider: string }
  | { ok: false; error: string };

const RESEND_URL = process.env.EMAIL_API_URL ?? "https://api.resend.com/emails";
/* Padrão é a caixa que a loja já usa: com SMTP, o remetente precisa ser o
   endereço autenticado, senão o servidor recusa. */
const FROM = process.env.EMAIL_FROM ?? "Tortas Fanor <administracion@tortasfanor.com>";

/**
 * Timeout curto e deliberado.
 *
 * O envio acontece dentro da rota que fecha o pedido. Um servidor SMTP lento
 * seguraria o checkout de alguém que já pagou. Melhor falhar rápido,
 * registrar e reenviar pelo painel do que travar a compra.
 */
const TIMEOUT_MS = 8000;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isValidEmail(address: string) {
  const bare = address.includes("<") ? address.split("<")[1]?.replace(">", "") : address;
  return EMAIL_RE.test((bare ?? "").trim());
}

/** Qual caminho está ativo. Aparece no painel e no registro de e-mails. */
export function activeProvider(): "smtp" | "resend" | "simulado" {
  if (process.env.SMTP_HOST) return "smtp";
  if (process.env.RESEND_API_KEY) return "resend";
  return "simulado";
}

/* -------------------------------------------------------------------------- */
/*  SMTP                                                                      */
/* -------------------------------------------------------------------------- */

let transporter: Transporter | null = null;

function getTransporter() {
  if (transporter) return transporter;

  const port = Number(process.env.SMTP_PORT ?? 587);

  const options: SMTPTransport.Options = {
    host: process.env.SMTP_HOST,
    port,
    /* 465 é TLS implícito; 587 abre em claro e sobe para TLS com STARTTLS.
       Errar isso é a causa mais comum de "a conexão trava e não diz por quê". */
    secure: port === 465,
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
      : undefined,
    connectionTimeout: TIMEOUT_MS,
    greetingTimeout: TIMEOUT_MS,
    socketTimeout: TIMEOUT_MS,
    /* `pool` fica no padrão (desligado) de propósito: em serverless cada
       invocação é um processo novo, então a conexão reaproveitada nunca
       existiria — e o pool só atrasaria o encerramento da função. */
  };

  transporter = nodemailer.createTransport(options);
  return transporter;
}

async function sendViaSmtp(payload: EmailPayload): Promise<EmailResult> {
  try {
    const info = await getTransporter().sendMail({
      from: FROM,
      to: payload.to,
      subject: payload.subject,
      html: payload.html,
      text: payload.text,
      ...(payload.replyTo && { replyTo: payload.replyTo }),
    });

    /* `rejected` traz destinatários recusados na hora. Sucesso parcial não é
       sucesso: o e-mail não chegou a quem precisava. */
    if (info.rejected?.length) {
      return { ok: false, error: `El servidor rechazó: ${info.rejected.join(", ")}` };
    }

    return { ok: true, providerId: info.messageId ?? null, simulated: false, provider: "smtp" };
  } catch (error) {
    return { ok: false, error: describeSmtpError(error) };
  }
}

/**
 * Traduz a falha do SMTP para algo acionável.
 *
 * O nodemailer devolve códigos secos como `EAUTH`. Quem lê o painel precisa
 * saber se é senha, porta ou servidor fora do ar — são três correções
 * diferentes.
 */
function describeSmtpError(error: unknown): string {
  if (!(error instanceof Error)) return "Fallo desconocido al enviar";

  const code = (error as { code?: string }).code;
  const responseCode = (error as { responseCode?: number }).responseCode;

  /* O nodemailer agrupa recusa de conexão, DNS morto e timeout todos sob
     ESOCKET. A causa real só aparece na mensagem, e são três correções
     diferentes: porta errada, host errado, ou servidor lento. Dizer
     "não respondeu em 8s" para uma conexão recusada em 1s manda a pessoa
     investigar a coisa errada. */
  if (code === "ESOCKET" || code === "ECONNECTION") {
    if (error.message.includes("ECONNREFUSED")) {
      return "El servidor de correo rechazó la conexión (revisa host y puerto)";
    }
    if (error.message.includes("ENOTFOUND") || error.message.includes("EAI_AGAIN")) {
      return "No se pudo resolver el servidor de correo (revisa el host)";
    }
    if (error.message.includes("ECONNRESET")) {
      return "La conexión con el servidor de correo se cortó (¿puerto TLS incorrecto?)";
    }
    if (error.message.includes("certificate") || error.message.includes("SSL")) {
      return "Fallo de certificado TLS al conectar con el servidor de correo";
    }
    return `Fallo de conexión con el servidor de correo: ${error.message}`;
  }

  switch (code) {
    case "EAUTH":
      return "El servidor de correo rechazó el usuario o la contraseña";
    case "ECONNREFUSED":
      return "El servidor de correo rechazó la conexión (revisa host y puerto)";
    case "ETIMEDOUT":
      return `El servidor de correo no respondió en ${TIMEOUT_MS / 1000}s`;
    case "ENOTFOUND":
    case "EDNS":
      return "No se pudo resolver el servidor de correo";
    case "EENVELOPE":
      return "El servidor rechazó el remitente o el destinatario";
    case "EMESSAGE":
      return "El servidor rechazó el contenido del mensaje";
    default:
      if (responseCode && responseCode >= 500) {
        return `El servidor respondió ${responseCode}: ${error.message}`;
      }
      return `Fallo de envío: ${error.message}`;
  }
}

/* -------------------------------------------------------------------------- */
/*  Resend                                                                    */
/* -------------------------------------------------------------------------- */

async function sendViaResend(payload: EmailPayload, apiKey: string): Promise<EmailResult> {
  try {
    const response = await fetch(RESEND_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: FROM,
        to: [payload.to],
        subject: payload.subject,
        html: payload.html,
        text: payload.text,
        ...(payload.replyTo && { reply_to: payload.replyTo }),
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    const body = await response.json().catch(() => ({}) as Record<string, unknown>);

    if (!response.ok) {
      const message =
        (body as { message?: string }).message ?? `El proveedor respondió ${response.status}`;
      return { ok: false, error: message };
    }

    return {
      ok: true,
      providerId: (body as { id?: string }).id ?? null,
      simulated: false,
      provider: "resend",
    };
  } catch (error) {
    return { ok: false, error: describeNetworkError(error) };
  }
}

/* -------------------------------------------------------------------------- */

export async function sendEmail(payload: EmailPayload): Promise<EmailResult> {
  if (!isValidEmail(payload.to)) {
    return { ok: false, error: `Dirección inválida: ${payload.to}` };
  }

  const provider = activeProvider();

  if (provider === "smtp") return sendViaSmtp(payload);
  if (provider === "resend") return sendViaResend(payload, process.env.RESEND_API_KEY!);

  console.info(`[email] simulado → ${payload.to} · ${payload.subject}`);
  return { ok: true, providerId: null, simulated: true, provider: "simulado" };
}

function describeNetworkError(error: unknown): string {
  if (!(error instanceof Error)) return "Fallo desconocido al enviar";

  if (error.name === "TimeoutError" || error.name === "AbortError") {
    return `El proveedor de correo no respondió en ${TIMEOUT_MS / 1000}s`;
  }

  const code = networkCode(error);
  switch (code) {
    case "ECONNREFUSED":
      return "El proveedor de correo rechazó la conexión";
    case "ENOTFOUND":
    case "EAI_AGAIN":
      return "No se pudo resolver el servidor del proveedor de correo";
    case "ECONNRESET":
      return "La conexión con el proveedor se cortó";
    case "CERT_HAS_EXPIRED":
    case "UNABLE_TO_VERIFY_LEAF_SIGNATURE":
      return "Fallo de certificado al conectar con el proveedor";
    default: {
      const detail = (error.cause as Error | undefined)?.message ?? error.message;
      return code ? `Fallo de red (${code})` : `Fallo de red: ${detail}`;
    }
  }
}

/**
 * Extrai o código do erro de rede.
 *
 * O undici embrulha a causa real: `fetch failed` → `cause` → e, quando o
 * happy-eyeballs tenta IPv4 e IPv6, um AggregateError com um erro por
 * tentativa. Sem descer esses dois níveis, todo problema vira "fetch failed".
 */
function networkCode(error: Error): string | undefined {
  const cause = error.cause as (Error & { code?: string; errors?: unknown[] }) | undefined;
  if (!cause) return undefined;
  if (cause.code) return cause.code;

  const nested = Array.isArray(cause.errors) ? cause.errors : [];
  for (const item of nested) {
    const code = (item as { code?: string })?.code;
    if (code) return code;
  }
  return undefined;
}
