import type { Metadata } from "next";
import { CheckoutView } from "@/components/checkout/CheckoutView";
import { isTransferEnabled } from "@/lib/payment-config";

export const metadata: Metadata = {
  title: "Finaliza tu pedido",
  robots: { index: false, follow: false },
};

export default function CheckoutPage() {
  return <CheckoutView transferEnabled={isTransferEnabled()} />;
}
