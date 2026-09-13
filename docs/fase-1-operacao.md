# Fase 1 — operação da loja sem depender do Sisgeco

Origem: reunião com o Joseka em 11/09/2026. O Sisgeco não sabe dizer quais
tortas prontas estão no balcão, não liga a torta física à venda da encomenda e
não fecha custo com rendimento variável. Em vez de ler o que ele não tem, o
fluxo passa a nascer no sistema novo, registrado por quem faz o trabalho.

Fica **fora desta fase**, porque depende do Joseka: emissão de boleta pelo
Close2U (credenciais e série), exportação para o Siscont (formato e plano de
contas), custo por etapa (decisão do escopo), integração com a API da Meta
(número e app do WhatsApp/Messenger), instalação do backup no PC dele. Tudo
isso tem gancho pronto aqui — ver "Pauta da reunião" no fim.

Banco: migrações `0011_estados_operacao.sql`, `0012_operacao_loja.sql`,
`0013_familia_por_codigo.sql` (já aplicadas e testadas de ponta a ponta).

---

## 1. O fluxo

```
Vendedora (loja)            Taller                        Loja                         Taller
────────────────            ──────                        ────                         ──────
Pedido: 10 × T26   ──►  Despacho com sabores     ──►  Recepción (QR)          ──►  Vencida volta
(sem sabor)             2 fresa · 3 choco · 5 moka     só o conferido sobe          Redecora (1 dia, série nova)
                        etiqueta QR por torta          na vitrine                   ou descarta
                        torta "en camino"              faltante → esclarecer        → novo despacho
```

Estados da torta (`cake_units.status`), só para `source = 'native'`:

| Estado | Onde está | Na vitrine? |
|---|---|---|
| `in_transit` | saiu do taller, ninguém conferiu | não |
| `in_stock` | conferida na loja | sim, se `expires_on >= hoje (Lima)` |
| `reserved` | conferida, é de uma encomenda | não |
| `missing` | estava no despacho e não chegou | não |
| `sold` | vendida (balcão, personal ou entrega de encomenda) | não |
| `returned` | voltou ao taller | não |
| `discarded` | descartada / perdida | não |

**Vitrine não mostra torta vencida** (`expires_on < hoje`) mesmo que ninguém a
tenha devolvido — a vitrine calar é melhor que vender torta velha. A loja vê as
vencidas na tela dela para devolver, e o alerta `expired_cakes` dispara.

**Convivência com o Sisgeco.** O leitor da loja continua gravando em
`cake_units` com `source = 'sisgeco'`. `system_settings.stock_source` diz qual
a vitrine pública lê: `"sisgeco"` (hoje) ou `"native"`. A chave só vira depois
que a boleta sair pelo sistema novo — antes disso a vendedora teria de digitar
cada venda duas vezes.

---

## 2. Operações do banco (RPC)

Tudo que muda estoque ou dinheiro é função no banco (atômica). Chamar pela
sessão do painel com `runOp(nome, args)` de `lib/gestion/server.ts`. As
mensagens de erro já vêm em espanhol, prontas para mostrar.

| Função | Argumentos | Devolve |
|---|---|---|
| `op_request_create` | `p_store uuid, p_lines jsonb [{product_id, quantity}], p_notes?, p_seller?, p_for_date?` | `{id, number, lines}` |
| `op_request_cancel` | `p_order uuid, p_reason?` | — (só sem despacho) |
| `op_request_close` | `p_order uuid, p_reason?` | — (taller encerra o que falta) |
| `op_dispatch_create` | `p_store, p_order uuid\|null, p_cakes jsonb [{product_id, quantity, flavor_id?, decorator_id?, cake_type_id?, production_order_line_id?, notes?}], p_items jsonb [{product_id, quantity, production_order_line_id?}], p_notes?` | `{id, number, code, serials[], cakes}` |
| `op_dispatch_receive` | `p_dispatch uuid, p_received text[] (séries conferidas), p_items jsonb [{dispatch_line_id, received_quantity}], p_notes?` | `{received, missing, short_items}` — o que não estiver em `p_received` vira `missing` |
| `op_cake_resolve_missing` | `p_serial text, p_found boolean, p_notes?` | — |
| `op_cakes_return` | `p_serials text[], p_notes?` | `{returned}` — só `in_stock` |
| `op_cake_redecorate` | `p_serial text, p_store uuid, p_decorator?, p_notes?` | `{dispatch_id, number, code, serial, expires_on}` — só `returned`, uma vez |
| `op_cakes_discard` | `p_serials text[], p_reason?` | `{discarded}` — `returned`, `in_stock` ou `missing` |
| `op_sale_register` | `p_store, p_lines jsonb, p_payments jsonb [{method, amount, reference?}], p_seller?, p_customer?, p_kind ('counter'\|'staff'\|'contract_advance'\|'contract_balance'), p_contract?, p_notes?` | `{id, number, total, paid, change}` |
| `op_contract_create` | `p_store, p_deliver_on date, p_lines jsonb [{product_id, quantity, unit_price, description?, flavor_id?, decorator_id?, cake_type_id?, cake_message?, photo_url?}], p_customer?, p_seller?, p_deliver_at time?, p_deliver_place?, p_notes?, p_advance jsonb {amount, method, reference?}?` | `{id, number, total, production_order_id, advance_sale}` |
| `op_contract_deliver` | `p_contract, p_serials text[], p_payments jsonb, p_notes?` | `{cakes, balance, balance_sale}` |
| `op_contract_cancel` | `p_contract, p_reason?` | — (libera tortas reservadas) |
| `op_customer_upsert` | `p_name, p_phone?, p_email?, p_doc_type ('DNI'\|'RUC'\|'CE'\|'PASSPORT'\|'NONE'), p_doc_number?, p_source?` | `uuid` — funde por documento → celular → e-mail |
| `op_lead_create` | `p_name, p_phone?, p_source?, p_context?, p_interest?, p_wanted_on?, p_store?, p_seller?` | `{id, number, customer_id}` |
| `op_lead_assign` | `p_lead, p_store, p_seller?` | — |
| `op_lead_contact` | `p_lead, p_notes?` | — (1ª vez grava `first_contact_at`) |
| `op_lead_close` | `p_lead, p_won boolean, p_value?, p_reason? (obrigatório se perdido), p_order_code?, p_contract?` | — |
| `op_lead_note` | `p_lead, p_notes` | — |
| `alerts_refresh` | — | nº de alertas abertos |
| `report_cakes` | `p_from date, p_to date` | linhas dia × loja × produto × sabor com `dispatched, received, sold, staff_sold, returned, redecorated, discarded, missing` |

