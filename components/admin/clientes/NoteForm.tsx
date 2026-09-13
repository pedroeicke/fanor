"use client";

import { useId, useState, useTransition, type FormEvent } from "react";
import { addCustomerNote } from "@/app/admin/(panel)/clientes/actions";
import { cx } from "@/lib/format";
import { MAX_NOTE_LENGTH } from "./rules";

/**
 * Nota interna sobre o cliente ("alérgica a nuez", "paga siempre con Yape").
 *
 * A lista vem do servidor; aqui só o campo. Depois de gravar, a ação
 * revalida a ficha e a nota nova aparece no topo sem recarregar.
 */
export function NoteForm({ customerId }: { customerId: string }) {
  const id = useId();
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const empty = !body.trim();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || empty) return;
    setError(null);
    startTransition(async () => {
      const result = await addCustomerNote(customerId, body);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setBody("");
    });
  }

  return (
    <form onSubmit={submit} className="space-y-2 border-b border-crema-200 p-5">
      <label htmlFor={id} className="sr-only">Nueva nota</label>
      <textarea
        id={id}
        value={body}
        onChange={(e) => {
          setBody(e.target.value);
          setError(null);
        }}
        rows={3}
        maxLength={MAX_NOTE_LENGTH}
        placeholder="Preferencias, alergias, cómo prefiere que le escriban…"
        className="w-full rounded-xl border border-crema-300 bg-white px-3 py-2.5 text-[15px] leading-relaxed text-cacao placeholder:text-cacao-300 focus:border-dorado-600 focus:outline-none"
      />
      {error && (
        <p role="alert" className="text-sm text-terracota">
          {error}
        </p>
      )}
      <div className="flex items-center justify-between gap-3">
        <span className={cx("text-[12px]", body.length > MAX_NOTE_LENGTH - 100 ? "text-terracota" : "text-cacao-300")}>
          {body.length > MAX_NOTE_LENGTH - 300 ? `${body.length}/${MAX_NOTE_LENGTH}` : "Solo la ve el equipo."}
        </span>
        <button
          type="submit"
          disabled={pending || empty}
          className="inline-flex h-11 shrink-0 items-center rounded-full bg-cacao px-5 text-sm font-semibold text-crema transition-colors hover:bg-cacao-700 disabled:cursor-not-allowed disabled:opacity-45"
        >
          {pending ? "Guardando…" : "Agregar nota"}
        </button>
      </div>
    </form>
  );
}
