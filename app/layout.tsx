import type { Metadata, Viewport } from "next";
import { Fraunces, Plus_Jakarta_Sans } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import { Header, TopBar } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { CartDrawer } from "@/components/cart/CartDrawer";
import { WhatsappFab } from "@/components/layout/WhatsappFab";
import { CookieConsent } from "@/components/layout/CookieConsent";
import { brand, siteUrl } from "@/lib/config";
import { getDeliveryConfig } from "@/lib/delivery-db";
import { DeliveryConfigProvider } from "@/components/delivery/DeliveryConfigProvider";
import { SHOW_REVIEWS } from "@/data/reviews";

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  display: "swap",
  axes: ["SOFT", "WONK", "opsz"],
});

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-jakarta",
  display: "swap",
});

/**
 * O site antigo não tinha meta description nem Open Graph. Como a marca vende
 * por WhatsApp e Instagram, cada link colado aparecia sem imagem e sem texto —
 * custo de aquisição desperdiçado em cada compartilhamento.
 */
export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: `${brand.name} — Tortas artesanales con delivery en ${brand.city}`,
    template: `%s — ${brand.name}`,
  },
  description:
    `Tortas artesanales hechas frescas, con mensaje personalizado y entrega programada en ${brand.city}. Elige fecha y horario al comprar. Pago seguro con tarjeta, Yape o Plin.`,
  keywords: ["tortas", "delivery de tortas", brand.city, "torta de cumpleaños", "pastelería", "tortas personalizadas"],
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    locale: "es_PE",
    siteName: brand.name,
    url: siteUrl,
    title: `${brand.name} — Tortas artesanales con delivery en ${brand.city}`,
    description: `Elige tu torta, la fecha y el horario. Nosotros la horneamos fresca y la llevamos a tu puerta.`,
    /* A imagem vem de app/opengraph-image.tsx, gerada no build. */
  },
  twitter: { card: "summary_large_image" },
  /* Sem `robots` explícito: indexar é o padrão, e declará-lo aqui fazia o 404
     sair com dois <meta name="robots"> contraditórios — o `noindex` que o Next
     injeta e o `index, follow` herdado do layout. */
};

export const viewport: Viewport = {
  themeColor: "#f7c118",
  colorScheme: "light",
};

/** Dados da empresa para o painel de conhecimento e a busca local. */
const orgSchema = {
  "@context": "https://schema.org",
  "@type": "Bakery",
  name: brand.name,
  url: siteUrl,
  telephone: `+${brand.whatsapp}`,
  email: brand.email,
  priceRange: "S/39 – S/280",
  address: { "@type": "PostalAddress", addressLocality: brand.city, addressCountry: "PE" },
  sameAs: [brand.instagram, brand.facebook],
  /* aggregateRating só entra quando houver avaliações reais. Publicar nota
     inventada em dados estruturados é pior que na página: o Google exibe como
     verdade na busca. */
  ...(SHOW_REVIEWS && {
    aggregateRating: {
      "@type": "AggregateRating",
      ratingValue: brand.rating,
      reviewCount: brand.reviewCount,
    },
  }),
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const gtmId = process.env.NEXT_PUBLIC_GTM_ID;
  /* Lido no servidor e injetado no contexto: chega no primeiro HTML, sem o
     frete aparecer depois de um piscar. */
  const deliveryConfig = await getDeliveryConfig();

  return (
    <html lang="es-PE" className={`${fraunces.variable} ${jakarta.variable}`}>
      <body className="flex min-h-screen flex-col">
        {/* Medição: o dataLayer existe sempre, mesmo sem container publicado,
            para que nenhum evento se perca quando o GTM for conectado. */}
        <Script id="datalayer-init" strategy="beforeInteractive">
          {`window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
// Consent Mode: nega por padrão. O banner libera depois, se a pessoa aceitar.
gtag('consent','default',{analytics_storage:'denied',ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied'});`}
        </Script>
        {gtmId && (
          <Script id="gtm" strategy="afterInteractive">
            {`(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});
var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';
j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
})(window,document,'script','dataLayer','${gtmId}');`}
          </Script>
        )}

        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(orgSchema) }}
        />

        <a
          href="#contenido"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-cacao focus:px-5 focus:py-3 focus:text-crema"
        >
          Saltar al contenido
        </a>

        <DeliveryConfigProvider config={deliveryConfig}>
          <TopBar />
          <Header />
          <CookieConsent />
          <main id="contenido" className="flex-1">
            {children}
          </main>
          <Footer config={deliveryConfig} />

          <CartDrawer />
          <WhatsappFab />
        </DeliveryConfigProvider>
      </body>
    </html>
  );
}
