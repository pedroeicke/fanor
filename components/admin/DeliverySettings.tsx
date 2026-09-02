"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addBlackout,
  createDeliveryStore,
  deleteDeliveryZone,
  removeBlackout,
  saveDeliverySlot,
  saveDeliveryZone,
  saveDistanceDeliverySettings,
  saveFreeDeliveryThreshold,
  saveStoreCoordinates,
} from "@/app/admin/actions";
import { Button, FieldLabel, Input, Select } from "@/components/ui/primitives";
import { IconCheck, IconClose, IconPlus } from "@/components/ui/icons";
import { formatDateLong } from "@/lib/delivery";
import { cx, soles } from "@/lib/format";

type Zone = { slug: string; name: string; coverage: string; fee: string; active: boolean };
type Slot = {
  slug: string;
  label: string;
  start_hour: number;
  weekdays: number[];
  capacity: number | null;
  active: boolean;
};
type Blackout = { date: string; reason: string | null; slotSlug: string | null; slotLabel: string | null };
type Store = { id: string; name: string; address: string; lat: string; lng: string; active: boolean };

const DAY_NAMES = ["D", "L", "M", "M", "J", "V", "S"];
const DAY_FULL = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

/**
 * Configuração de entrega no painel.
 *
 * Até aqui, distritos, tarifas, capacidade e feriados eram listas fixas no
 * código: mudar o frete de um distrito exigia programador. Estas tabelas
 * existiam no banco desde a primeira migração e ninguém as lia — esta tela é
 * o que as coloca em uso.
 */
export function DeliverySettings({
  zones,
  slots,
  blackouts,
  freeFrom,
  distanceSettings,
  stores,
}: {
  zones: Zone[];
  slots: Slot[];
  blackouts: Blackout[];
  freeFrom: string;
  distanceSettings: { baseFee: string; feePerKm: string; maxDistanceKm: string };
  stores: Store[];
}) {
  const router = useRouter();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, success: string) =>
    startTransition(async () => {
      setMessage(null);
      const result = await fn();
      setMessage(
        result.ok
          ? { ok: true, text: success }
          : { ok: false, text: result.error ?? "No se pudo guardar." },
      );
      if (result.ok) router.refresh();
    });

  return (
    <div className="space-y-6">
      {message && (
        <p
          role="status"
          className={cx(
            "flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-medium",
            message.ok ? "bg-verde-100 text-verde" : "bg-terracota/10 text-terracota-700",
          )}
        >
          {message.ok && <IconCheck className="h-4 w-4" />}
          {message.text}
        </p>
      )}

      <FreeThreshold value={freeFrom} pending={pending} onSave={run} />
      <DistanceSettings values={distanceSettings} stores={stores} pending={pending} onRun={run} />
      <Zones zones={zones} pending={pending} onRun={run} />
      <Slots slots={slots} pending={pending} onRun={run} />
      <Blackouts blackouts={blackouts} slots={slots} pending={pending} onRun={run} />
    </div>
  );
}

type Runner = (
  fn: () => Promise<{ ok: boolean; error?: string }>,
  success: string,
) => void;

/* -------------------------------------------------------------------------- */

