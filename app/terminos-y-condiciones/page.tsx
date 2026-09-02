import type { Metadata } from "next";
import { Prose } from "@/components/ui/Prose";
import { brand } from "@/lib/config";
import { getDeliveryConfig } from "@/lib/delivery-db";
import { soles } from "@/lib/format";

export const metadata: Metadata = {
  title: "Términos y condiciones",
  description: `Condiciones de compra, entrega, cambios y devoluciones en ${brand.name}.`,
  alternates: { canonical: "/terminos-y-condiciones" },
};

/** ⚠️ Texto base, não é parecer jurídico. Revisar com advogado antes de publicar. */
export const revalidate = 300;

export default async function TermsPage() {
  const { freeFrom: FREE_DELIVERY_FROM } = await getDeliveryConfig();
  return (
    <Prose
      title="Términos y condiciones"
      intro={`Estas condiciones rigen las compras realizadas en la tienda en línea de ${brand.name}.`}
      updatedAt="27 de agosto de 2026"
    >
      <h2>1. El pedido</h2>
      <p>
        El pedido queda registrado cuando completas el checkout y recibes un código de la forma
        <strong> FN-XXXXX</strong>. Si pagas con tarjeta, se confirma con la aprobación del cobro. Si
        eliges transferencia, se confirma cuando recibimos y validamos tu comprobante.
      </p>

      <h2>2. Precios</h2>
      <p>
        Los precios están en soles e incluyen IGV. El costo de delivery se muestra en el checkout
        antes del pago, según el distrito, y es de cortesía en pedidos desde {soles(FREE_DELIVERY_FROM)}.
      </p>

      <h2>3. Anticipación y producción</h2>
      <p>
        Necesitamos 24 horas para las tortas del catálogo y 48 para Altezas, FotoTortas y
        personalizadas. El calendario solo ofrece fechas que podemos cumplir. Una vez iniciada la
        producción, el pedido no admite cambios de diseño.
      </p>

      <h2>4. Entrega</h2>
      <p>
        Entregamos dentro de la franja horaria que elegiste, en la dirección indicada. Es
        responsabilidad del cliente que la dirección y la referencia sean correctas y que haya
        alguien para recibir. Si nadie recibe, esperamos 15 minutos y coordinamos una segunda visita
        el mismo día cuando la ruta lo permita; una tercera visita puede tener costo adicional.
      </p>

      <h2>5. Personalización</h2>
      <p>
        Las imágenes que subes deben ser de tu propiedad o contar con autorización de uso. No
        imprimimos contenido que infrinja derechos de terceros ni material ofensivo. La reproducción
        impresa puede variar levemente en color respecto a tu pantalla.
      </p>

      <h2>6. Diseño y variaciones</h2>
      <p>
        Cada torta se decora a mano, por lo que pueden existir diferencias menores respecto a la foto
        del catálogo. Los sabores, tamaños y porciones sí corresponden a lo indicado.
      </p>

      <h2>7. Cambios y cancelaciones</h2>
      <p>
        Puedes modificar o cancelar tu pedido con más de 24 horas de anticipación a la entrega,
        escribiéndonos por WhatsApp con tu código. Dentro de las 24 horas previas el pedido ya está
        en producción y no admite cancelación.
      </p>

      <h2>8. Reclamos</h2>
      <p>
        Al tratarse de un producto perecible, cualquier observación debe comunicarse el mismo día de
        la entrega, con fotos del producto. Evaluamos cada caso y, cuando corresponde, reponemos el
        producto o devolvemos el importe. También puedes registrar tu caso en nuestro Libro de
        Reclamaciones.
      </p>

      <h2>9. Contacto</h2>
      <p>
        Escríbenos a <a href={`mailto:${brand.email}`}>{brand.email}</a> o al WhatsApp{" "}
        {brand.whatsappDisplay}, en nuestro horario de atención.
      </p>
    </Prose>
  );
}
