import type { Metadata } from "next";
import { Prose } from "@/components/ui/Prose";
import { brand } from "@/lib/config";

export const metadata: Metadata = {
  title: "Políticas de privacidad",
  description: `Cómo ${brand.name} recolecta, usa y protege tus datos personales.`,
  alternates: { canonical: "/politicas-de-privacidad" },
};

/**
 * ⚠️ Texto base, não é parecer jurídico. Revisar com advogado antes de
 * publicar: a Ley 29733 de Protección de Datos Personales exige registro do
 * banco de dados na Autoridad Nacional e um aviso com conteúdo mínimo.
 */
export default function PrivacyPage() {
  return (
    <Prose
      title="Políticas de privacidad"
      intro={`Esta política explica qué datos recogemos en ${brand.name}, para qué los usamos y qué derechos tienes sobre ellos.`}
      updatedAt="27 de agosto de 2026"
    >
      <h2>Qué datos recogemos</h2>
      <ul>
        <li><strong>De contacto:</strong> nombre, celular y correo electrónico.</li>
        <li><strong>De entrega:</strong> distrito, dirección y referencia.</li>
        <li><strong>Del pedido:</strong> productos, fecha elegida, mensaje sobre la torta y las imágenes que subes para personalizar.</li>
        <li><strong>De navegación:</strong> páginas vistas y acciones en la tienda, mediante cookies analíticas.</li>
      </ul>
      <p>
        No recibimos ni almacenamos los datos de tu tarjeta. El cobro lo procesa nuestro
        proveedor de pagos, que los recibe cifrados directamente desde tu navegador.
      </p>

      <h2>Para qué los usamos</h2>
      <ul>
        <li>Preparar y entregar tu pedido en la fecha y dirección que elegiste.</li>
        <li>Comunicarnos contigo por WhatsApp o correo sobre el estado del pedido.</li>
        <li>Atender consultas, cambios y reclamos.</li>
        <li>Entender cómo se usa la tienda para mejorarla.</li>
      </ul>
      <p>
        Solo te enviamos promociones si nos das tu consentimiento explícito, y puedes retirarlo
        cuando quieras.
      </p>

      <h2>Con quién los compartimos</h2>
      <p>
        Únicamente con quienes necesitan el dato para que el pedido funcione: el procesador de
        pagos y el personal de reparto. No vendemos ni cedemos tus datos a terceros con fines
        publicitarios.
      </p>

      <h2>Cuánto tiempo los guardamos</h2>
      <p>
        Los datos del pedido se conservan mientras dure la relación comercial y el plazo legal
        aplicable. Las imágenes que subes para personalizar se eliminan a los 90 días de la entrega.
      </p>

      <h2>Tus derechos</h2>
      <p>
        Conforme a la Ley 29733, puedes acceder, rectificar, cancelar u oponerte al tratamiento de
        tus datos escribiendo a <a href={`mailto:${brand.email}`}>{brand.email}</a>. Respondemos
        dentro de los plazos que fija la norma.
      </p>

      <h2>Cookies</h2>
      <p>
        Usamos cookies propias para recordar tu carrito y cookies analíticas para medir el uso de la
        tienda. Puedes bloquearlas desde tu navegador; el carrito dejará de conservarse entre
        visitas.
      </p>
    </Prose>
  );
}
