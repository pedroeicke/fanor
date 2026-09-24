# Producción Fanor — resumen para revisar con Joseka

**Fecha:** 24/09/2026

**Base:** tres audios, dos grabaciones de pantalla y `Codigos_Fanor2026.xlsx` de la reunión del 21/09/2026.

Este documento resume lo entendido para validar las reglas antes de cargar recetas y mover inventario. Todavía no representa una importación aprobada ni una integración operativa con Siscont.

## Flujo entendido

1. El almacén principal recibe las compras y entrega insumos a los sectores de producción.
2. Las fórmulas preparan insumos intermedios, como jugos, almíbar, cremas y masas. Un preparado puede ser ingrediente de otra fórmula.
3. La batida se distribuye entre moldes o pedidos especiales. Se registra el rendimiento real del lote y cuánto fue a cada destino.
4. El horno produce cakes redondos o planchas; luego vienen el armado, la decoración, el corte y el producto terminado.
5. La tienda recibe las tortas terminadas. La caja externa permanece en la tienda y se descuenta al vender; no hace falta crear otra torta “con caja”.

La plancha completa mencionada en la reunión mide **50 × 70 cm**. En el dibujo enviado, el lado horizontal `x` es **70 cm** y el vertical `y` es **50 cm**. El armado habitual de la plancha rinde cinco porciones grandes; también se mencionaron cortes especiales y pedidos de diez porciones. Hay que registrar el corte efectivamente realizado.

## Datos ya revisados

| Archivo | Resultado de la revisión |
| --- | --- |
| Códigos (`XLS Milly`) | 1.256 artículos con código nuevo, descripción y unidad; 1.204 también tienen código antiguo para conservar la relación histórica. |
| Recetas intermedias de tortas | 52 fórmulas de salida y 178 líneas de ingredientes. |
| Grabaciones | Muestran otras pestañas de `RECETAS 2026`, incluidas planchas, tortas T20/T26 y pastelería. Ese Excel completo aún no está entre los archivos recibidos. |

Se preparó una **vista previa automática de importación**, sin modificar la base de datos. Encontró un rendimiento vacío en `IN3-4MDLCH` (fila 174) y dos temas para revisar en la fila 60: uso del código antiguo `MPP10064` y una fórmula donde el huevo entero aparece como resultado de claras y yemas. No conviene cargar esas filas como están.

## Decisiones para validar juntos

1. **Excel vigente:** enviar `RECETAS 2026` completo y confirmar qué versión de cada fórmula debe usarse.
2. **Unidades y envases:** el código ya define descripción y unidad; la receta solo necesita código y cantidad. Las equivalencias de compra se registran una vez y la conversión se hace internamente. Por ejemplo, `MPP-100074` está en ml: la receta contiene 6.630 ml; “17 latas × 390 ml” puede conservarse como explicación de la cantidad. Confirmar el contenido de cada presentación cuando no esté definido.
3. **Producción real:** definir cómo anotarán consumo, sobrantes, merma, rendimiento y fecha de preparación en cada etapa.
4. **Medios cakes y huevos:** decidir cómo controlar medios cakes; confirmar la transformación de huevo entero en claras, yemas y descarte de cáscara, con cantidades reales o una regla aprobada.
5. **Costos:** confirmar cómo repartir costos de servicios, energía, transporte y otros gastos, además del costo de ingredientes.
6. **Siscont:** enviar un archivo de importación de ejemplo y el plan de cuentas para definir el formato de exportación contable.

## Próximo avance del sistema

Con las fórmulas y reglas validadas, el siguiente paso es cargar el catálogo y las recetas en lote con una vista previa de errores; después registrar lotes, consumo y rendimiento por etapa, y finalmente calcular costos y preparar la exportación a Siscont. Las pantallas operativas serán en español.
