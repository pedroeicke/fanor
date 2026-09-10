-- =============================================================================
-- Tortas Fanor — núcleo do sistema de gestão (balcão, contrato, produção,
-- estoque e comprovante fiscal)
--
-- Substitui, por etapas, o Sisgeco 5 que a loja usa hoje. O modelo não foi
-- inventado: foi lido das telas do Sisgeco (colunas dos grids em
-- Usuarios/*.ini) e confirmado contra 17.454 comprovantes emitidos pela loja
-- entre set/2024 e set/2026. Onde uma decisão vem desses dados, o comentário
-- diz qual dado.
--
-- Tudo aqui é aditivo: nenhuma tabela ou coluna que o site usa é alterada ou
-- removida. O site continua funcionando igual com esta migração aplicada ou
-- não. Foi feito assim para que o balcão possa entrar em produção enquanto o
-- Sisgeco ainda cuida do resto.
--
-- Convenções (as mesmas de 0001):
--   · dinheiro em NUMERIC(10,2); quantidade de estoque em NUMERIC(12,3),
--     porque insumo se pesa;
--   · RLS ligado em tudo; hoje só `is_admin()` escreve e lê. Um papel de
--     balconista entra quando a tela de venda existir — não antes, para não
--     abrir permissão que ninguém usa;
--   · nomes em inglês nas tabelas, como o resto do banco; o nome da tela do
--     Sisgeco correspondente fica no comentário.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Catálogo: o que o Sisgeco chama de "artículo" é o `products` do site.
--
-- Uma tabela só, não duas. O ponto do sistema novo é a vitrine ler o mesmo
-- estoque que o balcão baixa; com dois cadastros isso nunca fecha. O que o
-- site não precisa (família operacional, unidade, série) entra como coluna
-- extra, e o que o balcão não precisa (SEO, ocasiões) simplesmente fica vazio.
-- -----------------------------------------------------------------------------

-- Família operacional (FFamilia): T tortas, PS pastelería, G galletas, V velas,
-- E empanadas, K kekes… É o prefixo do código do Sisgeco. Diferente de
-- `categories`, que é navegação do site (ocasiões).
create table product_families (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,          -- 'T', 'PS', 'G'…
  name        text not null,
  /* Padrão herdado por produtos novos da família. Nos dados: T tem série em
     99% das linhas; todas as outras famílias, em 0%. */
  tracks_serial boolean not null default false,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now()
);

alter table products
  add column if not exists family_id      uuid references product_families(id),
  /* Unidade no vocabulário do provedor fiscal (catálogo 2.5 do manual
     Close2U). Bolo, pastel e vela são UNIDAD_BIENES; serviço de decoração
     seria UNIDAD_SERVICIOS. */
  add column if not exists unit           text not null default 'UNIDAD_BIENES',
  /* Cada torta pronta é um item físico com identidade própria (série
     D0000083440), validade e lote. Pastel e vela são estoque contado. */
  add column if not exists tracks_serial  boolean not null default false,
  /* Validade a partir da data de produção. Nos comprovantes, toda torta
     vence 2 dias depois do lote. */
  add column if not exists shelf_life_days integer,
  /* Código do produto na tabela da SUNAT (codigoProductoSunat). A loja hoje
     manda vazio; fica aqui para quando o contador pedir. */
  add column if not exists sunat_code     text,
  /* Onde o produto se vende. Velas e empanadas são só balcão; a torta
     personalizada é só site; a T26 é os dois. */
  add column if not exists sold_online    boolean not null default true,
  add column if not exists sold_at_counter boolean not null default true,
  add column if not exists stock_min      numeric(12,3);

comment on column products.sku is
  'Código do artigo no Sisgeco (T14, PS12, ADL). É a chave para migrar histórico e para o balcão digitar.';

create index if not exists products_family_idx on products (family_id);

