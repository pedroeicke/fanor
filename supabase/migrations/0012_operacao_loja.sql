-- =============================================================================
-- Tortas Fanor — operação da loja sem o Sisgeco (fase 1)
--
-- Da reunião de 11/09/2026 com o Joseka. O Sisgeco não sabe dizer quais tortas
-- prontas estão no balcão, não liga a torta física à venda da encomenda e não
-- fecha custo com rendimento variável. Em vez de ler o que ele não tem, o
-- fluxo passa a nascer aqui, registrado por quem faz o trabalho:
--
--   vendedora pede (tamanho × quantidade)
--     → taller produz e decide os sabores
--     → despacho com etiqueta QR (torta "em trânsito", fora da vitrine)
--     → vendedora confere na loja; só então a torta sobe na vitrine
--     → venceu: volta ao taller → redecora (1 dia de validade) ou descarta
--
-- Mais o que vem junto: encomenda com adiantamento ligada à torta exata,
-- leads com tempo de resposta e alerta, CRM que se alimenta sozinho,
-- tratamento de foto e backup.
--
-- Convivência: o espelho do Sisgeco continua gravando em `cake_units`. Cada
-- torta diz de onde veio (`source`), e `system_settings.stock_source` decide
-- qual das duas a vitrine lê. Nada muda para o cliente até alguém virar a
-- chave — e ela só vira depois que a boleta sair por aqui (Close2U).
--
-- Aplicar DEPOIS da 0011, em execução separada.
--
-- Convenções de sempre: RLS em tudo, só `is_admin()` lê e escreve; dinheiro
-- NUMERIC(10,2); datas de operação no fuso de Lima, nunca em UTC — às 20h em
-- Arequipa já é amanhã em UTC, e a torta "vencia" quatro horas antes.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. Utilitários
-- -----------------------------------------------------------------------------

/* O "hoje" da loja. Supabase roda em UTC; `current_date` erraria o dia todas
   as noites a partir das 19h de Lima. */
create or replace function lima_today() returns date
language sql stable as $$
  select (now() at time zone 'America/Lima')::date;
$$;

/* Quem pode executar operação: administrador logado, ou o próprio servidor
   com a chave de serviço (rotinas agendadas). Anônimo nunca. */
create or replace function gestion_can_write() returns boolean
language sql stable security definer set search_path = public as $$
  select is_admin()
      or coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'service_role';
$$;

create or replace function op_guard() returns void
language plpgsql stable as $$
begin
  if not gestion_can_write() then
    raise exception 'Sin permiso para esta operación.' using errcode = '42501';
  end if;
end;
$$;

/* Celular peruano: só dígitos, sem o 51. É a chave que junta o mesmo cliente
   vindo do site, do Messenger e do balcão. */
create or replace function normalize_phone(p text) returns text
language plpgsql immutable as $$
declare
  d text;
begin
  if p is null then return null; end if;
  d := regexp_replace(p, '\D', '', 'g');
  if length(d) = 11 and left(d, 2) = '51' then d := substr(d, 3); end if;
  if length(d) < 6 then return null; end if;
  return d;
end;
$$;

-- -----------------------------------------------------------------------------
-- 1. Configuração editável pelo painel
-- -----------------------------------------------------------------------------
create table if not exists system_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

insert into system_settings (key, value) values
  /* 'sisgeco' = vitrine lê o espelho (hoje). 'native' = lê o fluxo novo. */
  ('stock_source', '"sisgeco"'),
  /* Prazos dos alertas. Chute inicial, para confirmar com o Joseka. */
  ('sla', '{"lead_first_contact_min": 15, "request_attend_hours": 4, "dispatch_receive_hours": 3, "complaint_response_days": 15, "sync_stale_min": 15}'),
  /* "Essa nova torta tem um único dia de validade." */
  ('redecorated_shelf_life_days', '1'),
  /* Mensagem que abre o WhatsApp da vendedora já com o contexto do lead —
     o problema relatado era a vendedora mandar mensagem genérica. */
  ('lead_whatsapp_template', '"Hola {nombre}, te escribe {vendedora} de Tortas Fanor 🎂. Vi que te interesa: {interes}. {contexto}"')
on conflict (key) do nothing;

-- -----------------------------------------------------------------------------
-- 2. Catálogo: serviço não mexe em estoque
-- -----------------------------------------------------------------------------
alter table product_families add column if not exists is_service boolean not null default false;
update product_families set is_service = true where code in ('ADL', 'REIN');

/* Validade efetiva: a do produto, senão a da família, senão 2 dias (o que as
   guias de ingresso mostram para quase tudo). */
create or replace function product_shelf_life(p_product uuid) returns integer
language sql stable as $$
  select coalesce(p.shelf_life_days, f.shelf_life_days, 2)
  from products p left join product_families f on f.id = p.family_id
  where p.id = p_product;
$$;

-- -----------------------------------------------------------------------------
-- 3. Vendedoras e o pedido da loja
-- -----------------------------------------------------------------------------
alter table sellers
  add column if not exists store_id uuid references stores(id),
  add column if not exists phone    text,
  add column if not exists role     text not null default 'seller';

do $$ begin
  alter table sellers add constraint sellers_role_chk check (role in ('seller', 'workshop', 'manager'));
exception when duplicate_object then null; end $$;

create unique index if not exists sellers_user_idx on sellers (user_id) where user_id is not null;

/* O pedido da vendedora é a OP do Sisgeco (FOP tem codtienda). `restock` é o
   "preciso dessas tortas" do fim do dia; `contract` nasce da encomenda. */
alter table production_orders
  add column if not exists kind         text not null default 'restock',
  add column if not exists seller_id    uuid references sellers(id),
  add column if not exists requested_by uuid references auth.users(id) on delete set null,
  add column if not exists contract_id  uuid references contracts(id) on delete set null,
  add column if not exists attended_at  timestamptz,
  add column if not exists closed_at    timestamptz;

do $$ begin
  alter table production_orders add constraint production_orders_kind_chk check (kind in ('restock', 'contract'));
exception when duplicate_object then null; end $$;

create index if not exists production_orders_queue_idx on production_orders (status, for_date);

-- -----------------------------------------------------------------------------
-- 4. Despacho do taller para a loja (a "emissão" que acompanha as tortas)
-- -----------------------------------------------------------------------------
do $$ begin
  create type dispatch_status as enum ('in_transit', 'received', 'received_with_issues', 'cancelled');
exception when duplicate_object then null; end $$;

