"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  createSeller,
  grantSellerAccess,
  revokeSellerAccess,
  setSellerActive,
  updateSeller,
} from "@/app/admin/(panel)/catalogos/actions";
import { EmptyState, Notice, Section, StatusPill, inputClass, labelClass } from "@/components/admin/ui";
import { cx } from "@/lib/format";
import {
  CODE_MAX,
  EMAIL_MAX,
  SELLER_NAME_MAX,
  SELLER_ROLES,
  codeError,
  emailError,
  isSellerRole,
  nameError,
  normalizeCode,
  phoneError,
  type SellerInput,
  type SellerRow,
  type StoreOption,
} from "./config";
import { ActionFeedback, buttonClass, useActionRunner } from "./useActionRunner";

const ACCESS = {
  yes: { label: "Con acceso al panel", tone: "ok" as const },
  no: { label: "Sin acceso", tone: "muted" as const },
  inactive: { label: "Inactiva", tone: "muted" as const },
};

const EMPTY: SellerInput = { code: "", name: "", storeId: "", role: "seller", phone: "" };

type Issued = { sellerId: string; sellerName: string; email: string; password: string };

/**
 * Quem trabalha na loja e no taller.
 *
 * A ficha diz a loja padrão das telas (recepção, balcão) e o papel. O acesso
 * ao painel é separado e só o dono concede: cadastrar a vendedora não abre
 * porta nenhuma.
 */
