import type { Metadata } from "next";
import Link from "next/link";
import { NewProductForm } from "@/components/admin/NewProductForm";
import { IconChevron } from "@/components/ui/icons";

export const metadata: Metadata = { title: "Nuevo producto" };

export default function NewProductPage() {
  return (
    <>
      <nav aria-label="Migas de pan" className="flex items-center gap-1.5 text-sm text-cacao-300">
        <Link href="/admin/productos" className="hover:text-cacao">Productos</Link>
        <IconChevron className="h-3.5 w-3.5" />
        <span className="text-cacao-500">Nuevo</span>
      </nav>

      <div className="mt-5 max-w-lg">
        <NewProductForm />
      </div>
    </>
  );
}
