import type { MetadataRoute } from "next";
import { OCCASIONS } from "@/lib/catalog";
import { getProducts } from "@/lib/catalog-db";
import { siteUrl } from "@/lib/config";

/**
 * Sitemap gerado do catálogo. O site atual dependia de um plugin para isto e
 * não expunha as páginas de ocasião, que são as que capturam a busca real
 * ("torta de cumpleaños delivery Lima").
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const products = await getProducts();

  const staticPages = [
    { path: "/", priority: 1 },
    { path: "/tortas", priority: 0.9 },
    { path: "/ocasiones", priority: 0.8 },
    { path: "/personalizadas", priority: 0.9 },
    { path: "/nosotros", priority: 0.5 },
    { path: "/delivery", priority: 0.6 },
    { path: "/preguntas-frecuentes", priority: 0.6 },
    { path: "/politicas-de-privacidad", priority: 0.2 },
    { path: "/terminos-y-condiciones", priority: 0.2 },
    { path: "/libro-de-reclamaciones", priority: 0.3 },
  ];

  return [
    ...staticPages.map((p) => ({
      url: `${siteUrl}${p.path}`,
      lastModified: now,
      changeFrequency: "weekly" as const,
      priority: p.priority,
    })),
    ...OCCASIONS.map((o) => ({
      url: `${siteUrl}/ocasiones/${o.slug}`,
      lastModified: now,
      changeFrequency: "weekly" as const,
      priority: 0.8,
    })),
    ...products.map((p) => ({
      url: `${siteUrl}/tortas/${p.slug}`,
      lastModified: now,
      changeFrequency: "weekly" as const,
      priority: 0.7,
    })),
  ];
}