function DistanceSettings({
  values,
  stores,
  pending,
  onRun,
}: {
  values: { baseFee: string; feePerKm: string; maxDistanceKm: string };
  stores: Store[];
  pending: boolean;
  onRun: Runner;
}) {
  const [settings, setSettings] = useState(values);
  const [coordinates, setCoordinates] = useState<Record<string, { lat: string; lng: string }>>(
    Object.fromEntries(stores.map((store) => [store.id, { lat: store.lat, lng: store.lng }])),
  );
  const [newStore, setNewStore] = useState({ name: "", address: "", district: "", lat: "", lng: "" });

  return (
    <section className="card p-5 sm:p-6">
      <h2 className="text-xl">Delivery por distancia</h2>
      <p className="mt-1 text-[13px] leading-relaxed text-cacao-500">
        El sitio elige la tienda activa más cercana, suma la tarifa base al costo por kilómetro y
        bloquea direcciones que superan la cobertura máxima. Se activa cuando hay tiendas con
        coordenadas y una cobertura mayor que cero; el cliente marca el punto en el mapa gratuito.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {(
          [
            ["baseFee", "Tarifa base", "S/"],
            ["feePerKm", "Costo por km", "S/"],
            ["maxDistanceKm", "Cobertura máxima", "km"],
          ] as const
        ).map(([key, label, hint]) => (
          <label key={key} className="block">
            <FieldLabel hint={hint}>{label}</FieldLabel>
            <Input
              type="number"
              min="0"
              step="0.1"
              value={settings[key]}
              onChange={(event) => setSettings({ ...settings, [key]: event.target.value })}
            />
          </label>
        ))}
      </div>
      <Button
        type="button"
        className="mt-3"
        disabled={pending}
        onClick={() =>
          onRun(() => saveDistanceDeliverySettings(settings), "Fórmula por distancia actualizada")
        }
      >
        Guardar fórmula
      </Button>

      <h3 className="mt-6 font-display text-lg">Coordenadas de tiendas</h3>
      {stores.length ? (
        <ul className="mt-3 space-y-3">
          {stores.map((store) => {
            const coords = coordinates[store.id] ?? { lat: "", lng: "" };
            return (
              <li key={store.id} className="rounded-xl border border-crema-200 p-3.5">
                <p className="font-medium">{store.name}</p>
                <p className="text-[13px] text-cacao-500">{store.address}</p>
                <div className="mt-3 flex flex-wrap items-end gap-2">
                  <label>
                    <FieldLabel>Latitud</FieldLabel>
                    <Input
                      className="w-44"
                      inputMode="decimal"
                      value={coords.lat}
                      onChange={(event) =>
                        setCoordinates({ ...coordinates, [store.id]: { ...coords, lat: event.target.value } })
                      }
                    />
                  </label>
                  <label>
                    <FieldLabel>Longitud</FieldLabel>
                    <Input
                      className="w-44"
                      inputMode="decimal"
                      value={coords.lng}
                      onChange={(event) =>
                        setCoordinates({ ...coordinates, [store.id]: { ...coords, lng: event.target.value } })
                      }
                    />
                  </label>
                  <Button
                    type="button"
                    size="sm"
                    disabled={pending || !coords.lat || !coords.lng}
                    onClick={() =>
                      onRun(
                        () => saveStoreCoordinates({ id: store.id, ...coords }),
                        `${store.name} actualizada`,
                      )
                    }
                  >
                    Guardar
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-3 text-[13px] text-terracota">
          No hay tiendas en la base de datos. Registra las tiendas confirmadas abajo.
        </p>
      )}

      <div className="mt-5 rounded-xl border border-dashed border-crema-300 bg-crema-100 p-4">
        <h4 className="font-medium">Agregar tienda</h4>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {(
            [
              ["name", "Nombre"],
              ["address", "Dirección"],
              ["district", "Distrito"],
              ["lat", "Latitud"],
              ["lng", "Longitud"],
            ] as const
          ).map(([key, label]) => (
            <label key={key}>
              <FieldLabel>{label}</FieldLabel>
              <Input
                value={newStore[key]}
                inputMode={key === "lat" || key === "lng" ? "decimal" : undefined}
                onChange={(event) => setNewStore({ ...newStore, [key]: event.target.value })}
              />
            </label>
          ))}
        </div>
        <Button
          type="button"
          className="mt-3"
          disabled={pending || !newStore.name || !newStore.address || !newStore.lat || !newStore.lng}
          onClick={() => onRun(() => createDeliveryStore(newStore), "Tienda agregada")}
        >
          Agregar tienda
        </Button>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */

function FreeThreshold({
  value,
  pending,
  onSave,
}: {
  value: string;
  pending: boolean;
  onSave: Runner;
}) {
  const [amount, setAmount] = useState(value);

  return (
    <section className="card p-5 sm:p-6">
      <h2 className="text-xl">Delivery de cortesía</h2>
      <p className="mt-1 text-[13px] text-cacao-500">
        A partir de este monto el envío no se cobra. Aparece en el carrito como barra de progreso.
      </p>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="block">
          <FieldLabel hint="en soles">Monto mínimo</FieldLabel>
          <Input
            type="number"
            step="1"
            min="0"
            className="w-36"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
        <Button
          type="button"
          disabled={pending || amount === value}
          onClick={() => onSave(() => saveFreeDeliveryThreshold(amount), "Monto actualizado")}
        >
          Guardar
        </Button>
        <span className="pb-3 text-[13px] text-cacao-300">actual: {soles(Number(value))}</span>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */

function Zones({ zones, pending, onRun }: { zones: Zone[]; pending: boolean; onRun: Runner }) {
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState(false);
  const [newZone, setNewZone] = useState({ name: "", coverage: "principal", fee: "12" });

  return (
    <section className="card p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl">Distritos y costos</h2>
        <Button type="button" size="sm" variant="outline" onClick={() => setAdding((v) => !v)}>
          <IconPlus className="h-4 w-4" />
          Agregar distrito
        </Button>
      </div>

      {adding && (
        <div className="mt-4 grid gap-3 rounded-xl border border-crema-300 bg-crema-100 p-4 sm:grid-cols-[1fr_auto_auto_auto]">
          <label className="block">
            <FieldLabel>Distrito</FieldLabel>
            <Input value={newZone.name} onChange={(e) => setNewZone({ ...newZone, name: e.target.value })} />
          </label>
          <label className="block">
            <FieldLabel>Cobertura</FieldLabel>
            <Select
              className="w-40"
              value={newZone.coverage}
              onChange={(e) => setNewZone({ ...newZone, coverage: e.target.value })}
            >
              <option value="principal">Principal</option>
              <option value="extendida">Extendida</option>
            </Select>
          </label>
          <label className="block">
            <FieldLabel>Costo</FieldLabel>
            <Input
              type="number"
              step="0.5"
              min="0"
              className="w-24"
              value={newZone.fee}
              onChange={(e) => setNewZone({ ...newZone, fee: e.target.value })}
            />
          </label>
          <div className="flex items-end">
            <Button
              type="button"
              disabled={pending || !newZone.name.trim()}
              onClick={() =>
                onRun(
                  () => saveDeliveryZone({ slug: "", ...newZone, active: true }),
                  "Distrito agregado",
                )
              }
            >
              Agregar
            </Button>
          </div>
        </div>
      )}

      <ul className="mt-4 divide-y divide-crema-200">
        {zones.map((zone) => {
          const fee = draft[zone.slug] ?? zone.fee;
          const changed = fee !== zone.fee;
          return (
            <li key={zone.slug} className="flex flex-wrap items-center gap-3 py-2.5">
              <span className={cx("min-w-0 flex-1 text-[15px]", !zone.active && "text-cacao-300 line-through")}>
                {zone.name}
              </span>

              <span className="rounded-full bg-crema-100 px-2.5 py-1 text-[11px] font-medium text-cacao-500">
                {zone.coverage}
              </span>

              <label className="flex items-center gap-1.5">
                <span className="text-[13px] text-cacao-300">S/</span>
                <Input
                  type="number"
                  step="0.5"
                  min="0"
                  className="h-9 w-24"
                  value={fee}
                  onChange={(e) => setDraft({ ...draft, [zone.slug]: e.target.value })}
                  aria-label={`Costo de ${zone.name}`}
                />
              </label>

              {changed && (
                <Button
                  type="button"
                  size="sm"
                  disabled={pending}
                  onClick={() =>
                    onRun(
                      () =>
                        saveDeliveryZone({
                          slug: zone.slug,
                          name: zone.name,
                          coverage: zone.coverage,
                          fee,
                          active: zone.active,
                        }),
                      `${zone.name} actualizado`,
                    )
                  }
                >
                  Guardar
                </Button>
              )}

              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  onRun(
                    () =>
                      zone.active
                        ? deleteDeliveryZone(zone.slug)
                        : saveDeliveryZone({ ...zone, fee, active: true }),
                    zone.active ? `${zone.name} desactivado` : `${zone.name} reactivado`,
                  )
                }
                className="rounded-full border border-crema-300 px-3 py-1.5 text-[12px] font-medium text-cacao-700 hover:border-cacao/35"
              >
                {zone.active ? "Desactivar" : "Reactivar"}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/* -------------------------------------------------------------------------- */

function Slots({ slots, pending, onRun }: { slots: Slot[]; pending: boolean; onRun: Runner }) {
  const [draft, setDraft] = useState<Record<string, { capacity: string; weekdays: number[] }>>({});

  return (
    <section className="card p-5 sm:p-6">
      <h2 className="text-xl">Franjas horarias</h2>
      <p className="mt-1 text-[13px] leading-relaxed text-cacao-500">
        La capacidad limita cuántos pedidos acepta cada franja por día. Al llenarse, deja de
        ofrecerse en el calendario — así la cocina no recibe más de lo que produce. Vacío = sin
        límite.
      </p>

      <ul className="mt-4 space-y-3">
        {slots.map((slot) => {
          const state = draft[slot.slug] ?? {
            capacity: slot.capacity === null ? "" : String(slot.capacity),
            weekdays: slot.weekdays,
          };
          const changed =
            state.capacity !== (slot.capacity === null ? "" : String(slot.capacity)) ||
            state.weekdays.join() !== slot.weekdays.join();

          return (
            <li key={slot.slug} className="rounded-xl border border-crema-200 p-3.5">
              <div className="flex flex-wrap items-center gap-3">
                <span className="min-w-0 flex-1 text-[15px] font-medium">{slot.label}</span>

                <label className="flex items-center gap-2">
                  <span className="text-[13px] text-cacao-500">Capacidad</span>
                  <Input
                    type="number"
                    min="1"
                    placeholder="sin límite"
                    className="h-9 w-28"
                    value={state.capacity}
                    onChange={(e) => setDraft({ ...draft, [slot.slug]: { ...state, capacity: e.target.value } })}
                    aria-label={`Capacidad de ${slot.label}`}
                  />
                </label>
              </div>

              <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                <span className="mr-1 text-[13px] text-cacao-500">Días:</span>
                {DAY_NAMES.map((name, day) => {
                  const on = state.weekdays.includes(day);
                  return (
                    <button
                      key={day}
                      type="button"
                      aria-pressed={on}
                      aria-label={DAY_FULL[day]}
                      title={DAY_FULL[day]}
                      onClick={() =>
                        setDraft({
                          ...draft,
                          [slot.slug]: {
                            ...state,
                            weekdays: on
                              ? state.weekdays.filter((d) => d !== day)
                              : [...state.weekdays, day].sort(),
                          },
                        })
                      }
                      className={cx(
                        "h-8 w-8 rounded-full border text-[12px] font-semibold transition-colors",
                        on
                          ? "border-dorado bg-dorado text-cacao"
                          : "border-crema-300 bg-white text-cacao-300",
                      )}
                    >
                      {name}
                    </button>
                  );
                })}

                {changed && (
                  <Button
                    type="button"
                    size="sm"
                    className="ml-auto"
                    disabled={pending}
                    onClick={() =>
                      onRun(
                        () =>
                          saveDeliverySlot({
                            slug: slot.slug,
                            label: slot.label,
                            capacity: state.capacity,
                            weekdays: state.weekdays,
                            active: slot.active,
                          }),
                        "Franja actualizada",
                      )
                    }
                  >
                    Guardar
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/* -------------------------------------------------------------------------- */

function Blackouts({
  blackouts,
  slots,
  pending,
  onRun,
}: {
  blackouts: Blackout[];
  slots: Slot[];
  pending: boolean;
  onRun: Runner;
}) {
  const [date, setDate] = useState("");
  const [slot, setSlot] = useState("");
  const [reason, setReason] = useState("");

  return (
    <section className="card p-5 sm:p-6">
      <h2 className="text-xl">Días sin entrega</h2>
      <p className="mt-1 text-[13px] leading-relaxed text-cacao-500">
        Feriados y días cerrados. Las fechas bloqueadas desaparecen del calendario del cliente en
        vez de aparecer deshabilitadas.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-[auto_1fr_1fr_auto]">
        <label className="block">
          <FieldLabel>Fecha</FieldLabel>
          <Input type="date" className="w-44" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="block">
          <FieldLabel>Franja</FieldLabel>
          <Select value={slot} onChange={(e) => setSlot(e.target.value)}>
            <option value="">Todo el día</option>
            {slots.map((s) => (
              <option key={s.slug} value={s.slug}>
                {s.label}
              </option>
            ))}
          </Select>
        </label>
        <label className="block">
          <FieldLabel hint="(opcional)">Motivo</FieldLabel>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Feriado" />
        </label>
        <div className="flex items-end">
          <Button
            type="button"
            disabled={pending || !date}
            onClick={() =>
              onRun(async () => {
                const result = await addBlackout(date, slot || null, reason);
                if (result.ok) {
                  setDate("");
                  setReason("");
                }
                return result.ok && result.existingOrders
                  ? { ok: false, error: `Bloqueado, pero ya hay ${result.existingOrders} pedido(s) para esa fecha. Revísalos.` }
                  : result;
              }, "Fecha bloqueada")
            }
          >
            Bloquear
          </Button>
        </div>
      </div>

      {blackouts.length > 0 ? (
        <ul className="mt-4 divide-y divide-crema-200">
          {blackouts.map((b) => (
            <li key={`${b.date}-${b.slotSlug ?? "all"}`} className="flex items-center gap-3 py-2.5 text-[15px]">
              <span className="flex-1">
                {formatDateLong(b.date)}
                <span className="ml-2 text-[13px] text-cacao-500">
                  {b.slotLabel ?? "todo el día"}
                  {b.reason && ` · ${b.reason}`}
                </span>
              </span>
              <button
                type="button"
                disabled={pending}
                onClick={() => onRun(() => removeBlackout(b.date, b.slotSlug), "Bloqueo eliminado")}
                className="grid h-8 w-8 place-items-center rounded-full border border-crema-300 text-cacao-300 hover:border-terracota hover:text-terracota"
                aria-label="Quitar bloqueo"
              >
                <IconClose className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-[13px] text-cacao-300">Ninguna fecha bloqueada.</p>
      )}
    </section>
  );
}
