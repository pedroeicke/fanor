"use client";

import Image from "next/image";
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  CUSTOM_FLAVORS,
  CUSTOM_LEAD_TIME_HOURS,
  CUSTOM_MESSAGE_LIMIT,
  CUSTOM_SIZES,
  CUSTOM_STYLES,
  MAX_CUSTOM_FLAVORS,
  customPrice,
} from "@/lib/custom-cake";
import type { Product } from "@/lib/catalog";
import { useCart, type DeliveryMethod } from "@/lib/cart";
import { cdnImage, cx, soles } from "@/lib/format";
import { Button } from "@/components/ui/primitives";
import { IconArrowRight, IconCake, IconCheck, IconRuler } from "@/components/ui/icons";
import { DeliveryPicker } from "@/components/product/DeliveryPicker";
import { PhotoUpload } from "@/components/product/PhotoUpload";

type Errors = Partial<Record<"flavors" | "date" | "slot" | "photo", string>>;

export function CakeBuilder({ covers }: { covers: Record<string, Product | null> }) {
  const router = useRouter();
  const addItem = useCart((s) => s.addItem);
  const savedDelivery = useCart((s) => s.delivery);

  const [sizeId, setSizeId] = useState(CUSTOM_SIZES[0].id);
  const [styleId, setStyleId] = useState(CUSTOM_STYLES[0].id);
  const [flavors, setFlavors] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [photo, setPhoto] = useState<{ path: string; url: string; name: string } | null>(null);
  const [method, setMethod] = useState<DeliveryMethod>(savedDelivery.method);
  const [dateISO, setDateISO] = useState<string | null>(savedDelivery.dateISO);
  const [slotId, setSlotId] = useState<string | null>(savedDelivery.slotId);
  const [errors, setErrors] = useState<Errors>({});

  const size = CUSTOM_SIZES.find((s) => s.id === sizeId)!;
  const style = CUSTOM_STYLES.find((s) => s.id === styleId)!;
  const price = customPrice(sizeId, styleId);
  const preview = covers[style.cover] ?? null;

  function toggleFlavor(f: string) {
    setFlavors((current) => {
      if (current.includes(f)) return current.filter((x) => x !== f);
      if (current.length >= MAX_CUSTOM_FLAVORS) return current;
      return [...current, f];
    });
  }

  function handleAdd() {
    const found: Errors = {};
    if (flavors.length === 0) found.flavors = `Elige hasta ${MAX_CUSTOM_FLAVORS} sabores.`;
    if (style.requiresPhoto && !photo) found.photo = "Sube la foto que irá impresa.";
    if (!dateISO) found.date = "Elige el día de entrega.";
    else if (!slotId) found.slot = "Elige una franja horaria.";

    setErrors(found);
    if (Object.keys(found).length) return;

    addItem(
      {
        productId: "custom",
        /* Linha própria, não um produto do catálogo: o servidor a precifica
           pelas regras do configurador. */
        slug: "torta-personalizada",
        name: `Torta personalizada · ${style.label}`,
        image: preview?.images[0].src ?? "",
        unitPrice: price,
        qty: 1,
        sizeSlug: null,
        sizeLabel: size.label,
        sizeServes: size.serves,
        flavors,
        cakeMessage: message.trim(),
        photoUrl: photo?.path ?? null,
        photoName: photo?.name ?? null,
        leadTimeHours: CUSTOM_LEAD_TIME_HOURS,
        custom: { sizeId, styleId },
      },
      { method, dateISO, slotId },
    );

    router.push("/carrito");
  }

  return (
    <div className="grid gap-10 lg:grid-cols-[1fr_1.1fr] lg:gap-14">
      <div className="lg:sticky lg:top-[100px] lg:self-start">
        <div className="relative aspect-square overflow-hidden rounded-[20px] bg-crema-100">
          {photo ? (
            <Image src={photo.url} alt="Tu foto" fill sizes="560px" className="object-cover" />
          ) : (
            preview && (
              <Image
                src={cdnImage(preview.images[0].src, 900)}
                alt={`Referencia de estilo ${style.label}`}
                fill
                priority
                sizes="(min-width:1024px) 560px, 100vw"
                className="object-cover"
              />
            )
          )}
          {message && !photo && (
            <span className="absolute inset-x-6 bottom-8 rounded-xl bg-white/92 px-4 py-3 text-center font-display text-lg text-cacao backdrop-blur-sm">
              {message}
            </span>
          )}
        </div>
        <p className="mt-3 text-center text-[13px] text-cacao-300">
          Imagen de referencia del estilo {style.label.toLowerCase()}. El diseño final se hace a mano
          para tu pedido.
        </p>
      </div>

      <div className="space-y-8">
        <Step n={1} icon={<IconRuler className="h-[18px] w-[18px]" />} title="Elige el tamaño">
          <div className="grid gap-2 sm:grid-cols-2">
            {CUSTOM_SIZES.map((s) => (
              <Option
                key={s.id}
                active={s.id === sizeId}
                onClick={() => setSizeId(s.id)}
                title={s.label}
                subtitle={s.serves}
                trailing={soles(s.price)}
              />
            ))}
          </div>
        </Step>

        <Step n={2} icon={<IconCake className="h-[18px] w-[18px]" />} title="Elige el estilo">
          <div className="grid gap-2 sm:grid-cols-2">
            {CUSTOM_STYLES.map((s) => (
              <Option
                key={s.id}
                active={s.id === styleId}
                onClick={() => {
                  setStyleId(s.id);
                  if (!s.requiresPhoto) setPhoto(null);
                }}
                title={s.label}
                subtitle={s.detail}
                trailing={s.surcharge ? `+${soles(s.surcharge)}` : "incluido"}
              />
            ))}
          </div>

          {style.requiresPhoto && (
            <div className="mt-4">
              <PhotoUpload
                photoUrl={photo?.url ?? null}
                photoName={photo?.name ?? null}
                onChange={setPhoto}
                error={errors.photo}
              />
            </div>
          )}
        </Step>

        <Step n={3} icon={<IconCake className="h-[18px] w-[18px]" />} title="Elige los sabores">
          <p className="mb-3 text-[13px] text-cacao-300">
            Hasta {MAX_CUSTOM_FLAVORS} · {flavors.length} elegidos
          </p>
          <div className="flex flex-wrap gap-2">
            {CUSTOM_FLAVORS.map((f) => {
              const active = flavors.includes(f);
              const full = !active && flavors.length >= MAX_CUSTOM_FLAVORS;
              return (
                <button
                  key={f}
                  type="button"
                  aria-pressed={active}
                  disabled={full}
                  onClick={() => toggleFlavor(f)}
                  className={cx(
                    "h-10 rounded-full border px-4 text-sm font-medium transition-colors",
                    active
                      ? "border-cacao bg-cacao text-crema"
                      : "border-crema-300 bg-white text-cacao-700 hover:border-cacao/30",
                    full && "opacity-40",
                  )}
                >
                  {f}
                </button>
              );
            })}
          </div>
          {errors.flavors && <p className="mt-2 text-sm font-medium text-terracota">{errors.flavors}</p>}
        </Step>

        <Step n={4} icon={<IconCake className="h-[18px] w-[18px]" />} title="Texto y fecha">
          <label htmlFor="custom-message" className="mb-1.5 block text-sm font-medium text-cacao-700">
            Texto sobre la torta <span className="text-cacao-300">(opcional)</span>
          </label>
          <div className="relative">
            <input
              id="custom-message"
              value={message}
              maxLength={CUSTOM_MESSAGE_LIMIT}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Feliz cumpleaños, Lucía"
              className="h-12 w-full rounded-xl border border-crema-300 bg-white px-4 pr-16 text-[15px] placeholder:text-cacao-300 focus:border-dorado-600"
            />
            <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[12px] tabular-nums text-cacao-300">
              {message.length}/{CUSTOM_MESSAGE_LIMIT}
            </span>
          </div>

          <div className="mt-5">
            <DeliveryPicker
              leadTimeHours={CUSTOM_LEAD_TIME_HOURS}
              method={method}
              dateISO={dateISO}
              slotId={slotId}
              onMethodChange={setMethod}
              onDateChange={(iso) => {
                setDateISO(iso);
                setSlotId(null);
              }}
              onSlotChange={setSlotId}
              error={errors.date ?? errors.slot}
            />
          </div>
        </Step>

        {/* Preço fechado e visível o tempo todo: nada de "te cotizamos". */}
        <div className="sticky bottom-4 flex flex-wrap items-center gap-4 rounded-2xl border border-crema-300 bg-white/95 p-4 shadow-lift backdrop-blur-sm">
          <div>
            <p className="text-[13px] text-cacao-300">
              {size.serves} · {style.label}
            </p>
            <p className="font-display text-3xl font-semibold leading-tight">{soles(price)}</p>
          </div>
          <Button size="lg" onClick={handleAdd} className="ml-auto">
            Añadir al carrito
            <IconArrowRight className="h-[18px] w-[18px]" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function Step({
  n,
  icon,
  title,
  children,
}: {
  n: number;
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="flex items-center gap-3 text-xl">
        <span className="grid h-9 w-9 place-items-center rounded-full bg-dorado-100 text-dorado-600">
          {icon}
        </span>
        <span className="text-cacao-300">{n}.</span> {title}
      </h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Option({
  active,
  onClick,
  title,
  subtitle,
  trailing,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  subtitle: string;
  trailing: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cx(
        "flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors",
        active ? "border-dorado-600 bg-dorado-100" : "border-crema-300 bg-white hover:border-cacao/30",
      )}
    >
      <span
        className={cx(
          "grid h-5 w-5 shrink-0 place-items-center rounded-full border-2",
          active ? "border-dorado-600 bg-dorado-600 text-white" : "border-crema-300",
        )}
      >
        {active && <IconCheck className="h-3 w-3" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-medium">{title}</span>
        <span className="mt-0.5 block text-[13px] leading-snug text-cacao-500">{subtitle}</span>
      </span>
      <span className="shrink-0 text-sm font-semibold text-terracota">{trailing}</span>
    </button>
  );
}