export function SellersCatalog({ sellers, stores, isOwner }: { sellers: SellerRow[]; stores: StoreOption[]; isOwner: boolean }) {
  const { pending, busyKey, feedbackFor, setFeedback, run } = useActionRunner();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [granting, setGranting] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [issued, setIssued] = useState<Issued | null>(null);

  const storeLabel = (id: string | null) => (id ? stores.find((s) => s.id === id)?.label ?? "Tienda no disponible" : "Sin tienda fija");
  const active = sellers.filter((s) => s.active);
  const inactive = sellers.filter((s) => !s.active);

  function closePanels() {
    setEditing(null);
    setGranting(null);
    setRevoking(null);
  }

  const renderSeller = (seller: SellerRow) => {
    const role = isSellerRole(seller.role) ? SELLER_ROLES[seller.role] : seller.role;
    return (
      <li key={seller.id} className="space-y-3 px-5 py-4">
        {editing === seller.id ? (
          <SellerForm
            initial={{ code: seller.code, name: seller.name, storeId: seller.storeId ?? "", role: seller.role, phone: seller.phone ?? "" }}
            stores={stores}
            pending={pending}
            busy={busyKey === `edit:${seller.id}`}
            submitLabel="Guardar cambios"
            onCancel={() => setEditing(null)}
            onSubmit={(values) =>
              run(`edit:${seller.id}`, () => updateSeller(seller.id, values), {
                success: "Cambios guardados.",
                onSuccess: () => setEditing(null),
              })
            }
          />
        ) : (
          <>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className={cx("text-[15px] font-semibold", seller.active ? "text-cacao" : "text-cacao-300")}>
                  {seller.name}
                  <span className="ml-2 font-mono text-[13px] font-medium text-cacao-300">{seller.code}</span>
                </p>
                <p className="mt-0.5 text-[13px] text-cacao-500">
                  {role} · {storeLabel(seller.storeId)}
                  {seller.phone && (
                    <>
                      {" · "}
                      <a href={`tel:${seller.phone.replace(/[^\d+]/g, "")}`} className="underline underline-offset-2">
                        {seller.phone}
                      </a>
                    </>
                  )}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {!seller.active && <StatusPill status="inactive" map={ACCESS} />}
                <StatusPill status={seller.hasAccess ? "yes" : "no"} map={ACCESS} />
              </div>
            </div>

            {!seller.active && seller.hasAccess && (
              <Notice tone="warn">
                Está inactiva pero su cuenta todavía entra al panel.{" "}
                {isOwner ? "Quítale el acceso si ya no trabaja aquí." : "Pide al dueño que le quite el acceso."}
              </Notice>
            )}

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={buttonClass.outline}
                disabled={pending}
                onClick={() => {
                  closePanels();
                  setEditing(seller.id);
                }}
              >
                Editar
              </button>
              <button
                type="button"
                className={seller.active ? buttonClass.outline : buttonClass.dark}
                disabled={pending}
                onClick={() =>
                  run(`toggle:${seller.id}`, () => setSellerActive(seller.id, !seller.active), {
                    success: `${seller.name}: ${seller.active ? "desactivada" : "activada"}.`,
                  })
                }
              >
                {busyKey === `toggle:${seller.id}` ? "Guardando…" : seller.active ? "Desactivar" : "Activar"}
              </button>
              {isOwner && !seller.hasAccess && seller.active && (
                <button
                  type="button"
                  className={buttonClass.outline}
                  disabled={pending}
                  onClick={() => {
                    closePanels();
                    setGranting(seller.id);
                  }}
                >
                  Crear acceso
                </button>
              )}
              {isOwner && seller.hasAccess && !seller.isSelf && (
                <button
                  type="button"
                  className={buttonClass.danger}
                  disabled={pending}
                  onClick={() => {
                    closePanels();
                    setRevoking(seller.id);
                  }}
                >
                  Quitar acceso
                </button>
              )}
            </div>

            {granting === seller.id && (
              <GrantAccess
                seller={seller}
                pending={pending}
                busy={busyKey === `grant:${seller.id}`}
                onCancel={() => setGranting(null)}
                onSubmit={(email) =>
                  run(`grant:${seller.id}`, () => grantSellerAccess(seller.id, email), {
                    onSuccess: (data) => {
                      setGranting(null);
                      setIssued({ sellerId: seller.id, sellerName: seller.name, email: data.email, password: data.password });
                    },
                  })
                }
              />
            )}

            {/* Na própria linha, não no topo: no celular a lista é longa e o
                aviso com a senha tem de aparecer onde o dedo tocou. */}
            {issued?.sellerId === seller.id && (
              <IssuedCredentials
                issued={issued}
                onDone={() => {
                  setIssued(null);
                  setFeedback({ key: `grant:${seller.id}`, tone: "ok", text: `${issued.sellerName} ya tiene acceso al panel.` });
                }}
              />
            )}

            {revoking === seller.id && (
              <div className="rounded-2xl border border-terracota/30 bg-terracota/5 p-4">
                <p className="text-sm text-cacao-700">
                  ¿Quitar el acceso de <strong>{seller.name}</strong> al panel? Deja de entrar en ese mismo momento. Su ficha y su historial se mantienen.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className={buttonClass.dangerSolid}
                    disabled={pending}
                    onClick={() =>
                      run(`revoke:${seller.id}`, () => revokeSellerAccess(seller.id), {
                        success: `${seller.name} ya no tiene acceso al panel.`,
                        onSuccess: () => setRevoking(null),
                      })
                    }
                  >
                    {busyKey === `revoke:${seller.id}` ? "Quitando…" : "Sí, quitar acceso"}
                  </button>
                  <button type="button" className={buttonClass.outline} disabled={pending} onClick={() => setRevoking(null)}>
                    Cancelar
                  </button>
                </div>
              </div>
            )}
          </>
        )}
        <ActionFeedback feedback={feedbackFor(seller.id)} />
      </li>
    );
  };

  return (
    <div className="space-y-6">
      <Section
        title="Vendedoras"
        aside={
          !adding && (
            <button
              type="button"
              className={buttonClass.primary}
              disabled={pending}
              onClick={() => {
                closePanels();
                setAdding(true);
              }}
            >
              Agregar vendedora
            </button>
          )
        }
      >
        {adding && (
          <div className="border-b border-crema-200 bg-crema-100 px-5 py-4">
            <SellerForm
              initial={EMPTY}
              stores={stores}
              pending={pending}
              busy={busyKey === "create"}
              submitLabel="Guardar vendedora"
              onCancel={() => setAdding(false)}
              onSubmit={(values) =>
                run("create", () => createSeller(values), {
                  success: `${values.name.trim().replace(/\s+/g, " ")} agregada.`,
                  onSuccess: () => setAdding(false),
                })
              }
            />
          </div>
        )}
        {feedbackFor() && (
          <div className="border-b border-crema-200 px-5 py-3">
            <ActionFeedback feedback={feedbackFor()} />
          </div>
        )}

        {active.length ? (
          <ul className="divide-y divide-crema-200">{active.map(renderSeller)}</ul>
        ) : (
          <EmptyState>
            {sellers.length
              ? "No hay vendedoras activas."
              : "Todavía no hay vendedoras. Agrega a quienes atienden en tienda y en el taller, con el código que usan en el Sisgeco."}
          </EmptyState>
        )}
      </Section>

      {inactive.length > 0 && (
        <Section title="Inactivas" aside={inactive.length}>
          <ul className="divide-y divide-crema-200">{inactive.map(renderSeller)}</ul>
        </Section>
      )}

      {!isOwner && (
        <p className="text-[13px] text-cacao-500">Solo el dueño puede crear o quitar el acceso al panel.</p>
      )}
    </div>
  );
}

