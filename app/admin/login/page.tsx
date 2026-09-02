import type { Metadata } from "next";
import { LoginForm } from "@/components/admin/LoginForm";
import { Logo } from "@/components/layout/Logo";

export const metadata: Metadata = {
  title: "Entrar al panel",
  robots: { index: false, follow: false },
};

export default function AdminLoginPage() {
  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center px-4 py-16">
      <div className="text-center">
        <Logo className="mx-auto h-14" />
        <h1 className="mt-8 text-3xl">Panel de administración</h1>
        <p className="mt-2 text-cacao-500">Ingresa con tu correo y contraseña.</p>
      </div>

      <div className="mt-8">
        <LoginForm />
      </div>
    </div>
  );
}
