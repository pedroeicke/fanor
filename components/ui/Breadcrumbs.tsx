import Link from "next/link";
import { IconChevron } from "./icons";
import { siteUrl } from "@/lib/config";

export type Crumb = { label: string; href?: string };

/**
 * Migalhas visuais + BreadcrumbList em JSON-LD.
 *
 * As duas juntas de propósito: sem os dados estruturados, o Google mostra a
 * URL crua no resultado em vez do caminho legível — e a migalha visual, que
 * já existia, não conta para isso.
 */
export function Breadcrumbs({ items }: { items: Crumb[] }) {
  const schema = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((crumb, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: crumb.label,
      ...(crumb.href && { item: `${siteUrl}${crumb.href}` }),
    })),
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }} />
      <nav aria-label="Migas de pan" className="flex flex-wrap items-center gap-1.5 text-sm text-cacao-300">
        {items.map((crumb, i) => (
          <span key={crumb.label} className="flex items-center gap-1.5">
            {i > 0 && <IconChevron className="h-3.5 w-3.5" aria-hidden="true" />}
            {crumb.href ? (
              <Link href={crumb.href} className="hover:text-cacao">
                {crumb.label}
              </Link>
            ) : (
              <span className="text-cacao-500">{crumb.label}</span>
            )}
          </span>
        ))}
      </nav>
    </>
  );
}
