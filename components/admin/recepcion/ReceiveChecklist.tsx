"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { QrScanner } from "@/components/admin/QrScanner";
import { Notice, inputClass, labelClass } from "@/components/admin/ui";
import { receiveDispatch } from "@/app/admin/(panel)/recepcion/actions";
import type { ParsedQr } from "@/lib/gestion/qr";
import { TONE_CLASS } from "@/lib/gestion/labels";
import { cx } from "@/lib/format";
import { clearDraft, draftKey, parseDraft, readDraftRaw, subscribeDraft, writeDraft, type ReceptionDraft } from "./draft";
import type { ChecklistCake, ChecklistLine, ReceiveInput, ReceiveResult } from "./types";

type Feedback = { tone: "ok" | "warn" | "bad" | "info"; text: string };

const MAX_NOTES = 500;

/* Classe própria em vez de `inputClass` + "w-20": `cx` só concatena, e o
   Tailwind gera `w-full` depois de `w-20` — o campo esticava e empurrava os
   botões −/+ para fora da linha no celular. */
const QTY_INPUT =
  "h-11 w-20 shrink-0 rounded-xl border bg-white px-2 text-center text-[15px] tabular-nums text-cacao focus:border-dorado-600 focus:outline-none";

function formatQty(n: number) {
  return n.toLocaleString("es-PE", { maximumFractionDigits: 3 });
}

/** Aceita vírgula: teclado numérico de celular em espanhol às vezes só tem ela. */
function parseQty(text: string) {
  const t = text.trim().replace(",", ".");
  return t === "" ? Number.NaN : Number(t);
}

/** Vibração diferente para erro: a vendedora está olhando a caixa, não a tela. */
function buzzError() {
  if (typeof navigator !== "undefined") navigator.vibrate?.([90, 60, 90]);
}

/**
 * Conferência de um despacho na loja.
 *
 * Escanear marca; tocar marca ou desmarca (etiqueta rasgada, câmera ruim).
 * Nada vai ao banco até "Confirmar recepción" — a conferência é do despacho
 * inteiro, de uma vez, e o que ficou sem marcar vira faltante. Por isso a
 * confirmação diz com todas as letras quantas vão ficar como FALTANTES.
 */
