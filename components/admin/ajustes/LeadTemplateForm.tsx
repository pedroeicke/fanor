"use client";

import { useRef, useState } from "react";
import { saveLeadTemplate } from "@/app/admin/(panel)/ajustes/actions";
import { Notice, Section, labelClass } from "@/components/admin/ui";
import { ActionFeedback, buttonClass, useActionRunner } from "@/components/admin/catalogos/useActionRunner";
import { cx } from "@/lib/format";
import {
  DEFAULT_LEAD_TEMPLATE,
  TEMPLATE_EXAMPLE_VALUES,
  TEMPLATE_MAX,
  TEMPLATE_PLACEHOLDERS,
  renderTemplate,
  templateLength,
  unknownPlaceholders,
} from "./config";

/**
 * A mensagem que a vendedora manda ao lead. O problema relatado era mensagem
 * genérica para quem já tinha contado tudo no Messenger; o modelo com os
 * marcadores leva o contexto junto.
 *
 * A prévia usa exemplos fixos para quem edita ver a frase inteira como o
 * cliente vai ler, sem precisar abrir um lead.
 */
export function LeadTemplateForm({ value, canEdit }: { value: string; canEdit: boolean }) {
  const { pending, busyKey, feedbackFor, run } = useActionRunner();
  const [draft, setDraft] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const text = canEdit && draft !== null ? draft : value;
  const normalized = text.replace(/\r\n?/g, "\n").trim();
  const length = templateLength(normalized);
  const unknown = unknownPlaceholders(normalized);
  const tooLong = length > TEMPLATE_MAX;
  const empty = normalized === "";
  const changed = normalized !== value;
  const missing = TEMPLATE_PLACEHOLDERS.filter((p) => !normalized.includes(p.token));

  /* Insere onde está o cursor: no celular, voltar ao fim do texto para
     digitar a chave à mão é justamente onde o marcador sai errado. */
  function insert(token: string) {
    const el = textareaRef.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    const next = text.slice(0, start) + token + text.slice(end);
    setDraft(next);
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  }

  return (
    <Section title="Mensaje de WhatsApp para leads">
      <div className="grid gap-5 px-5 py-4 lg:grid-cols-2">
        <div className="space-y-3">
          <p className="text-sm text-cacao-500">
            Es el texto con el que se abre el WhatsApp de la vendedora al tocar &quot;Escribir por WhatsApp&quot; en un lead. Los marcadores se reemplazan con los datos del lead.
          </p>

          <label className="block">
            <span className={labelClass}>Mensaje</span>
            <textarea
              ref={textareaRef}
              className={cx(
                "min-h-40 w-full rounded-xl border bg-white px-3 py-3 text-[15px] leading-relaxed text-cacao focus:border-dorado-600 focus:outline-none disabled:bg-crema-100 disabled:text-cacao-500",
                tooLong || unknown.length ? "border-terracota" : "border-crema-300",
              )}
              value={text}
              disabled={!canEdit || pending}
              onChange={(e) => setDraft(e.target.value)}
            />
          </label>
          <p className={cx("text-right text-[12px] tabular-nums", tooLong ? "font-semibold text-terracota-700" : "text-cacao-300")}>
            {length}/{TEMPLATE_MAX}
          </p>

          {canEdit && (
            <div>
              <p className={labelClass}>Insertar marcador</p>
              <div className="flex flex-wrap gap-2">
                {TEMPLATE_PLACEHOLDERS.map((p) => (
                  <button
                    key={p.token}
                    type="button"
                    className={cx(buttonClass.outline, "font-mono")}
                    title={p.label}
                    disabled={pending}
                    onClick={() => insert(p.token)}
                  >
                    {p.token}
                  </button>
                ))}
              </div>
            </div>
          )}

          {unknown.length > 0 && (
            <Notice tone="bad">
              {unknown.join(", ")} no es un marcador válido y saldría tal cual al cliente. Usa {TEMPLATE_PLACEHOLDERS.map((p) => p.token).join(", ")}.
            </Notice>
          )}
          {!unknown.length && !empty && missing.length > 0 && (
            <p className="text-[13px] text-cacao-500">
              No usa {missing.map((p) => p.token).join(", ")}. Está bien si es a propósito.
            </p>
          )}
        </div>

        <div className="space-y-3">
          <p className={labelClass}>Así lo recibe el cliente</p>
          <div className="rounded-2xl bg-crema-200 p-4">
            <p className="ml-auto max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-tr-sm bg-verde-100 px-4 py-3 text-[15px] leading-relaxed text-cacao shadow-card">
              {empty ? <span className="text-cacao-300">El mensaje está vacío.</span> : renderTemplate(normalized, TEMPLATE_EXAMPLE_VALUES)}
            </p>
          </div>
          <ul className="space-y-1 text-[13px] text-cacao-500">
            {TEMPLATE_PLACEHOLDERS.map((p) => (
              <li key={p.token}>
                <span className="font-mono text-cacao-700">{p.token}</span> {p.label.toLowerCase()} — ej.: {p.example}
              </li>
            ))}
          </ul>
        </div>

        {canEdit && (
          <div className="flex flex-wrap gap-2 lg:col-span-2">
            <button
              type="button"
              className={buttonClass.primary}
              disabled={pending || !changed || empty || tooLong || unknown.length > 0}
              onClick={() =>
                run("template", () => saveLeadTemplate(normalized), {
                  success: "Mensaje guardado.",
                  onSuccess: () => setDraft(null),
                })
              }
            >
              {busyKey === "template" ? "Guardando…" : "Guardar mensaje"}
            </button>
            {changed && (
              <button type="button" className={buttonClass.outline} disabled={pending} onClick={() => setDraft(null)}>
                Deshacer
              </button>
            )}
            {normalized !== DEFAULT_LEAD_TEMPLATE && (
              <button type="button" className={buttonClass.outline} disabled={pending} onClick={() => setDraft(DEFAULT_LEAD_TEMPLATE)}>
                Usar el mensaje original
              </button>
            )}
          </div>
        )}
        {feedbackFor() && (
          <div className="lg:col-span-2">
            <ActionFeedback feedback={feedbackFor()} />
          </div>
        )}
      </div>
    </Section>
  );
}
