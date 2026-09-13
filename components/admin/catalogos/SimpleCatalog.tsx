"use client";

import { useState, type FormEvent } from "react";
import {
  createCatalogItem,
  moveCatalogItem,
  setCatalogItemActive,
  updateCatalogItem,
} from "@/app/admin/(panel)/catalogos/actions";
import { EmptyState, Section, StatusPill, inputClass, labelClass } from "@/components/admin/ui";
import { cx } from "@/lib/format";
import {
  CODE_MAX,
  NAME_MAX,
  SIMPLE_CATALOGS,
  codeError,
  nameError,
  normalizeCode,
  type CatalogItem,
  type SimpleCatalogKind,
} from "./config";
import { ActionFeedback, buttonClass, useActionRunner } from "./useActionRunner";

/**
 * Sabores, tipos de torta e decoradoras: a mesma lista com outro nome.
 *
 * Ativos primeiro, na ordem em que o taller os vê no despacho; inativos
 * embaixo, sem setas — ordenar o que não aparece em lugar nenhum só confunde.
 */
export function SimpleCatalog({ kind, items }: { kind: SimpleCatalogKind; items: CatalogItem[] }) {
  const config = SIMPLE_CATALOGS[kind];
  const { pending, busyKey, feedbackFor, run } = useActionRunner();
  const [draft, setDraft] = useState({ code: "", name: "" });
  const [editing, setEditing] = useState<string | null>(null);

  const active = items.filter((i) => i.active);
  const inactive = items.filter((i) => !i.active);
  const feminine = config.article === "la";
  const statusMap = { off: { label: config.inactive, tone: "muted" as const } };

  const draftCode = normalizeCode(draft.code);
  const draftInvalid = codeError(draftCode) ?? nameError(draft.name.trim());
  /* Só aponta erro de código já digitado: campo vazio já trava o botão. */
  const draftHint = draft.code ? codeError(draftCode) : null;

  function add(event: FormEvent) {
    event.preventDefault();
    if (draftInvalid) return;
    run("create", () => createCatalogItem(kind, { code: draftCode, name: draft.name }), {
      success: `${capitalize(config.singular)} ${draftCode} agregad${feminine ? "a" : "o"}.`,
      onSuccess: () => setDraft({ code: "", name: "" }),
    });
  }

  const renderItem = (item: CatalogItem, index: number, list: CatalogItem[]) => (
    <li key={item.id} className="space-y-3 px-5 py-3">
      {editing === item.id ? (
        <EditRow
          item={item}
          pending={pending}
          busy={busyKey === `edit:${item.id}`}
          onCancel={() => setEditing(null)}
          onSave={(values) =>
            run(`edit:${item.id}`, () => updateCatalogItem(kind, item.id, values), {
              success: "Cambios guardados.",
              onSuccess: () => setEditing(null),
            })
          }
        />
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex h-7 items-center rounded-lg bg-crema-100 px-2.5 font-mono text-[13px] font-semibold text-cacao-700">
            {item.code}
          </span>
          <span className={cx("min-w-0 flex-1 text-[15px] font-medium", !item.active && "text-cacao-300")}>{item.name}</span>
          {!item.active && <StatusPill status="off" map={statusMap} />}

          <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto">
            {config.sortable && item.active && (
              <>
                <button
                  type="button"
                  className={buttonClass.icon}
                  disabled={pending || index === 0}
                  aria-label={`Subir ${item.name}`}
                  title="Subir"
                  onClick={() => run(`move:${item.id}`, () => moveCatalogItem(kind, item.id, "up"))}
                >
                  <Arrow up />
                </button>
                <button
                  type="button"
                  className={buttonClass.icon}
                  disabled={pending || index === list.length - 1}
                  aria-label={`Bajar ${item.name}`}
                  title="Bajar"
                  onClick={() => run(`move:${item.id}`, () => moveCatalogItem(kind, item.id, "down"))}
                >
                  <Arrow />
                </button>
              </>
            )}
            <button type="button" className={buttonClass.outline} disabled={pending} onClick={() => setEditing(item.id)}>
              Editar
            </button>
            <button
              type="button"
              className={item.active ? buttonClass.outline : buttonClass.dark}
              disabled={pending}
              onClick={() =>
                run(`toggle:${item.id}`, () => setCatalogItemActive(kind, item.id, !item.active), {
                  success: `${item.name}: ${(item.active ? config.inactive : config.active).toLowerCase()}.`,
                })
              }
            >
              {busyKey === `toggle:${item.id}` ? "Guardando…" : item.active ? "Desactivar" : "Activar"}
            </button>
          </div>
        </div>
      )}
      <ActionFeedback feedback={feedbackFor(item.id)} />
    </li>
  );

  return (
    <div className="space-y-6">
      <Section title={`Agregar ${config.singular}`}>
        <form onSubmit={add} className="grid gap-3 px-5 py-4 sm:grid-cols-[10rem_1fr_auto] sm:items-end">
          <label className="block">
            <span className={labelClass}>Código</span>
            <input
              className={cx(inputClass, "font-mono uppercase")}
              value={draft.code}
              maxLength={CODE_MAX}
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              placeholder={config.codePlaceholder}
              onChange={(e) => setDraft({ ...draft, code: e.target.value.toUpperCase() })}
            />
          </label>
          <label className="block">
            <span className={labelClass}>Nombre</span>
            <input
              className={inputClass}
              value={draft.name}
              maxLength={NAME_MAX}
              autoComplete="off"
              placeholder={config.namePlaceholder}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </label>
          <button type="submit" className={buttonClass.primary} disabled={pending || Boolean(draftInvalid)}>
            {busyKey === "create" ? "Agregando…" : "Agregar"}
          </button>
          {draftHint && <p className="text-[13px] text-terracota-700 sm:col-span-3">{draftHint}</p>}
          {feedbackFor() && (
            <div className="sm:col-span-3">
              <ActionFeedback feedback={feedbackFor()} />
            </div>
          )}
        </form>
        <p className="border-t border-crema-200 px-5 py-3 text-[13px] text-cacao-500">
          Usa el mismo código del Sisgeco. Nada se borra: lo que ya no se usa se desactiva y deja de aparecer en el taller y en las encomiendas, pero el historial lo sigue mostrando.
        </p>
      </Section>

      <Section title={config.title} aside={`${active.length} ${config.active.toLowerCase()}${active.length === 1 ? "" : "s"}`}>
        {active.length ? (
          <ul className="divide-y divide-crema-200">{active.map(renderItem)}</ul>
        ) : (
          <EmptyState>
            {items.length ? `No hay ${feminine ? "ninguna" : "ningún"} ${config.singular} ${config.active.toLowerCase()}.` : config.empty}
          </EmptyState>
        )}
      </Section>

      {inactive.length > 0 && (
        <Section title={feminine ? "Inactivas" : "Inactivos"} aside={inactive.length}>
          <ul className="divide-y divide-crema-200">{inactive.map(renderItem)}</ul>
        </Section>
      )}
    </div>
  );
}

