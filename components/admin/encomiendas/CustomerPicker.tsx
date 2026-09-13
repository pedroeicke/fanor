"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { saveCustomer, searchCustomers } from "@/app/admin/(panel)/encomiendas/actions";
import { inputClass, labelClass } from "@/components/admin/ui";
import { cx } from "@/lib/format";
import { DOC_TYPES, type CustomerSummary, type DocType } from "./shared";

/* Rótulo curto: o select divide a linha com o número, a 375 px não cabe "Carné de extranjería". */
const DOC_OPTION: Record<DocType, string> = { NONE: "Ninguno", DNI: "DNI", RUC: "RUC", CE: "CE", PASSPORT: "Pasaporte" };

/**
 * Cliente da encomenda: acha quem já comprou ou cadastra na hora.
 *
 * Busca primeiro, cadastro depois: o banco funde pelo documento e pelo
 * celular, mas achar o cliente certo na lista evita até a digitação.
 */
export function CustomerPicker({
  value,
  onChange,
}: {
  value: CustomerSummary | null;
  onChange: (customer: CustomerSummary | null) => void;
}) {
  const [mode, setMode] = useState<"search" | "new">("search");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CustomerSummary[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const lastQuery = useRef("");

  const [draft, setDraft] = useState({ name: "", phone: "", docType: "NONE" as DocType, docNumber: "" });
  const [saving, startSaving] = useTransition();

  useEffect(() => () => window.clearTimeout(timer.current), []);

  function handleQuery(next: string) {
    setQuery(next);
    setError(null);
    window.clearTimeout(timer.current);
    const q = next.trim();
    if (q.length < 2) {
      lastQuery.current = "";
      setResults(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    /* Espera a vendedora parar de digitar: uma consulta por nome, não uma por letra. */
    timer.current = window.setTimeout(async () => {
      lastQuery.current = q;
      try {
        const res = await searchCustomers(q);
        /* Resposta de uma busca velha que chegou depois da nova: descarta. */
        if (lastQuery.current !== q) return;
        if (res.ok) setResults(res.data);
        else setError(res.error);
      } catch {
        if (lastQuery.current === q) setError("Sin conexión. Vuelve a intentar.");
      }
      if (lastQuery.current === q) setSearching(false);
    }, 350);
  }

  function startNew() {
    const q = query.trim();
    const digits = q.replace(/\D/g, "");
    /* O que já foi digitado na busca vira o começo do cadastro. */
    setDraft({
      name: digits.length >= 6 ? "" : q,
      phone: digits.length >= 6 && digits.length <= 11 ? digits : "",
      docType: "NONE",
      docNumber: "",
    });
    setError(null);
    setMode("new");
  }

  function save() {
    setError(null);
    startSaving(async () => {
      /* Erro de rede numa ação lança dentro da transição e derrubaria o
         formulário inteiro (com as linhas já digitadas) na tela de erro. */
      try {
        const res = await saveCustomer(draft);
        if (!res.ok) {
          setError(res.error);
          return;
        }
        onChange(res.data);
        setMode("search");
        setQuery("");
        setResults(null);
      } catch {
        setError("Sin conexión. Vuelve a intentar.");
      }
    });
  }

  if (value) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-verde/35 bg-verde-100 px-4 py-3">
        <div className="min-w-0">
          <p className="truncate font-semibold text-cacao">{value.name}</p>
          <p className="text-sm text-cacao-500">
            {[value.phone, value.docNumber ? `${value.docType} ${value.docNumber}` : null].filter(Boolean).join(" · ") || "Sin datos de contacto"}
          </p>
        </div>
        <button
          type="button"
          onClick={() => onChange(null)}
          className="h-11 rounded-full border border-cacao/25 bg-white px-4 text-sm font-semibold text-cacao"
        >
          Cambiar
        </button>
      </div>
    );
  }

  if (mode === "new") {
    return (
      <div className="space-y-3 rounded-2xl border border-crema-300 bg-crema-100 p-4">
        <div>
          <label htmlFor="cli-name" className={labelClass}>Nombre</label>
          <input
            id="cli-name"
            className={inputClass}
            value={draft.name}
            maxLength={120}
            autoComplete="off"
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </div>
        <div>
          <label htmlFor="cli-phone" className={labelClass}>Celular</label>
          <input
            id="cli-phone"
            className={inputClass}
            value={draft.phone}
            inputMode="tel"
            maxLength={20}
            autoComplete="off"
            placeholder="987 654 321"
            onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
          />
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] gap-2">
          <div>
            <label htmlFor="cli-doc" className={labelClass}>Documento</label>
            <select
              id="cli-doc"
              className={inputClass}
              value={draft.docType}
              onChange={(e) => setDraft({ ...draft, docType: e.target.value as DocType, docNumber: "" })}
            >
              {DOC_TYPES.map((t) => (
                <option key={t} value={t}>{DOC_OPTION[t]}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="cli-docnum" className={labelClass}>Número</label>
            <input
              id="cli-docnum"
              className={cx(inputClass, "disabled:bg-crema-200")}
              value={draft.docNumber}
              disabled={draft.docType === "NONE"}
              inputMode={draft.docType === "DNI" || draft.docType === "RUC" ? "numeric" : "text"}
              maxLength={draft.docType === "DNI" ? 8 : draft.docType === "RUC" ? 11 : 15}
              autoComplete="off"
              placeholder={draft.docType === "NONE" ? "—" : ""}
              onChange={(e) => setDraft({ ...draft, docNumber: e.target.value })}
            />
          </div>
        </div>
        {error && <p role="alert" className="text-sm text-terracota">{error}</p>}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="h-11 flex-1 rounded-full bg-cacao px-5 text-sm font-semibold text-crema disabled:opacity-50"
          >
            {saving ? "Guardando…" : "Guardar cliente"}
          </button>
          <button
            type="button"
            onClick={() => { setMode("search"); setError(null); }}
            disabled={saving}
            className="h-11 rounded-full px-4 text-sm font-semibold text-cacao-700"
          >
            Volver a buscar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <input
        type="search"
        className={inputClass}
        value={query}
        onChange={(e) => handleQuery(e.target.value)}
        placeholder="Nombre, celular o DNI"
        autoComplete="off"
        aria-label="Buscar cliente"
      />
      {searching && <p className="text-sm text-cacao-500">Buscando…</p>}
      {error && <p role="alert" className="text-sm text-terracota">{error}</p>}
      {results && !searching && (
        results.length ? (
          <ul className="divide-y divide-crema-200 overflow-hidden rounded-2xl border border-crema-300 bg-white">
            {results.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => onChange(c)}
                  className="flex min-h-11 w-full flex-col items-start px-4 py-2.5 text-left hover:bg-crema-100"
                >
                  <span className="font-medium text-cacao">{c.name}</span>
                  <span className="text-[13px] text-cacao-500">
                    {[c.phone, c.docNumber ? `${c.docType} ${c.docNumber}` : null].filter(Boolean).join(" · ") || "Sin datos de contacto"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-cacao-500">Ningún cliente con “{query.trim()}”.</p>
        )
      )}
      <button
        type="button"
        onClick={startNew}
        className="h-11 w-full rounded-full border border-cacao/25 px-4 text-sm font-semibold text-cacao hover:bg-crema-100"
      >
        + Registrar cliente nuevo
      </button>
    </div>
  );
}
