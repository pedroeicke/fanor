import type { Metadata } from "next";
import { CartView } from "@/components/cart/CartView";

export const metadata: Metadata = {
  title: "Tu pedido",
  robots: { index: false, follow: false },
};

export default function CarritoPage() {
  return <CartView />;
}
