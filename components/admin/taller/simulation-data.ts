export type SimulationStep = {
  id: string;
  area: string;
  actor: string;
  title: string;
  receives: string;
  records: string;
  sends: string;
  outputLabel: string;
  outputUnit: string;
  exampleQuantity: number;
  recipeCode?: string;
  note?: string;
  existingScreen?: string;
};

export type SimulationScenario = {
  id: "torta" | "pasteleria";
  label: string;
  product: string;
  description: string;
  steps: SimulationStep[];
};

/**
 * Roteiros didáticos baseados no levantamento do Joseka e nos códigos do Excel.
 * Quantidades marcadas como exemplo não são uma ordem de produção nem alteram saldos.
 */
export const SIMULATION_SCENARIOS: SimulationScenario[] = [
  {
    id: "torta",
    label: "Tortas",
    product: "Torta 26 Chocolate-Naranja-Moca",
    description: "Sigue una torta desde los insumos hasta la venta. La fórmula final es T26-CHNRMC.",
    steps: [
      {
        id: "almacen", area: "Almacén", actor: "Responsable del almacén", title: "Entregar insumos al taller",
        receives: "Compra y saldo de materias primas en el almacén principal.",
        records: "Qué códigos y cantidades salen, a qué sector llegan y quién los recibe.",
        sends: "Ingredientes para preparados y batidas.",
        outputLabel: "entrega de prueba", outputUnit: "entrega", exampleQuantity: 1,
        note: "La transferencia interna de materias primas todavía no existe en el panel.",
      },
      {
        id: "preparados", area: "Preparados", actor: "Equipo de preparaciones", title: "Preparar almíbar y rellenos",
        receives: "Ingredientes del almacén para las recetas intermedias.",
        records: "Código de la receta, lote, cantidades realmente usadas, rendimiento y sobrante.",
        sends: "Almíbar y rellenos identificados por código para las etapas siguientes.",
        outputLabel: "almíbar reservado", outputUnit: "ml", exampleQuantity: 650, recipeCode: "IN3-1ALMIB",
        note: "La fórmula E26-CHNRMC consume 650 ml de almíbar; esto no define el rendimiento total del lote.",
      },
      {
        id: "batidas", area: "Batidas", actor: "Equipo de batidas", title: "Mezclar y repartir la batida",
        receives: "Materias primas y preparados intermedios.",
        records: "Consumo real de cada insumo, peso producido y cuánto se asigna a cada molde o pedido.",
        sends: "Porciones de batida de chocolate, naranja y moca al horno.",
        outputLabel: "batidas de prueba", outputUnit: "lotes", exampleQuantity: 3, recipeCode: "BAT-CHOCOL",
        note: "El rendimiento real puede variar. La simulación no interpreta como peso el rendimiento en 'un.' del Excel.",
      },
      {
        id: "horno", area: "Horno", actor: "Equipo del horno", title: "Registrar los cakes obtenidos",
        receives: "Batidas distribuidas en los moldes.",
        records: "Cuántos cakes salieron, peso real, pérdidas y lote de origen.",
        sends: "CAKE-T26CH, CAKE-T26NR y CAKE-T26MC al empate.",
        outputLabel: "cakes de prueba", outputUnit: "un.", exampleQuantity: 3, recipeCode: "CAKE-T26CH",
        note: "Cada cake debe conservar la relación con la batida que lo produjo.",
      },
      {
        id: "empate", area: "Empate", actor: "Empatador", title: "Montar la torta",
        receives: "Medio cake de cada sabor, 650 ml de almíbar y rellenos.",
        records: "Partes realmente usadas y las mitades que quedan disponibles.",
        sends: "Un empate E26-CHNRMC a decoración.",
        outputLabel: "empate obtenido", outputUnit: "un.", exampleQuantity: 1, recipeCode: "E26-CHNRMC",
        note: "La fórmula usa 0,5 de CAKE-T26CH, 0,5 de CAKE-T26NR y 0,5 de CAKE-T26MC.",
      },
      {
        id: "decoracion", area: "Decoración y corte", actor: "Decoradora", title: "Terminar e identificar la torta",
        receives: "Empate, chantilly, frutas y base indicados por T26-CHNRMC.",
        records: "Consumos de decoración, torta terminada, fecha de validez y serie única.",
        sends: "Torta terminada con etiqueta QR al despacho.",
        outputLabel: "torta terminada", outputUnit: "un.", exampleQuantity: 1, recipeCode: "T26-CHNRMC",
        note: "El QR identifica la torta física; no se genera una torta distinta 'con caja'.",
      },
      {
        id: "despacho", area: "Despacho", actor: "Taller", title: "Enviar a la tienda",
        receives: "Torta terminada y pedido de reposición o encomienda.",
        records: "Tienda de destino, sabor, serie, despacho y etiqueta.",
        sends: "Una torta en tránsito para que la tienda la confirme.",
        outputLabel: "torta despachada", outputUnit: "un.", exampleQuantity: 1,
        existingScreen: "/admin/taller",
        note: "El despacho con serie y QR ya existe; todavía no recibe automáticamente el lote de decoración.",
      },
      {
        id: "tienda", area: "Tienda", actor: "Vendedora", title: "Recibir y vender",
        receives: "Torta con serie y QR enviada por el taller.",
        records: "Recepción por serie, presencia en vitrina y venta. La caja se consume al vender.",
        sends: "Venta registrada y torta retirada de la vitrina.",
        outputLabel: "torta vendida", outputUnit: "un.", exampleQuantity: 1,
        existingScreen: "/admin/recepcion",
        note: "Recepción, vitrina y venta ya existen; el costo por lote y Siscont siguen pendientes.",
      },
    ],
  },
  {
    id: "pasteleria",
    label: "Pastelería",
    product: "Empanada de pollo",
    description: "Muestra cómo una misma área puede preparar masa, relleno y producto final.",
    steps: [
      {
        id: "almacen", area: "Almacén", actor: "Responsable del almacén", title: "Entregar insumos a pastelería",
        receives: "Materias primas compradas.",
        records: "Códigos, cantidades entregadas y responsable que recibe.",
        sends: "Ingredientes para masa y relleno.",
        outputLabel: "entrega de prueba", outputUnit: "entrega", exampleQuantity: 1,
      },
      {
        id: "relleno", area: "Pastelería · relleno", actor: "Pastelero", title: "Preparar relleno de pollo",
        receives: "Ingredientes del almacén.",
        records: "Consumo real y rendimiento del lote IN3-3REMPO.",
        sends: "Relleno disponible para armado.",
        outputLabel: "relleno producido", outputUnit: "gr.", exampleQuantity: 1435.5, recipeCode: "IN3-3REMPO",
        note: "1.435,5 g es el rendimiento previsto en el Excel; en producción se registra el peso medido.",
      },
      {
        id: "masa", area: "Pastelería · masa", actor: "Pastelero", title: "Preparar masa hojaldre",
        receives: "Harina, grasas y demás insumos del almacén.",
        records: "Consumo real, peso obtenido y sobrante del lote IN3-5MSHOJ.",
        sends: "Masa disponible para formado.",
        outputLabel: "masa producida", outputUnit: "gr.", exampleQuantity: 4740, recipeCode: "IN3-5MSHOJ",
        note: "4.740 g es el rendimiento previsto del lote de masa, no de una empanada.",
      },
      {
        id: "formado", area: "Pastelería · formado", actor: "Pastelero", title: "Armar y hornear empanadas",
        receives: "Una parte de la masa y del relleno preparados.",
        records: "Cuánto se consumió de cada lote, cuántas unidades salieron y merma.",
        sends: "Empanadas de pollo terminadas.",
        outputLabel: "empanadas de prueba", outputUnit: "un.", exampleQuantity: 1, recipeCode: "PT9-01EMPO",
        note: "PT9-01EMPO está en el catálogo, pero el Excel recibido no trae su fórmula final. La cantidad aquí es solo un ejemplo.",
      },
      {
        id: "salida", area: "Salida", actor: "Pastelería y tienda", title: "Entregar y vender",
        receives: "Unidades terminadas e identificadas.",
        records: "Destino, recepción y venta de cada cantidad.",
        sends: "Producto vendido y saldo actualizado.",
        outputLabel: "empanadas vendidas", outputUnit: "un.", exampleQuantity: 1,
        note: "El flujo interno de consumo por lote aún necesita implementación.",
      },
    ],
  },
];
