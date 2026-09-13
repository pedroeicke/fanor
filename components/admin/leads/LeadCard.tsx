"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { addLeadNote, assignLead, closeLead, contactLead, setLeadPhone } from "@/app/admin/(panel)/leads/actions";
import { cx, soles } from "@/lib/format";
import { LEAD_SOURCE, LEAD_STATUS } from "@/lib/gestion/labels";
import { inputClass, labelClass, StatusPill } from "@/components/admin/ui";
import { WaitTimer } from "./WaitTimer";
import {
  buildLeadMessage,
  LOST_REASONS,
  lostReasonCategory,
  lostReasonDetail,
  whatsappHref,
  whatsappNumber,
  type LeadView,
  type LostReason,
  type SellerOption,
  type StoreOption,
} from "./shared";
import {
  confirmButton,
  dangerButton,
  lostButton,
  secondaryButton,
  whatsappButton,
  whatsappButtonSmall,
  wonButton,
} from "./styles";

/**
 * Um lead, com tudo que a vendedora precisa sem abrir outra tela.
 *
 * A ação principal é "Escribir por WhatsApp": abre o WhatsApp dela já com a
 * mensagem montada e grava a hora do primeiro contato. O resto (atribuir,
 * nota, desfecho, histórico) abre embaixo do card, um painel por vez — no
 * celular não há espaço para modal em cima de modal.
 */

type Panel = "assign" | "note" | "won" | "lost" | "history" | "phone";

const EVENT_LABEL: Record<string, string> = {
  created: "Registrado",
  assigned: "Asignado",
  contacted: "Tocó «Escribir por WhatsApp»",
  won: "Ganado",
  lost: "Perdido",
  note: "Nota",
  reopened: "Reabierto",
};

const textareaClass = `${inputClass.replace("h-11", "")} min-h-24 py-2.5 leading-relaxed`;

