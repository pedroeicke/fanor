"use client";

import { useId, useMemo, useState, useTransition, type FormEvent, type KeyboardEvent } from "react";
import { updateCustomer } from "@/app/admin/(panel)/clientes/actions";
import { cx } from "@/lib/format";
import { inputClass, labelClass } from "@/components/admin/ui";
import {
  DOC_LABEL,
  DOC_TYPES,
  MAX_TAGS,
  MAX_TAG_LENGTH,
  MONTHS,
  docNumberError,
  isDocType,
  normalizeTag,
  splitBirthday,
  type CustomerInput,
} from "./rules";

export type CustomerFormValues = {
  name: string;
  phone: string | null;
  email: string | null;
  doc_type: string;
  doc_number: string | null;
  birthday: string | null;
  tags: string[];
  marketing_opt_in: boolean;
};

function toInput(values: CustomerFormValues): CustomerInput {
  return {
    name: values.name,
    phone: values.phone ?? "",
    email: values.email ?? "",
    docType: isDocType(values.doc_type) ? values.doc_type : "NONE",
    docNumber: values.doc_number ?? "",
    ...splitBirthday(values.birthday),
    tags: values.tags,
    marketingOptIn: values.marketing_opt_in,
  };
}

const selectClass = cx(
  inputClass,
  "appearance-none bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%23806047%22 stroke-width=%221.6%22 stroke-linecap=%22round%22><path d=%22m5 9 7 7 7-7%22/></svg>')] bg-[length:14px] bg-[right_0.6rem_center] bg-no-repeat pr-8",
);

/**
 * Ficha editável do cliente.
 *
 * Campos controlados, não `<form action>`: se o servidor recusar (DNI de
 * outro cliente, por exemplo), o que a pessoa digitou continua na tela para
 * corrigir, em vez de o formulário voltar ao valor antigo.
 */
