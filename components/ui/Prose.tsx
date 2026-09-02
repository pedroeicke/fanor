import type { ReactNode } from "react";

/**
 * Moldura das páginas de texto (legais, ajuda). Tailwind v4 aqui sem o plugin
 * de tipografia: são poucos estilos e não vale 30 KB de CSS extra.
 */
export function Prose({
  title,
  intro,
  updatedAt,
  children,
}: {
  title: string;
  intro?: string;
  updatedAt?: string;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <h1 className="text-4xl sm:text-[2.75rem]">{title}</h1>
      {intro && <p className="mt-4 text-lg leading-relaxed text-cacao-500">{intro}</p>}
      {updatedAt && <p className="mt-3 text-sm text-cacao-300">Última actualización: {updatedAt}</p>}

      <div
        className="mt-10 space-y-5 leading-relaxed text-cacao-700
          [&_a]:text-terracota [&_a]:underline [&_a]:underline-offset-4
          [&_h2]:mt-10 [&_h2]:text-2xl
          [&_h3]:mt-8 [&_h3]:text-xl
          [&_li]:pl-1
          [&_ol]:list-decimal [&_ol]:space-y-2 [&_ol]:pl-5
          [&_strong]:font-semibold [&_strong]:text-cacao
          [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5"
      >
        {children}
      </div>
    </div>
  );
}
