"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addProductFlavor,
  addProductSize,
  deleteProductFlavor,
  deleteProductSize,
  setProductCategories,
} from "@/app/admin/actions";
import { Button, FieldLabel, Input } from "@/components/ui/primitives";
import { IconCheck, IconClose, IconPlus } from "@/components/ui/icons";
import { cx, soles } from "@/lib/format";

type Size = { id: string; label: string; serves: string | null; price: string };
type Flavor = { id: string; label: string };
type Category = { id: string; slug: string; name: string; kind: string };

/**
 * Tamanhos, sabores e categorias do produto.
 *
 * Fecha o critério de aceite: até aqui a Joseka podia editar o preço de um
 * tamanho existente, mas não criar um novo nem incluir um sabor — o que exige
 * programador é exatamente o que o painel deveria evitar.
 */
export function ProductTaxonomy({
  productId,
  sizes,
  flavors,
  categories,
  selectedCategoryIds,
}: {
  productId: string;
  sizes: Size[];
  flavors: Flavor[];
  categories: Category[];
  selectedCategoryIds: string[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, message: string) =>
    startTransition(async () => {
      setError(null);
      setSaved(null);
      const result = await fn();
      if (result.ok) {
        setSaved(message);
        router.refresh();
      } else {
        setError(result.error ?? "No se pudo guardar.");
      }
    });

  const [newSize, setNewSize] = useState({ label: "", serves: "", price: "" });
  const [newFlavor, setNewFlavor] = useState("");
  const [selected, setSelected] = useState<string[]>(selectedCategoryIds);

  const occasions = categories.filter((c) => c.kind === "ocasion");
  const types = categories.filter((c) => c.kind === "tipo");
  const categoriesChanged =
    selected.slice().sort().join() !== selectedCategoryIds.slice().sort().join();

  return (
    <section className="card space-y-8 p-5 sm:p-6">
      {(error || saved) && (
        <p
          role="status"
          className={cx(
            "flex items-center gap-2 rounded-lg px-3.5 py-2.5 text-[13px] font-medium",
            error ? "bg-terracota/10 text-terracota-700" : "bg-verde-100 text-verde",
          )}
        >
          {!error && <IconCheck className="h-4 w-4" />}
          {error ?? saved}
        </p>
      )}

      {/* -------------------------------------------------- tamanhos */}
      <div>
        <h2 className="text-xl">Tamaños</h2>
        <p className="mt-1 text-[13px] text-cacao-500">
          Agregar el primer tamaño convierte el producto en variable: el precio pasa a salir de
          cada tamaño en vez del precio único.
        </p>

        {sizes.length > 0 && (
          <ul className="mt-3 divide-y divide-crema-200">
            {sizes.map((size) => (
              <li key={size.id} className="flex items-center gap-3 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-medium">{size.label}</span>
                  <span className="text-[13px] text-cacao-500">{size.serves ?? "sin porciones"}</span>
                </span>
                <span className="text-sm font-medium">{soles(Number(size.price))}</span>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => run(() => deleteProductSize(productId, size.id), "Tamaño eliminado")}
                  className="grid h-8 w-8 place-items-center rounded-full border border-crema-300 text-cacao-300 hover:border-terracota hover:text-terracota"
                  aria-label={`Eliminar ${size.label}`}
                >
                  <IconClose className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-3 grid gap-3 rounded-xl border border-crema-200 bg-crema-100 p-3.5 sm:grid-cols-[1fr_1fr_auto_auto]">
          <label className="block">
            <FieldLabel>Nombre</FieldLabel>
            <Input
              className="h-10"
              placeholder="26 cm"
              value={newSize.label}
              onChange={(e) => setNewSize({ ...newSize, label: e.target.value })}
            />
          </label>
          <label className="block">
            <FieldLabel>Porciones</FieldLabel>
            <Input
              className="h-10"
              placeholder="18–20 porciones"
              value={newSize.serves}
              onChange={(e) => setNewSize({ ...newSize, serves: e.target.value })}
            />
          </label>
          <label className="block">
            <FieldLabel>Precio</FieldLabel>
            <Input
              type="number"
              step="0.5"
              min="0"
              className="h-10 w-24"
              value={newSize.price}
              onChange={(e) => setNewSize({ ...newSize, price: e.target.value })}
            />
          </label>
          <div className="flex items-end">
            <Button
              type="button"
              size="sm"
              disabled={pending || !newSize.label.trim() || newSize.price === ""}
              onClick={() =>
                run(async () => {
                  const r = await addProductSize(productId, newSize);
                  if (r.ok) setNewSize({ label: "", serves: "", price: "" });
                  return r;
                }, "Tamaño agregado")
              }
            >
              <IconPlus className="h-4 w-4" />
              Agregar
            </Button>
          </div>
        </div>
      </div>

      {/* -------------------------------------------------- sabores */}
      <div>
        <h2 className="text-xl">Sabores</h2>
        <p className="mt-1 text-[13px] text-cacao-500">
          La cantidad que el cliente debe elegir se define arriba, en mínimo y máximo de sabores.
        </p>

        <ul className="mt-3 flex flex-wrap gap-2">
          {flavors.map((flavor) => (
            <li
              key={flavor.id}
              className="flex items-center gap-1.5 rounded-full border border-crema-300 bg-white py-1 pl-3.5 pr-1.5 text-[13px]"
            >
              {flavor.label}
              <button
                type="button"
                disabled={pending}
                onClick={() => run(() => deleteProductFlavor(productId, flavor.id), "Sabor eliminado")}
                className="grid h-5 w-5 place-items-center rounded-full text-cacao-300 hover:bg-terracota/10 hover:text-terracota"
                aria-label={`Quitar ${flavor.label}`}
              >
                <IconClose className="h-3 w-3" />
              </button>
            </li>
          ))}
          {flavors.length === 0 && (
            <li className="text-[13px] text-cacao-300">Sin sabores para elegir.</li>
          )}
        </ul>

        <div className="mt-3 flex gap-2">
          <Input
            className="h-10 max-w-xs"
            placeholder="Chocolate"
            value={newFlavor}
            onChange={(e) => setNewFlavor(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              if (!newFlavor.trim()) return;
              run(async () => {
                const r = await addProductFlavor(productId, newFlavor);
                if (r.ok) setNewFlavor("");
                return r;
              }, "Sabor agregado");
            }}
          />
          <Button
            type="button"
            size="sm"
            disabled={pending || !newFlavor.trim()}
            onClick={() =>
              run(async () => {
                const r = await addProductFlavor(productId, newFlavor);
                if (r.ok) setNewFlavor("");
                return r;
              }, "Sabor agregado")
            }
          >
            <IconPlus className="h-4 w-4" />
            Agregar
          </Button>
        </div>
      </div>

      {/* -------------------------------------------------- categorias */}
      <div>
        <h2 className="text-xl">Ocasiones y tipo</h2>
        <p className="mt-1 text-[13px] text-cacao-500">
          La ocasión define en qué página de la tienda aparece. El tipo es clasificación interna y
          solo se usa como filtro secundario.
        </p>

        <p className="mt-4 font-sans text-xs font-bold uppercase tracking-[0.14em] text-cacao-300">
          Ocasiones
        </p>
        <CategoryChips list={occasions} selected={selected} onToggle={setSelected} />

        <p className="mt-4 font-sans text-xs font-bold uppercase tracking-[0.14em] text-cacao-300">
          Tipo
        </p>
        <CategoryChips list={types} selected={selected} onToggle={setSelected} />

        {categoriesChanged && (
          <Button
            type="button"
            size="sm"
            className="mt-4"
            disabled={pending}
            onClick={() => run(() => setProductCategories(productId, selected), "Categorías guardadas")}
          >
            Guardar categorías
          </Button>
        )}
      </div>
    </section>
  );
}

function CategoryChips({
  list,
  selected,
  onToggle,
}: {
  list: Category[];
  selected: string[];
  onToggle: (next: string[]) => void;
}) {
  return (
    <ul className="mt-2 flex flex-wrap gap-2">
      {list.map((category) => {
        const on = selected.includes(category.id);
        return (
          <li key={category.id}>
            <button
              type="button"
              aria-pressed={on}
              onClick={() =>
                onToggle(
                  on ? selected.filter((id) => id !== category.id) : [...selected, category.id],
                )
              }
              className={cx(
                "h-9 rounded-full border px-4 text-[13px] font-medium transition-colors",
                on
                  ? "border-dorado bg-dorado text-cacao"
                  : "border-crema-300 bg-white text-cacao-700 hover:border-cacao/35",
              )}
            >
              {category.name}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