-- Tipos de torta, sabores e decoradoras do contrato (FContratoDet:
-- codtipotorta, codsabor, coddecoradora). Listas globais, não por produto —
-- no Sisgeco o sabor é escolhido no contrato, não cadastrado na torta.
create table cake_types (
  id         uuid primary key default gen_random_uuid(),
  code       text not null unique,
  name       text not null,
  active     boolean not null default true,
  sort_order integer not null default 0
);

create table flavors (
  id         uuid primary key default gen_random_uuid(),
  code       text not null unique,
  name       text not null,
  active     boolean not null default true,
  sort_order integer not null default 0
);

create table decorators (
  id         uuid primary key default gen_random_uuid(),
  code       text not null unique,
  name       text not null,
  active     boolean not null default true
);

-- Vendedoras (FVendedor). Carmen Apaza emitiu 12.937 dos 17.454 comprovantes:
-- o balcão é a tela dela. `user_id` liga a uma conta de login quando houver.
create table sellers (
  id         uuid primary key default gen_random_uuid(),
  code       text not null unique,
  name       text not null,
  user_id    uuid references auth.users(id) on delete set null,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

-- Clientes (FProvClie). Consumidor final não vira linha aqui: boleta sem
-- identificação usa o receptor genérico da SUNAT ("VENTAS AL PUBLICO EN
-- GENERAL"), como a loja já faz em 16.576 dos 17.454 comprovantes.
create type identity_doc as enum ('DNI', 'RUC', 'CE', 'PASSPORT', 'NONE');

create table customers (
  id          uuid primary key default gen_random_uuid(),
  doc_type    identity_doc not null default 'NONE',
  doc_number  text,
  name        text not null,               -- razão social ou nome completo
  trade_name  text,                        -- nome fantasia (descomercial)
  email       text,
  phone       text,
  address     text,
  district    text,
  ubigeo      text,                        -- 040101 = Arequipa/Arequipa/Arequipa
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  /* RUC e DNI identificam; sem documento não há unicidade a impor. */
  unique (doc_type, doc_number)
);

create trigger customers_updated_at before update on customers
  for each row execute function set_updated_at();

-- -----------------------------------------------------------------------------
-- 2. Estoque
-- -----------------------------------------------------------------------------

-- Uma torta pronta. É a única coisa no estoque com identidade individual.
--
-- A série continua o padrão do Sisgeco ('D' + 10 dígitos) para o balcão e
-- as etiquetas não mudarem. Começa em 100000 porque a última série vista nos
-- comprovantes é D0000083440 — assim a numeração nova nunca colide com a
-- antiga, mesmo que os dois sistemas rodem lado a lado por um tempo.
create sequence cake_serial_seq start with 100000;

create or replace function next_cake_serial() returns text
language sql volatile as $$
  select 'D' || lpad(nextval('cake_serial_seq')::text, 10, '0');
$$;

create type cake_unit_status as enum ('in_stock', 'reserved', 'sold', 'discarded');

create table cake_units (
  id          uuid primary key default gen_random_uuid(),
  serial      text not null unique default next_cake_serial(),
  product_id  uuid not null references products(id),
  store_id    uuid not null references stores(id),
  /* "lote" nos comprovantes é a data de produção. 12.123 tortas foram
     vendidas no dia seguinte ao lote e 6.482 no mesmo dia. */
  produced_on date not null default current_date,
  expires_on  date not null,
  status      cake_unit_status not null default 'in_stock',
  /* Preenchido quando o bolo nasce de uma encomenda. */
  contract_id uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index cake_units_stock_idx on cake_units (store_id, product_id) where status = 'in_stock';
create trigger cake_units_updated_at before update on cake_units
  for each row execute function set_updated_at();

-- Saldo por loja de tudo que não tem série (FArticuloAyuCD: alm0…alm9).
create table stock_levels (
  store_id   uuid not null references stores(id),
  product_id uuid not null references products(id),
  quantity   numeric(12,3) not null default 0,
  updated_at timestamptz not null default now(),
  primary key (store_id, product_id)
);

create trigger stock_levels_updated_at before update on stock_levels
  for each row execute function set_updated_at();

-- Movimentos (FGuia / FGuiaDetI). Tudo que muda estoque passa por aqui, com
-- motivo: entrada de produção, saída por venda, transferência entre lojas,
-- ajuste de inventário, descarte por vencimento.
create type stock_movement_kind as enum ('production', 'sale', 'transfer', 'adjustment', 'discard', 'purchase');

create table stock_movements (
  id          uuid primary key default gen_random_uuid(),
  number      bigserial,
  kind        stock_movement_kind not null,
  store_id    uuid not null references stores(id),
  /* Só em transferência. */
  to_store_id uuid references stores(id),
  reference   text,                         -- nº da OP, da venda, da nota do fornecedor
  notes       text,
  seller_id   uuid references sellers(id),
  created_at  timestamptz not null default now()
);

create table stock_movement_lines (
  id           uuid primary key default gen_random_uuid(),
  movement_id  uuid not null references stock_movements(id) on delete cascade,
  product_id   uuid not null references products(id),
  quantity     numeric(12,3) not null,
  /* Quando o item é uma torta, aponta para ela. */
  cake_unit_id uuid references cake_units(id),
  lot_date     date,
  unit_cost    numeric(10,2)
);

create index stock_movement_lines_movement_idx on stock_movement_lines (movement_id);

-- -----------------------------------------------------------------------------
-- 3. Venda de balcão (FVenta / FVentaDet / FVentaPago)
--
-- É o que roda 300 vezes por dia. 86% dos comprovantes têm um item só e
-- quantidade 1: a tela precisa fechar uma torta em dois toques.
-- -----------------------------------------------------------------------------
create type sale_status as enum ('open', 'paid', 'void');

create table sales (
  id            uuid primary key default gen_random_uuid(),
  number        bigserial,                  -- numero
  store_id      uuid not null references stores(id),
  seller_id     uuid references sellers(id),
  customer_id   uuid references customers(id),
  status        sale_status not null default 'open',
  sold_at       timestamptz not null default now(),
  currency      text not null default 'PEN',
  subtotal      numeric(10,2) not null default 0,
  discount      numeric(10,2) not null default 0,
  igv           numeric(10,2) not null default 0,
  total         numeric(10,2) not null default 0,
  /* Adiantamento (ADL) e saldo (REIN) de uma encomenda são vendas comuns
     que apontam para o contrato — é assim que o Sisgeco faz, com dois
     artigos de serviço, e é assim que aparece nas 1.861 boletas de contrato. */
  contract_id   uuid,
  /* Venda que nasceu no site: liga ao pedido para não contar duas vezes. */
  web_order_code text references orders(code),
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index sales_store_day_idx on sales (store_id, sold_at desc);
create trigger sales_updated_at before update on sales
  for each row execute function set_updated_at();

create table sale_lines (
  id           uuid primary key default gen_random_uuid(),
  sale_id      uuid not null references sales(id) on delete cascade,
  product_id   uuid references products(id),
  /* Copiados na hora: o preço de lista muda (a T26 passou por S/69, 70, 71,
     75, 76, 80 e 85 em dois anos) e a venda tem de continuar batendo com a
     boleta emitida. */
  description  text not null,
  quantity     numeric(12,3) not null default 1,
  unit_price   numeric(10,2) not null,
  discount     numeric(10,2) not null default 0,
  igv          numeric(10,2) not null default 0,
  total        numeric(10,2) not null,
  cake_unit_id uuid references cake_units(id),
  lot_date     date,
  expires_on   date,
  sort_order   integer not null default 0
);

create index sale_lines_sale_idx on sale_lines (sale_id);
/* Uma torta só se vende uma vez. */
create unique index sale_lines_cake_unit_idx on sale_lines (cake_unit_id) where cake_unit_id is not null;

-- Formas de pagamento vistas nos comprovantes: Efectivo 10.245, Tarjeta 1.364,
-- depósito 26, crédito 12. Yape e Plin aparecem na glosa ("YAPE 284"), não
-- como forma — aqui viram forma própria, porque conciliar depois exige.
create type payment_method as enum ('cash', 'card', 'yape', 'plin', 'transfer', 'deposit', 'credit');

create table sale_payments (
  id        uuid primary key default gen_random_uuid(),
  sale_id   uuid not null references sales(id) on delete cascade,
  method    payment_method not null,
  amount    numeric(10,2) not null,
  currency  text not null default 'PEN',
  reference text,                            -- nº da operação Yape, voucher do cartão
  paid_at   timestamptz not null default now()
);

create index sale_payments_sale_idx on sale_payments (sale_id);

-- -----------------------------------------------------------------------------
-- 4. Encomenda de torta (FContrato / FContratoDet)
--
-- Fluxo da loja hoje: contrato → boleta de adiantamento → ordem de produção
-- → guia → boleta de saldo na retirada. Está tudo nos dados: 937 ADL e 924
-- REIN em dois anos.
-- -----------------------------------------------------------------------------
create type contract_status as enum ('open', 'in_production', 'ready', 'delivered', 'cancelled');

create table contracts (
  id             uuid primary key default gen_random_uuid(),
  number         bigserial,
  store_id       uuid not null references stores(id),
  customer_id    uuid references customers(id),
  seller_id      uuid references sellers(id),
  status         contract_status not null default 'open',
  deliver_on     date not null,              -- fechaentrega
  deliver_at     time,                       -- horaentrega
  deliver_place  text,                       -- lugarentrega: loja ou endereço
  total          numeric(10,2) not null default 0,
  notes          text,
  /* Encomenda feita pelo site: mesmo vínculo da venda. */
  web_order_code text references orders(code),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  closed_at      timestamptz
);

create index contracts_deliver_idx on contracts (store_id, deliver_on);
create trigger contracts_updated_at before update on contracts
  for each row execute function set_updated_at();

alter table sales      add constraint sales_contract_fk      foreign key (contract_id) references contracts(id);
alter table cake_units add constraint cake_units_contract_fk foreign key (contract_id) references contracts(id);

create table contract_lines (
  id            uuid primary key default gen_random_uuid(),
  contract_id   uuid not null references contracts(id) on delete cascade,
  product_id    uuid references products(id),
  description   text not null,
  quantity      numeric(12,3) not null default 1,
  unit_price    numeric(10,2) not null,
  total         numeric(10,2) not null,
  cake_type_id  uuid references cake_types(id),
  flavor_id     uuid references flavors(id),
  decorator_id  uuid references decorators(id),
  cake_message  text,
  photo_url     text,
  sort_order    integer not null default 0
);

create index contract_lines_contract_idx on contract_lines (contract_id);

-- -----------------------------------------------------------------------------
-- 5. Ordem de produção (FOP / FOPDet)
-- -----------------------------------------------------------------------------
create type production_status as enum ('planned', 'in_progress', 'done', 'cancelled');

create table production_orders (
  id         uuid primary key default gen_random_uuid(),
  number     bigserial,
  store_id   uuid not null references stores(id),   -- codtienda
  for_date   date not null,
  status     production_status not null default 'planned',
  notes      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger production_orders_updated_at before update on production_orders
  for each row execute function set_updated_at();

create table production_order_lines (
  id                  uuid primary key default gen_random_uuid(),
  production_order_id uuid not null references production_orders(id) on delete cascade,
  product_id          uuid not null references products(id),
  quantity            numeric(12,3) not null,
  produced_quantity   numeric(12,3) not null default 0,   -- cantguia
  /* Quando a linha existe por causa de uma encomenda. */
  contract_line_id    uuid references contract_lines(id),
  cake_type_id        uuid references cake_types(id),
  flavor_id           uuid references flavors(id),
  decorator_id        uuid references decorators(id)
);

create index production_order_lines_order_idx on production_order_lines (production_order_id);

-- -----------------------------------------------------------------------------
-- 6. Comprovante fiscal (boleta, factura, nota de crédito) via Close2U
--
-- O JSON enviado e a resposta ficam guardados inteiros: é a prova do que foi
-- declarado e o que permite reenviar sem remontar nada. Estados copiados do
-- catálogo 2.13 do manual do provedor.
-- -----------------------------------------------------------------------------
create type fiscal_doc_type as enum ('01', '03', '07', '08');   -- factura, boleta, NC, ND
create type fiscal_channel  as enum ('counter', 'web');

-- Séries e correlativos (Utilitarios › Correlativos do Sisgeco). No modo
-- OFFLINE do Close2U quem numera é a empresa; por isso o site precisa de série
-- própria — se emitir na B003 do balcão, os números colidem com o Sisgeco.
create table fiscal_series (
  id          uuid primary key default gen_random_uuid(),
  serie       text not null unique,          -- 'B003', 'F010', 'B004'
  doc_type    fiscal_doc_type not null,
  channel     fiscal_channel not null,
  store_id    uuid references stores(id),
  next_number bigint not null default 1,
  active      boolean not null default true
);

create type fiscal_status as enum (
  'draft',                 -- montado, não enviado
  'sent',                  -- aceito pelo provedor, aguardando SUNAT
  'accepted',              -- SUNAT 1
  'accepted_with_notes',   -- SUNAT 2
  'rejected',              -- SUNAT 3
  'queued',                -- SUNAT 4
  'pending',               -- SUNAT 5
  'voided',                -- SUNAT 6 (baixa)
  'error'                  -- falha de rede/provedor; vai tentar de novo
);

create table fiscal_documents (
  id            uuid primary key default gen_random_uuid(),
  sale_id       uuid references sales(id),
  doc_type      fiscal_doc_type not null,
  serie         text not null,
  number        bigint not null,
  issued_on     date not null default current_date,
  /* Nota de crédito/débito aponta o comprovante que ajusta. */
  adjusts_id    uuid references fiscal_documents(id),
  adjust_reason text,                        -- catálogo 2.10 / 2.11 do manual
  /* Receptor copiado na emissão: o cadastro do cliente pode mudar depois,
     o comprovante não. */
  customer_doc_type identity_doc not null default 'NONE',
  customer_doc_number text,
  customer_name text not null,
  customer_email text,
  currency      text not null default 'PEN',
  subtotal      numeric(10,2) not null,
  igv           numeric(10,2) not null,
  total         numeric(10,2) not null,
  status        fiscal_status not null default 'draft',
  sunat_code    smallint,                    -- 0..6, cru, para não perder informação
  provider      text not null default 'close2u',
  request       jsonb,
  response      jsonb,
  pdf_url       text,
  xml_url       text,
  cdr_url       text,
  attempts      integer not null default 0,
  last_error    text,
  sent_at       timestamptz,
  accepted_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (serie, number)
);

create index fiscal_documents_sale_idx   on fiscal_documents (sale_id);
create index fiscal_documents_status_idx on fiscal_documents (status) where status in ('error', 'queued', 'pending', 'sent');
create trigger fiscal_documents_updated_at before update on fiscal_documents
  for each row execute function set_updated_at();

-- -----------------------------------------------------------------------------
-- 7. Segurança
--
-- Tudo interno: nada aqui é lido pelo site público. Enquanto não existir o
-- papel de balconista, só administrador entra. Abrir mais cedo seria conceder
-- permissão a uma tela que ainda não existe.
-- -----------------------------------------------------------------------------
alter table product_families       enable row level security;
alter table cake_types             enable row level security;
alter table flavors                enable row level security;
alter table decorators             enable row level security;
alter table sellers                enable row level security;
alter table customers              enable row level security;
alter table cake_units             enable row level security;
alter table stock_levels           enable row level security;
alter table stock_movements        enable row level security;
alter table stock_movement_lines   enable row level security;
alter table sales                  enable row level security;
alter table sale_lines             enable row level security;
alter table sale_payments          enable row level security;
alter table contracts              enable row level security;
alter table contract_lines         enable row level security;
alter table production_orders      enable row level security;
alter table production_order_lines enable row level security;
alter table fiscal_series          enable row level security;
alter table fiscal_documents       enable row level security;

create policy "admin gerencia famílias"       on product_families       for all using (is_admin()) with check (is_admin());
create policy "admin gerencia tipos de torta" on cake_types             for all using (is_admin()) with check (is_admin());
create policy "admin gerencia sabores"        on flavors                for all using (is_admin()) with check (is_admin());
create policy "admin gerencia decoradoras"    on decorators             for all using (is_admin()) with check (is_admin());
create policy "admin gerencia vendedoras"     on sellers                for all using (is_admin()) with check (is_admin());
create policy "admin gerencia clientes"       on customers              for all using (is_admin()) with check (is_admin());
create policy "admin gerencia tortas"         on cake_units             for all using (is_admin()) with check (is_admin());
create policy "admin gerencia saldos"         on stock_levels           for all using (is_admin()) with check (is_admin());
create policy "admin gerencia movimentos"     on stock_movements        for all using (is_admin()) with check (is_admin());
create policy "admin gerencia linhas mov."    on stock_movement_lines   for all using (is_admin()) with check (is_admin());
create policy "admin gerencia vendas"         on sales                  for all using (is_admin()) with check (is_admin());
create policy "admin gerencia linhas venda"   on sale_lines             for all using (is_admin()) with check (is_admin());
create policy "admin gerencia pagamentos"     on sale_payments          for all using (is_admin()) with check (is_admin());
create policy "admin gerencia contratos"      on contracts              for all using (is_admin()) with check (is_admin());
create policy "admin gerencia linhas contr."  on contract_lines         for all using (is_admin()) with check (is_admin());
create policy "admin gerencia OPs"            on production_orders      for all using (is_admin()) with check (is_admin());
create policy "admin gerencia linhas OP"      on production_order_lines for all using (is_admin()) with check (is_admin());
create policy "admin gerencia séries"         on fiscal_series          for all using (is_admin()) with check (is_admin());
create policy "admin gerencia comprovantes"   on fiscal_documents       for all using (is_admin()) with check (is_admin());

-- Famílias vistas nos comprovantes, pelo prefixo do código. Os nomes de PA,
-- PT, H, O são chute a confirmar com a Joseka; os demais estão nas descrições.
insert into product_families (code, name, tracks_serial, sort_order) values
  ('T',   'Tortas',                true,  1),
  ('PS',  'Pastelería',            false, 2),
  ('G',   'Galletas',              false, 3),
  ('K',   'Kekes',                 false, 4),
  ('E',   'Empanadas',             false, 5),
  ('PE',  'Pastelería especial',   false, 6),
  ('CP',  'Copas',                 false, 7),
  ('PA',  'Panadería',             false, 8),
  ('PT',  'Postres',               false, 9),
  ('H',   'Helados',               false, 10),
  ('V',   'Velas',                 false, 11),
  ('O',   'Otros',                 false, 12),
  ('ADL', 'Adelanto de contrato',  false, 90),
  ('REIN','Saldo de contrato',     false, 91);

-- Séries que a loja já usa, para o histórico migrar com o mesmo nome. A do
-- canal web (B004) só entra quando a Close2U a habilitar.
insert into fiscal_series (serie, doc_type, channel, next_number) values
  ('B003', '03', 'counter', 1),
  ('F010', '01', 'counter', 1),
  ('B001', '03', 'counter', 1);
