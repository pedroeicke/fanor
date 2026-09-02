"use client";

import Image from "next/image";
import Link from "next/link";
import { useState, useTransition } from "react";
import { updateProduct, type ProductPatch } from "@/app/admin/actions";
import { Button, FieldLabel, Input, Select, Textarea } from "@/components/ui/primitives";
import { IconCheck } from "@/components/ui/icons";
import { cdnImage, soles } from "@/lib/format";

type Size = { id: string; slug: string; label: string; serves: string | null; price: string };
type Flavor = { id: string; label: string };
type ImageRow = { id: string; url: string; kind: string; sort_order: number };

type Product = {
  id: string;
  slug: string;
  sku: string | null;
  name: string;
  short_description: string | null;
  status: string;
  kind: string;
  base_price: string | null;
  lead_time_hours: number;
  min_flavors: number;
  max_flavors: number;
  default_serves: string | null;
  max_servings: number | null;
  accepts_photo: boolean;
  featured: boolean;
  product_sizes: Size[];
  product_flavors: Flavor[];
  product_images: ImageRow[];
};

export function ProductForm({ product }: { product: Product }) {
  const sizes = [...product.product_sizes].sort((a, b) => a.label.localeCompare(b.label));
  const gallery = product.product_images
    .filter((i) => i.kind === "gallery")
    .sort((a, b) => a.sort_order - b.sort_order);
  const spinCount = product.product_images.filter((i) => i.kind === "spin360").length;

  const [form, setForm] = useState<ProductPatch>({
    name: product.name,
    sku: product.sku ?? "",
    shortDescription: product.short_description ?? "",
    status: product.status,
    basePrice: product.base_price ?? "",
    leadTimeHours: String(product.lead_time_hours),
    minFlavors: String(product.min_flavors),
    maxFlavors: String(product.max_flavors),
    defaultServes: product.default_serves ?? "",
    maxServings: product.max_servings ? String(product.max_servings) : "",
    acceptsPhoto: product.accepts_photo,
    featured: product.featured,
    sizes: sizes.map((s) => ({ id: s.id, price: s.price })),
  });

  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const set = <K extends keyof ProductPatch>(key: K, value: ProductPatch[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setSaved(false);
  };

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await updateProduct(product.id, form);
      if (result.ok) setSaved(true);
      else setError(result.error);
    });
  }

  const exactFlavors = form.minFlavors === form.maxFlavors && Number(form.maxFlavors) > 0;

  return (
    <form onSubmit={handleSubmit} className="grid gap-6 lg:grid-cols-[1fr_320px] lg:items-start">
      <div className="space-y-6">
        <section className="card p-5 sm:p-6">
          <h2 className="text-xl">Datos básicos</h2>
          <div className="mt-4 space-y-4">
            <label className="block">
              <FieldLabel>Nombre</FieldLabel>
              <Input value={form.name} onChange={(e) => set("name", e.target.value)} required />
            </label>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <FieldLabel hint="(opcional)">SKU</FieldLabel>
                <Input value={form.sku} onChange={(e) => set("sku", e.target.value)} />
              </label>
              <label className="block">
                <FieldLabel>Estado</FieldLabel>
                <Select value={form.status} onChange={(e) => set("status", e.target.value)}>
                  <option value="active">Publicado</option>
                  <option value="draft">Borrador</option>
                  <option value="unavailable">Agotado</option>
                </Select>
              </label>
            </div>

            <label className="block">
              <FieldLabel>Descripción</FieldLabel>
              <Textarea
                rows={3}
                value={form.shortDescription}
                onChange={(e) => set("shortDescription", e.target.value)}
              />
            </label>
          </div>
        </section>

        <section className="card p-5 sm:p-6">
          <h2 className="text-xl">Precio y tamaños</h2>

          {sizes.length === 0 ? (
            <label className="mt-4 block sm:max-w-[220px]">
              <FieldLabel hint="en soles">Precio</FieldLabel>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={form.basePrice}
                onChange={(e) => set("basePrice", e.target.value)}
              />
            </label>
          ) : (
            <ul className="mt-4 space-y-2">
              {sizes.map((size, i) => (
                <li key={size.id} className="flex items-center gap-4 rounded-xl border border-crema-200 p-3">
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] font-medium">{size.label}</span>
                    <span className="text-[13px] text-cacao-500">{size.serves}</span>
                  </span>
                  <label className="flex items-center gap-2">
                    <span className="text-sm text-cacao-300">S/</span>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      className="h-10 w-28"
                      value={form.sizes[i]?.price ?? ""}
                      onChange={(e) => {
                        const next = [...form.sizes];
                        next[i] = { id: size.id, price: e.target.value };
                        set("sizes", next);
                      }}
                      aria-label={`Precio de ${size.label}`}
                    />
                  </label>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card p-5 sm:p-6">
          <h2 className="text-xl">Sabores y porciones</h2>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="block">
              <FieldLabel>Mínimo de sabores</FieldLabel>
              <Input
                type="number"
                min="0"
                value={form.minFlavors}
                onChange={(e) => set("minFlavors", e.target.value)}
              />
            </label>
            <label className="block">
              <FieldLabel>Máximo de sabores</FieldLabel>
              <Input
                type="number"
                min="0"
                value={form.maxFlavors}
                onChange={(e) => set("maxFlavors", e.target.value)}
              />
            </label>
          </div>

          <p className="mt-2 text-[13px] text-cacao-500">
            {Number(form.maxFlavors) === 0
              ? "Este producto no ofrece elección de sabores."
              : exactFlavors
                ? `El cliente deberá elegir exactamente ${form.maxFlavors} entre los ${product.product_flavors.length} sabores cargados.`
                : `El cliente podrá elegir entre ${form.minFlavors} y ${form.maxFlavors} sabores.`}
          </p>

          {product.product_flavors.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-2">
              {product.product_flavors.map((f) => (
                <li
                  key={f.id}
                  className="rounded-full border border-crema-300 bg-crema-100 px-3 py-1.5 text-[13px]"
                >
                  {f.label}
                </li>
              ))}
            </ul>
          )}

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <label className="block">
              <FieldLabel hint='ej. "10–12 porciones"'>Porciones</FieldLabel>
              <Input
                value={form.defaultServes}
                onChange={(e) => set("defaultServes", e.target.value)}
              />
            </label>
            <label className="block">
              <FieldLabel hint="usado en el filtro de invitados">Porciones máximas</FieldLabel>
              <Input
                type="number"
                min="1"
                value={form.maxServings}
                onChange={(e) => set("maxServings", e.target.value)}
              />
            </label>
          </div>
        </section>

        <section className="card p-5 sm:p-6">
          <h2 className="text-xl">Producción</h2>
          <label className="mt-4 block sm:max-w-[260px]">
            <FieldLabel hint="horas de anticipación">Tiempo de preparación</FieldLabel>
            <Input
              type="number"
              min="0"
              step="1"
              value={form.leadTimeHours}
              onChange={(e) => set("leadTimeHours", e.target.value)}
            />
          </label>
          <p className="mt-2 text-[13px] text-cacao-500">
            El calendario del cliente solo ofrecerá fechas que respeten este plazo.
          </p>

          <div className="mt-5 space-y-3">
            <Checkbox
              checked={form.acceptsPhoto}
              onChange={(v) => set("acceptsPhoto", v)}
              label="Requiere foto del cliente"
              hint="El pedido no se cierra sin la imagen subida."
            />
            <Checkbox
              checked={form.featured}
              onChange={(v) => set("featured", v)}
              label="Destacado"
              hint="Aparece primero en el catálogo."
            />
          </div>
        </section>
      </div>

      <aside className="card p-5 lg:sticky lg:top-6">
        {gallery[0] && (
          <div className="relative aspect-square overflow-hidden rounded-xl bg-crema-100">
            <Image
              src={cdnImage(gallery[0].url, 400)}
              alt=""
              fill
              sizes="288px"
              className="object-cover"
            />
          </div>
        )}

        <p className="mt-3 text-[13px] text-cacao-500">
          {gallery.length} {gallery.length === 1 ? "foto" : "fotos"}
          {spinCount > 0 && ` · ${spinCount} cuadros 360°`}
        </p>

        <Link
          href={`/tortas/${product.slug}`}
          target="_blank"
          className="mt-4 block text-sm text-terracota underline underline-offset-4"
        >
          Ver en la tienda
        </Link>

        {error && (
          <p role="alert" className="mt-4 rounded-lg bg-terracota/10 px-3.5 py-3 text-sm font-medium text-terracota-700">
            {error}
          </p>
        )}

        {saved && (
          <p className="mt-4 flex items-center gap-2 rounded-lg bg-verde-100 px-3.5 py-3 text-sm font-medium text-verde">
            <IconCheck className="h-4 w-4" />
            Cambios guardados
          </p>
        )}

        <Button type="submit" size="lg" disabled={pending} className="mt-4 w-full">
          {pending ? "Guardando..." : "Guardar cambios"}
        </Button>

        <p className="mt-3 text-center text-[12px] text-cacao-300">
          {sizes.length > 0
            ? `Precio desde ${soles(Math.min(...form.sizes.map((s) => Number(s.price) || 0)))}`
            : form.basePrice
              ? soles(Number(form.basePrice))
              : "Sin precio definido"}
        </p>
      </aside>
    </form>
  );
}

function Checkbox({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-5 w-5 shrink-0 accent-[#e2a900]"
      />
      <span>
        <span className="block text-[15px] font-medium">{label}</span>
        <span className="block text-[13px] text-cacao-500">{hint}</span>
      </span>
    </label>
  );
}
