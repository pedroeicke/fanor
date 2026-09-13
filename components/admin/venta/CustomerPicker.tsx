"use client";

import { useRef, useState, useTransition } from "react";
import { createCustomer, searchCustomers } from "@/app/admin/(panel)/venta/actions";
import { cx } from "@/lib/format";
import { inputClass, labelClass } from "@/components/admin/ui";
import { docLabel } from "./format";
import type { CustomerRef } from "./types";

/**
 * Cliente da venda — opcional.
 *
 * 16.576 dos 17.454 comprovantes do Sisgeco saíram para "público en general":
 * a regra é não perguntar. O campo fica fechado numa linha e só abre quando
 * a cliente quer boleta com nome, factura com RUC, ou entrar no CRM.
 */
export function CustomerPicker({
  customer,
  onChange,
  disabled,
}: {
  customer: CustomerRef | null;
  onChange: (customer: CustomerRef | null) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"search" | "create">("search");
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<CustomerRef[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", phone: "", doc: "" });
  const [searching, startSearch] = useTransition();
  const [saving, startSave] = useTransition();
  const timer = useRef<number | undefined>(undefined);
  const seq = useRef(0);

  function close() {
    window.clearTimeout(timer.current);
    seq.current++;
    setOpen(false);
    setMode("search");
    setQuery("");
    setHits(null);
    setError(null);
  }

  function run(value: string) {
    const id = ++seq.current;
    startSearch(async () => {
      try {
        const result = await searchCustomers(value);
        if (id !== seq.current) return;
        if (result.ok) {
          setHits(result.data);
          setError(null);
        } else {
          setError(result.error);
        }
      } catch {
        if (id === seq.current) setError("Sin conexión. Vuelve a intentar.");
      }
    });
  }

  function change(value: string) {
    setQuery(value);
    window.clearTimeout(timer.current);
    if (value.trim().length < 2) {
      seq.current++;
      setHits(null);
      return;
    }
    timer.current = window.setTimeout(() => run(value), 300);
  }

  /* O que já foi digitado na busca vira o começo do cadastro: 8 dígitos é
     DNI, 11 é RUC, 9 é celular; o resto é nome. */
  function startCreate() {
    const digits = query.replace(/\D/g, "");
    const onlyDigits = digits.length > 0 && digits.length === query.replace(/[\s+-]/g, "").length;
    setForm({
      name: onlyDigits ? "" : query.trim(),
      phone: onlyDigits && digits.length !== 8 && digits.length !== 11 ? digits : "",
      doc: onlyDigits && (digits.length === 8 || digits.length === 11) ? digits : "",
    });
    setError(null);
    setMode("create");
  }

  function choose(next: CustomerRef) {
    onChange(next);
    close();
  }

  function save(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setError(null);
    startSave(async () => {
      try {
        const result = await createCustomer(form);
        if (result.ok) choose(result.data);
        else setError(result.error);
      } catch {
        setError("Sin conexión. Vuelve a intentar.");
      }
    });
  }

  const detail = customer ? [docLabel(customer.docType, customer.docNumber), customer.phone].filter(Boolean).join(" · ") : "";

  return (
    <section className="card p-4 sm:p-5">
      {/* Nome longo (razão social) não é cortado: os botões descem para a
          linha de baixo quando não cabem juntos no celular. */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-[1_1_12rem]">
          <p className={labelClass}>Cliente</p>
          <p className="break-words font-medium text-cacao">{customer ? customer.name : "Público general"}</p>
          {detail && <p className="break-words text-[13px] text-cacao-500">{detail}</p>}
        </div>
        {customer && !open && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => onChange(null)}
            className="ml-auto h-11 shrink-0 rounded-full px-3 text-sm font-medium text-terracota hover:bg-crema-100 disabled:opacity-50"
          >
            Quitar
          </button>
        )}
        <button
          type="button"
          disabled={disabled}
          onClick={() => (open ? close() : setOpen(true))}
          aria-expanded={open}
          className={cx(
            "h-11 shrink-0 rounded-full border border-crema-300 bg-white px-4 text-sm font-semibold text-cacao-700 hover:border-cacao/35 disabled:opacity-50",
            !(customer && !open) && "ml-auto",
          )}
        >
          {open ? "Cerrar" : customer ? "Cambiar" : "Agregar"}
        </button>
      </div>

      {open && mode === "search" && (
        <div className="mt-4 border-t border-crema-200 pt-4">
          <form
            role="search"
            onSubmit={(e) => {
              e.preventDefault();
              window.clearTimeout(timer.current);
              if (query.trim().length >= 2) run(query);
            }}
          >
            <label htmlFor="venta-cliente" className={labelClass}>Buscar cliente</label>
            <input
              id="venta-cliente"
              type="search"
              enterKeyHint="search"
              autoComplete="off"
              placeholder="Nombre, celular o DNI/RUC"
              value={query}
              onChange={(e) => change(e.target.value)}
              className={inputClass}
            />
          </form>

          <div aria-live="polite">
            {searching && <p className="mt-2 text-sm text-cacao-300">Buscando…</p>}
            {error && <p className="mt-2 text-sm text-terracota">{error}</p>}
            {!searching && hits?.length === 0 && (
              <p className="mt-2 text-sm text-cacao-500">No encontramos a nadie con esos datos.</p>
            )}
          </div>

          {!!hits?.length && (
            <ul className="-mx-2 mt-2 divide-y divide-crema-200">
              {hits.map((hit) => (
                <li key={hit.id}>
                  <button
                    type="button"
                    onClick={() => choose(hit)}
                    className="flex min-h-14 w-full flex-col justify-center rounded-xl px-2 py-2 text-left hover:bg-crema-100"
                  >
                    <span className="font-medium text-cacao">{hit.name}</span>
                    <span className="text-[13px] text-cacao-500">
                      {[docLabel(hit.docType, hit.docNumber), hit.phone].filter(Boolean).join(" · ") || "Sin documento ni celular"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <button
            type="button"
            onClick={startCreate}
            className="mt-3 h-11 w-full rounded-full border border-dashed border-cacao/30 text-sm font-semibold text-cacao-700 hover:border-cacao/50"
          >
            + Cliente nuevo
          </button>
        </div>
      )}

      {open && mode === "create" && (
        <form onSubmit={save} className="mt-4 space-y-3 border-t border-crema-200 pt-4">
          <div>
            <label htmlFor="venta-cliente-nombre" className={labelClass}>Nombre o razón social</label>
            <input
              id="venta-cliente-nombre"
              required
              minLength={2}
              maxLength={120}
              autoComplete="off"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className={inputClass}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label htmlFor="venta-cliente-celular" className={labelClass}>Celular</label>
              <input
                id="venta-cliente-celular"
                type="tel"
                inputMode="tel"
                autoComplete="off"
                maxLength={20}
                placeholder="987654321"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="venta-cliente-doc" className={labelClass}>DNI o RUC</label>
              <input
                id="venta-cliente-doc"
                inputMode="numeric"
                autoComplete="off"
                maxLength={11}
                placeholder="Opcional"
                value={form.doc}
                onChange={(e) => setForm({ ...form, doc: e.target.value.replace(/\D/g, "") })}
                className={inputClass}
              />
            </div>
          </div>
          {error && <p role="alert" className="text-sm text-terracota">{error}</p>}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => {
                setError(null);
                setMode("search");
              }}
              className="h-11 rounded-full border border-crema-300 bg-white text-sm font-semibold text-cacao-700"
            >
              Volver
            </button>
            <button
              type="submit"
              disabled={saving}
              className={cx("h-11 rounded-full bg-dorado text-sm font-semibold text-cacao hover:bg-dorado-600", saving && "opacity-60")}
            >
              {saving ? "Guardando…" : "Guardar cliente"}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