Linhas de venda (`op_sale_register.p_lines`):
- torta: `{cake_serial, unit_price, discount?, description?}` — obrigatório para família com série (T);
- demais: `{product_id?, description?, quantity, unit_price, discount?}` — baixa `stock_levels` se não for serviço.

Preço com IGV incluído. Pagar a mais só em dinheiro; o vuelto é descontado do
pagamento em dinheiro gravado. Toda venda nasce `fiscal_pending = true` (a
boleta sai depois, pelo Close2U).

Regras de dados úteis:
- família com série: `product_families.tracks_serial` (só T). Produtos do
  Sisgeco herdam família pelo prefixo do código (gatilho da 0013).
- validade: `product_shelf_life(product_id)` = produto → família → 2 dias.
- torta: sabor em `cake_units.flavor_id` (tabela `flavors`), decoradora em
  `decorator_id`, foto real em `photo_url`.
- lojas que recebem torta: `stores` com `serial_prefix` (G = Calle Perú, D = Av. EE.UU.).
- vendedora do login: `sellers.user_id` → `sellers.store_id` (loja padrão das telas).

Tabelas novas: `system_settings`, `dispatches`, `dispatch_lines`, `cake_events`,
`customer_notes`, `leads`, `lead_events`, `alerts`, `photo_treatments`,
`backup_runs`. Colunas novas em `cake_units`, `sellers`, `production_orders`,
`sales`, `customers`, `orders.customer_id`, `complaints.customer_id`.

Chaves de `system_settings`: `stock_source` (`"sisgeco"|"native"`), `sla`
(`lead_first_contact_min, request_attend_hours, dispatch_receive_hours,
complaint_response_days, sync_stale_min`), `redecorated_shelf_life_days`,
`lead_whatsapp_template` (placeholders `{nombre} {vendedora} {interes} {contexto}`).

CRM automático: gatilhos ligam pedido do site e reclamação a `customers`, e
recalculam `orders_count`, `total_spent`, `last_purchase_at` a cada pedido pago,
venda ou encomenda.

---

## 3. Módulos e telas

Rotas no painel (`app/admin/(panel)/…`), todas em espanhol, com sessão
obrigatória. Telas de loja e taller são usadas **no celular**: primeiro mobile,
alvos de toque de 44 px, uma ação principal por tela.

