"use client";

import { useState, useTransition } from "react";
import { createLead } from "@/app/admin/(panel)/leads/actions";
import { cx } from "@/lib/format";
import { LEAD_SOURCE } from "@/lib/gestion/labels";
import { inputClass, labelClass, Notice } from "@/components/admin/ui";
import type { SellerOption, StoreOption } from "./shared";
import { primaryButton } from "./styles";

/**
 * Repasse rápido do lead: o Joseka está no meio de uma conversa do Messenger
 * e tem de passar o cliente adiante em segundos, sem trocar de tela.
 *
 * Aberto no computador (onde ele atende), fechado no celular (onde a
 * vendedora só quer ver a fila). O estado inicial é resolvido por CSS —
 * nada de ler a largura da tela no primeiro render, que daria diferença
 * entre servidor e navegador.
 */

const EMPTY = { name: "", phone: "", interest: "", wantedOn: "", context: "", storeId: "", sellerId: "" };
const DESKTOP = "(min-width: 1024px)";
/* `inputClass` tem altura fixa de campo de uma linha. */
const textareaClass = `${inputClass.replace("h-11", "")} min-h-28 py-2.5 leading-relaxed`;

export function NewLeadForm({ stores, sellers, today }: { stores: StoreOption[]; sellers: SellerOption[]; today: string }) {
  /* null = padrão por tamanho de tela; true/false = a pessoa escolheu. */
  const [open, setOpen] = useState<boolean | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [source, setSource] = useState("messenger");
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ number: number; assigned: boolean } | null>(null);
  const [pending, startTransition] = useTransition();

  const storeSellers = sellers.filter((s) => !form.storeId || !s.storeId || s.storeId === form.storeId);

  function set<K extends keyof typeof EMPTY>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function toggle() {
    setOpen((current) => (current === null ? !window.matchMedia(DESKTOP).matches : !current));
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    setError(null);
    setCreated(null);
    startTransition(async () => {
      const result = await createLead({ ...form, source });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setCreated({ number: result.data.number, assigned: Boolean(form.storeId || form.sellerId) });
      /* Origem fica: o próximo lead quase sempre vem do mesmo canal. */
      setForm(EMPTY);
    });
  }

  return (
    <section className="card overflow-hidden">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open ?? undefined}
        aria-controls="nuevo-lead"
        className="flex min-h-14 w-full items-center justify-between gap-3 px-5 py-3 text-left"
      >
        <span>
          <span className="block font-display text-lg">Nuevo lead</span>
          <span className="block text-[13px] text-cacao-500">Pega la conversación de Messenger y pásala a una tienda.</span>
        </span>
        <svg
          aria-hidden
          viewBox="0 0 24 24"
          className={cx(
            "h-5 w-5 shrink-0 text-cacao-500 transition-transform",
            open === true && "rotate-180",
            open === null && "lg:rotate-180",
          )}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      <form
        id="nuevo-lead"
        onSubmit={submit}
        className={cx(
          "space-y-4 border-t border-crema-200 px-5 py-5",
          open === null ? "hidden lg:block" : open ? "block" : "hidden",
        )}
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block">
            <span className={labelClass}>Nombre *</span>
            <input
              className={inputClass}
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              required
              maxLength={120}
              autoComplete="off"
              placeholder="Ej. María Quispe"
            />
          </label>
          <label className="block">
            <span className={labelClass}>Celular</span>
            <input
              className={inputClass}
              type="tel"
              inputMode="tel"
              value={form.phone}
              onChange={(e) => set("phone", e.target.value)}
              maxLength={30}
              autoComplete="off"
              placeholder="987 654 321"
            />
          </label>
          <label className="block">
            <span className={labelClass}>Origen</span>
            <select className={inputClass} value={source} onChange={(e) => setSource(e.target.value)}>
              {Object.entries(LEAD_SOURCE).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className={labelClass}>Fecha deseada</span>
            <input
              className={inputClass}
              type="date"
              min={today}
              value={form.wantedOn}
              onChange={(e) => set("wantedOn", e.target.value)}
            />
          </label>
        </div>

        <label className="block">
          <span className={labelClass}>Interés</span>
          <input
            className={inputClass}
            value={form.interest}
            onChange={(e) => set("interest", e.target.value)}
            maxLength={200}
            placeholder="Ej. Torta de cumpleaños para 20 personas, de fresa"
          />
        </label>

        <label className="block">
          <span className={labelClass}>Contexto</span>
          <textarea
            className={textareaClass}
            rows={5}
            value={form.context}
            onChange={(e) => set("context", e.target.value)}
            maxLength={4000}
            placeholder="Pega aquí lo conversado: modelo, precio que se habló, dirección, dudas…"
          />
          <span className="mt-1 block text-right text-[12px] text-cacao-300">{form.context.length}/4000</span>
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className={labelClass}>Tienda</span>
            <select
              className={inputClass}
              value={form.storeId}
              onChange={(e) => {
                const storeId = e.target.value;
                /* Vendedora de outra loja não combina com a loja nova. */
                const keep = sellers.find((s) => s.id === form.sellerId);
                setForm((f) => ({
                  ...f,
                  storeId,
                  sellerId: keep && (!keep.storeId || !storeId || keep.storeId === storeId) ? f.sellerId : "",
                }));
              }}
            >
              <option value="">Sin asignar todavía</option>
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className={labelClass}>Vendedora</span>
            <select className={inputClass} value={form.sellerId} onChange={(e) => set("sellerId", e.target.value)}>
              <option value="">{storeSellers.length ? "Cualquiera de la tienda" : "Sin vendedoras registradas"}</option>
              {storeSellers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        {error && (
          <p role="alert" className="rounded-xl bg-terracota/10 px-3.5 py-3 text-sm font-medium text-terracota-700">
            {error}
          </p>
        )}
        {created !== null && (
          <Notice tone="ok">
            Lead #{created.number} registrado.{" "}
            {created.assigned ? "Ya está en la fila de la tienda." : "Queda en «Sin asignar» hasta que elijas la tienda."}
          </Notice>
        )}

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-end">
          <p className="text-[13px] text-cacao-500 sm:mr-auto">
            Con tienda elegida, el reloj del primer contacto empieza a correr ahora.
          </p>
          <button type="submit" disabled={pending} className={cx(primaryButton, "w-full sm:w-auto")}>
            {pending ? "Registrando…" : "Registrar lead"}
          </button>
        </div>
      </form>
    </section>
  );
}
