"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";
import { Button, FieldLabel, Input } from "@/components/ui/primitives";
import { IconLock } from "@/components/ui/icons";

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") ?? "/admin";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    return (
      <p className="card p-5 text-[15px] text-cacao-700">
        El panel necesita conexión con la base de datos. Falta configurar{" "}
        <code className="font-mono text-[13px]">NEXT_PUBLIC_SUPABASE_URL</code>.
      </p>
    );
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);

    try {
      const supabase = createBrowserClient(url!, key!);
      const { error: authError } = await supabase.auth.signInWithPassword({ email, password });

      if (authError) {
        /* Mensagem genérica de propósito: dizer "correo no registrado" revela
           quais e-mails existem, e isso é reconhecimento para quem tenta. */
        setError("Correo o contraseña incorrectos.");
        return;
      }

      /* refresh() força o servidor a reler a sessão do cookie antes de navegar. */
      router.refresh();
      router.replace(next);
    } catch {
      setError("No pudimos conectar. Revisa tu conexión e intenta de nuevo.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="card space-y-4 p-6">
      <label className="block">
        <FieldLabel>Correo</FieldLabel>
        <Input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="username"
          required
          autoFocus
        />
      </label>

      <label className="block">
        <FieldLabel>Contraseña</FieldLabel>
        <Input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />
      </label>

      {error && (
        <p role="alert" className="rounded-lg bg-terracota/10 px-3.5 py-3 text-sm font-medium text-terracota-700">
          {error}
        </p>
      )}

      <Button type="submit" size="lg" disabled={busy} className="w-full">
        <IconLock className="h-[18px] w-[18px]" />
        {busy ? "Entrando..." : "Entrar"}
      </Button>
    </form>
  );
}