function SellerForm({
  initial,
  stores,
  pending,
  busy,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: SellerInput;
  stores: StoreOption[];
  pending: boolean;
  busy: boolean;
  submitLabel: string;
  onSubmit: (values: SellerInput) => void;
  onCancel: () => void;
}) {
  const [values, setValues] = useState(initial);
  const set = (key: keyof SellerInput, value: string) => setValues((v) => ({ ...v, [key]: value }));

  const code = normalizeCode(values.code);
  const invalid =
    nameError(values.name.trim(), SELLER_NAME_MAX) ?? codeError(code) ?? phoneError(values.phone.trim()) ?? (isSellerRole(values.role) ? null : "Elige el rol.");
  const hint = (values.code && codeError(code)) || phoneError(values.phone.trim());
  /* Mesma normalização do servidor: "Guardar" sem mudança não faz nada. */
  const unchanged =
    code === normalizeCode(initial.code) &&
    values.name.trim().replace(/\s+/g, " ") === initial.name &&
    values.storeId === initial.storeId &&
    values.role === initial.role &&
    values.phone.trim() === initial.phone;
  /* Loja que deixou de receber torta (desativada, sem prefixo) não está na
     lista. Sem esta opção o seletor mostraria "Sin tienda fija" e mandaria
     outra coisa. */
  const orphanStore = initial.storeId && !stores.some((s) => s.id === initial.storeId) ? initial.storeId : null;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!invalid && !unchanged) onSubmit({ ...values, code });
  }

  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      <label className="block lg:col-span-2">
        <span className={labelClass}>Nombre</span>
        <input className={inputClass} value={values.name} maxLength={SELLER_NAME_MAX} autoComplete="off" onChange={(e) => set("name", e.target.value)} />
      </label>
      <label className="block">
        <span className={labelClass}>Código</span>
        <input
          className={cx(inputClass, "font-mono uppercase")}
          value={values.code}
          maxLength={CODE_MAX}
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => set("code", e.target.value.toUpperCase())}
        />
      </label>
      <label className="block">
        <span className={labelClass}>Rol</span>
        <select className={inputClass} value={values.role} onChange={(e) => set("role", e.target.value)}>
          {Object.entries(SELLER_ROLES).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className={labelClass}>Tienda</span>
        <select className={inputClass} value={values.storeId} onChange={(e) => set("storeId", e.target.value)}>
          <option value="">Sin tienda fija</option>
          {orphanStore && <option value={orphanStore}>Tienda actual (ya no recibe tortas)</option>}
          {stores.map((store) => (
            <option key={store.id} value={store.id}>
              {store.label}
            </option>
          ))}
        </select>
      </label>
      <label className="block lg:col-span-2">
        <span className={labelClass}>Celular (opcional)</span>
        <input
          className={inputClass}
          value={values.phone}
          inputMode="tel"
          type="tel"
          maxLength={20}
          autoComplete="off"
          placeholder="987 654 321"
          onChange={(e) => set("phone", e.target.value)}
        />
      </label>
      <div className="flex flex-wrap items-end gap-2 sm:col-span-2 lg:col-span-3">
        <button type="submit" className={buttonClass.primary} disabled={pending || unchanged || Boolean(invalid)}>
          {busy ? "Guardando…" : submitLabel}
        </button>
        <button type="button" className={buttonClass.outline} disabled={pending} onClick={onCancel}>
          Cancelar
        </button>
      </div>
      {hint && <p className="text-[13px] text-terracota-700 sm:col-span-2 lg:col-span-5">{hint}</p>}
    </form>
  );
}

