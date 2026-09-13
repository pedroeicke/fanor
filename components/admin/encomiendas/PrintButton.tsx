"use client";

/** Abre o diálogo de impressão do navegador (no celular, também "Guardar como PDF"). */
export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="h-12 rounded-full bg-dorado px-6 text-[15px] font-semibold text-cacao hover:bg-dorado-600"
    >
      Imprimir
    </button>
  );
}
