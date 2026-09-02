import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/config";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      /* Carrinho, checkout e confirmação não têm nada a indexar e podem vazar
         detalhes de pedido nos resultados de busca. O painel exige sessão,
         mas não há motivo para anunciá-lo. */
      disallow: ["/carrito", "/checkout", "/pedido/", "/admin", "/api/"],
    },
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