| # | Módulo | Rotas | O que faz |
|---|---|---|---|
| M1 | Catálogos y ajustes | `/admin/catalogos`, `/admin/ajustes` | Sabores, tipos de torta, decoradoras, vendedoras (loja, papel, acesso de login), validade por família. Ajustes: fonte da vitrine (com trava e explicação), SLAs, validade da redecorada, mensagem do WhatsApp |
| M2 | Pedidos y taller | `/admin/pedidos-tienda`, `/admin/taller`, `/admin/taller/despachos/[id]` | Vendedora pede tamanho × quantidade. Taller vê a fila (pedidos + encomendas), monta o despacho dividindo cada linha em sabores, imprime etiquetas com QR. Devolvidas: redecorar ou descartar. Faltantes: esclarecer |
| M3 | Recepción y tienda | `/admin/recepcion`, `/admin/tienda` | Despachos a caminho da loja; conferir por QR (câmera) ou marcando; confirmar. "Mi vitrina": tortas na loja, vencem hoje, vencidas → devolver ao taller |
| M4 | Vitrina pública | `/vitrina`, selo no produto | "Disponibles hoy" por loja, com foto real da torta quando houver, lendo a fonte configurada |
| M5 | Venta de mostrador | `/admin/venta`, `/admin/ventas` | Balcão: escanear torta ou escolher produto, cliente opcional, pagamento misto com vuelto. Lista de vendas com fila de boleta pendente |
| M6 | Encomiendas | `/admin/encomiendas`, `/admin/encomiendas/nueva`, `/admin/encomiendas/[id]` | Contrato com adiantamento, OP automática para o taller, entrega escolhendo a torta exata e cobrando o saldo |
| M7 | Clientes (CRM) | `/admin/clientes`, `/admin/clientes/[id]` | Busca, segmentos, ficha com linha do tempo (site, balcão, encomendas, leads, reclamações), notas, etiquetas, aniversário |
| M8 | Leads y alertas | `/admin/leads`, `/admin/alertas`, `/api/cron/alertas`, `/api/webhooks/meta` | Repasse de lead com contexto; "Escribir por WhatsApp" registra o primeiro contato; desfecho; métricas de resposta por loja/vendedora. Central de alertas. Webhook da Meta pronto e inerte sem credenciais |
| M9 | Fotos con IA | `/admin/fotos`, `/api/admin/fotos` | Foto do celular → recorte 4:5 no bolo, exposição, nitidez, WebP 1080×1350; nota de qualidade e texto alternativo pelo Claude; usar no produto ou na torta (série) |
| M10 | Reportes y respaldos | `/admin/reportes/operacion`, `/admin/respaldos`, `/api/cron/respaldo`, `/api/respaldo/ultimo` | Mais produzidas/vendidas por tamanho e sabor, sobras, redecoradas, por dia/semana/loja. Backup diário de todas as tabelas no Storage, com download para o PC do Joseka |

### Convenções para quem implementa

- **Leitura** nas páginas: `getOperator()` (cliente da sessão, RLS). Nunca a
  chave de serviço no painel. A vitrina pública usa `getSupabaseAdmin()`.
- **Escrita**: server action em `actions.ts` dentro da pasta da rota, com
  `"use server"`; chama `runOp` (operação) ou confere `getOperator()` antes de
  qualquer `insert/update` simples (cadastros). Toda ação devolve
  `ActionResult` e revalida as rotas afetadas.
- **Datas**: `lib/gestion/dates.ts` (fuso de Lima). Nunca
  `toISOString().slice(0, 10)` para "hoje".
- **Rótulos e cores de estado**: `lib/gestion/labels.ts`. Componentes:
  `components/admin/ui.tsx`. QR: `components/admin/QrScanner.tsx` (câmera) e
  `lib/gestion/qr.ts` (conteúdo). Etiqueta de torta = série; guia =
  `FANOR-D:<código>`.
- Textos de tela em espanhol (es-PE); comentários de código em português,
  explicando o porquê, como no resto do projeto.
- Telas que ficam abertas no balcão/taller: `<AutoRefresh />`.

---

## 4. Pauta da reunião com o Joseka

**Fiscal (Close2U)**
1. Credenciais da API do Close2U e série nova para o sistema (as do balcão — B001, B003, F001, F010 — colidem se dois sistemas numerarem).
2. Venda ao pessoal emite boleta?
3. Adiantamento e saldo continuam como duas boletas (ADL/REIN), como hoje?

**Siscont**
4. Formato de importação do Siscont (arquivo de exemplo) e plano de contas usado nas vendas.
5. Frequência e forma: exportação diária para o PC dele serve?

**Operação**
6. O QR é por torta (etiqueta) — confirma? Precisa de impressora de etiqueta (qual modelo existe hoje)?
7. Redecorada vale 1 dia: vence no dia seguinte à redecoração, ou no mesmo dia?
8. Torta pode ser redecorada mais de uma vez? (hoje o sistema permite uma.)
9. Prazos dos alertas: lead sem contato (15 min?), pedido de loja sem atender (4 h?), despacho sem conferir (3 h?).
10. Quem acessa o quê: vendedora vê só a loja dela? vê valores? taller vê vendas?
11. Validade por família além de torta (pastel, keke, galleta).
12. Lista real de sabores, tipos de torta e decoradoras (com código do Sisgeco).

**Custos (fase 2)**
13. Escopo: só capturar consumo real por produção e mandar ao Siscont, ou custo por etapa completo aqui? (O Sisgeco já tem insumos cadastrados: CHANTILLY, JALEA, BRILLO, FRUTAS…)

**Atendimento**
14. WhatsApp Business das lojas: número, conta Meta Business, quem administra — para ligar o webhook que cria o lead sozinho.

**Backup**
15. Instalar no PC dele o baixador do backup diário (e onde guardar).

**Virada**
16. Data para a vitrine passar a ler o sistema novo e desligar o leitor do Sisgeco.