export function CustomerForm({
  customerId,
  initial,
  tagSuggestions,
}: {
  customerId: string;
  initial: CustomerFormValues;
  tagSuggestions: string[];
}) {
  const uid = useId();
  const [saved, setSaved] = useState<CustomerInput>(() => toInput(initial));
  const [form, setForm] = useState<CustomerInput>(() => toInput(initial));
  const [tagDraft, setTagDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const dirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(saved), [form, saved]);
  const docType = isDocType(form.docType) ? form.docType : "NONE";
  const cleanedDoc = form.docNumber.replace(/[\s.-]/g, "").toUpperCase();
  /* Documento antigo que ninguém mexeu não é cobrado (o servidor também aceita): o aviso só aparece para valor novo. */
  const docUntouched = form.docType === saved.docType && form.docNumber === saved.docNumber;
  const docError = docType !== "NONE" && cleanedDoc && !docUntouched ? docNumberError(docType, cleanedDoc) : null;
  /* Não acusa erro enquanto a pessoa ainda está digitando: só quando já passou do tamanho ou entrou caractere inválido. */
  const numericDoc = docType === "DNI" || docType === "RUC";
  const docHint =
    docError && (cleanedDoc.length >= (docType === "DNI" ? 8 : docType === "RUC" ? 11 : 5) || (numericDoc ? /\D/ : /[^A-Z0-9]/).test(cleanedDoc))
      ? docError
      : null;
  const suggestions = tagSuggestions.filter((t) => !form.tags.includes(t));

  function set<K extends keyof CustomerInput>(key: K, value: CustomerInput[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setNotice(null);
  }

  function addTags(raws: string[]) {
    const next = [...form.tags];
    for (const raw of raws) {
      const tag = normalizeTag(raw);
      if (tag && !next.includes(tag)) next.push(tag);
    }
    if (next.length > MAX_TAGS) {
      setError(`Máximo ${MAX_TAGS} etiquetas por cliente.`);
      return;
    }
    if (next.length !== form.tags.length) {
      setError(null);
      set("tags", next);
    }
  }

  function onTagKey(event: KeyboardEvent<HTMLInputElement>) {
    /* Enter fecha a etiqueta; sem isto o Enter enviaria a ficha inteira. */
    if (event.key === "Enter") {
      event.preventDefault();
      addTags([tagDraft]);
      setTagDraft("");
    }
  }

  function onTagChange(value: string) {
    /* Vírgula também fecha a etiqueta. Tratado no texto, e não na tecla, porque
       o teclado do Android não informa qual tecla foi apertada. */
    if (!value.includes(",")) {
      setTagDraft(value);
      return;
    }
    const parts = value.split(",");
    const rest = parts.pop() ?? "";
    addTags(parts);
    setTagDraft(rest);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    /* Etiqueta digitada e não confirmada também vai: é o que a pessoa espera ao tocar em Guardar. */
    const pendingTag = normalizeTag(tagDraft);
    const payload = pendingTag && !form.tags.includes(pendingTag) ? { ...form, tags: [...form.tags, pendingTag] } : form;
    setError(null);
    setNotice(null);

    startTransition(async () => {
      const result = await updateCustomer(customerId, payload);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      /* Volta o que o servidor gravou (nome sem espaço sobrando, etiquetas normalizadas). */
      const next = toInput(result.data);
      setForm(next);
      setSaved(next);
      setTagDraft("");
      setNotice("Ficha guardada.");
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4 p-5" noValidate>
      <div>
        <label htmlFor={`${uid}-name`} className={labelClass}>Nombre</label>
        <input
          id={`${uid}-name`}
          value={form.name}
          onChange={(e) => set("name", e.target.value)}
          maxLength={120}
          autoComplete="off"
          required
          className={inputClass}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
        <div>
          <label htmlFor={`${uid}-phone`} className={labelClass}>Celular</label>
          <input
            id={`${uid}-phone`}
            type="tel"
            inputMode="tel"
            value={form.phone}
            onChange={(e) => set("phone", e.target.value)}
            maxLength={40}
            autoComplete="off"
            placeholder="987 654 321"
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor={`${uid}-email`} className={labelClass}>Correo</label>
          <input
            id={`${uid}-email`}
            type="email"
            inputMode="email"
            value={form.email}
            onChange={(e) => set("email", e.target.value)}
            maxLength={254}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            className={inputClass}
          />
        </div>
      </div>

      <fieldset>
        <legend className={labelClass}>Documento</legend>
        <div className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)] gap-2">
          <select
            aria-label="Tipo de documento"
            value={docType}
            onChange={(e) => set("docType", e.target.value)}
            className={selectClass}
          >
            {DOC_TYPES.map((type) => (
              <option key={type} value={type}>{type === "NONE" ? "Sin documento" : type === "CE" ? "C. extranjería" : DOC_LABEL[type]}</option>
            ))}
          </select>
          <input
            aria-label="Número de documento"
            value={docType === "NONE" ? "" : form.docNumber}
            onChange={(e) => set("docNumber", e.target.value)}
            disabled={docType === "NONE"}
            inputMode={docType === "DNI" || docType === "RUC" ? "numeric" : "text"}
            maxLength={docType === "DNI" ? 8 : docType === "RUC" ? 11 : 15}
            autoComplete="off"
            placeholder={docType === "DNI" ? "8 dígitos" : docType === "RUC" ? "11 dígitos" : docType === "NONE" ? "—" : "Número"}
            className={cx(inputClass, "disabled:bg-crema-100 disabled:text-cacao-300")}
          />
        </div>
        {docHint && <p className="mt-1 text-[13px] text-terracota">{docHint}</p>}
      </fieldset>

      <fieldset>
        <legend className={labelClass}>Cumpleaños</legend>
        <div className="grid grid-cols-[minmax(0,4.5rem)_minmax(0,1fr)_minmax(0,5rem)] gap-2">
          <select aria-label="Día" value={form.birthDay} onChange={(e) => set("birthDay", e.target.value)} className={selectClass}>
            <option value="">Día</option>
            {Array.from({ length: 31 }, (_, i) => (
              <option key={i + 1} value={String(i + 1)}>{i + 1}</option>
            ))}
          </select>
          <select aria-label="Mes" value={form.birthMonth} onChange={(e) => set("birthMonth", e.target.value)} className={selectClass}>
            <option value="">Mes</option>
            {MONTHS.map((month, i) => (
              <option key={month} value={String(i + 1)}>{month}</option>
            ))}
          </select>
          <input
            aria-label="Año (opcional)"
            inputMode="numeric"
            value={form.birthYear}
            onChange={(e) => set("birthYear", e.target.value.replace(/\D/g, "").slice(0, 4))}
            placeholder="Año"
            autoComplete="off"
            className={inputClass}
          />
        </div>
        <p className="mt-1 text-[12px] text-cacao-300">El año es opcional.</p>
        {(form.birthDay || form.birthMonth || form.birthYear) && (
          <button
            type="button"
            onClick={() => {
              setForm((f) => ({ ...f, birthDay: "", birthMonth: "", birthYear: "" }));
              setNotice(null);
            }}
            className="inline-flex h-11 items-center text-[13px] text-terracota underline underline-offset-2"
          >
            Quitar cumpleaños
          </button>
        )}
      </fieldset>

      <fieldset>
        <legend className={labelClass}>Etiquetas</legend>
        {form.tags.length > 0 && (
          <ul className="mb-2 flex flex-wrap gap-2">
            {form.tags.map((tag) => (
              <li key={tag} className="inline-flex h-11 items-center rounded-full border border-cacao/20 bg-crema-100 pl-4 text-sm font-medium text-cacao-700">
                #{tag}
                <button
                  type="button"
                  onClick={() => set("tags", form.tags.filter((t) => t !== tag))}
                  aria-label={`Quitar etiqueta ${tag}`}
                  className="grid h-11 w-11 place-items-center rounded-full text-lg text-cacao-500 hover:text-terracota"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex gap-2">
          <input
            aria-label="Nueva etiqueta"
            value={tagDraft}
            onChange={(e) => onTagChange(e.target.value)}
            onKeyDown={onTagKey}
            maxLength={MAX_TAG_LENGTH}
            list={suggestions.length ? `${uid}-tags` : undefined}
            placeholder="empresa, alergia nueces…"
            autoComplete="off"
            className={cx(inputClass, "min-w-0 flex-1")}
          />
          <button
            type="button"
            onClick={() => {
              addTags([tagDraft]);
              setTagDraft("");
            }}
            disabled={!normalizeTag(tagDraft)}
            className="h-11 shrink-0 rounded-full border border-cacao/25 px-4 text-sm font-semibold text-cacao transition-colors hover:border-cacao disabled:opacity-40"
          >
            Agregar
          </button>
        </div>
        {suggestions.length > 0 && (
          <datalist id={`${uid}-tags`}>
            {suggestions.map((tag) => <option key={tag} value={tag} />)}
          </datalist>
        )}
      </fieldset>

      <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border border-crema-300 px-3 py-3">
        <input
          type="checkbox"
          checked={form.marketingOptIn}
          onChange={(e) => set("marketingOptIn", e.target.checked)}
          className="mt-0.5 h-5 w-5 shrink-0 accent-cacao"
        />
        <span className="text-sm text-cacao-700">
          <span className="font-semibold text-cacao">Acepta recibir promociones</span>
          <span className="block text-[13px] text-cacao-500">Solo marcar si el cliente lo autorizó (Ley de Protección de Datos Personales).</span>
        </span>
      </label>

      {error && (
        <p role="alert" className="rounded-xl border border-terracota/30 bg-terracota/10 px-3 py-2 text-sm text-terracota-700">
          {error}
        </p>
      )}
      {notice && !dirty && (
        <p role="status" className="rounded-xl border border-verde/35 bg-verde-100 px-3 py-2 text-sm text-verde">
          {notice}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending || (!dirty && !normalizeTag(tagDraft))}
          className="inline-flex h-12 flex-1 items-center justify-center rounded-full bg-dorado px-6 text-[15px] font-semibold text-cacao transition-colors hover:bg-dorado-600 disabled:cursor-not-allowed disabled:opacity-45 sm:flex-none"
        >
          {pending ? "Guardando…" : "Guardar ficha"}
        </button>
        {dirty && !pending && (
          <button
            type="button"
            onClick={() => {
              setForm(saved);
              setTagDraft("");
              setError(null);
            }}
            className="inline-flex h-11 items-center px-2 text-sm text-cacao-500 underline underline-offset-2 hover:text-cacao"
          >
            Descartar cambios
          </button>
        )}
      </div>
    </form>
  );
}