export function LeadCard({
  lead,
  stores,
  sellers,
  slaMin,
  serverNow,
  template,
  writerName,
  userName,
  defaultStoreId,
}: {
  lead: LeadView;
  stores: StoreOption[];
  sellers: SellerOption[];
  slaMin: number;
  serverNow: number;
  template: string;
  /** Quem vai escrever: a vendedora do login, se houver. */
  writerName: string | null;
  /** Primeiro nome de quem está logado, quando o login não é de vendedora. */
  userName: string;
  defaultStoreId: string | null;
}) {
  const closed = lead.status === "won" || lead.status === "lost";
  const [panel, setPanel] = useState<Panel | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const [storeId, setStoreId] = useState(lead.storeId ?? defaultStoreId ?? stores[0]?.id ?? "");
  const [sellerId, setSellerId] = useState(lead.sellerId ?? "");
  const [note, setNote] = useState("");
  const [value, setValue] = useState("");
  const [reason, setReason] = useState<LostReason | null>(null);
  const [detail, setDetail] = useState("");
  const [phone, setPhone] = useState("");

  const message = buildLeadMessage(template, {
    name: lead.name,
    /* Quem toca o botão é quem escreve (o WhatsApp que abre é o do aparelho).
       Login genérico da loja, sem vendedora ligada, assina pela atribuída. */
    seller: writerName ?? lead.sellerName ?? userName,
    interest: lead.interest,
    context: lead.context,
  });
  const href = whatsappHref(lead.phone, message);
  const storeSellers = sellers.filter((s) => !s.storeId || s.storeId === storeId);

  function toggle(next: Panel) {
    setError(null);
    setSaved(null);
    setPanel((current) => (current === next ? null : next));
  }

  function run(action: () => Promise<{ ok: true } | { ok: false; error: string }>, success: string, after?: () => void) {
    if (pending) return;
    setError(null);
    setSaved(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSaved(success);
      setPanel(null);
      after?.();
    });
  }

  /* O <a> abre o WhatsApp no próprio clique (o navegador não bloqueia janela
     aberta por gesto do usuário); a gravação vai em paralelo e não segura a
     navegação. Se falhar, o erro aparece no card quando a pessoa voltar.
     Lead fechado não grava: `op_lead_contact` não olha o estado e carimbaria
     um "primeiro contato" dias depois do desfecho, estragando mediana e P90. */
  function registerContact() {
    if (pending || closed) return;
    setError(null);
    startTransition(async () => {
      const result = await contactLead(lead.id);
      if (!result.ok) setError(`El WhatsApp se abrió, pero no se registró el contacto: ${result.error}`);
    });
  }

  /* "Ver todo" quando o texto está de fato cortado. Contar caracteres não
     serve: numa coluna de 220 px, 120 caracteres já passam de três linhas e
     o resto ficaria escondido sem botão. O observador dispara ao começar a
     observar e de novo quando a aba do celular mostra a coluna. */
  const contextRef = useRef<HTMLParagraphElement>(null);
  const [clamped, setClamped] = useState(false);
  useEffect(() => {
    const el = contextRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      /* Aberto, cabe por definição: só mede com o corte aplicado. */
      if (el.classList.contains("line-clamp-3")) setClamped(el.scrollHeight > el.clientHeight + 1);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [lead.context]);

  const hasLongContext = expanded || clamped || (lead.context?.split("\n").length ?? 0) > 3;

  return (
    <article className={cx("card space-y-3 p-4", pending && "opacity-80")} aria-busy={pending}>
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[12px] text-cacao-300">
            #{lead.number} · {LEAD_SOURCE[lead.source] ?? lead.source} · {lead.createdLabel}
          </p>
          <h4 className="mt-0.5 break-words font-display text-lg leading-tight">{lead.name}</h4>
          {lead.phone && <p className="text-sm tabular-nums text-cacao-500">{lead.phone}</p>}
        </div>
        {closed && <StatusPill status={lead.status} map={LEAD_STATUS} />}
      </header>

      {(lead.interest || lead.wantedLabel) && (
        <p className="text-sm text-cacao-700">
          {lead.interest && <span className="font-medium text-cacao">{lead.interest}</span>}
          {lead.interest && lead.wantedLabel && " · "}
          {lead.wantedLabel && <span>para el {lead.wantedLabel}</span>}
        </p>
      )}

      {lead.context && (
        <div className="rounded-xl bg-crema-100 px-3 py-2">
          <p
            ref={contextRef}
            className={cx("whitespace-pre-line break-words text-[13px] leading-relaxed text-cacao-700", !expanded && "line-clamp-3")}
          >
            {lead.context}
          </p>
          {hasLongContext && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="-mb-1 min-h-11 pr-3 text-[13px] font-semibold text-terracota underline underline-offset-2"
              aria-expanded={expanded}
            >
              {expanded ? "Ver menos" : "Ver todo"}
            </button>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px] text-cacao-500">
        <span>
          <span className="font-medium text-cacao-700">{lead.storeName ?? "Sin tienda"}</span>
          {" · "}
          {lead.sellerName ?? "Sin vendedora"}
        </span>
        <WaitTimer
          createdAt={lead.createdAt}
          assignedAt={lead.assignedAt}
          firstContactAt={lead.firstContactAt}
          closed={closed}
          slaMin={slaMin}
          serverNow={serverNow}
        />
      </div>

      {closed && (
        <p className="text-sm text-cacao-700">
          {lead.status === "won" ? (
            <>Ganado{lead.value !== null ? ` por ${soles(lead.value)}` : ""}</>
          ) : (
            <>
              Perdido: <span className="font-medium">{lostReasonCategory(lead.lostReason)}</span>
              {lostReasonDetail(lead.lostReason) && <span> — {lostReasonDetail(lead.lostReason)}</span>}
            </>
          )}
          {lead.closedLabel && <span className="text-cacao-300"> · {lead.closedLabel}</span>}
        </p>
      )}

      {/* Ação principal */}
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          onClick={registerContact}
          aria-disabled={pending || undefined}
          className={cx(closed ? whatsappButtonSmall : whatsappButton, "w-full")}
        >
          <WhatsAppIcon />
          {pending ? "Registrando…" : "Escribir por WhatsApp"}
        </a>
      ) : (
        <div className="space-y-1">
          <button type="button" disabled className={cx(whatsappButton, "w-full")}>
            <WhatsAppIcon />
            Escribir por WhatsApp
          </button>
          <p className="text-[12px] text-cacao-500">
            {lead.phone
              ? `El número «${lead.phone}» no sirve para WhatsApp. Corrígelo con «Celular».`
              : "Sin celular: consíguelo en la conversación y agrégalo con «Celular»."}
          </p>
        </div>
      )}

      {/* Ações secundárias */}
      <div className="flex flex-wrap gap-2">
        {!closed && (
          <>
            <button type="button" disabled={pending} onClick={() => toggle("assign")} className={secondaryButton} aria-expanded={panel === "assign"}>
              {lead.storeId ? "Reasignar" : "Asignar"}
            </button>
            {(!lead.phone || !whatsappNumber(lead.phone)) && (
              <button type="button" disabled={pending} onClick={() => toggle("phone")} className={secondaryButton} aria-expanded={panel === "phone"}>
                Celular
              </button>
            )}
          </>
        )}
        <button type="button" disabled={pending} onClick={() => toggle("note")} className={secondaryButton} aria-expanded={panel === "note"}>
          Nota
        </button>
        {!closed && (
          <>
            <button type="button" disabled={pending} onClick={() => toggle("won")} className={secondaryButton} aria-expanded={panel === "won"}>
              Ganado
            </button>
            <button type="button" disabled={pending} onClick={() => toggle("lost")} className={dangerButton} aria-expanded={panel === "lost"}>
              Perdido
            </button>
          </>
        )}
        <button type="button" onClick={() => toggle("history")} className={secondaryButton} aria-expanded={panel === "history"}>
          Historial ({lead.events.length})
        </button>
      </div>

      {/* Painéis */}
      {panel === "assign" && (
        <form
          className="space-y-3 rounded-xl border border-crema-200 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => assignLead(lead.id, storeId, sellerId), "Asignación guardada.");
          }}
        >
          <label className="block">
            <span className={labelClass}>Tienda</span>
            <select
              className={inputClass}
              value={storeId}
              required
              onChange={(e) => {
                setStoreId(e.target.value);
                const current = sellers.find((s) => s.id === sellerId);
                if (current?.storeId && current.storeId !== e.target.value) setSellerId("");
              }}
            >
              <option value="" disabled>
                Elige la tienda
              </option>
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className={labelClass}>Vendedora</span>
            <select className={inputClass} value={sellerId} onChange={(e) => setSellerId(e.target.value)}>
              <option value="">Cualquiera de la tienda</option>
              {storeSellers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <p className="text-[12px] text-cacao-500">
            {stores.length
              ? "Al asignar, el reloj del primer contacto vuelve a contar desde ahora."
              : "No hay tiendas activas para asignar."}
          </p>
          <button type="submit" disabled={pending || !storeId} className={confirmButton}>
            {pending ? "Guardando…" : "Guardar asignación"}
          </button>
        </form>
      )}

      {panel === "phone" && (
        <form
          className="space-y-3 rounded-xl border border-crema-200 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => setLeadPhone(lead.id, phone), "Celular guardado.", () => setPhone(""));
          }}
        >
          <label className="block">
            <span className={labelClass}>Celular del cliente</span>
            <input
              className={inputClass}
              type="tel"
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              maxLength={30}
              required
              placeholder="987 654 321"
            />
          </label>
          <button type="submit" disabled={pending || !phone.trim()} className={confirmButton}>
            {pending ? "Guardando…" : "Guardar celular"}
          </button>
        </form>
      )}

      {panel === "note" && (
        <form
          className="space-y-3 rounded-xl border border-crema-200 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => addLeadNote(lead.id, note), "Nota guardada.", () => setNote(""));
          }}
        >
          <label className="block">
            <span className={labelClass}>Nota</span>
            <textarea
              className={textareaClass}
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={2000}
              required
              placeholder="Ej. Pidió cotización con foto, respondo a las 5"
            />
          </label>
          <button type="submit" disabled={pending || !note.trim()} className={confirmButton}>
            {pending ? "Guardando…" : "Guardar nota"}
          </button>
        </form>
      )}

      {panel === "won" && (
        <form
          className="space-y-3 rounded-xl border border-verde/30 bg-verde-100/40 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => closeLead({ leadId: lead.id, won: true, value, reason: "", detail: "" }), "Lead cerrado como ganado.");
          }}
        >
          <label className="block">
            <span className={labelClass}>Monto de la venta (opcional)</span>
            <input
              className={inputClass}
              inputMode="decimal"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              maxLength={12}
              placeholder="S/ 120.00"
            />
          </label>
          <button type="submit" disabled={pending} className={wonButton}>
            {pending ? "Guardando…" : "Confirmar venta ganada"}
          </button>
        </form>
      )}

      {panel === "lost" && (
        <form
          className="space-y-3 rounded-xl border border-terracota/25 bg-terracota/5 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!reason) {
              setError("Elige el motivo de la pérdida.");
              return;
            }
            run(() => closeLead({ leadId: lead.id, won: false, value: "", reason, detail }), "Lead cerrado como perdido.");
          }}
        >
          <fieldset>
            <legend className={labelClass}>Motivo</legend>
            <div className="flex flex-wrap gap-2">
              {LOST_REASONS.map((r) => (
                <button
                  key={r}
                  type="button"
                  aria-pressed={reason === r}
                  onClick={() => setReason(r)}
                  className={cx(
                    "min-h-11 rounded-full border px-4 text-sm font-medium transition-colors",
                    reason === r ? "border-dorado bg-dorado text-cacao" : "border-crema-300 bg-white text-cacao-700 hover:border-cacao/35",
                  )}
                >
                  {r}
                </button>
              ))}
            </div>
          </fieldset>
          <label className="block">
            <span className={labelClass}>{reason === "Otro" ? "¿Qué pasó? *" : "Detalle (opcional)"}</span>
            <input
              className={inputClass}
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
              maxLength={300}
              required={reason === "Otro"}
              placeholder="Ej. Quería para hoy y no había modelo"
            />
          </label>
          <button
            type="submit"
            disabled={pending || !reason || (reason === "Otro" && !detail.trim())}
            className={lostButton}
          >
            {pending ? "Guardando…" : "Confirmar pérdida"}
          </button>
        </form>
      )}

      {panel === "history" && (
        <ol className="space-y-2 rounded-xl border border-crema-200 p-3 text-[13px]">
          {lead.events.map((event) => (
            <li key={event.id} className="border-b border-crema-200 pb-2 last:border-0 last:pb-0">
              <p className="text-cacao-300">
                {event.at} · {event.actor}
              </p>
              <p className="font-medium text-cacao-700">
                {event.inbound ? "Mensaje del cliente" : (EVENT_LABEL[event.kind] ?? event.kind)}
              </p>
              {event.notes && <p className="whitespace-pre-line break-words text-cacao-700">{event.notes}</p>}
            </li>
          ))}
          {!lead.events.length && <li className="text-cacao-500">Sin movimientos registrados.</li>}
        </ol>
      )}

      {error && (
        <p role="alert" className="rounded-xl bg-terracota/10 px-3 py-2 text-[13px] font-medium text-terracota-700">
          {error}
        </p>
      )}
      {saved && !error && (
        <p role="status" className="text-[13px] font-medium text-verde">
          {saved}
        </p>
      )}
    </article>
  );
}

