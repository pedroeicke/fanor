"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Product } from "@/lib/catalog";
import { useCart, type DeliveryMethod } from "@/lib/cart";
import { formatDateShort } from "@/lib/delivery";
import { cx, soles } from "@/lib/format";
import { track } from "@/lib/analytics";
import { Button } from "@/components/ui/primitives";
import { IconCart, IconCheck, IconMinus, IconPlus } from "@/components/ui/icons";
import { DeliveryPicker } from "./DeliveryPicker";
import { PhotoUpload } from "./PhotoUpload";

const MESSAGE_LIMIT = 80;

type Errors = Partial<Record<"size" | "flavors" | "date" | "slot" | "photo", string>>;

export function ProductPurchase({ product }: { product: Product }) {
  const router = useRouter();
  const addItem = useCart((s) => s.addItem);
  const closeDrawer = useCart((s) => s.closeDrawer);
  const savedDelivery = useCart((s) => s.delivery);

  const [sizeSlug, setSizeSlug] = useState(product.sizes[0]?.slug ?? null);
  const [flavors, setFlavors] = useState<string[]>([]);
  const [qty, setQty] = useState(1);
  const [cakeMessage, setCakeMessage] = useState("");
  const [photo, setPhoto] = useState<{ path: string; url: string; name: string } | null>(null);
  const [method, setMethod] = useState<DeliveryMethod>(savedDelivery.method);
  const [dateISO, setDateISO] = useState<string | null>(savedDelivery.dateISO);
  const [slotId, setSlotId] = useState<string | null>(savedDelivery.slotId);
  const [errors, setErrors] = useState<Errors>({});

  const size = product.sizes.find((s) => s.slug === sizeSlug) ?? null;
  const unitPrice = size?.price ?? product.price;
  const errorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    track("view_item", {
      currency: "PEN",
      value: unitPrice,
      items: [{ item_id: product.slug, item_name: product.name, price: unitPrice }],
    });
    // Um evento por produto, não por mudança de tamanho.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product.slug]);

  /* Qual tamanho as pessoas escolhem é o dado que orienta produção e estoque. */
  function chooseSize(slug: string) {
    setSizeSlug(slug);
    const chosen = product.sizes.find((s) => s.slug === slug);
    if (!chosen) return;
    track("select_item", {
      currency: "PEN",
      value: chosen.price,
      items: [
        {
          item_id: product.slug,
          item_name: product.name,
          item_variant: chosen.label,
          price: chosen.price,
        },
      ],
    });
  }

  function toggleFlavor(slug: string) {
    setFlavors((current) => {
      if (current.includes(slug)) return current.filter((f) => f !== slug);
      if (current.length >= product.maxFlavors) return current;
      return [...current, slug];
    });
  }

  function validate(): Errors {
    const next: Errors = {};
    if (product.sizes.length && !size) next.size = "Elige un tamaño.";

    /* "Exactamente 3 entre 9" é min = max. A mensagem muda conforme a regra
       para não pedir "hasta 3" quando na verdade são 3 obrigatórios. */
    if (product.minFlavors > 0 && flavors.length < product.minFlavors) {
      next.flavors =
        product.minFlavors === product.maxFlavors
          ? `Elige exactamente ${product.minFlavors} ${product.minFlavors === 1 ? "sabor" : "sabores"}. Te faltan ${product.minFlavors - flavors.length}.`
          : `Elige al menos ${product.minFlavors} ${product.minFlavors === 1 ? "sabor" : "sabores"}.`;
    }
    if (!dateISO) next.date = "Elige el día de entrega.";
    else if (!slotId) next.slot = "Elige una franja horaria.";
    if (product.acceptsPhoto && !photo) next.photo = "Sube la foto que irá impresa.";
    return next;
  }

  function handleAdd() {
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length) {
      errorRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    addItem(
      {
        productId: product.id,
        slug: product.slug,
        name: product.name,
        image: product.images[0].src,
        unitPrice,
        qty,
        sizeSlug: size?.slug ?? null,
        sizeLabel: size?.label ?? null,
        sizeServes: size?.serves ?? product.defaultServes,
        flavors: flavors.map((f) => product.flavors.find((x) => x.slug === f)?.label ?? f),
        cakeMessage: cakeMessage.trim(),
        photoUrl: photo?.path ?? null,
        photoName: photo?.name ?? null,
        leadTimeHours: product.leadTimeHours,
      },
      { method, dateISO, slotId },
    );
  }

  function handleBuyNow() {
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length) {
      errorRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    handleAdd();
    /* addItem abre a gaveta; a gaveta vive no layout e seguiria aberta por
       cima do checkout, tapando o formulário na página que mais importa. */
    closeDrawer();
    router.push("/checkout");
  }

  return (
    <div className="space-y-6" ref={errorRef}>
      <p className="font-display text-[2rem] font-semibold leading-none">
        {soles(unitPrice)}
        {size && <span className="ml-2 font-sans text-sm font-normal text-cacao-500">{size.serves}</span>}
      </p>

      <p className="leading-relaxed text-cacao-500">{product.description}</p>

      {product.sizes.length > 0 && (
        <fieldset>
          <legend className="mb-2.5 text-[15px] font-semibold">Elige el tamaño</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {product.sizes.map((s) => {
              const active = s.slug === sizeSlug;
              return (
                <button
                  key={s.slug}
                  type="button"
                  aria-pressed={active}
                  onClick={() => chooseSize(s.slug)}
                  className={cx(
                    "relative flex items-center justify-between rounded-xl border px-4 py-3 text-left transition-colors",
                    active
                      ? "border-dorado-600 bg-dorado-100"
                      : "border-crema-300 bg-white hover:border-cacao/30",
                  )}
                >
                  <span>
                    <span className="block text-[15px] font-medium">{s.label}</span>
                    {/* Porções, não centímetros: é a pergunta que a pessoa tem. */}
                    <span className="mt-0.5 block text-[13px] text-cacao-500">{s.serves}</span>
                  </span>
                  <span className="flex items-center gap-2.5">
                    <span className="text-[15px] font-semibold text-terracota">{soles(s.price)}</span>
                    {active && (
                      <span className="grid h-5 w-5 place-items-center rounded-full bg-dorado-600 text-white">
                        <IconCheck className="h-3.5 w-3.5" />
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
          {errors.size && <p className="mt-2 text-sm font-medium text-terracota">{errors.size}</p>}
        </fieldset>
      )}

      {product.maxFlavors > 0 && (
        <fieldset>
          <legend className="mb-2.5 flex flex-wrap items-baseline gap-x-2 text-[15px] font-semibold">
            Elige los sabores
            <span className="text-[13px] font-normal text-cacao-300">
              {product.minFlavors === product.maxFlavors
                ? `exactamente ${product.maxFlavors} de ${product.flavors.length}`
                : `hasta ${product.maxFlavors}`}{" "}
              · {flavors.length} {flavors.length === 1 ? "elegido" : "elegidos"}
            </span>
          </legend>
          <div className="flex flex-wrap gap-2">
            {product.flavors.map((f) => {
              const active = flavors.includes(f.slug);
              const full = !active && flavors.length >= product.maxFlavors;
              return (
                <button
                  key={f.slug}
                  type="button"
                  aria-pressed={active}
                  disabled={full}
                  onClick={() => toggleFlavor(f.slug)}
                  className={cx(
                    "h-10 rounded-full border px-4 text-sm font-medium transition-colors",
                    active
                      ? "border-cacao bg-cacao text-crema"
                      : "border-crema-300 bg-white text-cacao-700 hover:border-cacao/30",
                    full && "opacity-40",
                  )}
                >
                  {f.label}
                </button>
              );
            })}
          </div>
          {errors.flavors && <p className="mt-2 text-sm font-medium text-terracota">{errors.flavors}</p>}
        </fieldset>
      )}

      {product.acceptsPhoto && (
        <PhotoUpload
          photoUrl={photo?.url ?? null}
          photoName={photo?.name ?? null}
          onChange={setPhoto}
          error={errors.photo}
        />
      )}

      <DeliveryPicker
        leadTimeHours={product.leadTimeHours}
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

      {/* Mensagem sobre a torta: incluída, escrita aqui, sem custo e sem chat. */}
      <div>
        <label htmlFor="cake-message" className="mb-2 flex flex-wrap items-baseline gap-x-2 text-[15px] font-semibold">
          Mensaje sobre la torta
          <span className="text-[13px] font-normal text-cacao-300">opcional · sin costo</span>
        </label>
        <div className="relative">
          <textarea
            id="cake-message"
            rows={2}
            maxLength={MESSAGE_LIMIT}
            value={cakeMessage}
            onChange={(e) => setCakeMessage(e.target.value)}
            placeholder="Ej. Feliz cumpleaños, Ana"
            className="w-full rounded-xl border border-crema-300 bg-white px-4 py-3 pb-7 text-[15px] leading-relaxed placeholder:text-cacao-300 focus:border-dorado-600"
          />
          <span className="pointer-events-none absolute bottom-2.5 right-4 text-[12px] tabular-nums text-cacao-300">
            {cakeMessage.length}/{MESSAGE_LIMIT}
          </span>
        </div>
      </div>

      <div className="flex gap-3">
        <div className="flex h-14 shrink-0 items-center rounded-full border border-crema-300 bg-white">
          <button
            type="button"
            onClick={() => setQty((q) => Math.max(1, q - 1))}
            disabled={qty <= 1}
            className="grid h-full w-12 place-items-center rounded-l-full text-cacao-700 disabled:opacity-30"
            aria-label="Disminuir cantidad"
          >
            <IconMinus className="h-4 w-4" />
          </button>
          <span className="w-8 text-center text-[15px] font-semibold tabular-nums" aria-live="polite">
            {qty}
          </span>
          <button
            type="button"
            onClick={() => setQty((q) => Math.min(20, q + 1))}
            className="grid h-full w-12 place-items-center rounded-r-full text-cacao-700"
            aria-label="Aumentar cantidad"
          >
            <IconPlus className="h-4 w-4" />
          </button>
        </div>

        <Button size="lg" onClick={handleAdd} className="flex-1">
          <IconCart className="h-5 w-5" />
          Añadir al carrito
        </Button>
      </div>

      <Button variant="dark" size="lg" onClick={handleBuyNow} className="w-full">
        Comprar ahora — {soles(unitPrice * qty)}
      </Button>

      {dateISO && slotId && (
        <p className="flex items-center justify-center gap-2 rounded-xl bg-verde-100 px-4 py-3 text-sm font-medium text-verde">
          <IconCheck className="h-[18px] w-[18px]" />
          {method === "pickup" ? "Recojo" : "Entrega"} el {formatDateShort(dateISO)}
        </p>
      )}
    </div>
  );
}
