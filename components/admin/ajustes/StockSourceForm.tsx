"use client";

import { useState } from "react";
import { saveStockSource } from "@/app/admin/(panel)/ajustes/actions";
import { Notice, Section, StatusPill, inputClass, labelClass } from "@/components/admin/ui";
import { ActionFeedback, buttonClass, useActionRunner } from "@/components/admin/catalogos/useActionRunner";
import { formatDuration } from "@/lib/gestion/dates";
import { cx } from "@/lib/format";
import { CONFIRM_WORD, confirmsChange, type StockSource } from "./config";

const SOURCE_PILL = {
  sisgeco: { label: "Lee el Sisgeco", tone: "info" as const },
  native: { label: "Lee el sistema nuevo", tone: "ok" as const },
};

export type SourceCount = {
  /** Tortas `in_stock` dessa fonte, vencidas incluídas. */
  stock: number;
  /** As que a vitrine mostraria hoje: `in_stock` e não vencidas. */
  showable: number;
};

export type StockCounts = Record<StockSource, SourceCount>;

function cakes(n: number) {
  return `${n} ${n === 1 ? "torta" : "tortas"}`;
}

/* As vencidas ficam fora da conta e da vitrine; dizer quantas são explica a
   diferença para quem conferir o Sisgeco ou a tela da loja. */
function expiredNote(source: StockSource, count: SourceCount) {
  const expired = count.stock - count.showable;
  if (expired <= 0) return null;
  if (source === "sisgeco") {
    return expired === 1
      ? "1 vencida sigue como disponible en el Sisgeco: no se cuenta ni sale en la vitrina."
      : `${expired} vencidas siguen como disponibles en el Sisgeco: no se cuentan ni salen en la vitrina.`;
  }
  return expired === 1
    ? "1 vencida espera volver al taller: no se cuenta ni sale en la vitrina."
    : `${expired} vencidas esperan volver al taller: no se cuentan ni salen en la vitrina.`;
}

/**
 * A chave mais perigosa do sistema, com a explicação do lado.
 *
 * Mostra quantas tortas cada fonte poria na vitrine agora: quem vai virar a
 * chave vê que a vitrine passaria de "96 tortas" para "0" antes de fazer
 * isso com o cliente olhando. A conta segue a mesma regra da vitrine
 * (lib/stock.ts): sem vencidas e, no Sisgeco, só com o leitor em dia.
 */