function EditRow({
  item,
  pending,
  busy,
  onSave,
  onCancel,
}: {
  item: CatalogItem;
  pending: boolean;
  busy: boolean;
  onSave: (values: { code: string; name: string }) => void;
  onCancel: () => void;
}) {
  const [code, setCode] = useState(item.code);
  const [name, setName] = useState(item.name);
  const normalized = normalizeCode(code);
  const invalid = codeError(normalized) ?? nameError(name.trim());
  const unchanged = normalized === item.code && name.trim() === item.name;

  return (
    <form
      className="grid gap-3 sm:grid-cols-[10rem_1fr_auto_auto] sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        if (!invalid && !unchanged) onSave({ code: normalized, name });
      }}
    >
      <label className="block">
        <span className={labelClass}>Código</span>
        <input
          className={cx(inputClass, "font-mono uppercase")}
          value={code}
          maxLength={CODE_MAX}
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
        />
      </label>
      <label className="block">
        <span className={labelClass}>Nombre</span>
        <input className={inputClass} value={name} maxLength={NAME_MAX} autoComplete="off" onChange={(e) => setName(e.target.value)} />
      </label>
      <div className="flex gap-2 sm:contents">
        <button type="submit" className={buttonClass.primary} disabled={pending || unchanged || Boolean(invalid)}>
          {busy ? "Guardando…" : "Guardar"}
        </button>
        <button type="button" className={buttonClass.outline} disabled={pending} onClick={onCancel}>
          Cancelar
        </button>
      </div>
      {invalid && <p className="text-[13px] text-terracota-700 sm:col-span-4">{invalid}</p>}
    </form>
  );
}

function Arrow({ up = false }: { up?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={cx("h-5 w-5", up && "rotate-180")}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 5v14M5 12l7 7 7-7" />
    </svg>
  );
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
