"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { deliverContract, findDeliverableCake } from "@/app/admin/(panel)/encomiendas/actions";
import { QrScanner } from "@/components/admin/QrScanner";
import { Notice, inputClass, labelClass } from "@/components/admin/ui";
import { formatDateShort } from "@/lib/delivery";
import { cx, soles } from "@/lib/format";
import type { ParsedQr } from "@/lib/gestion/qr";
import { PaymentEditor, parsePayments, type PaymentDraft } from "./PaymentFields";
import { LIMITS, checkPayments, type DeliverableCake } from "./shared";

/**
 * Entrega da encomenda: QUAL torta saiu e o saldo cobrado.
 *
 * É o ponto que o Sisgeco não fecha. A reservada vem marcada; se a vendedora
 * resolveu com outra da vitrine, escaneia a etiqueta. Sair sem torta nenhuma
 * é possível, mas pede confirmação explícita — é exatamente o furo antigo.
 */
export function DeliverPanel({
  contractId,
  balance,
  expectedCakes,
  expectedProducts,
  reserved,
  vitrine,
  inTransit,
  today,
}: {
  contractId: string;
  balance: number;
  expectedCakes: number;
  /** Produtos das linhas com série: ordena a vitrine com o que combina primeiro. */
  expectedProducts: string[];
  reserved: DeliverableCake[];
  vitrine: DeliverableCake[];
  inTransit: number;
  today: string;
}) {
  const [open, setOpen] = useState(false);
  /* Guarda o que a vendedora DESMARCOU, não o que está marcado: a página volta
     do servidor com props novas (saldo que mudou, torta recebida no meio) e a
     reservada que acabou de chegar entra marcada sem ninguém mexer. */
  const [unchecked, setUnchecked] = useState<string[]>([]);
  const [extras, setExtras] = useState<DeliverableCake[]>([]);
  const [showVitrine, setShowVitrine] = useState(false);
  const [filter, setFilter] = useState("");
  /* Null = pagamento padrão (efectivo pelo saldo atual). Derivado das props
     até a vendedora mexer: se o saldo mudar, o valor sugerido acompanha. */
  const [paymentDrafts, setPayments] = useState<PaymentDraft[] | null>(null);
  const [notes, setNotes] = useState("");
  const [withoutCake, setWithoutCake] = useState(false);
  const [scanMsg, setScanMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [looking, startLookup] = useTransition();
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(false);
  const busy = pending || done;

  /* Chave fixa no pagamento padrão: o contador de `newPayment` só roda em clique. */
  const payments = paymentDrafts ?? [{ key: "p0", method: "cash" as const, amount: balance > 0 ? balance.toFixed(2) : "", reference: "" }];

  /* A torta escaneada antes de a página saber que ela chegou pode voltar
     também como reservada: aparece uma vez só. */
  const listed = useMemo(() => {
    const mine = new Set(reserved.map((c) => c.serial));
    return [...reserved, ...extras.filter((c) => !mine.has(c.serial))];
  }, [reserved, extras]);
  const selected = useMemo(() => listed.map((c) => c.serial).filter((s) => !unchecked.includes(s)), [listed, unchecked]);
  const expected = useMemo(() => new Set(expectedProducts), [expectedProducts]);

  const available = useMemo(() => {
    const taken = new Set(listed.map((c) => c.serial));
    const q = filter.trim().toLowerCase();
    return vitrine
      .filter((c) => !taken.has(c.serial))
      .filter((c) => !q || `${c.serial} ${c.product} ${c.flavor ?? ""}`.toLowerCase().includes(q))
      .sort((a, b) => Number(expected.has(b.productId)) - Number(expected.has(a.productId)));
  }, [vitrine, listed, filter, expected]);

  const count = selected.length;
  const releasing = reserved.filter((c) => !selected.includes(c.serial)).length;
  const parsed = parsePayments(payments);
  const payCheck = balance > 0 && parsed ? checkPayments(balance, parsed) : null;
  const paymentsOk = balance <= 0 || Boolean(payCheck?.ok);

  function toggle(serial: string) {
    setUnchecked((prev) => (prev.includes(serial) ? prev.filter((s) => s !== serial) : [...prev, serial]));
    setWithoutCake(false);
  }

  function addCake(cake: DeliverableCake) {
    /* Conferência dentro do update: duas leituras seguidas não duplicam a torta. */
    setExtras((prev) =>
      reserved.some((c) => c.serial === cake.serial) || prev.some((c) => c.serial === cake.serial) ? prev : [...prev, cake],
    );
    setUnchecked((prev) => prev.filter((s) => s !== cake.serial));
    setWithoutCake(false);
    setScanMsg({ tone: "ok", text: `${cake.serial} · ${cake.product} agregada.` });
  }

  function handleScan(value: ParsedQr) {
    setError(null);
    if (value.type !== "cake") {
      setScanMsg({ tone: "bad", text: "Ese es el código de una guía. Escanea la etiqueta de la torta." });
      return;
    }
    const serial = value.serial;
    const known = listed.find((c) => c.serial === serial) ?? vitrine.find((c) => c.serial === serial);
    if (known) {
      if (selected.includes(serial) && listed.some((c) => c.serial === serial)) {
        setScanMsg({ tone: "ok", text: `${serial} ya está marcada.` });
        return;
      }
      addCake(known);
      return;
    }
    /* Não estava na tela: pode ter chegado depois, ou ser de outro lugar.
       O servidor diz qual dos dois. */
    startLookup(async () => {
      try {
        const res = await findDeliverableCake(contractId, serial);
        if (res.ok) addCake(res.data);
        else setScanMsg({ tone: "bad", text: res.error });
      } catch {
        setScanMsg({ tone: "bad", text: "Sin conexión. Vuelve a escanear." });
      }
    });
  }

  function confirm() {
    setError(null);
    if (count === 0 && !withoutCake) {
      setError("Marca la torta entregada o confirma la entrega sin torta.");
      return;
    }
    if (count > LIMITS.serials) {
      setError("Demasiadas tortas en una entrega.");
      return;
    }
    if (balance > 0) {
      if (!parsed) {
        setError("Hay un monto con formato inválido.");
        return;
      }
      if (payCheck && !payCheck.ok) {
        setError(payCheck.error);
        return;
      }
    }
    startTransition(async () => {
      try {
        const res = await deliverContract({
          contractId,
          serials: selected,
          payments: balance > 0 && parsed ? parsed : [],
          notes,
          confirmWithoutCake: count === 0 && withoutCake,
          expectedBalance: balance,
        });
        /* Deu certo: a página volta do servidor já como "Entregada" e este
           painel sai da tela. Até lá, o botão fica travado. */
        if (!res.ok) setError(res.error);
        else setDone(true);
      } catch {
        setError("Sin conexión. Revisa si la entrega se registró antes de repetir.");
      }
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="h-14 w-full rounded-full bg-dorado text-base font-semibold text-cacao hover:bg-dorado-600"
      >
        Entregar encomienda{balance > 0 ? ` · cobrar ${soles(balance)}` : ""}
      </button>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-display text-lg">Entregar encomienda</h3>
        <button type="button" disabled={busy} onClick={() => setOpen(false)} className="h-11 px-3 text-sm font-semibold text-cacao-700">
          Cerrar
        </button>
      </div>

      {/* 1. Tortas */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className={labelClass}>1 · Tortas que salen</p>
          <p className={cx("text-sm font-semibold", expectedCakes > 0 && count !== expectedCakes ? "text-terracota" : "text-cacao-700")}>
            {count} {count === 1 ? "torta" : "tortas"}{expectedCakes > 0 ? ` de ${expectedCakes}` : ""}
          </p>
        </div>

        {inTransit > 0 && (
          <Notice tone="warn">
            {inTransit === 1 ? "Una torta de esta encomienda sigue en camino." : `${inTransit} tortas de esta encomienda siguen en camino.`}{" "}
            Si ya llegó a la tienda, confírmala primero en{" "}
            <Link href="/admin/recepcion" className="font-semibold underline underline-offset-2">Recepción</Link>{" "}
            y vuelve aquí. Si entregas otra de la vitrina en su lugar, la que está en camino quedará reservada para esta
            encomienda al llegar: avisa al administrador para liberarla.
          </Notice>
        )}

        {listed.length > 0 ? (
          <ul className="space-y-2">
            {listed.map((c) => {
              const on = selected.includes(c.serial);
              return (
                <li key={c.serial}>
                  <label
                    className={cx(
                      "flex min-h-14 cursor-pointer items-center gap-3 rounded-2xl border px-4 py-2",
                      on ? "border-verde/40 bg-verde-100" : "border-crema-300 bg-white",
                    )}
                  >
                    <input type="checkbox" className="h-5 w-5 accent-[var(--color-verde)]" checked={on} disabled={busy} onChange={() => toggle(c.serial)} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-cacao">{c.product}{c.flavor ? ` · ${c.flavor}` : ""}</span>
                      <span className="text-[13px] text-cacao-500">
                        <span className="font-mono">{c.serial}</span> · {c.reserved ? "reservada" : "de la vitrina"} · vence {formatDateShort(c.expiresOn)}
                        {c.expiresOn < today && <strong className="text-terracota"> · vencida</strong>}
                      </span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="rounded-2xl border border-dashed border-crema-300 px-4 py-3 text-sm text-cacao-500">
            No hay tortas reservadas para esta encomienda. Escanea la de la vitrina que vas a entregar.
          </p>
        )}

        {releasing > 0 && (
          <p className="text-sm text-cacao-500">
            {releasing === 1 ? "La reservada sin marcar vuelve" : `Las ${releasing} reservadas sin marcar vuelven`} a la vitrina.
          </p>
        )}

        <QrScanner onScan={handleScan} label="Escanear torta" />
        {looking && <p className="text-sm text-cacao-500">Buscando la torta…</p>}
        {scanMsg && !looking && (
          <p role="status" className={cx("text-sm font-medium", scanMsg.tone === "ok" ? "text-verde" : "text-terracota")}>{scanMsg.text}</p>
        )}

        <div>
          <button
            type="button"
            onClick={() => setShowVitrine((v) => !v)}
            aria-expanded={showVitrine}
            className="h-11 text-sm font-semibold text-terracota underline underline-offset-2"
          >
            {showVitrine ? "Ocultar vitrina" : `Elegir de la vitrina (${vitrine.length})`}
          </button>
          {showVitrine && (
            <div className="mt-2 space-y-2">
              <input
                type="search"
                className={inputClass}
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filtrar por torta, sabor o serie"
                aria-label="Filtrar vitrina"
              />
              {available.length ? (
                <ul className="max-h-80 divide-y divide-crema-200 overflow-y-auto rounded-2xl border border-crema-300 bg-white">
                  {available.map((c) => (
                    <li key={c.serial}>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => addCake(c)}
                        className="flex min-h-12 w-full items-center justify-between gap-3 px-4 py-2 text-left hover:bg-crema-100"
                      >
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-cacao">{c.product}{c.flavor ? ` · ${c.flavor}` : ""}</span>
                          <span className="text-[12px] text-cacao-500"><span className="font-mono">{c.serial}</span> · vence {formatDateShort(c.expiresOn)}</span>
                        </span>
                        <span className="shrink-0 text-sm font-semibold text-verde">Agregar</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-cacao-500">{vitrine.length ? "Ninguna torta coincide." : "No hay tortas en la vitrina de esta tienda."}</p>
              )}
            </div>
          )}
        </div>

        {count === 0 && (
          <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-terracota/30 bg-terracota/10 px-4 py-3 text-sm text-terracota-700">
            <input
              type="checkbox"
              className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--color-terracota)]"
              checked={withoutCake}
              disabled={busy}
              onChange={(e) => setWithoutCake(e.target.checked)}
            />
            <span>
              <strong>Entregar sin registrar torta.</strong> No quedará registro de qué torta salió y el inventario no cuadrará.
              Úsalo solo si la encomienda no lleva torta con serie.
            </span>
          </label>
        )}
      </div>

      {/* 2. Pagamento */}
      <div className="space-y-3">
        <p className={labelClass}>2 · Saldo</p>
        {balance > 0 ? (
          <PaymentEditor due={balance} drafts={payments} onChange={setPayments} disabled={busy} />
        ) : (
          <Notice tone="ok">La encomienda ya está pagada. No hay saldo que cobrar.</Notice>
        )}
      </div>

      {/* 3. Observação */}
      <div>
        <label htmlFor="deliver-notes" className={labelClass}>3 · Observación (opcional)</label>
        <textarea
          id="deliver-notes"
          rows={2}
          className={cx(inputClass, "h-auto py-2")}
          maxLength={LIMITS.notes}
          value={notes}
          disabled={busy}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Quién recogió, detalle de la entrega…"
        />
      </div>

      {error && <Notice tone="bad">{error}</Notice>}

      <button
        type="button"
        onClick={confirm}
        disabled={busy || looking || (count === 0 && !withoutCake) || !paymentsOk}
        className="h-14 w-full rounded-full bg-dorado text-base font-semibold text-cacao hover:bg-dorado-600 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? "Registrando entrega…" : balance > 0 ? `Confirmar entrega y cobro de ${soles(balance)}` : "Confirmar entrega"}
      </button>
    </div>
  );
}
