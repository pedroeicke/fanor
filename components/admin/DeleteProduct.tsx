"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteProduct } from "@/app/admin/actions";
import { Button } from "@/components/ui/primitives";
import { IconTrash } from "@/components/ui/icons";

/**
 * Exclusão de produto.
 *
 * Exige digitar o nome. Parece exagero até a primeira vez que alguém apaga a
 * torta errada — e aqui não há desfazer: os pedidos antigos guardam nome e
 * preço copiados, mas o produto em si não volta.
 */
export function DeleteProduct({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const confirmed = typed.trim().toLowerCase() === name.trim().toLowerCase();

  function handleDelete() {
    setError(null);
    startTransition(async () => {
      const result = await deleteProduct(id);
      if (result.ok) router.push("/admin/productos");
      else setError(result.error);
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-4 flex items-center gap-2 text-[13px] text-cacao-300 transition-colors hover:text-terracota"
      >
        <IconTrash className="h-4 w-4" />
        Eliminar producto
      </button>
    );
  }

  return (
    <div className="mt-4 rounded-xl border border-terracota/30 bg-terracota/5 p-4">
      <p className="text-sm font-medium text-terracota-700">Esto no se puede deshacer.</p>
      <p className="mt-1 text-[13px] leading-relaxed text-cacao-700">
        Los pedidos ya realizados conservan el nombre y el precio, pero el producto y sus
        imágenes se borran. Si solo quieres sacarlo de la tienda, usa el estado{" "}
        <strong>Agotado</strong> o <strong>Borrador</strong>.
      </p>

      <label className="mt-3 block">
        <span className="mb-1.5 block text-[13px] text-cacao-700">
          Escribe <strong>{name}</strong> para confirmar:
        </span>
        <input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          className="h-11 w-full rounded-xl border border-crema-300 bg-white px-4 text-[15px] focus:border-terracota"
          autoFocus
        />
      </label>

      {error && (
        <p role="alert" className="mt-2 text-[13px] font-medium text-terracota-700">
          {error}
        </p>
      )}

      <div className="mt-3 flex gap-2">
        <Button
          type="button"
          variant="dark"
          size="sm"
          disabled={!confirmed || pending}
          onClick={handleDelete}
        >
          {pending ? "Eliminando..." : "Eliminar definitivamente"}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}
