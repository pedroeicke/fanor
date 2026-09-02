import Link from "next/link";
import { ButtonLink } from "@/components/ui/primitives";
import { OCCASIONS } from "@/lib/catalog";

/**
 * O rodapé do site atual aponta para "Sobre el delivery" e cai num 404 sem
 * saída — justamente a página que responde a dúvida mais comum antes da
 * compra. Aqui o 404 devolve caminhos, não um beco.
 */
export default function NotFound() {
  return (
    <div className="mx-auto max-w-xl px-4 py-24 text-center">
      <p className="font-display text-7xl font-semibold text-dorado">404</p>
      <h1 className="mt-4 text-3xl">Esta página se nos quemó en el horno</h1>
      <p className="mt-3 text-cacao-500">
        No encontramos lo que buscabas, pero todo el catálogo sigue en pie.
      </p>

      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <ButtonLink href="/tortas" size="lg">
          Ver todas las tortas
        </ButtonLink>
        <ButtonLink href="/" size="lg" variant="outline">
          Ir al inicio
        </ButtonLink>
      </div>

      <ul className="mt-10 flex flex-wrap justify-center gap-2">
        {OCCASIONS.map((o) => (
          <li key={o.slug}>
            <Link
              href={`/ocasiones/${o.slug}`}
              className="inline-flex h-9 items-center rounded-full border border-crema-300 bg-white px-4 text-sm text-cacao-700 hover:border-cacao/35"
            >
              {o.name}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
