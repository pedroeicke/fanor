"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createProduct } from "@/app/admin/actions";
import { Button, FieldLabel, Input, Select } from "@/components/ui/primitives";

/**
 * Criação de produto.
 *
 * Pede o mínimo — nome, tipo e preço — e leva direto para a edição completa.
 * Um formulário longo aqui faria a pessoa desistir no meio e deixar produtos
 * pela metade; nascendo como rascunho, nada disso aparece na loja.
 */
export function NewProductForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [kind, setKind] = useState("simple");
  const [basePrice, setBasePrice] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await createProduct({ name, kind, basePrice });
      if (result.ok) router.push(`/admin/productos/${result.id}`);
      else setError(result.error);
    });
  }

  return (
    <form onSubmit={handleSubmit} className="card space-y-4 p-6">
      <h1 className="text-2xl">Nuevo producto</h1>

      <label className="block">
        <FieldLabel>Nombre</FieldLabel>
        <Input value={name} onChange={(e) => setName(e.target.value)} required autoFocus placeholder="Ej. Torta de Chocolate" />
      </label>

      <label className="block">
        <FieldLabel>Tipo</FieldLabel>
        <Select value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="simple">Simple — un solo precio</option>
          <option value="variable">Variable — precio por tamaño</option>
          <option value="custom">Personalizado — requiere foto del cliente</option>
        </Select>
      </label>

      {kind !== "variable" && (
        <label className="block">
          <FieldLabel hint="en soles">Precio</FieldLabel>
          <Input
            type="number"
            step="0.01"
            min="0"
            value={basePrice}
            onChange={(e) => setBasePrice(e.target.value)}
            placeholder="65.00"
          />
        </label>
      )}

      {error && (
        <p role="alert" className="rounded-lg bg-terracota/10 px-3.5 py-3 text-sm font-medium text-terracota-700">
          {error}
        </p>
      )}

      <p className="text-[13px] leading-relaxed text-cacao-500">
        Se crea como <strong>borrador</strong>: no aparece en la tienda hasta que lo publiques.
        En la pantalla siguiente agregas descripción, fotos, sabores y porciones.
      </p>

      <Button type="submit" size="lg" disabled={pending} className="w-full">
        {pending ? "Creando..." : "Crear y continuar"}
      </Button>
    </form>
  );
}