export function StockSourceForm({
  current,
  counts,
  lastSyncMinutes,
  staleAfterMin,
  canEdit,
}: {
  current: StockSource;
  counts: StockCounts;
  lastSyncMinutes: number | null;
  /** `sla.sync_stale_min`: passado esse tempo sem envio, a vitrine do Sisgeco some. */
  staleAfterMin: number;
  canEdit: boolean;
}) {
  const { pending, busyKey, feedbackFor, run } = useActionRunner();
  /* null = sem rascunho, segue o banco. Guardar a fonte atual como estado
     faria a tela insistir numa opção velha se outra aba virasse a chave. */
  const [choice, setChoice] = useState<StockSource | null>(null);
  const [confirmation, setConfirmation] = useState("");

  const selected = canEdit && choice ? choice : current;
  const switching = selected !== current;
  const toNative = switching && selected === "native";
  const canSubmit = canEdit && switching && (!toNative || confirmsChange(confirmation));

  /* Leitor calado além do prazo: a vitrine esconde a disponibilidade em vez
     de mostrar número velho. O que ela mostra "hoje" pelo Sisgeco é zero. */
  const readerLive = lastSyncMinutes !== null && lastSyncMinutes <= staleAfterMin;
  const sisgecoOnVitrine = readerLive ? counts.sisgeco.showable : 0;
  const syncText =
    lastSyncMinutes === null
      ? "El lector del Sisgeco todavía no envió nada: con esta fuente la vitrina no muestra disponibilidad."
      : readerLive
        ? `Último envío del lector: hace ${formatDuration(lastSyncMinutes)}.`
        : `El lector no envía hace ${formatDuration(lastSyncMinutes)}: mientras siga así, con esta fuente la vitrina no muestra disponibilidad.`;

  function submit() {
    if (!canSubmit) return;
    run("source", () => saveStockSource(selected, confirmation), {
      success: selected === "native" ? "Listo: la vitrina ahora lee el sistema nuevo." : "Listo: la vitrina volvió a leer el Sisgeco.",
      onSuccess: () => {
        setChoice(null);
        setConfirmation("");
      },
    });
  }

  return (
    <Section title="Fuente de la vitrina pública" aside={<StatusPill status={current} map={SOURCE_PILL} />}>
      <div className="space-y-4 px-5 py-4">
        <p className="text-sm text-cacao-500">
          La vitrina del sitio muestra a los clientes las tortas disponibles hoy en cada tienda. Puede tomarlas de uno de estos dos lugares:
        </p>

        <div className="grid gap-3 md:grid-cols-2">
          <Option
            value="sisgeco"
            selected={selected === "sisgeco"}
            isCurrent={current === "sisgeco"}
            disabled={!canEdit || pending}
            onSelect={() => setChoice(current === "sisgeco" ? null : "sisgeco")}
            title="Sistema de la tienda (Sisgeco)"
            description="Lo que se registra en el Sisgeco del mostrador. El lector instalado en la tienda lo envía cada pocos segundos. Es como funciona hoy."
            count={counts.sisgeco.showable}
            details={[expiredNote("sisgeco", counts.sisgeco), syncText]}
            warn={!readerLive}
          />
          <Option
            value="native"
            selected={selected === "native"}
            isCurrent={current === "native"}
            disabled={!canEdit || pending}
            onSelect={() => setChoice(current === "native" ? null : "native")}
            title="Sistema nuevo"
            description="Las tortas que el taller despachó y la tienda recibió en este panel, con su etiqueta QR. Las vencidas no se muestran."
            count={counts.native.showable}
            details={[
              counts.native.stock === 0 ? "Todavía no hay tortas recibidas en el sistema nuevo." : expiredNote("native", counts.native),
            ]}
          />
        </div>

        {toNative && (
          <div className="space-y-3">
            <Notice tone="warn">
              <p className="font-semibold">Antes de cambiar, confirma esto:</p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li>
                  La boleta todavía sale por el Sisgeco. Si la tienda empieza a vender por el sistema nuevo antes de conectar el Close2U, cada venta se digita dos veces: aquí y en el Sisgeco.
                </li>
                <li>Después del cambio, apaguen el lector del Sisgeco en la PC de la tienda: ya no alimenta la vitrina.</li>
                <li>
                  Desde este momento la vitrina mostrará {cakes(counts.native.showable)}; hoy muestra {cakes(sisgecoOnVitrine)}
                  {readerLive ? "." : " porque el lector del Sisgeco no está enviando."}
                </li>
              </ul>
            </Notice>
            {counts.native.showable === 0 && (
              <Notice tone="bad">El sistema nuevo no tiene tortas vigentes en tienda: la vitrina pública quedará vacía hasta que se reciba el primer despacho.</Notice>
            )}
            <label className="block max-w-xs">
              <span className={labelClass}>Escribe {CONFIRM_WORD} para confirmar</span>
              <input
                className={cx(inputClass, "font-mono uppercase tracking-widest")}
                value={confirmation}
                autoCapitalize="characters"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                maxLength={20}
                disabled={pending}
                onChange={(e) => setConfirmation(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    submit();
                  }
                }}
              />
            </label>
          </div>
        )}

        {switching && selected === "sisgeco" && (
          <Notice tone={readerLive ? "info" : "warn"}>
            La vitrina volverá a mostrar lo que envía el lector del Sisgeco: hoy serían {cakes(sisgecoOnVitrine)}. Verifica que el lector esté encendido en la tienda: si pasa más de {staleAfterMin} min sin enviar, la vitrina deja de mostrar disponibilidad. {syncText}
          </Notice>
        )}

        {canEdit && switching && (
          <div className="flex flex-wrap gap-2">
            <button type="button" className={toNative ? buttonClass.dark : buttonClass.primary} disabled={pending || !canSubmit} onClick={submit}>
              {busyKey === "source" ? "Cambiando…" : toNative ? "Cambiar al sistema nuevo" : "Volver al Sisgeco"}
            </button>
            <button
              type="button"
              className={buttonClass.outline}
              disabled={pending}
              onClick={() => {
                setChoice(null);
                setConfirmation("");
              }}
            >
              Cancelar
            </button>
          </div>
        )}

        <ActionFeedback feedback={feedbackFor()} />
      </div>
    </Section>
  );
}

function Option({
  value,
  selected,
  isCurrent,
  disabled,
  onSelect,
  title,
  description,
  count,
  details,
  warn = false,
}: {
  value: StockSource;
  selected: boolean;
  isCurrent: boolean;
  disabled: boolean;
  onSelect: () => void;
  title: string;
  description: string;
  count: number;
  details: (string | null)[];
  /** A última linha é um problema (leitor calado), não só informação. */
  warn?: boolean;
}) {
  const lines = details.filter((line): line is string => Boolean(line));
  return (
    <button
      type="button"
      aria-pressed={selected}
      data-value={value}
      disabled={disabled}
      onClick={onSelect}
      className={cx(
        "flex min-h-11 flex-col gap-2 rounded-2xl border-2 p-4 text-left transition-colors disabled:cursor-default",
        selected ? "border-dorado bg-dorado-100" : "border-crema-300 bg-white enabled:hover:border-cacao/35",
      )}
    >
      <span className="flex w-full items-center justify-between gap-2">
        <span className="font-semibold text-cacao">{title}</span>
        {isCurrent && <span className="shrink-0 rounded-full bg-cacao px-2.5 py-0.5 text-[11px] font-semibold text-crema">Actual</span>}
      </span>
      <span className="text-[13px] leading-relaxed text-cacao-500">{description}</span>
      <span className="mt-auto flex items-baseline gap-2 pt-1">
        <span className="font-display text-3xl font-semibold tabular-nums text-cacao">{count}</span>
        <span className="text-[13px] text-cacao-500">{count === 1 ? "torta vigente en tienda" : "tortas vigentes en tienda"}</span>
      </span>
      {lines.map((line, i) => (
        <span
          key={i}
          className={cx("text-[12px]", warn && i === lines.length - 1 ? "font-semibold text-terracota-700" : "text-cacao-300")}
        >
          {line}
        </span>
      ))}
    </button>
  );
}
