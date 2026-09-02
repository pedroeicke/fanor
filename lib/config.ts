/**
 * Dados de negócio num só lugar. Trocar de praça, horário ou número de
 * WhatsApp é uma edição aqui — nada disso está escrito dentro de componente.
 */

export const brand = {
  name: "Tortas Fanor",
  /** Razão social, para documentos e o Libro de Reclamaciones. */
  legalName: "Delicias Fanor S.A.C.",
  /* Texto do próprio site: título da home. */
  tagline: "Tortas con modelos exclusivos para todos los gustos.",
  since: 2003,
  city: "Arequipa",

  /* Dados reais, lidos de tortasfanor.com e de diretórios locais. */
  whatsapp: "51972063660",
  whatsappDisplay: "972 063 660",
  phone: "054-281118",
  phoneDisplay: "(054) 28 1118",
  email: "administracion@tortasfanor.com",
  instagram: "https://www.instagram.com/tortasfanor/",
  facebook: "https://www.facebook.com/TortasFanor/",

  /* Fraseado igual ao do rodapé do site atual, não normalizado — é assim que
     o cliente já reconhece o horário. */
  hours: [
    { days: "Lunes a sábados", time: "9 am – 8 pm" },
    { days: "Domingos", time: "8 am – 6 pm" },
  ],

  /**
   * Prova social vinda de diretórios que agregam avaliações (cityperu),
   * não do Google diretamente — não consegui ler a ficha do Google.
   * Confirmar na ficha oficial antes de exibir.
   */
  rating: 3.8,
  reviewCount: 50,
} as const;

/**
 * Lojas físicas.
 *
 * Duas unidades confirmadas no perfil atual do Google Maps e em publicação
 * recente da própria Fanor.
 */
export const stores = [
  {
    slug: "peru",
    name: "Tortas Fanor — Calle Perú",
    address: "Calle Perú 105-A",
    district: "Cercado",
    /* Coordenadas do mapa incorporado no site atual. */
    mapQuery: "Tortas Fanor, Calle Perú 105-A, Cercado, Arequipa",
    main: true,
  },
  {
    slug: "eeuu",
    name: "Tortas Fanor — Av. EE.UU.",
    address: "Av. Estados Unidos 303",
    district: "José Luis Bustamante y Rivero",
    mapQuery: "Tortas Fanor, Av. Estados Unidos 303, José Luis Bustamante y Rivero, Arequipa",
    main: false,
  },
] as const;

export const yearsInBusiness = new Date().getFullYear() - brand.since;

/** URL canônica — usada em metadata, Open Graph e JSON-LD. */
export const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ?? "https://tortasfanor.com";

/** Abre o WhatsApp já com contexto, para o atendimento não começar do zero. */
export function whatsappLink(message: string) {
  return `https://wa.me/${brand.whatsapp}?text=${encodeURIComponent(message)}`;
}