function GrantAccess({
  seller,
  pending,
  busy,
  onSubmit,
  onCancel,
}: {
  seller: SellerRow;
  pending: boolean;
  busy: boolean;
  onSubmit: (email: string) => void;
  onCancel: () => void;
}) {
  const [email, setEmail] = useState("");
  const normalized = email.trim().toLowerCase();
  const invalid = emailError(normalized);

  return (
    <form
      className="rounded-2xl border border-crema-300 bg-crema-100 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!invalid) onSubmit(normalized);
      }}
    >
      <p className="text-sm text-cacao-700">
        Se crea una cuenta para que <strong>{seller.name}</strong> entre al panel con su correo y una contraseña temporal. La contraseña aparece una sola vez.
      </p>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="block min-w-0 flex-1 basis-60">
          <span className={labelClass}>Correo</span>
          <input
            className={inputClass}
            type="email"
            inputMode="email"
            autoCapitalize="none"
            autoComplete="off"
            spellCheck={false}
            maxLength={EMAIL_MAX}
            value={email}
            placeholder="nombre@correo.com"
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <button type="submit" className={buttonClass.primary} disabled={pending || Boolean(invalid)}>
          {busy ? "Creando…" : "Crear acceso"}
        </button>
        <button type="button" className={buttonClass.outline} disabled={pending} onClick={onCancel}>
          Cancelar
        </button>
      </div>
      {email.includes("@") && invalid && <p className="mt-2 text-[13px] text-terracota-700">{invalid}</p>}
    </form>
  );
}

/**
 * A senha só existe aqui, na memória desta tela. Fechar o aviso a apaga —
 * não há como vê-la de novo, e é assim que tem de ser.
 */
function IssuedCredentials({ issued, onDone }: { issued: Issued; onDone: () => void }) {
  const [copied, setCopied] = useState<"ok" | "fail" | null>(null);
  const ref = useRef<HTMLElement>(null);
  /* Só aparece depois de uma ação no navegador, nunca no HTML do servidor. */
  const [loginUrl] = useState(() => (typeof window === "undefined" ? "/admin/login" : `${window.location.origin}/admin/login`));

  useEffect(() => {
    ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(`Panel Tortas Fanor\n${loginUrl}\nCorreo: ${issued.email}\nContraseña: ${issued.password}`);
      setCopied("ok");
    } catch {
      setCopied("fail");
    }
  }

  return (
    <section ref={ref} className="card border-2 border-dorado p-5" aria-labelledby="issued-title">
      <h3 id="issued-title" className="font-display text-lg">
        Acceso creado para {issued.sellerName}
      </h3>
      <p className="mt-1 text-sm text-cacao-500">
        Anota o copia estos datos ahora: la contraseña <strong>no se vuelve a mostrar</strong>. Entrégasela en persona, no por un grupo.
      </p>
      <dl className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl bg-crema-100 px-4 py-3">
          <dt className={labelClass}>Correo</dt>
          <dd className="break-all text-[15px] font-medium text-cacao">{issued.email}</dd>
        </div>
        <div className="rounded-xl bg-crema-100 px-4 py-3">
          <dt className={labelClass}>Contraseña temporal</dt>
          <dd className="select-all break-all font-mono text-xl font-semibold tracking-wider text-cacao">{issued.password}</dd>
        </div>
      </dl>
      <p className="mt-3 break-all text-[13px] text-cacao-500">Entra en {loginUrl}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" className={buttonClass.outline} onClick={copy}>
          {copied === "ok" ? "Copiado" : "Copiar datos"}
        </button>
        <button type="button" className={buttonClass.primary} onClick={onDone}>
          Ya los anoté
        </button>
      </div>
      {copied === "fail" && (
        <p className="mt-2 text-[13px] text-terracota-700">No se pudo copiar. Mantén presionada la contraseña para seleccionarla.</p>
      )}
    </section>
  );
}
