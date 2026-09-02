import type { Metadata } from "next";

export const metadata: Metadata = {
  title: { default: "Panel", template: "%s — Panel Fanor" },
  robots: { index: false, follow: false },
};

/** O painel depende da sessão: nunca pode ser servido de cache estático. */
export const dynamic = "force-dynamic";

/**
 * Camada externa sem proteção — a tela de login mora aqui.
 * O grupo (panel) é que carrega a verificação de sessão.
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