create table if not exists dispatches (
  id                  uuid primary key default gen_random_uuid(),
  number              bigserial,
  /* Vai no QR da guia: curto para caber legível embaixo do código. */
  code                text not null unique default upper(substr(md5(gen_random_uuid()::text), 1, 8)),
  production_order_id uuid references production_orders(id) on delete set null,
  store_id            uuid not null references stores(id),
  status              dispatch_status not null default 'in_transit',
  dispatched_at       timestamptz not null default now(),
  dispatched_by       uuid references auth.users(id) on delete set null,
  received_at         timestamptz,
  received_by         uuid references auth.users(id) on delete set null,
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists dispatches_store_status_idx on dispatches (store_id, status, dispatched_at desc);
drop trigger if exists dispatches_updated_at on dispatches;
create trigger dispatches_updated_at before update on dispatches
  for each row execute function set_updated_at();

/* Itens sem série (pastel, galleta): quantidade, conferida na chegada. */
create table if not exists dispatch_lines (
  id                       uuid primary key default gen_random_uuid(),
  dispatch_id              uuid not null references dispatches(id) on delete cascade,
  product_id               uuid not null references products(id),
  quantity                 numeric(12,3) not null check (quantity > 0),
  received_quantity        numeric(12,3),
  production_order_line_id uuid references production_order_lines(id) on delete set null
);

create index if not exists dispatch_lines_dispatch_idx on dispatch_lines (dispatch_id);

-- -----------------------------------------------------------------------------
-- 5. A torta no fluxo novo
-- -----------------------------------------------------------------------------

/* Default 'sisgeco' de propósito: o leitor da loja está rodando agora e grava
   sem mandar `source`. Com default 'native', tudo que ele gravasse entre esta
   migração e o deploy do código apareceria na vitrine errada. As funções
   daqui mandam 'native' explicitamente. */
alter table cake_units
  add column if not exists source                   text not null default 'sisgeco',
  add column if not exists flavor_id                uuid references flavors(id),
  add column if not exists decorator_id             uuid references decorators(id),
  add column if not exists cake_type_id             uuid references cake_types(id),
  add column if not exists dispatch_id              uuid references dispatches(id) on delete set null,
  add column if not exists production_order_line_id uuid references production_order_lines(id) on delete set null,
  /* Redecorada: aponta a torta que voltou do balcão e foi refeita. */
  add column if not exists origin_unit_id           uuid references cake_units(id),
  add column if not exists redecorated              boolean not null default false,
  add column if not exists received_at              timestamptz,
  add column if not exists returned_at              timestamptz,
  /* Foto da torta de verdade, tirada na loja: é o que a vitrine mostra. */
  add column if not exists photo_url                text,
  add column if not exists notes                    text;

do $$ begin
  alter table cake_units add constraint cake_units_source_chk check (source in ('native', 'sisgeco'));
exception when duplicate_object then null; end $$;

create index if not exists cake_units_native_idx on cake_units (store_id, status, expires_on) where source = 'native';
create index if not exists cake_units_dispatch_idx on cake_units (dispatch_id);
create index if not exists cake_units_contract_idx on cake_units (contract_id) where contract_id is not null;

/* Diário de vida de cada torta. É dele que saem "mais produzidas", "mais
   vendidas" e "o que sobrou" — e é a resposta a "onde está a torta G…?". */
create table if not exists cake_events (
  id           bigint generated always as identity primary key,
  cake_unit_id uuid not null references cake_units(id) on delete cascade,
  kind         text not null check (kind in (
                 'dispatched', 'received', 'missing', 'found', 'returned', 'redecorated',
                 'discarded', 'sold', 'staff_sale', 'reserved', 'released', 'photo')),
  store_id     uuid references stores(id),
  actor        uuid references auth.users(id) on delete set null,
  ref_id       uuid,
  notes        text,
  created_at   timestamptz not null default now()
);

create index if not exists cake_events_unit_idx on cake_events (cake_unit_id, created_at);
create index if not exists cake_events_kind_idx on cake_events (kind, created_at);

-- -----------------------------------------------------------------------------
-- 6. Venda: tipo e fila da boleta
-- -----------------------------------------------------------------------------
alter table sales
  add column if not exists kind           text not null default 'counter',
  /* Venda registrada aqui ainda sem boleta: a emissão pelo Close2U entra
     depois da reunião com o Joseka e varre esta fila. */
  add column if not exists fiscal_pending boolean not null default true,
  add column if not exists created_by     uuid references auth.users(id) on delete set null;

do $$ begin
  alter table sales add constraint sales_kind_chk check (kind in ('counter', 'staff', 'contract_advance', 'contract_balance'));
exception when duplicate_object then null; end $$;

create index if not exists sales_fiscal_pending_idx on sales (sold_at) where fiscal_pending;

-- -----------------------------------------------------------------------------
-- 7. CRM que se alimenta sozinho
-- -----------------------------------------------------------------------------
alter table customers
  add column if not exists phone_norm       text,
  add column if not exists email_norm       text,
  add column if not exists birthday         date,
  add column if not exists tags             text[] not null default '{}',
  add column if not exists source           text,
  add column if not exists first_seen_at    timestamptz not null default now(),
  add column if not exists last_purchase_at timestamptz,
  add column if not exists orders_count     integer not null default 0,
  add column if not exists total_spent      numeric(12,2) not null default 0,
  add column if not exists marketing_opt_in boolean not null default false;

create index if not exists customers_phone_norm_idx on customers (phone_norm) where phone_norm is not null;
create index if not exists customers_email_norm_idx on customers (email_norm) where email_norm is not null;
create index if not exists customers_last_purchase_idx on customers (last_purchase_at desc nulls last);

alter table orders     add column if not exists customer_id uuid references customers(id) on delete set null;
alter table complaints add column if not exists customer_id uuid references customers(id) on delete set null;

create table if not exists customer_notes (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  body        text not null,
  actor       uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);

create index if not exists customer_notes_customer_idx on customer_notes (customer_id, created_at desc);

/**
 * Acha ou cria o cliente. Documento manda; depois celular; depois e-mail.
 *
 * Nunca sobrescreve o que já existe — só preenche o que falta. Nome, celular
 * e e-mail que o cliente digitou numa compra antiga não são apagados por um
 * pedido novo digitado às pressas.
 */
create or replace function crm_upsert_customer(
  p_name text, p_phone text, p_email text,
  p_doc_type identity_doc default 'NONE', p_doc_number text default null,
  p_source text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id    uuid;
  v_phone text := normalize_phone(p_phone);
  v_email text := nullif(lower(trim(coalesce(p_email, ''))), '');
  v_doc   text := case when p_doc_type = 'NONE' then null else nullif(trim(coalesce(p_doc_number, '')), '') end;
  v_name  text := nullif(trim(coalesce(p_name, '')), '');
begin
  if v_name is null and v_phone is null and v_email is null and v_doc is null then
    return null;
  end if;

  if v_doc is not null then
    select id into v_id from customers where doc_type = p_doc_type and doc_number = v_doc limit 1;
  end if;
  if v_id is null and v_phone is not null then
    select id into v_id from customers where phone_norm = v_phone order by created_at limit 1;
  end if;
  if v_id is null and v_email is not null then
    select id into v_id from customers where email_norm = v_email order by created_at limit 1;
  end if;

  if v_id is null then
    insert into customers (doc_type, doc_number, name, email, phone, phone_norm, email_norm, source)
    values (case when v_doc is null then 'NONE' else p_doc_type end, v_doc, coalesce(v_name, 'Cliente'),
            v_email, nullif(trim(coalesce(p_phone, '')), ''), v_phone, v_email, p_source)
    returning id into v_id;
  else
    update customers c set
      name       = case when c.name = 'Cliente' and v_name is not null then v_name else c.name end,
      phone      = coalesce(c.phone, nullif(trim(coalesce(p_phone, '')), '')),
      phone_norm = coalesce(c.phone_norm, v_phone),
      email      = coalesce(c.email, v_email),
      email_norm = coalesce(c.email_norm, v_email),
      doc_type   = case when c.doc_type = 'NONE' and v_doc is not null
                         and not exists (select 1 from customers o where o.doc_type = p_doc_type and o.doc_number = v_doc)
                        then p_doc_type else c.doc_type end,
      doc_number = case when c.doc_number is null and v_doc is not null
                         and not exists (select 1 from customers o where o.doc_type = p_doc_type and o.doc_number = v_doc)
                        then v_doc else c.doc_number end
    where c.id = v_id;
  end if;

  return v_id;
end;
$$;

/* Compras = pedidos pagos do site + vendas de balcão + encomendas. Dinheiro =
   tudo que entrou, adiantamento e saldo incluídos. */
create or replace function crm_refresh_customer_stats(p_customer uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_customer is null then return; end if;

  update customers c set
    orders_count     = s.purchases,
    total_spent      = s.spent,
    last_purchase_at = s.last_at
  from (
    select
      (select count(*) from orders where customer_id = p_customer and status = 'paid')
      + (select count(*) from sales where customer_id = p_customer and status = 'paid' and kind in ('counter', 'staff'))
      + (select count(*) from contracts where customer_id = p_customer and status <> 'cancelled') as purchases,
      coalesce((select sum(total) from orders where customer_id = p_customer and status = 'paid'), 0)
      + coalesce((select sum(total) from sales where customer_id = p_customer and status = 'paid'), 0) as spent,
      greatest(
        (select max(coalesce(paid_at, created_at)) from orders where customer_id = p_customer and status = 'paid'),
        (select max(sold_at) from sales where customer_id = p_customer and status = 'paid'),
        (select max(created_at) from contracts where customer_id = p_customer and status <> 'cancelled')
      ) as last_at
  ) s
  where c.id = p_customer;
end;
$$;

/* O CRM nunca pode derrubar um checkout. Se o cadastro falhar, o pedido entra
   sem cliente ligado e segue a vida. */
create or replace function crm_orders_link() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.customer_id is null then
    begin
      new.customer_id := crm_upsert_customer(new.customer_name, new.customer_phone, new.customer_email, 'NONE', null, 'web');
    exception when others then
      new.customer_id := null;
    end;
  end if;
  return new;
end;
$$;

create or replace function crm_stats_trigger() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  begin
    perform crm_refresh_customer_stats(new.customer_id);
    if tg_op = 'UPDATE' and old.customer_id is distinct from new.customer_id then
      perform crm_refresh_customer_stats(old.customer_id);
    end if;
  exception when others then
    null;
  end;
  return null;
end;
$$;

create or replace function crm_complaints_link() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.customer_id is null then
    begin
      new.customer_id := crm_upsert_customer(
        new.name, new.phone, new.email,
        (case when new.document ~ '^\d{8}$' then 'DNI' when new.document ~ '^\d{11}$' then 'RUC' else 'NONE' end)::identity_doc,
        new.document, 'reclamaciones');
    exception when others then
      new.customer_id := null;
    end;
  end if;
  return new;
end;
$$;

drop trigger if exists orders_crm_link on orders;
create trigger orders_crm_link before insert on orders
  for each row execute function crm_orders_link();

drop trigger if exists orders_crm_stats on orders;
create trigger orders_crm_stats after insert or update of status, total, customer_id on orders
  for each row execute function crm_stats_trigger();

drop trigger if exists sales_crm_stats on sales;
create trigger sales_crm_stats after insert or update of status, total, customer_id on sales
  for each row execute function crm_stats_trigger();

drop trigger if exists contracts_crm_stats on contracts;
create trigger contracts_crm_stats after insert or update of status, customer_id on contracts
  for each row execute function crm_stats_trigger();

drop trigger if exists complaints_crm_link on complaints;
create trigger complaints_crm_link before insert on complaints
  for each row execute function crm_complaints_link();

/* Não é para ninguém chamar pela API: só gatilhos e funções de operação. */
revoke execute on function crm_upsert_customer(text, text, text, identity_doc, text, text) from public, anon, authenticated;
revoke execute on function crm_refresh_customer_stats(uuid) from public, anon, authenticated;
grant  execute on function crm_upsert_customer(text, text, text, identity_doc, text, text) to service_role;
grant  execute on function crm_refresh_customer_stats(uuid) to service_role;

/* Cadastro do painel: mesma regra de fusão, com a porta de administrador. */
create or replace function op_customer_upsert(
  p_name text, p_phone text default null, p_email text default null,
  p_doc_type identity_doc default 'NONE', p_doc_number text default null, p_source text default 'panel'
) returns uuid
language plpgsql security definer set search_path = public as $$
begin
  perform op_guard();
  return crm_upsert_customer(p_name, p_phone, p_email, p_doc_type, p_doc_number, p_source);
end;
$$;

-- Histórico: quem já comprou pelo site ou reclamou vira cliente agora.
update orders set customer_id = crm_upsert_customer(customer_name, customer_phone, customer_email, 'NONE', null, 'web')
where customer_id is null;
update complaints set customer_id = crm_upsert_customer(
  name, phone, email,
  (case when document ~ '^\d{8}$' then 'DNI' when document ~ '^\d{11}$' then 'RUC' else 'NONE' end)::identity_doc,
  document, 'reclamaciones')
where customer_id is null;

-- -----------------------------------------------------------------------------
-- 8. Leads: do Messenger à venda, com relógio
--
-- Hoje o Joseka cola o número num grupo de WhatsApp das duas lojas e não sabe
-- quando (nem se) a vendedora chamou. Aqui o repasse, o primeiro contato e o
-- desfecho têm hora — e o alerta dispara sozinho.
-- -----------------------------------------------------------------------------
do $$ begin
  create type lead_status as enum ('new', 'assigned', 'contacted', 'won', 'lost');
exception when duplicate_object then null; end $$;

create table if not exists leads (
  id               uuid primary key default gen_random_uuid(),
  number           bigserial,
  source           text not null default 'messenger'
                   check (source in ('messenger', 'instagram', 'facebook', 'whatsapp', 'web', 'phone', 'store', 'other')),
  customer_id      uuid references customers(id) on delete set null,
  name             text not null,
  phone            text,
  /* O que já foi conversado. A vendedora abre o WhatsApp com isto pronto. */
  context          text,
  interest         text,
  wanted_on        date,
  store_id         uuid references stores(id),
  seller_id        uuid references sellers(id),
  status           lead_status not null default 'new',
  value            numeric(10,2),
  lost_reason      text,
  order_code       text references orders(code) on delete set null,
  contract_id      uuid references contracts(id) on delete set null,
  created_by       uuid references auth.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  assigned_at      timestamptz,
  first_contact_at timestamptz,
  closed_at        timestamptz,
  updated_at       timestamptz not null default now()
);

create index if not exists leads_open_idx on leads (status, created_at) where status in ('new', 'assigned', 'contacted');
create index if not exists leads_store_idx on leads (store_id, created_at desc);
drop trigger if exists leads_updated_at on leads;
create trigger leads_updated_at before update on leads
  for each row execute function set_updated_at();

create table if not exists lead_events (
  id         bigint generated always as identity primary key,
  lead_id    uuid not null references leads(id) on delete cascade,
  kind       text not null check (kind in ('created', 'assigned', 'contacted', 'won', 'lost', 'note', 'reopened')),
  notes      text,
  actor      uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists lead_events_lead_idx on lead_events (lead_id, created_at);

-- -----------------------------------------------------------------------------
-- 9. Alertas
-- -----------------------------------------------------------------------------
create table if not exists alerts (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null,
  severity     text not null default 'warn' check (severity in ('info', 'warn', 'critical')),
  store_id     uuid references stores(id),
  seller_id    uuid references sellers(id),
  entity       text,
  entity_id    text,
  title        text not null,
  detail       text,
  /* Uma condição, um alerta aberto: recalcular não duplica. */
  dedupe_key   text not null,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  notified_at  timestamptz,
  resolved_at  timestamptz
);

create unique index if not exists alerts_open_dedupe_idx on alerts (dedupe_key) where resolved_at is null;
create index if not exists alerts_open_idx on alerts (severity, created_at desc) where resolved_at is null;

-- -----------------------------------------------------------------------------
-- 10. Foto tratada e backup
-- -----------------------------------------------------------------------------
create table if not exists photo_treatments (
  id             uuid primary key default gen_random_uuid(),
  original_path  text not null,
  processed_path text,
  processed_url  text,
  status         text not null default 'processing' check (status in ('processing', 'done', 'failed')),
  width          integer,
  height         integer,
  ai_used        boolean not null default false,
  /* Nota de qualidade, recorte escolhido, texto alternativo sugerido. */
  report         jsonb,
  target         text not null default 'none' check (target in ('none', 'product', 'cake_unit')),
  target_id      uuid,
  error          text,
  created_by     uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now()
);

create index if not exists photo_treatments_created_idx on photo_treatments (created_at desc);

create table if not exists backup_runs (
  id          bigint generated always as identity primary key,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  status      text not null default 'running' check (status in ('running', 'done', 'failed')),
  path        text,
  tables      integer,
  rows        bigint,
  bytes       bigint,
  error       text
);

insert into storage.buckets (id, name, public, file_size_limit)
values ('backups', 'backups', false, 524288000)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photo-originals', 'photo-originals', false, 15728640, array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
on conflict (id) do nothing;

do $$ begin
  create policy "admin lê backups" on storage.objects for select
    using (bucket_id = 'backups' and is_admin());
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "admin gerencia originais de foto" on storage.objects for all
    using (bucket_id = 'photo-originals' and is_admin())
    with check (bucket_id = 'photo-originals' and is_admin());
exception when duplicate_object then null; end $$;

-- -----------------------------------------------------------------------------
-- 11. Operações
--
-- Cada passo do fluxo é uma função: ou acontece inteiro, ou nada. O cliente
-- JS do Supabase não tem transação, e um despacho que cria metade das tortas
-- porque a rede caiu no meio é estoque fantasma na vitrine.
--
-- Security invoker (o padrão): o RLS de quem chama continua valendo, e
-- `op_guard()` devolve um erro legível em vez de zero linhas.
-- As mensagens de erro são em espanhol porque a vendedora as lê.
-- -----------------------------------------------------------------------------

/* Pedido da vendedora: "preciso destas tortas". Tamanho e quantidade, sem
   sabor — o sabor é autonomia do taller. */
create or replace function op_request_create(
  p_store uuid, p_lines jsonb, p_notes text default null,
  p_seller uuid default null, p_for_date date default null
) returns jsonb
language plpgsql as $$
declare
  v_id     uuid;
  v_number bigint;
  l        jsonb;
  v_qty    numeric;
  v_lines  integer := 0;
begin
  perform op_guard();
  if not exists (select 1 from stores where id = p_store) then
    raise exception 'Tienda no encontrada.';
  end if;
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'El pedido no tiene productos.';
  end if;

  insert into production_orders (store_id, for_date, status, notes, kind, seller_id, requested_by)
  values (p_store, coalesce(p_for_date, lima_today()), 'planned', nullif(trim(coalesce(p_notes, '')), ''),
          'restock', p_seller, auth.uid())
  returning id, number into v_id, v_number;

  for l in select * from jsonb_array_elements(p_lines) loop
    v_qty := (l->>'quantity')::numeric;
    if v_qty is null or v_qty <= 0 or v_qty > 500 then
      raise exception 'Cantidad inválida.';
    end if;
    if not exists (select 1 from products where id = nullif(l->>'product_id', '')::uuid) then
      raise exception 'Producto no encontrado.';
    end if;
    insert into production_order_lines (production_order_id, product_id, quantity)
    values (v_id, (l->>'product_id')::uuid, v_qty);
    v_lines := v_lines + 1;
  end loop;

  return jsonb_build_object('id', v_id, 'number', v_number, 'lines', v_lines);
end;
$$;

/* Cancelar só o que o taller ainda não começou a mandar. */
create or replace function op_request_cancel(p_order uuid, p_reason text default null) returns void
language plpgsql as $$
begin
  perform op_guard();
  if exists (select 1 from production_order_lines where production_order_id = p_order and produced_quantity > 0) then
    raise exception 'El pedido ya tiene despachos. Ciérralo en vez de cancelarlo.';
  end if;
  update production_orders
     set status = 'cancelled'::production_status, closed_at = now(),
         notes = concat_ws(E'\n', notes, nullif('Cancelado: ' || trim(coalesce(p_reason, '')), 'Cancelado: '))
   where id = p_order and status in ('planned', 'in_progress');
  if not found then
    raise exception 'Pedido no encontrado o ya cerrado.';
  end if;
end;
$$;

/* O taller decide não mandar o resto (faltou insumo). Fecha como está. */
create or replace function op_request_close(p_order uuid, p_reason text default null) returns void
language plpgsql as $$
begin
  perform op_guard();
  update production_orders
     set status = 'done'::production_status, closed_at = now(),
         notes = concat_ws(E'\n', notes, nullif('Cerrado: ' || trim(coalesce(p_reason, '')), 'Cerrado: '))
   where id = p_order and status in ('planned', 'in_progress');
  if not found then
    raise exception 'Pedido no encontrado o ya cerrado.';
  end if;
end;
$$;

/**
 * Despacho: o taller manda tortas (já com sabor) para uma loja.
 *
 * `p_cakes`: [{product_id, quantity, flavor_id?, decorator_id?, cake_type_id?,
 *              production_order_line_id?, notes?}] — cada quantidade vira N
 *              tortas, cada uma com série própria, em trânsito.
 * `p_items`: [{product_id, quantity, production_order_line_id?}] — sem série.
 *
 * A pedida "10 × T26" chega aqui como "2 × T26 fresa, 3 × T26 chocolate…":
 * várias entradas apontando a mesma linha do pedido.
 */
create or replace function op_dispatch_create(
  p_store uuid, p_order uuid, p_cakes jsonb, p_items jsonb default '[]'::jsonb, p_notes text default null
) returns jsonb
language plpgsql as $$
declare
  v_dispatch uuid;
  v_number   bigint;
  v_code     text;
  v_mov      uuid;
  c          jsonb;
  i          jsonb;
  k          integer;
  v_qty      numeric;
  v_product  uuid;
  v_line     uuid;
  v_contract uuid;
  v_unit     uuid;
  v_serial   text;
  v_today    date := lima_today();
  v_life     integer;
  v_serials  text[] := '{}';
  v_notes    text := nullif(trim(coalesce(p_notes, '')), '');
begin
  perform op_guard();

  if not exists (select 1 from stores where id = p_store and serial_prefix is not null) then
    raise exception 'La tienda no existe o no tiene prefijo de serie.';
  end if;
  if p_order is not null and not exists (
    select 1 from production_orders where id = p_order and status in ('planned', 'in_progress')
  ) then
    raise exception 'El pedido ya fue cerrado o cancelado.';
  end if;
  if coalesce(jsonb_array_length(p_cakes), 0) + coalesce(jsonb_array_length(p_items), 0) = 0 then
    raise exception 'El despacho está vacío.';
  end if;

  insert into dispatches (production_order_id, store_id, notes, dispatched_by)
  values (p_order, p_store, v_notes, auth.uid())
  returning id, number, code into v_dispatch, v_number, v_code;

  insert into stock_movements (kind, store_id, reference, notes)
  values ('production', p_store, 'Despacho #' || v_number, v_notes)
  returning id into v_mov;

  for c in select * from jsonb_array_elements(coalesce(p_cakes, '[]'::jsonb)) loop
    v_product := nullif(c->>'product_id', '')::uuid;
    v_qty     := (c->>'quantity')::numeric;
    v_line    := nullif(c->>'production_order_line_id', '')::uuid;

    if v_qty is null or v_qty < 1 or v_qty > 200 or v_qty <> trunc(v_qty) then
      raise exception 'Cantidad de tortas inválida.';
    end if;
    if not exists (select 1 from products where id = v_product) then
      raise exception 'Producto no encontrado.';
    end if;

    v_contract := null;
    if v_line is not null then
      select po.contract_id into v_contract
        from production_order_lines pol
        join production_orders po on po.id = pol.production_order_id
       where pol.id = v_line and (p_order is null or pol.production_order_id = p_order);
      if not found then
        raise exception 'La línea no pertenece a este pedido.';
      end if;
      update production_order_lines set produced_quantity = produced_quantity + v_qty where id = v_line;
    end if;

    v_life := product_shelf_life(v_product);

    for k in 1..v_qty::integer loop
      insert into cake_units (
        product_id, store_id, source, status, produced_on, expires_on,
        flavor_id, decorator_id, cake_type_id, dispatch_id, production_order_line_id, contract_id, notes)
      values (
        v_product, p_store, 'native', 'in_transit', v_today, v_today + v_life,
        nullif(c->>'flavor_id', '')::uuid, nullif(c->>'decorator_id', '')::uuid, nullif(c->>'cake_type_id', '')::uuid,
        v_dispatch, v_line, v_contract, nullif(trim(coalesce(c->>'notes', '')), ''))
      returning id, serial into v_unit, v_serial;

      insert into cake_events (cake_unit_id, kind, store_id, actor, ref_id)
      values (v_unit, 'dispatched', p_store, auth.uid(), v_dispatch);
      insert into stock_movement_lines (movement_id, product_id, quantity, cake_unit_id, lot_date)
      values (v_mov, v_product, 1, v_unit, v_today);

      v_serials := v_serials || v_serial;
    end loop;
  end loop;

  for i in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    v_product := nullif(i->>'product_id', '')::uuid;
    v_qty     := (i->>'quantity')::numeric;
    v_line    := nullif(i->>'production_order_line_id', '')::uuid;
    if v_qty is null or v_qty <= 0 or v_qty > 10000 then
      raise exception 'Cantidad inválida.';
    end if;
    if not exists (select 1 from products where id = v_product) then
      raise exception 'Producto no encontrado.';
    end if;
    if v_line is not null then
      update production_order_lines set produced_quantity = produced_quantity + v_qty
       where id = v_line and (p_order is null or production_order_id = p_order);
      if not found then
        raise exception 'La línea no pertenece a este pedido.';
      end if;
    end if;
    insert into dispatch_lines (dispatch_id, product_id, quantity, production_order_line_id)
    values (v_dispatch, v_product, v_qty, v_line);
    insert into stock_movement_lines (movement_id, product_id, quantity, lot_date)
    values (v_mov, v_product, v_qty, v_today);
  end loop;

  if p_order is not null then
    update production_orders po set
      attended_at = coalesce(po.attended_at, now()),
      status = (case when exists (select 1 from production_order_lines where production_order_id = p_order and produced_quantity < quantity)
                     then 'in_progress' else 'done' end)::production_status,
      closed_at = case when exists (select 1 from production_order_lines where production_order_id = p_order and produced_quantity < quantity)
                       then po.closed_at else now() end
    where po.id = p_order;

    update contracts set status = 'in_production'::contract_status
     where id = (select contract_id from production_orders where id = p_order)
       and status = 'open';
  end if;

  return jsonb_build_object('id', v_dispatch, 'number', v_number, 'code', v_code,
                            'serials', to_jsonb(v_serials), 'cakes', coalesce(array_length(v_serials, 1), 0));
end;
$$;

/**
 * Recepção na loja. `p_received` são as séries que a vendedora conferiu
 * (escaneou ou marcou). Toda torta do despacho que não estiver na lista vira
 * "faltante" — a conferência é do despacho inteiro, de uma vez.
 *
 * Torta de encomenda chega reservada: não sobe na vitrine.
 */
create or replace function op_dispatch_receive(
  p_dispatch uuid, p_received text[], p_items jsonb default '[]'::jsonb, p_notes text default null
) returns jsonb
language plpgsql as $$
declare
  v_store   uuid;
  v_status  dispatch_status;
  r         record;
  dl        record;
  v_q       numeric;
  v_ok      integer := 0;
  v_missing integer := 0;
  v_short   boolean := false;
  v_notes   text := nullif(trim(coalesce(p_notes, '')), '');
begin
  perform op_guard();

  select store_id, status into v_store, v_status from dispatches where id = p_dispatch for update;
  if not found then
    raise exception 'Despacho no encontrado.';
  end if;
  if v_status <> 'in_transit' then
    raise exception 'Este despacho ya fue recibido.';
  end if;

  for r in select id, serial, contract_id from cake_units
            where dispatch_id = p_dispatch and status = 'in_transit' for update loop
    if r.serial = any(coalesce(p_received, '{}')) then
      update cake_units
         set status = (case when r.contract_id is not null then 'reserved' else 'in_stock' end)::cake_unit_status,
             received_at = now()
       where id = r.id;
      insert into cake_events (cake_unit_id, kind, store_id, actor, ref_id)
      values (r.id, 'received', v_store, auth.uid(), p_dispatch);
      v_ok := v_ok + 1;
    else
      update cake_units set status = 'missing' where id = r.id;
      insert into cake_events (cake_unit_id, kind, store_id, actor, ref_id, notes)
      values (r.id, 'missing', v_store, auth.uid(), p_dispatch, v_notes);
      v_missing := v_missing + 1;
    end if;
  end loop;

  for dl in select id, product_id, quantity from dispatch_lines where dispatch_id = p_dispatch loop
    v_q := null;
    select (x->>'received_quantity')::numeric into v_q
      from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) x
     where x->>'dispatch_line_id' = dl.id::text
     limit 1;
    v_q := coalesce(v_q, dl.quantity);
    if v_q < 0 then
      raise exception 'Cantidad recibida inválida.';
    end if;
    if v_q < dl.quantity then
      v_short := true;
    end if;
    update dispatch_lines set received_quantity = v_q where id = dl.id;
    insert into stock_levels (store_id, product_id, quantity) values (v_store, dl.product_id, v_q)
      on conflict (store_id, product_id) do update set quantity = stock_levels.quantity + excluded.quantity;
  end loop;

  update dispatches set
    status = (case when v_missing > 0 or v_short then 'received_with_issues' else 'received' end)::dispatch_status,
    received_at = now(),
    received_by = auth.uid(),
    notes = case when v_notes is null then notes else concat_ws(E'\n', notes, 'Recepción: ' || v_notes) end
  where id = p_dispatch;

  /* Encomenda com todas as tortas na loja: pronta para entregar. */
  update contracts c set status = 'ready'::contract_status
   where c.status in ('open', 'in_production')
     and exists (select 1 from cake_units u where u.dispatch_id = p_dispatch and u.contract_id = c.id)
     and (select count(*) from cake_units u where u.contract_id = c.id and u.status in ('reserved', 'sold'))
         >= (select coalesce(sum(cl.quantity), 0)
               from contract_lines cl
               join products p on p.id = cl.product_id
               left join product_families f on f.id = p.family_id
              where cl.contract_id = c.id and coalesce(f.tracks_serial, false));

  return jsonb_build_object('received', v_ok, 'missing', v_missing, 'short_items', v_short);
end;
$$;

/* Faltante que apareceu (chegou no despacho seguinte, estava na caixa errada)
   ou que se deu por perdida. */
create or replace function op_cake_resolve_missing(p_serial text, p_found boolean, p_notes text default null) returns void
language plpgsql as $$
declare
  u record;
begin
  perform op_guard();
  select id, store_id, contract_id, status into u from cake_units where serial = p_serial and source = 'native' for update;
  if not found then
    raise exception 'Torta no encontrada.';
  end if;
  if u.status <> 'missing' then
    raise exception 'La torta % no está como faltante.', p_serial;
  end if;

  if p_found then
    update cake_units
       set status = (case when u.contract_id is not null then 'reserved' else 'in_stock' end)::cake_unit_status,
           received_at = now()
     where id = u.id;
    insert into cake_events (cake_unit_id, kind, store_id, actor, notes)
    values (u.id, 'found', u.store_id, auth.uid(), nullif(trim(coalesce(p_notes, '')), ''));
  else
    update cake_units set status = 'discarded' where id = u.id;
    insert into cake_events (cake_unit_id, kind, store_id, actor, notes)
    values (u.id, 'discarded', u.store_id, auth.uid(), coalesce(nullif(trim(coalesce(p_notes, '')), ''), 'Perdida en el traslado'));
  end if;
end;
$$;

/* Venceu na vitrine: volta ao taller. */
create or replace function op_cakes_return(p_serials text[], p_notes text default null) returns jsonb
language plpgsql as $$
declare
  v_store uuid;
  v_mov   uuid;
  r       record;
  v_n     integer := 0;
  v_notes text := nullif(trim(coalesce(p_notes, '')), '');
begin
  perform op_guard();
  if coalesce(array_length(p_serials, 1), 0) = 0 then
    raise exception 'No hay tortas seleccionadas.';
  end if;
  if (select count(*) from cake_units where serial = any(p_serials) and source = 'native') <> array_length(p_serials, 1) then
    raise exception 'Alguna serie no existe.';
  end if;

  for v_store in select distinct store_id from cake_units where serial = any(p_serials) and source = 'native' loop
    insert into stock_movements (kind, store_id, reference, notes)
    values ('transfer', v_store, 'Devolución al taller', v_notes)
    returning id into v_mov;

    for r in select id, serial, product_id, produced_on, status from cake_units
              where serial = any(p_serials) and source = 'native' and store_id = v_store for update loop
      if r.status <> 'in_stock' then
        raise exception 'La torta % no está en la vitrina.', r.serial;
      end if;
      update cake_units set status = 'returned', returned_at = now() where id = r.id;
      insert into cake_events (cake_unit_id, kind, store_id, actor, notes)
      values (r.id, 'returned', v_store, auth.uid(), v_notes);
      insert into stock_movement_lines (movement_id, product_id, quantity, cake_unit_id, lot_date)
      values (v_mov, r.product_id, 1, r.id, r.produced_on);
      v_n := v_n + 1;
    end loop;
  end loop;

  return jsonb_build_object('returned', v_n);
end;
$$;

/**
 * Redecoração: a torta devolvida em ótimas condições é despida e decorada de
 * novo. Vira outra torta — série nova, 1 dia de validade — e volta para uma
 * loja por despacho, para passar pela conferência como qualquer outra.
 *
 * Só uma vez: torta que já é redecorada não se redecora de novo.
 */
create or replace function op_cake_redecorate(
  p_serial text, p_store uuid, p_decorator uuid default null, p_notes text default null
) returns jsonb
language plpgsql as $$
declare
  o          record;
  v_dispatch uuid;
  v_number   bigint;
  v_code     text;
  v_unit     uuid;
  v_serial   text;
  v_mov      uuid;
  v_today    date := lima_today();
  v_life     integer;
  v_notes    text := nullif(trim(coalesce(p_notes, '')), '');
begin
  perform op_guard();

  select * into o from cake_units where serial = p_serial and source = 'native' for update;
  if not found then
    raise exception 'Torta no encontrada.';
  end if;
  if o.status <> 'returned' then
    raise exception 'Solo se redecora una torta devuelta al taller.';
  end if;
  if o.redecorated or exists (select 1 from cake_units where origin_unit_id = o.id) then
    raise exception 'Esta torta ya fue redecorada una vez.';
  end if;
  if not exists (select 1 from stores where id = p_store and serial_prefix is not null) then
    raise exception 'Tienda inválida.';
  end if;

  select (value #>> '{}')::integer into v_life from system_settings where key = 'redecorated_shelf_life_days';
  v_life := coalesce(v_life, 1);

  insert into dispatches (store_id, notes, dispatched_by)
  values (p_store, concat_ws(' · ', 'Redecoración de ' || o.serial, v_notes), auth.uid())
  returning id, number, code into v_dispatch, v_number, v_code;

  insert into cake_units (
    product_id, store_id, source, status, produced_on, expires_on,
    flavor_id, decorator_id, cake_type_id, dispatch_id, origin_unit_id, redecorated, notes)
  values (
    o.product_id, p_store, 'native', 'in_transit', v_today, v_today + v_life,
    o.flavor_id, coalesce(p_decorator, o.decorator_id), o.cake_type_id, v_dispatch, o.id, true, v_notes)
  returning id, serial into v_unit, v_serial;

  insert into cake_events (cake_unit_id, kind, store_id, actor, ref_id, notes)
  values (o.id, 'redecorated', o.store_id, auth.uid(), v_unit, v_notes);
  insert into cake_events (cake_unit_id, kind, store_id, actor, ref_id)
  values (v_unit, 'dispatched', p_store, auth.uid(), v_dispatch);

  insert into stock_movements (kind, store_id, reference, notes)
  values ('production', p_store, 'Redecoración · Despacho #' || v_number, 'Torta de origen ' || o.serial)
  returning id into v_mov;
  insert into stock_movement_lines (movement_id, product_id, quantity, cake_unit_id, lot_date)
  values (v_mov, o.product_id, 1, v_unit, v_today);

  return jsonb_build_object('dispatch_id', v_dispatch, 'number', v_number, 'code', v_code,
                            'serial', v_serial, 'expires_on', v_today + v_life);
end;
$$;

create or replace function op_cakes_discard(p_serials text[], p_reason text default null) returns jsonb
language plpgsql as $$
declare
  v_store uuid;
  v_mov   uuid;
  r       record;
  v_n     integer := 0;
  v_notes text := coalesce(nullif(trim(coalesce(p_reason, '')), ''), 'Descarte');
begin
  perform op_guard();
  if coalesce(array_length(p_serials, 1), 0) = 0 then
    raise exception 'No hay tortas seleccionadas.';
  end if;
  if (select count(*) from cake_units where serial = any(p_serials) and source = 'native') <> array_length(p_serials, 1) then
    raise exception 'Alguna serie no existe.';
  end if;

  for v_store in select distinct store_id from cake_units where serial = any(p_serials) and source = 'native' loop
    insert into stock_movements (kind, store_id, reference, notes)
    values ('discard', v_store, 'Descarte', v_notes)
    returning id into v_mov;

    for r in select id, serial, product_id, produced_on, status from cake_units
              where serial = any(p_serials) and source = 'native' and store_id = v_store for update loop
      if r.status not in ('returned', 'in_stock', 'missing') then
        raise exception 'La torta % no se puede descartar (%).', r.serial, r.status;
      end if;
      update cake_units set status = 'discarded' where id = r.id;
      insert into cake_events (cake_unit_id, kind, store_id, actor, notes)
      values (r.id, 'discarded', v_store, auth.uid(), v_notes);
      insert into stock_movement_lines (movement_id, product_id, quantity, cake_unit_id, lot_date)
      values (v_mov, r.product_id, 1, r.id, r.produced_on);
      v_n := v_n + 1;
    end loop;
  end loop;

  return jsonb_build_object('discarded', v_n);
end;
$$;

/**
 * Venda. Serve ao balcão, à compra da vendedora e às duas partes da
 * encomenda (adiantamento e saldo).
 *
 * `p_lines`: [{cake_serial?} | {product_id?, description?, quantity}, unit_price, discount?]
 * `p_payments`: [{method, amount, reference?}] — pago a mais só em dinheiro,
 *               e o vuelto é descontado do pagamento em dinheiro: o caixa
 *               tem de bater com o que ficou na gaveta.
 *
 * Preço com IGV incluído, como na boleta. Torta sai por série; tudo que é
 * da família torta exige a série — vender "uma T26" sem dizer qual é
 * justamente o furo do Sisgeco que motivou isto.
 */
create or replace function op_sale_register(
  p_store uuid, p_lines jsonb, p_payments jsonb,
  p_seller uuid default null, p_customer uuid default null,
  p_kind text default 'counter', p_contract uuid default null, p_notes text default null
) returns jsonb
language plpgsql as $$
declare
  v_sale         uuid;
  v_number       bigint;
  v_mov          uuid;
  l              jsonb;
  p              jsonb;
  u              record;
  v_product      uuid;
  v_desc         text;
  v_qty          numeric;
  v_price        numeric(10,2);
  v_disc         numeric(10,2);
  v_line_total   numeric(10,2);
  v_total        numeric(10,2) := 0;
  v_paid         numeric(10,2) := 0;
  v_change       numeric(10,2);
  v_cash         uuid;
  v_service      boolean;
  v_needs_serial boolean;
  v_sort         integer := 0;
  v_igv          numeric(10,2);
begin
  perform op_guard();

  if p_kind not in ('counter', 'staff', 'contract_advance', 'contract_balance') then
    raise exception 'Tipo de venta inválido.';
  end if;
  if not exists (select 1 from stores where id = p_store) then
    raise exception 'Tienda no encontrada.';
  end if;
  if coalesce(jsonb_array_length(p_lines), 0) = 0 then
    raise exception 'La venta no tiene productos.';
  end if;
  if p_kind in ('contract_advance', 'contract_balance') and p_contract is null then
    raise exception 'Falta la encomienda.';
  end if;

  insert into sales (store_id, seller_id, customer_id, status, kind, contract_id, notes, created_by)
  values (p_store, p_seller, p_customer, 'open', p_kind, p_contract, nullif(trim(coalesce(p_notes, '')), ''), auth.uid())
  returning id, number into v_sale, v_number;

  insert into stock_movements (kind, store_id, reference, seller_id)
  values ('sale', p_store, 'Venta #' || v_number, p_seller)
  returning id into v_mov;

  for l in select * from jsonb_array_elements(p_lines) loop
    v_price := round((l->>'unit_price')::numeric, 2);
    v_disc  := round(coalesce((l->>'discount')::numeric, 0), 2);
    if v_price is null or v_price < 0 or v_disc < 0 then
      raise exception 'Precio inválido.';
    end if;

    if nullif(l->>'cake_serial', '') is not null then
      select * into u from cake_units where serial = l->>'cake_serial' and source = 'native' for update;
      if not found then
        raise exception 'Torta % no encontrada.', l->>'cake_serial';
      end if;
      if u.store_id <> p_store then
        raise exception 'La torta % es de otra tienda.', u.serial;
      end if;
      if not (u.status = 'in_stock' or (u.status = 'reserved' and p_contract is not null and u.contract_id = p_contract)) then
        raise exception 'La torta % no está disponible.', u.serial;
      end if;

      v_qty := 1;
      v_product := u.product_id;
      select coalesce(nullif(trim(coalesce(l->>'description', '')), ''), p.name) into v_desc from products p where p.id = v_product;
      v_line_total := round(v_price - v_disc, 2);
      if v_line_total < 0 then
        raise exception 'El descuento supera el precio.';
      end if;

      insert into sale_lines (sale_id, product_id, description, quantity, unit_price, discount, igv, total,
                              cake_unit_id, lot_date, expires_on, sort_order)
      values (v_sale, v_product, v_desc, 1, v_price, v_disc, round(v_line_total - v_line_total / 1.18, 2), v_line_total,
              u.id, u.produced_on, u.expires_on, v_sort);

      update cake_units set status = 'sold' where id = u.id;
      insert into cake_events (cake_unit_id, kind, store_id, actor, ref_id)
      values (u.id, case when p_kind = 'staff' then 'staff_sale' else 'sold' end, p_store, auth.uid(), v_sale);
      insert into stock_movement_lines (movement_id, product_id, quantity, cake_unit_id, lot_date)
      values (v_mov, v_product, 1, u.id, u.produced_on);
    else
      v_product := nullif(l->>'product_id', '')::uuid;
      v_qty     := coalesce((l->>'quantity')::numeric, 1);
      v_desc    := nullif(trim(coalesce(l->>'description', '')), '');
      if v_qty <= 0 or v_qty > 1000 then
        raise exception 'Cantidad inválida.';
      end if;

      v_service := p_kind in ('contract_advance', 'contract_balance');
      v_needs_serial := false;
      if v_product is not null then
        select coalesce(v_desc, p.name), v_service or coalesce(f.is_service, false), coalesce(f.tracks_serial, false)
          into v_desc, v_service, v_needs_serial
          from products p left join product_families f on f.id = p.family_id
         where p.id = v_product;
        if not found then
          raise exception 'Producto no encontrado.';
        end if;
        if v_needs_serial and not v_service then
          raise exception 'Para vender % escanea la serie de la torta.', v_desc;
        end if;
      end if;
      if v_desc is null then
        raise exception 'Falta la descripción del ítem.';
      end if;

      v_line_total := round(v_qty * v_price - v_disc, 2);
      if v_line_total < 0 then
        raise exception 'El descuento supera el precio.';
      end if;

      insert into sale_lines (sale_id, product_id, description, quantity, unit_price, discount, igv, total, sort_order)
      values (v_sale, v_product, v_desc, v_qty, v_price, v_disc, round(v_line_total - v_line_total / 1.18, 2), v_line_total, v_sort);

      if v_product is not null and not v_service then
        insert into stock_levels (store_id, product_id, quantity) values (p_store, v_product, -v_qty)
          on conflict (store_id, product_id) do update set quantity = stock_levels.quantity - v_qty;
        insert into stock_movement_lines (movement_id, product_id, quantity)
        values (v_mov, v_product, v_qty);
      end if;
    end if;

    v_total := v_total + v_line_total;
    v_sort := v_sort + 1;
  end loop;

  for p in select * from jsonb_array_elements(coalesce(p_payments, '[]'::jsonb)) loop
    if coalesce(p->>'method', '') not in ('cash', 'card', 'yape', 'plin', 'transfer', 'deposit', 'credit') then
      raise exception 'Forma de pago inválida.';
    end if;
    if coalesce((p->>'amount')::numeric, 0) <= 0 then
      raise exception 'Monto de pago inválido.';
    end if;
    insert into sale_payments (sale_id, method, amount, reference)
    values (v_sale, (p->>'method')::payment_method, round((p->>'amount')::numeric, 2), nullif(trim(coalesce(p->>'reference', '')), ''))
    returning id into v_cash;
    v_paid := v_paid + round((p->>'amount')::numeric, 2);
  end loop;

  if v_paid < v_total then
    raise exception 'Falta cobrar S/ %.', to_char(v_total - v_paid, 'FM999999990.00');
  end if;

  v_change := v_paid - v_total;
  if v_change > 0 then
    select id into v_cash from sale_payments
     where sale_id = v_sale and method = 'cash' and amount >= v_change
     order by amount desc limit 1;
    if v_cash is null then
      raise exception 'El vuelto solo aplica a pagos en efectivo.';
    end if;
    update sale_payments set amount = amount - v_change where id = v_cash;
  end if;

  v_igv := round(v_total - v_total / 1.18, 2);
  update sales set subtotal = v_total - v_igv, igv = v_igv, total = v_total, status = 'paid', sold_at = now()
   where id = v_sale;

  /* Venda só de serviço (adiantamento) não movimenta estoque. */
  delete from stock_movements m
   where m.id = v_mov and not exists (select 1 from stock_movement_lines where movement_id = v_mov);

  return jsonb_build_object('id', v_sale, 'number', v_number, 'total', v_total, 'paid', v_paid, 'change', v_change);
end;
$$;

/**
 * Encomenda: contrato + OP para o taller + adiantamento (opcional).
 *
 * `p_lines`: [{product_id, quantity, unit_price, description?, flavor_id?,
 *              decorator_id?, cake_type_id?, cake_message?, photo_url?}]
 * `p_advance`: {amount, method, reference?} ou null
 */
create or replace function op_contract_create(
  p_store uuid, p_deliver_on date, p_lines jsonb,
  p_customer uuid default null, p_seller uuid default null, p_deliver_at time default null,
  p_deliver_place text default null, p_notes text default null, p_advance jsonb default null
) returns jsonb
language plpgsql as $$
declare
  v_contract     uuid;
  v_number       bigint;
  v_order        uuid;
  l              jsonb;
  v_line         uuid;
  v_product      uuid;
  v_desc         text;
  v_qty          numeric;
  v_price        numeric(10,2);
  v_line_total   numeric(10,2);
  v_total        numeric(10,2) := 0;
  v_needs_serial boolean;
  v_has_cake     boolean := false;
  v_sort         integer := 0;
  v_adv          numeric(10,2);
  v_adl          uuid;
  v_sale         jsonb;
begin
  perform op_guard();

  if not exists (select 1 from stores where id = p_store) then
    raise exception 'Tienda no encontrada.';
  end if;
  if p_deliver_on is null or p_deliver_on < lima_today() then
    raise exception 'La fecha de entrega no puede ser pasada.';
  end if;
  if coalesce(jsonb_array_length(p_lines), 0) = 0 then
    raise exception 'La encomienda no tiene productos.';
  end if;

  insert into contracts (store_id, customer_id, seller_id, status, deliver_on, deliver_at, deliver_place, notes)
  values (p_store, p_customer, p_seller, 'open', p_deliver_on, p_deliver_at,
          nullif(trim(coalesce(p_deliver_place, '')), ''), nullif(trim(coalesce(p_notes, '')), ''))
  returning id, number into v_contract, v_number;

  insert into production_orders (store_id, for_date, status, notes, kind, seller_id, requested_by, contract_id)
  values (p_store, p_deliver_on, 'planned', 'Encomienda #' || v_number, 'contract', p_seller, auth.uid(), v_contract)
  returning id into v_order;

  for l in select * from jsonb_array_elements(p_lines) loop
    v_product := nullif(l->>'product_id', '')::uuid;
    v_qty     := coalesce((l->>'quantity')::numeric, 1);
    v_price   := round((l->>'unit_price')::numeric, 2);
    if v_qty <= 0 or v_qty > 100 or v_price is null or v_price < 0 then
      raise exception 'Cantidad o precio inválido.';
    end if;

    select coalesce(nullif(trim(coalesce(l->>'description', '')), ''), p.name), coalesce(f.tracks_serial, false)
      into v_desc, v_needs_serial
      from products p left join product_families f on f.id = p.family_id
     where p.id = v_product;
    if not found then
      raise exception 'Producto no encontrado.';
    end if;

    v_line_total := round(v_qty * v_price, 2);
    insert into contract_lines (contract_id, product_id, description, quantity, unit_price, total,
                                cake_type_id, flavor_id, decorator_id, cake_message, photo_url, sort_order)
    values (v_contract, v_product, v_desc, v_qty, v_price, v_line_total,
            nullif(l->>'cake_type_id', '')::uuid, nullif(l->>'flavor_id', '')::uuid, nullif(l->>'decorator_id', '')::uuid,
            nullif(trim(coalesce(l->>'cake_message', '')), ''), nullif(trim(coalesce(l->>'photo_url', '')), ''), v_sort)
    returning id into v_line;

    if v_needs_serial then
      insert into production_order_lines (production_order_id, product_id, quantity, contract_line_id,
                                          cake_type_id, flavor_id, decorator_id)
      values (v_order, v_product, v_qty, v_line,
              nullif(l->>'cake_type_id', '')::uuid, nullif(l->>'flavor_id', '')::uuid, nullif(l->>'decorator_id', '')::uuid);
      v_has_cake := true;
    end if;

    v_total := v_total + v_line_total;
    v_sort := v_sort + 1;
  end loop;

  if not v_has_cake then
    delete from production_orders where id = v_order;
    v_order := null;
  end if;

  update contracts set total = v_total where id = v_contract;

  v_adv := round(coalesce((p_advance->>'amount')::numeric, 0), 2);
  if v_adv > 0 then
    if v_adv > v_total then
      raise exception 'El adelanto supera el total de la encomienda.';
    end if;
    select id into v_adl from products where sku = 'ADL' limit 1;
    v_sale := op_sale_register(
      p_store,
      jsonb_build_array(jsonb_build_object('product_id', v_adl, 'description', 'Adelanto encomienda #' || v_number,
                                           'quantity', 1, 'unit_price', v_adv)),
      jsonb_build_array(jsonb_build_object('method', p_advance->>'method', 'amount', v_adv, 'reference', p_advance->>'reference')),
      p_seller, p_customer, 'contract_advance', v_contract, null);
  end if;

  return jsonb_build_object('id', v_contract, 'number', v_number, 'total', v_total,
                            'production_order_id', v_order, 'advance_sale', v_sale);
end;
$$;

/**
 * Entrega da encomenda: diz QUAL torta saiu (o furo do Sisgeco) e cobra o
 * saldo. A torta pode ser a reservada para ela ou uma da vitrine da mesma
 * loja, quando a vendedora resolve com o que tem.
 */
create or replace function op_contract_deliver(
  p_contract uuid, p_serials text[], p_payments jsonb default '[]'::jsonb, p_notes text default null
) returns jsonb
language plpgsql as $$
declare
  c         record;
  u         record;
  v_paid    numeric(10,2);
  v_balance numeric(10,2);
  v_mov     uuid;
  v_rein    uuid;
  v_sale    jsonb;
  v_n       integer := 0;
begin
  perform op_guard();

  select * into c from contracts where id = p_contract for update;
  if not found then
    raise exception 'Encomienda no encontrada.';
  end if;
  if c.status in ('delivered', 'cancelled') then
    raise exception 'La encomienda ya fue entregada o cancelada.';
  end if;

  if coalesce(array_length(p_serials, 1), 0) > 0 then
    insert into stock_movements (kind, store_id, reference, notes)
    values ('sale', c.store_id, 'Entrega encomienda #' || c.number, nullif(trim(coalesce(p_notes, '')), ''))
    returning id into v_mov;

    for u in select * from cake_units where serial = any(p_serials) and source = 'native' for update loop
      if u.store_id <> c.store_id then
        raise exception 'La torta % es de otra tienda.', u.serial;
      end if;
      if not ((u.status = 'reserved' and u.contract_id = p_contract) or u.status = 'in_stock') then
        raise exception 'La torta % no está disponible.', u.serial;
      end if;
      update cake_units set status = 'sold', contract_id = p_contract where id = u.id;
      insert into cake_events (cake_unit_id, kind, store_id, actor, ref_id)
      values (u.id, 'sold', c.store_id, auth.uid(), p_contract);
      insert into stock_movement_lines (movement_id, product_id, quantity, cake_unit_id, lot_date)
      values (v_mov, u.product_id, 1, u.id, u.produced_on);
      v_n := v_n + 1;
    end loop;

    if v_n <> array_length(p_serials, 1) then
      raise exception 'Alguna serie no existe.';
    end if;
  end if;

  select coalesce(sum(total), 0) into v_paid from sales where contract_id = p_contract and status = 'paid';
  v_balance := c.total - v_paid;

  if v_balance > 0 then
    select id into v_rein from products where sku = 'REIN' limit 1;
    v_sale := op_sale_register(
      c.store_id,
      jsonb_build_array(jsonb_build_object('product_id', v_rein, 'description', 'Saldo encomienda #' || c.number,
                                           'quantity', 1, 'unit_price', v_balance)),
      p_payments, c.seller_id, c.customer_id, 'contract_balance', p_contract, null);
  end if;

  /* Reservada que sobrou (entregaram outra da vitrine no lugar): volta a
     ficar disponível. */
  for u in select id, store_id from cake_units where contract_id = p_contract and status = 'reserved' for update loop
    update cake_units set status = 'in_stock', contract_id = null where id = u.id;
    insert into cake_events (cake_unit_id, kind, store_id, actor, ref_id, notes)
    values (u.id, 'released', u.store_id, auth.uid(), p_contract, 'Sobró de la encomienda');
  end loop;

  update contracts set status = 'delivered', closed_at = now() where id = p_contract;

  return jsonb_build_object('cakes', v_n, 'balance', greatest(v_balance, 0), 'balance_sale', v_sale);
end;
$$;

create or replace function op_contract_cancel(p_contract uuid, p_reason text default null) returns void
language plpgsql as $$
declare
  u record;
begin
  perform op_guard();
  update contracts
     set status = 'cancelled', closed_at = now(),
         notes = concat_ws(E'\n', notes, nullif('Cancelada: ' || trim(coalesce(p_reason, '')), 'Cancelada: '))
   where id = p_contract and status not in ('delivered', 'cancelled');
  if not found then
    raise exception 'La encomienda no se puede cancelar.';
  end if;

  for u in select id, store_id from cake_units where contract_id = p_contract and status = 'reserved' loop
    update cake_units set status = 'in_stock', contract_id = null where id = u.id;
    insert into cake_events (cake_unit_id, kind, store_id, actor, ref_id, notes)
    values (u.id, 'released', u.store_id, auth.uid(), p_contract, 'Encomienda cancelada');
  end loop;

  update production_orders set status = 'cancelled', closed_at = now()
   where contract_id = p_contract and status = 'planned';
end;
$$;

-- Leads -----------------------------------------------------------------------

create or replace function op_lead_create(
  p_name text, p_phone text default null, p_source text default 'messenger',
  p_context text default null, p_interest text default null, p_wanted_on date default null,
  p_store uuid default null, p_seller uuid default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_id       uuid;
  v_number   bigint;
  v_customer uuid;
  v_assigned boolean := p_store is not null or p_seller is not null;
begin
  perform op_guard();
  if nullif(trim(coalesce(p_name, '')), '') is null then
    raise exception 'Falta el nombre.';
  end if;

  v_customer := crm_upsert_customer(p_name, p_phone, null, 'NONE', null, p_source);

  insert into leads (source, customer_id, name, phone, context, interest, wanted_on, store_id, seller_id,
                     status, assigned_at, created_by)
  values (p_source, v_customer, trim(p_name), nullif(trim(coalesce(p_phone, '')), ''),
          nullif(trim(coalesce(p_context, '')), ''), nullif(trim(coalesce(p_interest, '')), ''), p_wanted_on,
          p_store, p_seller,
          (case when v_assigned then 'assigned' else 'new' end)::lead_status,
          case when v_assigned then now() end, auth.uid())
  returning id, number into v_id, v_number;

  insert into lead_events (lead_id, kind, actor) values (v_id, 'created', auth.uid());
  if v_assigned then
    insert into lead_events (lead_id, kind, actor) values (v_id, 'assigned', auth.uid());
  end if;

  return jsonb_build_object('id', v_id, 'number', v_number, 'customer_id', v_customer);
end;
$$;

create or replace function op_lead_assign(p_lead uuid, p_store uuid, p_seller uuid default null) returns void
language plpgsql as $$
begin
  perform op_guard();
  update leads set
    store_id = p_store,
    seller_id = p_seller,
    assigned_at = now(),
    status = (case when status = 'new' then 'assigned' else status::text end)::lead_status
  where id = p_lead and status not in ('won', 'lost');
  if not found then
    raise exception 'Lead no encontrado o cerrado.';
  end if;
  insert into lead_events (lead_id, kind, actor) values (p_lead, 'assigned', auth.uid());
end;
$$;

/* A vendedora tocou "Escribir por WhatsApp". É a hora do primeiro contato
   que o Joseka não tinha como saber. Só a primeira vez conta. */
create or replace function op_lead_contact(p_lead uuid, p_notes text default null) returns void
language plpgsql as $$
begin
  perform op_guard();
  update leads set
    first_contact_at = coalesce(first_contact_at, now()),
    status = (case when status in ('new', 'assigned') then 'contacted' else status::text end)::lead_status
  where id = p_lead;
  if not found then
    raise exception 'Lead no encontrado.';
  end if;
  insert into lead_events (lead_id, kind, notes, actor) values (p_lead, 'contacted', nullif(trim(coalesce(p_notes, '')), ''), auth.uid());
end;
$$;

/* Fechar sem contato registrado não inventa contato: o tempo de resposta
   daquele lead fica em branco, e o relatório mostra isso. */
create or replace function op_lead_close(
  p_lead uuid, p_won boolean, p_value numeric default null, p_reason text default null,
  p_order_code text default null, p_contract uuid default null
) returns void
language plpgsql as $$
begin
  perform op_guard();
  if not p_won and nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'Indica el motivo de la pérdida.';
  end if;
  update leads set
    status = (case when p_won then 'won' else 'lost' end)::lead_status,
    closed_at = now(),
    value = case when p_won then p_value else value end,
    lost_reason = case when p_won then null else trim(p_reason) end,
    order_code = coalesce(p_order_code, order_code),
    contract_id = coalesce(p_contract, contract_id)
  where id = p_lead and status not in ('won', 'lost');
  if not found then
    raise exception 'Lead no encontrado o ya cerrado.';
  end if;
  insert into lead_events (lead_id, kind, notes, actor)
  values (p_lead, case when p_won then 'won' else 'lost' end, nullif(trim(coalesce(p_reason, '')), ''), auth.uid());
end;
$$;

create or replace function op_lead_note(p_lead uuid, p_notes text) returns void
language plpgsql as $$
begin
  perform op_guard();
  if nullif(trim(coalesce(p_notes, '')), '') is null then
    raise exception 'La nota está vacía.';
  end if;
  insert into lead_events (lead_id, kind, notes, actor) values (p_lead, 'note', trim(p_notes), auth.uid());
end;
$$;

-- Alertas ---------------------------------------------------------------------

create or replace function alerts_upsert(
  p_key text, p_kind text, p_severity text, p_store uuid, p_seller uuid,
  p_entity text, p_entity_id text, p_title text, p_detail text
) returns void
language sql as $$
  insert into alerts (dedupe_key, kind, severity, store_id, seller_id, entity, entity_id, title, detail)
  values (p_key, p_kind, p_severity, p_store, p_seller, p_entity, p_entity_id, p_title, p_detail)
  on conflict (dedupe_key) where resolved_at is null
  do update set severity = excluded.severity, title = excluded.title, detail = excluded.detail,
                store_id = excluded.store_id, seller_id = excluded.seller_id, last_seen_at = now();
$$;

/**
 * Recalcula o que está atrasado. Abre alerta novo, atualiza o que continua e
 * fecha o que se resolveu. Idempotente: pode rodar a cada abertura do painel
 * e a cada rotina agendada.
 */
create or replace function alerts_refresh() returns integer
language plpgsql as $$
declare
  v_sla        jsonb;
  v_lead_min   integer;
  v_req_h      integer;
  v_disp_h     integer;
  v_compl_d    integer;
  v_sync_min   integer;
  v_now        timestamptz := now();
  v_today      date := lima_today();
  v_keys       text[] := '{}';
  v_key        text;
  v_minutes    integer;
  v_source     text;
  v_last_sync  timestamptz;
  r            record;
begin
  perform op_guard();

  select value into v_sla from system_settings where key = 'sla';
  v_lead_min := coalesce((v_sla->>'lead_first_contact_min')::integer, 15);
  v_req_h    := coalesce((v_sla->>'request_attend_hours')::integer, 4);
  v_disp_h   := coalesce((v_sla->>'dispatch_receive_hours')::integer, 3);
  v_compl_d  := coalesce((v_sla->>'complaint_response_days')::integer, 15);
  v_sync_min := coalesce((v_sla->>'sync_stale_min')::integer, 15);

  -- Lead sem primeiro contato.
  for r in select id, number, name, store_id, seller_id, coalesce(assigned_at, created_at) as since, status
             from leads
            where status in ('new', 'assigned') and first_contact_at is null
              and coalesce(assigned_at, created_at) < v_now - make_interval(mins => v_lead_min) loop
    v_key := 'lead:' || r.id;
    v_minutes := floor(extract(epoch from (v_now - r.since)) / 60);
    perform alerts_upsert(v_key, 'lead_sla',
      case when v_minutes >= v_lead_min * 4 then 'critical' else 'warn' end,
      r.store_id, r.seller_id, 'leads', r.id::text,
      case when r.status = 'new' then format('Lead #%s sin asignar: %s', r.number, r.name)
           else format('Lead #%s sin contacto: %s', r.number, r.name) end,
      format('Esperando hace %s min', v_minutes));
    v_keys := v_keys || v_key;
  end loop;

  -- Pedido da loja que o taller não atendeu.
  for r in select id, number, store_id, created_at from production_orders
            where kind = 'restock' and status = 'planned' and attended_at is null
              and created_at < v_now - make_interval(hours => v_req_h) loop
    v_key := 'request:' || r.id;
    perform alerts_upsert(v_key, 'request_sla', 'warn', r.store_id, null, 'production_orders', r.id::text,
      format('Pedido de tienda #%s sin atender', r.number),
      format('Enviado hace %s h', floor(extract(epoch from (v_now - r.created_at)) / 3600)::integer));
    v_keys := v_keys || v_key;
  end loop;

  -- Encomenda para hoje/amanhã ainda não despachada.
  for r in select po.id, c.number, po.store_id, po.for_date from production_orders po
             join contracts c on c.id = po.contract_id
            where po.kind = 'contract' and po.status = 'planned' and po.for_date <= v_today + 1 loop
    v_key := 'contract_due:' || r.id;
    perform alerts_upsert(v_key, 'contract_due',
      case when r.for_date <= v_today then 'critical' else 'warn' end,
      r.store_id, null, 'contracts', r.id::text,
      format('Encomienda #%s sin producir', r.number),
      format('Entrega %s', to_char(r.for_date, 'DD/MM')));
    v_keys := v_keys || v_key;
  end loop;

  -- Encomenda pronta que passou da data.
  for r in select id, number, store_id, deliver_on from contracts
            where status in ('open', 'in_production', 'ready') and deliver_on < v_today loop
    v_key := 'contract_overdue:' || r.id;
    perform alerts_upsert(v_key, 'contract_overdue', 'critical', r.store_id, null, 'contracts', r.id::text,
      format('Encomienda #%s no entregada', r.number),
      format('Debía entregarse el %s', to_char(r.deliver_on, 'DD/MM')));
    v_keys := v_keys || v_key;
  end loop;

  -- Despacho que ninguém conferiu.
  for r in select id, number, store_id, dispatched_at from dispatches
            where status = 'in_transit' and dispatched_at < v_now - make_interval(hours => v_disp_h) loop
    v_key := 'dispatch:' || r.id;
    perform alerts_upsert(v_key, 'dispatch_sla', 'warn', r.store_id, null, 'dispatches', r.id::text,
      format('Despacho #%s sin recibir', r.number),
      format('Salió del taller hace %s h', floor(extract(epoch from (v_now - r.dispatched_at)) / 3600)::integer));
    v_keys := v_keys || v_key;
  end loop;

  -- Torta vencida ainda na vitrine.
  for r in select u.store_id, s.name as store_name, count(*)::integer as n from cake_units u
             join stores s on s.id = u.store_id
            where u.source = 'native' and u.status = 'in_stock' and u.expires_on < v_today
            group by u.store_id, s.name loop
    v_key := 'expired:' || r.store_id;
    perform alerts_upsert(v_key, 'expired_cakes', 'critical', r.store_id, null, 'stores', r.store_id::text,
      format('%s torta(s) vencida(s) en vitrina', r.n), format('%s · devolver al taller', r.store_name));
    v_keys := v_keys || v_key;
  end loop;

  -- Faltantes sem esclarecer.
  for r in select u.store_id, s.name as store_name, count(*)::integer as n from cake_units u
             join stores s on s.id = u.store_id
            where u.source = 'native' and u.status = 'missing'
            group by u.store_id, s.name loop
    v_key := 'missing:' || r.store_id;
    perform alerts_upsert(v_key, 'missing_cakes', 'warn', r.store_id, null, 'stores', r.store_id::text,
      format('%s torta(s) faltante(s) sin aclarar', r.n), r.store_name);
    v_keys := v_keys || v_key;
  end loop;

  -- Libro de Reclamaciones: aviso aos 2/3 do prazo, crítico ao vencer.
  for r in select code, name, created_at from complaints
            where status <> 'respondido' and created_at < v_now - make_interval(days => greatest(1, (v_compl_d * 2) / 3)) loop
    v_key := 'complaint:' || r.code;
    perform alerts_upsert(v_key, 'complaint_sla',
      case when r.created_at < v_now - make_interval(days => v_compl_d) then 'critical' else 'warn' end,
      null, null, 'complaints', r.code,
      format('Reclamo %s sin respuesta', r.code),
      format('%s · recibido hace %s días', r.name, floor(extract(epoch from (v_now - r.created_at)) / 86400)::integer));
    v_keys := v_keys || v_key;
  end loop;

  -- Espelho do Sisgeco calado (enquanto for ele que alimenta a vitrine).
  select value #>> '{}' into v_source from system_settings where key = 'stock_source';
  if coalesce(v_source, 'sisgeco') = 'sisgeco' then
    select max(finished_at) into v_last_sync from sync_runs;
    if v_last_sync is not null and v_last_sync < v_now - make_interval(mins => v_sync_min) then
      v_key := 'sync_stale';
      perform alerts_upsert(v_key, 'sync_stale', 'critical', null, null, 'sync_runs', null,
        'El lector del Sisgeco dejó de enviar',
        format('Última sincronización hace %s min', floor(extract(epoch from (v_now - v_last_sync)) / 60)::integer));
      v_keys := v_keys || v_key;
    end if;
  end if;

  update alerts set resolved_at = v_now
   where resolved_at is null and not (dedupe_key = any(v_keys));

  return (select count(*)::integer from alerts where resolved_at is null);
end;
$$;

-- Relatório -------------------------------------------------------------------

/* Um número por dia × loja × produto × sabor para cada coisa que acontece com
   torta. É a base de "mais produzidas", "mais vendidas" e "o que sobrou". */
create or replace function report_cakes(p_from date, p_to date)
returns table (
  day date, store_id uuid, product_id uuid, flavor_id uuid,
  dispatched integer, received integer, sold integer, staff_sold integer,
  returned integer, redecorated integer, discarded integer, missing integer
)
language sql stable as $$
  select (e.created_at at time zone 'America/Lima')::date,
         coalesce(e.store_id, u.store_id), u.product_id, u.flavor_id,
         count(*) filter (where e.kind = 'dispatched')::integer,
         count(*) filter (where e.kind in ('received', 'found'))::integer,
         count(*) filter (where e.kind = 'sold')::integer,
         count(*) filter (where e.kind = 'staff_sale')::integer,
         count(*) filter (where e.kind = 'returned')::integer,
         count(*) filter (where e.kind = 'redecorated')::integer,
         count(*) filter (where e.kind = 'discarded')::integer,
         count(*) filter (where e.kind = 'missing')::integer
    from cake_events e
    join cake_units u on u.id = e.cake_unit_id
   where u.source = 'native'
     and (e.created_at at time zone 'America/Lima')::date between p_from and p_to
   group by 1, 2, 3, 4;
$$;

-- -----------------------------------------------------------------------------
-- 12. Segurança
-- -----------------------------------------------------------------------------
alter table system_settings  enable row level security;
alter table dispatches       enable row level security;
alter table dispatch_lines   enable row level security;
alter table cake_events      enable row level security;
alter table customer_notes   enable row level security;
alter table leads            enable row level security;
alter table lead_events      enable row level security;
alter table alerts           enable row level security;
alter table photo_treatments enable row level security;
alter table backup_runs      enable row level security;

do $$ begin create policy "admin gerencia configuração" on system_settings  for all using (is_admin()) with check (is_admin()); exception when duplicate_object then null; end $$;
do $$ begin create policy "admin gerencia despachos"    on dispatches       for all using (is_admin()) with check (is_admin()); exception when duplicate_object then null; end $$;
do $$ begin create policy "admin gerencia linhas desp." on dispatch_lines   for all using (is_admin()) with check (is_admin()); exception when duplicate_object then null; end $$;
do $$ begin create policy "admin gerencia eventos"      on cake_events      for all using (is_admin()) with check (is_admin()); exception when duplicate_object then null; end $$;
do $$ begin create policy "admin gerencia notas"        on customer_notes   for all using (is_admin()) with check (is_admin()); exception when duplicate_object then null; end $$;
do $$ begin create policy "admin gerencia leads"        on leads            for all using (is_admin()) with check (is_admin()); exception when duplicate_object then null; end $$;
do $$ begin create policy "admin gerencia eventos lead" on lead_events      for all using (is_admin()) with check (is_admin()); exception when duplicate_object then null; end $$;
do $$ begin create policy "admin gerencia alertas"      on alerts           for all using (is_admin()) with check (is_admin()); exception when duplicate_object then null; end $$;
do $$ begin create policy "admin gerencia fotos"        on photo_treatments for all using (is_admin()) with check (is_admin()); exception when duplicate_object then null; end $$;
do $$ begin create policy "admin lê backups"            on backup_runs      for select using (is_admin()); exception when duplicate_object then null; end $$;
