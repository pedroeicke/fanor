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
  },
  experimental: {
    optimizePackageImports: ["zustand"],
  },
};

export default nextConfig;