export function ReceiveChecklist({
  dispatchId,
  code,
  cakes,
  lines,
  initialSerial,
}: {
  dispatchId: string;
  code: string;
  cakes: ChecklistCake[];
  lines: ChecklistLine[];
  initialSerial: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<{ text: string; refresh: boolean } | null>(null);
  const [done, setDone] = useState<ReceiveResult | null>(null);

  const key = draftKey(dispatchId);
  const serialSet = useMemo(() => new Set(cakes.map((c) => c.serial)), [cakes]);
  const lineIds = useMemo(() => new Set(lines.map((l) => l.id)), [lines]);
  const bySerial = useMemo(() => new Map(cakes.map((c) => [c.serial, c])), [cakes]);

  const raw = useSyncExternalStore(subscribeDraft, () => readDraftRaw(key), () => "");
  const draft = useMemo(() => parseDraft(raw, serialSet, lineIds), [raw, serialSet, lineIds]);
  const checked = useMemo(() => new Set(draft.checked), [draft]);

  /* Sempre a partir do que está guardado agora, não do render: duas
     leituras seguidas da câmera não podem uma apagar a outra. */
  function currentDraft() {
    return parseDraft(readDraftRaw(key), serialSet, lineIds);
  }

  function update(change: (d: ReceptionDraft) => ReceptionDraft) {
    writeDraft(key, change(currentDraft()));
  }

  /* Veio da lista escaneando uma torta: ela já entra marcada. A série sai da
     URL em seguida — senão, se a vendedora desmarcar e recarregar, voltaria
     marcada sozinha. */
  const appliedInitial = useRef(false);
  useEffect(() => {
    if (!initialSerial || appliedInitial.current) return;
    appliedInitial.current = true;
    if (serialSet.has(initialSerial)) {
      const current = parseDraft(readDraftRaw(key), serialSet, lineIds);
      if (!current.checked.includes(initialSerial)) {
        writeDraft(key, { ...current, checked: [...current.checked, initialSerial] });
      }
    }
    router.replace(`/admin/recepcion/${dispatchId}`, { scroll: false });
  }, [initialSerial, serialSet, lineIds, key, dispatchId, router]);

  function toggle(serial: string) {
    setError(null);
    setConfirming(false);
    update((d) =>
      d.checked.includes(serial) ? { ...d, checked: d.checked.filter((s) => s !== serial) } : { ...d, checked: [...d.checked, serial] },
    );
  }

  function handleScan(parsed: ParsedQr) {
    setError(null);
    setConfirming(false);

    if (parsed.type === "dispatch") {
      if (parsed.code === code) {
        setFeedback({ tone: "info", text: "Es la guía de este despacho. Ahora escanea cada torta." });
      } else {
        buzzError();
        setFeedback({ tone: "bad", text: `La guía ${parsed.code} es de otro despacho.` });
      }
      return;
    }

    const serial = parsed.serial;
    const cake = bySerial.get(serial);
    if (!cake) {
      buzzError();
      setFeedback({ tone: "bad", text: `${serial} no pertenece a este despacho.` });
      return;
    }

    const current = currentDraft();
    setHighlight(serial);
    if (current.checked.includes(serial)) {
      buzzError();
      setFeedback({ tone: "warn", text: `${serial} ya estaba marcada.` });
      return;
    }
    writeDraft(key, { ...current, checked: [...current.checked, serial] });
    setFeedback({ tone: "ok", text: `✔ ${serial} · ${cake.product}${cake.flavor ? ` · ${cake.flavor}` : ""}` });
  }

  const lineState = lines.map((line) => {
    const text = draft.qty[line.id] ?? String(line.quantity);
    const value = parseQty(text);
    const max = line.quantity * 2;
    const valid = Number.isFinite(value) && value >= 0 && value <= max;
    return { line, text, value, max, valid };
  });

  function setQty(lineId: string, text: string) {
    setError(null);
    setConfirming(false);
    update((d) => ({ ...d, qty: { ...d.qty, [lineId]: text.slice(0, 12) } }));
  }

  function step(lineId: string, delta: number) {
    const state = lineState.find((s) => s.line.id === lineId);
    if (!state) return;
    const from = state.valid ? state.value : state.line.quantity;
    const next = Math.min(state.max, Math.max(0, Math.round((from + delta) * 1000) / 1000));
    setQty(lineId, String(next));
  }

  const checkedCount = cakes.filter((c) => checked.has(c.serial)).length;
  const missing = cakes.filter((c) => !checked.has(c.serial));
  const shortLines = lineState.filter((s) => s.valid && s.value < s.line.quantity);
  const progress = cakes.length ? Math.round((checkedCount / cakes.length) * 100) : 100;

  function handleConfirm() {
    setError(null);
    if (lineState.some((s) => !s.valid)) {
      setError({ text: "Revisa las cantidades recibidas: cada una va de 0 al doble de lo enviado.", refresh: false });
      return;
    }
    if (draft.notes.trim().length > MAX_NOTES) {
      setError({ text: `La observación admite hasta ${MAX_NOTES} caracteres.`, refresh: false });
      return;
    }
    if (missing.length > 0) {
      setConfirming(true);
      return;
    }
    submit();
  }

  function submit() {
    const payload: ReceiveInput = {
      dispatchId,
      expected: cakes.map((c) => c.serial),
      received: cakes.filter((c) => checked.has(c.serial)).map((c) => c.serial),
      items: lineState.map((s) => ({ dispatch_line_id: s.line.id, received_quantity: s.value })),
      notes: draft.notes,
    };

    startTransition(async () => {
      try {
        const result = await receiveDispatch(payload);
        if (!result.ok) {
          /* "Ya fue recibido" e afins: atualizar mostra o estado real do despacho. */
          setError({ text: result.error, refresh: true });
          setConfirming(false);
          return;
        }
        setDone(result.data);
        clearDraft(key);
        router.replace(`/admin/recepcion/${dispatchId}?confirmado=1`);
      } catch {
        /* Sinal fraco no meio do envio. O rascunho continua guardado: é só tentar de novo. */
        setError({ text: "No se pudo conectar. Revisa la señal e inténtalo de nuevo.", refresh: false });
        setConfirming(false);
      }
    });
  }

  if (done) {
    return (
      <Notice tone={done.missing > 0 || done.short_items ? "warn" : "ok"}>
        <p className="font-semibold">
          Recepción confirmada: {done.received} {done.received === 1 ? "torta recibida" : "tortas recibidas"}
          {done.missing > 0 && `, ${done.missing} ${done.missing === 1 ? "faltante" : "faltantes"}`}.
        </p>
        <p className="mt-1">Cargando el resumen…</p>
        <Link href={`/admin/recepcion/${dispatchId}?confirmado=1`} className="mt-2 inline-flex h-11 items-center font-semibold underline underline-offset-4">
          Ver resumen
        </Link>
      </Notice>
    );
  }

  return (
    <div className="space-y-5">
      {cakes.length > 0 && (
        <div className="space-y-2">
          <QrScanner onScan={handleScan} label="Escanear tortas" />
          {feedback && (
            <p role="status" aria-live="polite" className={cx("rounded-2xl border px-4 py-3 text-[15px] font-medium", TONE_CLASS[feedback.tone])}>
              {feedback.text}
            </p>
          )}
        </div>
      )}

      {cakes.length > 0 && (
        <section aria-label="Tortas del despacho" className="space-y-3">
          {/* Fica grudado no topo ao rolar: a vendedora sabe quanto falta sem voltar para cima. */}
          <div className="sticky top-0 z-10 -mx-4 bg-crema/95 px-4 py-2 backdrop-blur sm:mx-0 sm:rounded-2xl sm:px-0">
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-[15px] text-cacao-700">
                <span className="font-display text-2xl font-semibold text-cacao">{checkedCount}</span> de {cakes.length} conferidas
              </p>
              {missing.length > 0 && <p className="text-sm text-cacao-500">faltan {missing.length}</p>}
            </div>
            <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-crema-300" aria-hidden>
              <div className={cx("h-full rounded-full transition-all", missing.length ? "bg-dorado-600" : "bg-verde")} style={{ width: `${progress}%` }} />
            </div>
          </div>

          <ul className="space-y-2">
            {cakes.map((cake) => {
              const isChecked = checked.has(cake.serial);
              return (
                <li key={cake.serial}>
                  <button
                    type="button"
                    onClick={() => toggle(cake.serial)}
                    aria-pressed={isChecked}
                    disabled={pending}
                    className={cx(
                      "flex min-h-16 w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left transition-colors disabled:opacity-60",
                      isChecked ? "border-verde/40 bg-verde-100" : "border-crema-300 bg-white hover:border-cacao/30",
                      highlight === cake.serial && "ring-2 ring-dorado-600 ring-offset-2 ring-offset-crema",
                    )}
                  >
                    <span
                      aria-hidden
                      className={cx(
                        "grid size-9 shrink-0 place-items-center rounded-full border-2 text-lg font-bold",
                        isChecked ? "border-verde bg-verde text-white" : "border-crema-300 bg-white text-transparent",
                      )}
                    >
                      ✓
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-mono text-[15px] font-semibold text-cacao">{cake.serial}</span>
                      <span className="block text-sm text-cacao-700">
                        {cake.product}
                        {cake.sku && <span className="text-cacao-300"> · {cake.sku}</span>}
                        {" · "}
                        {cake.flavor ?? "Sin sabor"}
                        {cake.cakeType && ` · ${cake.cakeType}`}
                      </span>
                      {cake.decorator && <span className="block text-[13px] text-cacao-500">Decoró: {cake.decorator}</span>}
                      {(cake.redecorated || cake.contractNumber !== null) && (
                        <span className="mt-1 flex flex-wrap gap-1.5">
                          {cake.redecorated && (
                            <span className={cx("rounded-full border px-2 py-0.5 text-[11px] font-bold tracking-wide", TONE_CLASS.warn)}>REDECORADA</span>
                          )}
                          {cake.contractNumber !== null && (
                            <span className={cx("rounded-full border px-2 py-0.5 text-[11px] font-semibold", TONE_CLASS.info)}>
                              Encomienda #{cake.contractNumber}
                            </span>
                          )}
                        </span>
                      )}
                    </span>
                    <span className="sr-only">{isChecked ? "Conferida. Toca para desmarcar." : "Sin conferir. Toca para marcar."}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {lines.length > 0 && (
        <section className="card overflow-hidden" aria-label="Ítems sin serie">
          <header className="border-b border-crema-200 px-4 py-3 sm:px-5">
            <h3 className="font-display text-lg">Ítems sin serie</h3>
            <p className="text-[13px] text-cacao-500">Cuenta lo que llegó. Viene lleno con lo enviado.</p>
          </header>
          <ul className="divide-y divide-crema-200">
            {lineState.map(({ line, text, value, max, valid }) => {
              const diff = valid ? value - line.quantity : 0;
              return (
                <li key={line.id} className="px-4 py-3 sm:px-5">
                  <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                    <div className="min-w-0">
                      <p className="font-medium text-cacao">
                        {line.product}
                        {line.sku && <span className="ml-1.5 text-[13px] text-cacao-300">{line.sku}</span>}
                      </p>
                      <p className="text-[13px] text-cacao-500">Enviado: {formatQty(line.quantity)}</p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => step(line.id, -1)}
                        disabled={pending || (valid && value <= 0)}
                        aria-label={`Restar uno a ${line.product}`}
                        className="grid size-11 shrink-0 place-items-center rounded-full border border-crema-300 bg-white text-xl font-semibold text-cacao disabled:opacity-40"
                      >
                        −
                      </button>
                      <input
                        value={text}
                        onChange={(e) => setQty(line.id, e.target.value)}
                        inputMode="decimal"
                        aria-label={`Recibido de ${line.product}`}
                        aria-invalid={!valid}
                        disabled={pending}
                        className={cx(QTY_INPUT, valid ? "border-crema-300" : "border-terracota")}
                      />
                      <button
                        type="button"
                        onClick={() => step(line.id, 1)}
                        disabled={pending || (valid && value >= max)}
                        aria-label={`Sumar uno a ${line.product}`}
                        className="grid size-11 shrink-0 place-items-center rounded-full border border-crema-300 bg-white text-xl font-semibold text-cacao disabled:opacity-40"
                      >
                        +
                      </button>
                    </div>
                  </div>
                  {!valid && <p className="mt-1 text-[13px] text-terracota">Entre 0 y {formatQty(max)}.</p>}
                  {valid && diff < 0 && <p className="mt-1 text-[13px] font-medium text-terracota">Faltan {formatQty(-diff)}</p>}
                  {valid && diff > 0 && <p className="mt-1 text-[13px] font-medium text-cacao-700">Sobran {formatQty(diff)}</p>}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <div>
        <label htmlFor="reception-notes" className={labelClass}>
          Observación (opcional)
        </label>
        <textarea
          id="reception-notes"
          value={draft.notes}
          onChange={(e) => {
            setConfirming(false);
            update((d) => ({ ...d, notes: e.target.value.slice(0, MAX_NOTES) }));
          }}
          maxLength={MAX_NOTES}
          rows={3}
          disabled={pending}
          placeholder="Ej.: una torta llegó golpeada, faltó una caja…"
          className={cx(inputClass, "h-auto py-2.5")}
        />
      </div>

      {error && (
        <div role="alert" className={cx("rounded-2xl border px-4 py-3 text-sm", TONE_CLASS.bad)}>
          <p>{error.text}</p>
          {error.refresh && (
            <button type="button" onClick={() => router.refresh()} className="mt-2 inline-flex h-11 items-center font-semibold underline underline-offset-4">
              Actualizar la página
            </button>
          )}
        </div>
      )}

      {confirming ? (
        <div role="alert" aria-labelledby="missing-title" className="rounded-2xl border-2 border-terracota/40 bg-white p-4 shadow-lift sm:p-5">
          <p id="missing-title" className="font-display text-xl font-semibold text-terracota">
            {missing.length} {missing.length === 1 ? "torta quedará" : "tortas quedarán"} como FALTANTES
          </p>
          <p className="mt-1 text-sm text-cacao-700">
            {checkedCount === 0
              ? "No marcaste ninguna torta. Si confirmas, todo el despacho queda como no llegado."
              : "No aparecen en la vitrina hasta que alguien aclare qué pasó con ellas."}
          </p>
          <ul className="mt-3 max-h-48 space-y-1 overflow-y-auto text-sm">
            {missing.map((c) => (
              <li key={c.serial} className="flex flex-wrap gap-x-2">
                <span className="font-mono font-semibold text-cacao">{c.serial}</span>
                <span className="text-cacao-500">
                  {c.product} · {c.flavor ?? "Sin sabor"}
                </span>
              </li>
            ))}
          </ul>
          {shortLines.length > 0 && (
            <p className="mt-3 text-sm text-cacao-700">
              Ítems con menos cantidad:{" "}
              {shortLines.map((s) => `${s.line.product} (${formatQty(s.value)} de ${formatQty(s.line.quantity)})`).join(", ")}.
            </p>
          )}
          <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={pending}
              className="h-12 rounded-full border border-cacao/25 px-5 font-semibold text-cacao disabled:opacity-50"
            >
              Volver a revisar
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={pending}
              className="h-12 rounded-full bg-terracota px-5 font-semibold text-white hover:bg-terracota-700 disabled:opacity-60"
            >
              {pending ? "Confirmando…" : "Confirmar con faltantes"}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {shortLines.length > 0 && missing.length === 0 && (
            <p className="text-sm text-cacao-700">
              Hay {shortLines.length} {shortLines.length === 1 ? "ítem" : "ítems"} con menos cantidad de lo enviado. Quedará registrado.
            </p>
          )}
          <button
            type="button"
            onClick={handleConfirm}
            disabled={pending}
            className="h-14 w-full rounded-full bg-dorado text-base font-semibold text-cacao hover:bg-dorado-600 disabled:opacity-60"
          >
            {pending ? "Confirmando…" : "Confirmar recepción"}
          </button>
        </div>
      )}
    </div>
  );
}