function WhatsAppIcon() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5 shrink-0" fill="currentColor">
      <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38a9.9 9.9 0 0 0 4.74 1.21h.01c5.46 0 9.91-4.45 9.91-9.91A9.85 9.85 0 0 0 12.04 2Zm0 18.15h-.01a8.23 8.23 0 0 1-4.2-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.2 8.2 0 0 1-1.26-4.38c0-4.54 3.7-8.24 8.25-8.24a8.2 8.2 0 0 1 8.24 8.25c0 4.54-3.7 8.23-8.23 8.23Zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.16.24-.64.8-.78.97-.15.16-.29.18-.54.06a6.8 6.8 0 0 1-2-1.23 7.5 7.5 0 0 1-1.38-1.72c-.15-.25-.02-.38.11-.5.11-.11.25-.29.37-.43.12-.15.16-.25.25-.41.08-.17.04-.31-.02-.43-.07-.13-.56-1.35-.77-1.85-.2-.48-.4-.42-.56-.43h-.48a.92.92 0 0 0-.66.31c-.23.25-.87.85-.87 2.07 0 1.22.89 2.4 1.01 2.57.13.16 1.75 2.67 4.24 3.75.59.25 1.05.4 1.41.52.6.19 1.13.16 1.56.1.48-.07 1.47-.6 1.67-1.18.21-.58.21-1.07.15-1.18-.06-.1-.23-.16-.48-.29Z" />
    </svg>
  );
}
