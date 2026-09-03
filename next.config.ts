import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      // As fotos do catálogo vivem no CDN Sirv, que já redimensiona por
      // querystring — ver cdnImage() em lib/format.ts.
      { protocol: "https", hostname: "tortasfanor.sirv.com" },
      // Imagens carregadas pelo painel vivem no Supabase Storage.
      { protocol: "https", hostname: "*.supabase.co", pathname: "/storage/v1/object/**" },
    ],
    formats: ["image/avif", "image/webp"],
    /* O Next 16 recusa qualquer q= fora desta lista. Declarado explicitamente
       para que sizedImage() não dependa do valor padrão mudar. */
    qualities: [70, 75, 82],
    /**
     * Larguras servidas pelo otimizador. Pedir uma que não esteja aqui devolve
     * 400 — e como a imagem some sem erro no console, o defeito passa
     * despercebido: foi assim que o giro 360° ficou em branco só no celular,
     * onde ele pedia 448.
     *
     * A lista é a padrão do Next mais 448, que é o meio-termo de memória do
     * giro em telas pequenas: 30 quadros a 640px seriam ~49 MB de bitmap
     * vivo, a 448 são ~24 MB. Declarada por extenso para que `ALLOWED_WIDTHS`
     * em lib/format.ts tenha com o que casar.
     */
    deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048, 3840],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384, 448],
  },
  experimental: {
    optimizePackageImports: ["zustand"],
  },
};

export default nextConfig;
