"use client";

import { useState } from "react";
import { Button, FieldLabel, Input, Select, Textarea } from "@/components/ui/primitives";
import { IconCheck } from "@/components/ui/icons";
import { brand } from "@/lib/config";

/**
 * Libro de Reclamaciones virtual.
 *
 * Obrigatório para todo fornecedor no Peru (Código de Protección y Defensa del
 * Consumidor, Ley 29571, e D.S. 101-2022-PCM para o livro virtual). O site
 * atual linkava para uma página, mas o rodapé também apontava para uma URL
 * quebrada — aqui o formulário funciona e devolve um código de registro.
 */
export function ComplaintForm() {
  const [submitting, setSubmitting] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    const data = Object.fromEntries(new FormData(event.currentTarget));

    try {
      const res = await fetch("/api/reclamaciones", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "No pudimos registrar tu reclamo.");
        return;
      }
      setCode(json.code);
    } catch {
      setError("Hubo un problema de conexión. Intenta de nuevo.");
    } finally {
      setSubmitting(false);
    }
  }

  if (code) {
    return (
      <div className="card p-6 text-center">
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-verde-100 text-verde">
          <IconCheck className="h-7 w-7" />
        </span>
        <h2 className="mt-4 text-2xl">Reclamo registrado</h2>
        <p className="mt-2 text-cacao-500">
          {/* Sem prometer cópia por e-mail: a rota grava o reclamo, não envia
              nada. Anotar o código é o que garante o acompanhamento. */}
          Tu código es <strong className="font-mono text-cacao">{code}</strong>. Anótalo para hacer
          seguimiento: te responderemos al correo indicado en un plazo máximo de 15 días hábiles,
          conforme a ley.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="card space-y-5 p-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <FieldLabel>Nombre completo</FieldLabel>
          <Input name="name" required minLength={3} autoComplete="name" />
        </label>
        <label className="block">
          <FieldLabel>Documento de identidad</FieldLabel>
          <Input name="document" required placeholder="DNI o CE" />
        </label>
        <label className="block">
          <FieldLabel>Correo electrónico</FieldLabel>
          <Input name="email" type="email" required autoComplete="email" />
        </label>
        <label className="block">
          <FieldLabel>Celular</FieldLabel>
          <Input name="phone" required inputMode="numeric" autoComplete="tel" />
        </label>
        <div className="sm:col-span-2">
          <label className="block">
            <FieldLabel>Domicilio</FieldLabel>
            <Input name="address" required autoComplete="street-address" />
          </label>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <FieldLabel>Tipo</FieldLabel>
          <Select name="type" required defaultValue="reclamo">
            <option value="reclamo">Reclamo — disconformidad con el producto o servicio</option>
            <option value="queja">Queja — disconformidad con la atención</option>
          </Select>
        </label>
        <label className="block">
          <FieldLabel hint="(opcional)">Código de pedido</FieldLabel>
          <Input name="orderCode" placeholder="FN-XXXXX" />
        </label>
      </div>

      <label className="block">
        <FieldLabel>Detalle</FieldLabel>
        <Textarea name="detail" rows={5} required minLength={20} placeholder="Cuéntanos qué ocurrió." />
      </label>

      <label className="block">
        <FieldLabel>Pedido concreto</FieldLabel>
        <Textarea name="request" rows={3} required minLength={10} placeholder="¿Qué solución esperas?" />
      </label>

      {error && (
        <p role="alert" className="rounded-lg bg-terracota/10 px-3.5 py-3 text-sm font-medium text-terracota-700">
          {error}
        </p>
      )}

      <Button type="submit" size="lg" disabled={submitting} className="w-full sm:w-auto">
        {submitting ? "Enviando..." : "Enviar reclamo"}
      </Button>

      <p className="text-[13px] leading-relaxed text-cacao-300">
        Al enviar aceptas que {brand.name} trate tus datos para atender este reclamo, conforme a
        nuestras políticas de privacidad. La respuesta se emite en un plazo máximo de 15 días
        hábiles.
      </p>
    </form>
  );
}
