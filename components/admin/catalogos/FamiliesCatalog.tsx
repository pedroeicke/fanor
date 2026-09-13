"use client";

import { useState } from "react";
import { setFamilyShelfLife } from "@/app/admin/(panel)/catalogos/actions";
import { EmptyState, Notice, Section, StatusPill } from "@/components/admin/ui";
import { cx } from "@/lib/format";
import { DEFAULT_SHELF_LIFE, SHELF_LIFE_MAX, type FamilyRow } from "./config";
import { ActionFeedback, buttonClass, useActionRunner } from "./useActionRunner";

const FLAGS = {
  serial: { label: "Con serie", tone: "info" as const },
  service: { label: "Servicio", tone: "muted" as const },
};

/**
 * Famílias do Sisgeco (T, PS, G…) e quantos dias cada uma dura.
 *
 * Série e serviço são só leitura: mudar "tem série" de uma família com
 * tortas em trânsito deixaria metade do fluxo exigindo QR e metade não. A
 * validade é o que o dono decide — e é a pergunta 11 da pauta.
 */
export function FamiliesCatalog({ families, withoutFamily }: { families: FamilyRow[]; withoutFamily: number }) {
  const { pending, busyKey, feedbackFor, run } = useActionRunner();
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  return (
    <div className="space-y-6">
      <Notice>
        <p>
          <strong>Validez</strong> son los días entre la producción y el vencimiento. Se usa la del producto si tiene; si no, la de su familia; si ninguna la tiene, {DEFAULT_SHELF_LIFE} días.
          {" "}0 = vence el mismo día. El cambio vale para lo que se despache desde ahora: lo que ya está en tienda conserva su fecha.
        </p>
        <p className="mt-2">
          Hoy el vencimiento se controla torta por torta (familias con serie). En las demás familias el valor queda registrado para cuando se controle.
        </p>
      </Notice>

      <Section title="Familias de productos" aside={`${families.length} familias`}>
        {families.length ? (
          <ul className="divide-y divide-crema-200">
            {families.map((family) => {
              const current = family.shelfLifeDays === null ? "" : String(family.shelfLifeDays);
              const draft = drafts[family.id] ?? current;
              const parsed = parseDays(draft);
              /* "03" e "3" são o mesmo prazo: compara o número, não o texto. */
              const changed = (parsed === undefined ? draft.trim() : parsed === null ? "" : String(parsed)) !== current;
              const busy = busyKey === `life:${family.id}`;

              return (
                <li key={family.id} className="space-y-3 px-5 py-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="inline-flex h-7 items-center rounded-lg bg-crema-100 px-2.5 font-mono text-[13px] font-semibold text-cacao-700">
                      {family.code}
                    </span>
                    <span className="min-w-0 flex-1 text-[15px] font-medium text-cacao">{family.name}</span>
                    <span className="text-[13px] text-cacao-500">
                      {family.products} {family.products === 1 ? "producto" : "productos"}
                    </span>
                    {family.tracksSerial && <StatusPill status="serial" map={FLAGS} />}
                    {family.isService && <StatusPill status="service" map={FLAGS} />}
                  </div>

                  {family.isService ? (
                    <p className="text-[13px] text-cacao-300">Servicio: no mueve stock ni vence.</p>
                  ) : (
                    <form
                      className="flex flex-wrap items-end gap-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (!changed || parsed === undefined) return;
                        run(`life:${family.id}`, () => setFamilyShelfLife(family.id, parsed), {
                          success: parsed === null
                            ? `${family.name}: usa la validez por defecto (${DEFAULT_SHELF_LIFE} días).`
                            : `${family.name}: ${describeDays(parsed)}.`,
                          /* Mantém o valor salvo no rascunho: se a lista nova
                             chegar um instante depois, o campo não pisca o
                             número antigo. */
                          onSuccess: () => setDrafts((d) => ({ ...d, [family.id]: parsed === null ? "" : String(parsed) })),
                        });
                      }}
                    >
                      <label className="flex items-center gap-2">
                        <span className="text-[13px] font-semibold text-cacao-500">Validez</span>
                        <input
                          className={cx(
                            "h-11 w-20 rounded-xl border bg-white px-3 text-center text-[15px] tabular-nums text-cacao placeholder:text-cacao-300 focus:border-dorado-600 focus:outline-none",
                            parsed === undefined ? "border-terracota" : "border-crema-300",
                          )}
                          type="number"
                          inputMode="numeric"
                          min={0}
                          max={SHELF_LIFE_MAX}
                          step={1}
                          placeholder={String(DEFAULT_SHELF_LIFE)}
                          value={draft}
                          aria-label={`Validez de ${family.name} en días`}
                          onChange={(e) => setDrafts((d) => ({ ...d, [family.id]: e.target.value }))}
                        />
                        <span className="text-[13px] text-cacao-500">días</span>
                      </label>
                      {changed && (
                        <>
                          <button type="submit" className={buttonClass.primary} disabled={pending || parsed === undefined}>
                            {busy ? "Guardando…" : "Guardar"}
                          </button>
                          <button
                            type="button"
                            className={buttonClass.outline}
                            disabled={pending}
                            onClick={() =>
                              setDrafts((d) => {
                                const next = { ...d };
                                delete next[family.id];
                                return next;
                              })
                            }
                          >
                            Deshacer
                          </button>
                        </>
                      )}
                      <span className="basis-full text-[13px] text-cacao-500">
                        {parsed === undefined
                          ? `Escribe un número entero de 0 a ${SHELF_LIFE_MAX}, o déjalo vacío.`
                          : parsed === null
                            ? `Vacío: ${DEFAULT_SHELF_LIFE} días por defecto, salvo que el producto tenga la suya.`
                            : `${capitalize(describeDays(parsed))}.`}
                      </span>
                      {family.ownShelfLife > 0 && (
                        <span className="basis-full text-[13px] text-cacao-700">
                          {family.ownShelfLife === family.products
                            ? family.products === 1
                              ? "Su único producto tiene validez propia: este valor no le cambia nada."
                              : `Los ${family.products} productos tienen validez propia: este valor no les cambia nada.`
                            : `${family.ownShelfLife} de ${family.products} productos ${family.ownShelfLife === 1 ? "tiene" : "tienen"} validez propia y no ${family.ownShelfLife === 1 ? "sigue" : "siguen"} este valor.`}
                        </span>
                      )}
                    </form>
                  )}
                  <ActionFeedback feedback={feedbackFor(family.id)} />
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState>No hay familias registradas. Se cargan con la migración del Sisgeco.</EmptyState>
        )}
      </Section>

      {withoutFamily > 0 && (
        <p className="text-[13px] text-cacao-500">
          {withoutFamily} {withoutFamily === 1 ? "producto no tiene" : "productos no tienen"} familia: vencen a los {DEFAULT_SHELF_LIFE} días, salvo que el producto tenga validez propia.
        </p>
      )}
    </div>
  );
}

/** null = vazio (volta ao padrão); undefined = inválido. */
function parseDays(value: string): number | null | undefined {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  if (!/^\d+$/.test(trimmed)) return undefined;
  const days = Number(trimmed);
  return days <= SHELF_LIFE_MAX ? days : undefined;
}

function describeDays(days: number) {
  if (days === 0) return "vence el mismo día de producción";
  if (days === 1) return "vence al día siguiente de producción";
  return `vence ${days} días después de la producción`;
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
