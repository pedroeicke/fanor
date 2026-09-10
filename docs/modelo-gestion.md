# Sistema de gestão — modelo de dados (passo 1)

O que o Sisgeco 5 faz hoje na loja, tabela por tabela, e como fica no sistema
novo. Lido das telas do Sisgeco (`Usuarios/*.ini`) e conferido contra 17.454
comprovantes emitidos entre set/2024 e set/2026. Migração: `supabase/migrations/0008_gestion.sql`.

## O que os dados da loja dizem

| Fato | Número | Consequência no modelo |
|---|---|---|
| Só a família **T** (tortas) tem número de série | 99 % das linhas T; 0 % das outras 17 famílias | `products.tracks_serial`; tabela `cake_units` só para tortas |
| Uma série = um bolo físico, quantidade 1 | 14.582 séries distintas, 10 repetidas (reemissão) | `sale_lines.cake_unit_id` único |
| Lote = data de produção; vendido no dia seguinte | 12.123 no dia seguinte, 6.482 no mesmo dia | `cake_units.produced_on`, `expires_on` = +2 dias |
| Comprovante de um item só | 15.059 de 17.454 (86 %) | Tela de balcão fecha uma torta em dois toques |
| Encomenda = adiantamento + saldo | 937 `ADL`, 924 `REIN` | `sales.contract_id`; ADL/REIN são vendas comuns ligadas ao contrato |
| Boleta sem identificar o cliente | 16.576 de 17.454 | Consumidor final não vira `customers`; receptor genérico da SUNAT |
| Preço de lista muda | T26 passou por S/69, 70, 71, 75, 76, 80, 85 | Preço e descrição copiados em `sale_lines` |
| Uma vendedora faz quase tudo | a vendedora principal: 12.937 comprovantes | O balcão é a tela dela; `sellers` |
| Yape/Plin vão na glosa ("YAPE 284") | — | Viram `payment_method` próprio, para conciliar |

## Mapa Sisgeco → novo

| Tela do Sisgeco | Colunas que importam | Novo | Observação |
|---|---|---|---|
| FArticulo | codigo, des, codfamilia, codunidad, usaserie, usalote, precio1, codigosunat, cuentaC/V, stockM | `products` (+ `family_id`, `unit`, `tracks_serial`, `shelf_life_days`, `sunat_code`, `stock_min`) | Uma tabela só: a vitrine lê o que o balcão baixa. `sku` = código do Sisgeco |
| FFamilia | codigo, des | `product_families` | 14 famílias pré-carregadas pelo prefixo dos códigos |
| FArticuloAyuCD | alm0…alm9, stockf | `stock_levels` (por loja) | Saldo do que não tem série |
| FVenta | numero, codtipodoc, numdoc, fecha, codprovclie, codvendedor, total, pagado | `sales` | `web_order_code` liga à venda do site |
| FVentaDetGF / VE | codarticulo, numlote, fechaven, numserie, cantidad, valor, igv, total | `sale_lines` | Série, lote e vencimento copiados na linha |
| FVentaPago | codtipopago, monto, monedapago, vuelto, numvoucher | `sale_payments` | |
| FContrato | numero, fecha, codprovclie, fechaentrega, horaentrega, lugarentrega, total, cerrado | `contracts` | |
| FContratoDet | codarticulo, codtipotorta, codsabor, coddecoradora | `contract_lines` + `cake_types`, `flavors`, `decorators` | Sabor é global, escolhido no contrato — não é atributo da torta |
| FOP / FOPDet | numero, fecha, codtienda, codarticulo, cantidad, cantguia, sabor, decoradora | `production_orders`, `production_order_lines` | `contract_line_id` liga a OP à encomenda |
| FGuia / FGuiaDetI | codalmacen, codtipomov, numserie, numlote, cantidad | `stock_movements`, `stock_movement_lines` | Todo movimento de estoque com motivo |
| FProvClie | tipo, ruc, tipodocide, numdocide, des, email, direccion, codubigeo | `customers` | Só quem se identifica (factura ou DNI) |
| FVendedor | codigo, des | `sellers` | |
| Utilitários › Correlativos | prefijo, correlativo | `fiscal_series` | No modo OFFLINE do Close2U quem numera é a empresa |
| JSON do Close2U | série, número, receptor, itens, estado | `fiscal_documents` | JSON enviado e resposta guardados inteiros |

Não modelado agora, de propósito: compras e fornecedores (FCompra), insumos e
ficha técnica (`artiip`), centros de custo, contas contábeis por artigo. Entram
quando o balcão estiver rodando; modelar antes seria adivinhar.

## Decisões que valem explicar

**Uma tabela de produto, não duas.** O motivo de refazer o sistema é a vitrine
ler o mesmo estoque que o balcão baixa. Com `products` do site e `articulo` do
balcão separados, isso nunca fecha. Por isso as colunas operacionais entram em
`products`, e produto que só existe no balcão (vela, empanada) fica com
`sold_online = false`.

**Série continua no formato do Sisgeco.** `D` + 10 dígitos, começando em
100000 — a última série vista é D0000083440. As etiquetas e o hábito da loja
não mudam, e os dois sistemas podem conviver sem colidir.

**Adiantamento e saldo são vendas.** É como o Sisgeco faz (dois artigos de
serviço, ADL e REIN) e é como aparece nas boletas. Modelar "parcela de
contrato" como outra coisa quebraria o histórico e a emissão fiscal.

**Comprovante guarda o JSON inteiro.** É a prova do que foi declarado à SUNAT e
o que permite reenviar sem remontar. Estados copiados do catálogo do manual do
Close2U (0 por processar … 6 anulado), com o código cru ao lado do enum.

**Só administrador acessa, por enquanto.** O papel de balconista nasce junto
com a tela de venda. Abrir permissão para uma tela que não existe é risco sem
benefício.

## Perguntas para a Joseka (bloqueiam a próxima etapa)

1. **Famílias**: os prefixos PA, PT, H e O — o que são? (chutei Panadería, Postres, Helados, Otros.)
2. **Lojas**: quais lojas/almacenes existem no Sisgeco (alm0…alm9) e qual vende o quê. O site conhece três: Calle Perú, Mercaderes, Av. EE.UU.
3. **Tipos de torta, sabores e decoradoras**: a lista atual, com código. Está nas tabelas do Sisgeco; um print das telas basta.
4. **Validade**: toda torta vence em 2 dias? Pastel, keke e galleta têm validade?
5. **Campos que não entendi**: em FArticulo, o que são `PS`, `tipo`/`tipo2`, `auxiliar1`/`auxiliar2`?
6. **Backup do SQL Server `Fanor`**: para migrar clientes, produtos e histórico em vez de recadastrar.
7. **Close2U**: credenciais da API e uma série nova para o site (B004). Mensagem pronta já foi passada.

## Próximos passos, em ordem

1. Aplicar a migração (aditiva — o site não muda).
2. Importar os 113 códigos de produto dos comprovantes para `products` (os 59 do site ganham `sku`; os demais entram como só-balcão).
3. Tela de venda de balcão: buscar por código/série, um toque, forma de pagamento, boleta.
4. Emissão pelo Close2U com fila e estados.
5. Contrato de encomenda → OP → série → saldo.
6. Só então, vitrine em tempo real no site.
