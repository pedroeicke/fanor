import { REVIEWS, SHOW_REVIEWS } from "@/data/reviews";
import { brand } from "@/lib/config";
import { SectionHeading, Stars } from "@/components/ui/primitives";

export function Reviews() {
  if (!SHOW_REVIEWS) return null;

  return (
    <section className="border-y border-crema-200 bg-crema-100 py-16">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <SectionHeading title="Clientes felices" />

        <div className="mt-10 grid gap-6 lg:grid-cols-[auto_1fr] lg:items-center lg:gap-12">
          <div className="text-center lg:pr-12 lg:text-left">
            <p className="font-display text-6xl font-semibold leading-none">{brand.rating}</p>
            <Stars value={brand.rating} size={20} />
            <p className="mt-2 text-sm text-cacao-500">{brand.reviewCount} reseñas verificadas</p>
          </div>

          <ul className="grid gap-4 sm:grid-cols-3 lg:border-l lg:border-crema-300 lg:pl-12">
            {REVIEWS.slice(0, 3).map((r) => (
              <li key={r.id} className="card p-5">
                <Stars value={r.rating} size={15} />
                <blockquote className="mt-3 text-[15px] leading-relaxed text-cacao-700">
                  {r.text}
                </blockquote>
                <p className="mt-3 text-sm font-medium text-cacao-300">{r.author}</p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
