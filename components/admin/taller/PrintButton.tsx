"use client";

/**
 * Abre o diálogo de impressão do navegador. Fica escondido no papel pela
 * classe `no-print` da própria folha de etiquetas.
 */
export function PrintButton({ label = "Imprimir" }: { label?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex h-12 items-center justify-center rounded-full bg-dorado px-6 font-semibold text-cacao transition-colors hover:bg-dorado-600"
    >
      {label}
    </button>
  );
}
