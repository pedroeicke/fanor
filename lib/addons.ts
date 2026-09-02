/**
 * Complementos oferecidos no carrinho.
 *
 * Ticket médio: quem já decidiu a torta aceita velas e tarjeta sem fricção,
 * e hoje esses itens só existem se o cliente lembrar de pedir no WhatsApp.
 */

export type Addon = {
  id: string;
  name: string;
  detail: string;
  price: number;
  /** Aceita um texto do cliente (a tarjeta leva a mensagem escrita à mão). */
  acceptsMessage?: boolean;
  art: "velas" | "tarjeta" | "vela-numero";
};

export const ADDONS: Addon[] = [
  {
    id: "velas-clasicas",
    name: "Velas clásicas",
    detail: "Set de 12 unidades",
    price: 6,
    art: "velas",
  },
  {
    id: "vela-numero",
    name: "Vela de número",
    detail: "Dorada, 12 cm de alto",
    price: 8,
    art: "vela-numero",
  },
  {
    id: "tarjeta-saludo",
    name: "Tarjeta de saludo",
    detail: "Escribe tu mensaje y lo incluimos por ti",
    price: 4,
    acceptsMessage: true,
    art: "tarjeta",
  },
];

export function getAddon(id: string) {
  return ADDONS.find((a) => a.id === id) ?? null;
}
