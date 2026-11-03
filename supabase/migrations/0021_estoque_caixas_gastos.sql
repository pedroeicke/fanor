-- =============================================================================
-- Tortas Fanor — inventário, caixas e gastos
--
-- Inventário: contagem e compra, no taller ou na loja. A tela fala em unidade de
-- estoque (balde, kg, caixa); o razão continua na unidade de receita.
--
-- Caixas: cada formato de torta aponta para a caixa dele, e a torta vendida baixa
-- a caixa na loja. Fica num gatilho porque a venda de balcão e a entrega de
-- encomenda são caminhos diferentes para o mesmo "vendida".
--
-- Gastos: tela de uma pessoa só. O perfil Administración vê só isso, e o banco
-- esconde os lançamentos das outras contas do painel.
--
-- articles.cost é soles por unidade de estoque. A planilha ainda veio sem custos.
-- =============================================================================

alter table article_movements drop constraint if exists article_movements_kind_check;
alter table article_movements add constraint article_movements_kind_check
  check (kind in ('production_input', 'production_output', 'byproduct', 'purchase', 'adjustment', 'loss', 'dispatch', 'sale'));

alter table article_movements
  add column if not exists unit_cost    numeric(14,4),
  add column if not exists document     text,
  add column if not exists cake_unit_id uuid references cake_units(id) on delete set null;

create index if not exists article_movements_recent_idx on article_movements (created_at desc);

-- -----------------------------------------------------------------------------
-- 1. Perfil Administración
-- -----------------------------------------------------------------------------
alter table sellers drop constraint if exists sellers_role_chk;
alter table sellers add constraint sellers_role_chk check (role in ('seller', 'workshop', 'manager', 'accounting'));

/* Mesma regra de profileOf() em lib/gestion/access.ts. */
create or replace function panel_access() returns jsonb
language sql stable security definer set search_path = public as $$
  select case
    when a.role = 'owner' then jsonb_build_object('profile', 'owner', 'stages', '[]'::jsonb)
    when s.role = 'manager' then jsonb_build_object('profile', 'manager', 'stages', '[]'::jsonb)
    when s.role = 'accounting' then jsonb_build_object('profile', 'accounting', 'stages', '[]'::jsonb)
    when s.role = 'workshop' and cardinality(s.production_stages) > 0
      then jsonb_build_object('profile', 'area', 'stages', to_jsonb(s.production_stages))
    when s.role = 'workshop' then jsonb_build_object('profile', 'workshop', 'stages', '[]'::jsonb)
    else jsonb_build_object('profile', 'seller', 'stages', '[]'::jsonb)
  end
  from admins a
  left join sellers s on s.user_id = a.user_id and s.active
  where a.user_id = auth.uid();
$$;

create or replace function access_can_stock() returns boolean
language sql stable security definer set search_path = public as $$
  select access_is_service()
      or coalesce(panel_access() ->> 'profile' in ('owner', 'manager', 'workshop'), false);
$$;

create or replace function access_can_cost() returns boolean
language sql stable security definer set search_path = public as $$
  select access_is_service()
      or coalesce(panel_access() ->> 'profile' in ('owner', 'manager'), false);
$$;

create or replace function access_can_expenses() returns boolean
language sql stable security definer set search_path = public as $$
  select access_is_service()
      or coalesce(panel_access() ->> 'profile' in ('owner', 'accounting'), false);
$$;

-- -----------------------------------------------------------------------------
-- 2. Inventário e compras
-- -----------------------------------------------------------------------------
/* Última contagem ou compra por lugar: é assim que a tela sabe o que ainda falta contar. */
create or replace view article_counted with (security_invoker = true) as
  select article_code, store_id, max(created_at) as last_at
  from article_movements
  where kind in ('purchase', 'adjustment')
  group by article_code, store_id;

create or replace function stock_factor(p_code text) returns numeric
language sql stable as $$
  select coalesce(nullif(conversion_factor, 0), 1) from articles where code = p_code;
$$;

/* Quantidade e custo por unidade de estoque: "2 baldes a S/ 180". */
create or replace function op_stock_purchase(
  p_code text, p_store uuid, p_quantity numeric, p_unit_cost numeric, p_document text, p_notes text
) returns jsonb
language plpgsql as $$
declare
  a        articles;
  v_factor numeric;
begin
  perform op_guard();
  if not access_can_stock() then
    raise exception 'Sin permiso para registrar compras.' using errcode = '42501';
  end if;
  select * into a from articles where code = p_code for update;
  if not found then
    raise exception 'El artículo no existe.';
  end if;
  if a.type not in ('MP', 'NV', 'CS') then
    raise exception '% no se compra: se produce en el taller.', a.description;
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Indica cuánto se compró.';
  end if;
  if p_unit_cost is not null and p_unit_cost < 0 then
    raise exception 'El costo no puede ser negativo.';
  end if;
  if p_store is not null and not exists (select 1 from stores where id = p_store) then
    raise exception 'La tienda no existe.';
  end if;

  v_factor := stock_factor(p_code);
  insert into article_movements (article_code, store_id, kind, quantity, unit_cost, document, notes, created_by)
  values (p_code, p_store, 'purchase', p_quantity * v_factor, p_unit_cost,
          nullif(trim(coalesce(p_document, '')), ''), nullif(trim(coalesce(p_notes, '')), ''), auth.uid());

  /* O custo vale pela última compra: média ponderada depende de saldo confiável. */
  if p_unit_cost is not null then
    update articles set cost = p_unit_cost where code = p_code;
  end if;

  return jsonb_build_object('quantity', p_quantity * v_factor);
end;
$$;

/* A contagem manda: a diferença para o saldo vira ajuste. Serve para o inventário
   inicial e para qualquer conferência depois. */
create or replace function op_stock_count(p_code text, p_store uuid, p_counted numeric, p_notes text)
returns jsonb
language plpgsql as $$
declare
  a         articles;
  v_factor  numeric;
  v_balance numeric;
  v_diff    numeric;
begin
  perform op_guard();
  if not access_can_stock() then
    raise exception 'Sin permiso para registrar conteos.' using errcode = '42501';
  end if;
  select * into a from articles where code = p_code for update;
  if not found then
    raise exception 'El artículo no existe.';
  end if;
  if p_counted is null or p_counted < 0 then
    raise exception 'Indica cuánto se contó.';
  end if;
  if p_store is not null and not exists (select 1 from stores where id = p_store) then
    raise exception 'La tienda no existe.';
  end if;

  v_factor := stock_factor(p_code);
  select coalesce(sum(quantity), 0) into v_balance
    from article_movements
   where article_code = p_code and store_id is not distinct from p_store;
  v_diff := p_counted * v_factor - v_balance;

  /* Diferença zero também grava: "conferido hoje" é informação. */
  insert into article_movements (article_code, store_id, kind, quantity, notes, created_by)
  values (p_code, p_store, 'adjustment', v_diff, coalesce(nullif(trim(coalesce(p_notes, '')), ''), 'Conteo'), auth.uid());

  return jsonb_build_object('difference', v_diff);
end;
$$;

create or replace function op_article_cost(p_code text, p_cost numeric) returns void
language plpgsql as $$
declare
  v_before numeric;
begin
  perform op_guard();
  if not access_can_cost() then
    raise exception 'Sin permiso para cambiar costos.' using errcode = '42501';
  end if;
  if p_cost is not null and p_cost < 0 then
    raise exception 'El costo no puede ser negativo.';
  end if;
  select cost into v_before from articles where code = p_code for update;
  if not found then
    raise exception 'El artículo no existe.';
  end if;
  update articles set cost = p_cost where code = p_code;
  insert into audit_log (actor, action, entity, entity_id, changes)
  values (auth.uid(), 'article.cost', 'articles', p_code, jsonb_build_object('before', v_before, 'after', p_cost));
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. Caixas
-- -----------------------------------------------------------------------------
/* "T26-CHNRMC" → T26, "F2_5CHMCTT" → F2_5. */
create or replace function cake_format(p_sku text) returns text
language sql immutable as $$
  select substring(p_sku from '^[A-Za-z]+[0-9_]*');
$$;

create table if not exists packaging_rules (
  format     text primary key,
  box_code   text not null references articles(code),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table packaging_rules enable row level security;
drop policy if exists "admin gerencia caixas" on packaging_rules;
create policy "admin gerencia caixas" on packaging_rules for all using (is_admin()) with check (is_admin());

create or replace view packaging_formats with (security_invoker = true) as
  select cake_format(f.output_code) as format,
         count(*) as models,
         min(a.description) as example,
         r.box_code,
         b.description as box_description
  from formulas f
  join articles a on a.code = f.output_code
  left join packaging_rules r on r.format = cake_format(f.output_code)
  left join articles b on b.code = r.box_code
  where f.stage = 'decoracion' and f.active
  group by cake_format(f.output_code), r.box_code, b.description;

/* Caixa vazia tira o vínculo. */
create or replace function op_packaging_set(p_format text, p_box text) returns void
language plpgsql as $$
begin
  perform op_guard();
  if not access_can_stock() then
    raise exception 'Sin permiso para cambiar las cajas.' using errcode = '42501';
  end if;
  if nullif(trim(coalesce(p_box, '')), '') is null then
    delete from packaging_rules where format = p_format;
    return;
  end if;
  if not exists (select 1 from articles where code = p_box and type = 'NV') then
    raise exception 'Esa caja no existe.';
  end if;
  insert into packaging_rules (format, box_code, updated_by)
  values (p_format, p_box, auth.uid())
  on conflict (format) do update set box_code = excluded.box_code, updated_by = excluded.updated_by, updated_at = now();
end;
$$;

/* Saldo da loja pode ficar negativo: a venda não para por falta de um dado. */
create or replace function cake_sold_takes_box() returns trigger
language plpgsql as $$
declare
  v_box text;
begin
  select r.box_code into v_box
    from products p
    join packaging_rules r on r.format = cake_format(p.sku)
   where p.id = new.product_id;
  if v_box is not null then
    insert into article_movements (article_code, store_id, kind, quantity, cake_unit_id, notes, created_by)
    values (v_box, new.store_id, 'sale', -1, new.id, 'Torta ' || new.serial, auth.uid());
  end if;
  return new;
end;
$$;

drop trigger if exists cake_units_take_box on cake_units;
create trigger cake_units_take_box after update of status on cake_units
  for each row
  when (new.source = 'native' and new.status = 'sold' and old.status is distinct from new.status)
  execute function cake_sold_takes_box();

-- -----------------------------------------------------------------------------
-- 4. Gastos
-- -----------------------------------------------------------------------------
create table if not exists expenses (
  id           uuid primary key default gen_random_uuid(),
  spent_on     date not null,
  article_code text not null references articles(code),
  amount       numeric(12,2) not null check (amount > 0),
  store_id     uuid references stores(id),
  document     text,
  notes        text,
  voided_at    timestamptz,
  void_reason  text,
  created_by   uuid references auth.users(id) on delete set null,
  updated_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists expenses_day_idx on expenses (spent_on desc);
drop trigger if exists expenses_updated_at on expenses;
create trigger expenses_updated_at before update on expenses
  for each row execute function set_updated_at();

alter table expenses enable row level security;
drop policy if exists "gastos so de quem cuida deles" on expenses;
create policy "gastos so de quem cuida deles" on expenses
  for all using (access_can_expenses()) with check (access_can_expenses());

/* Sem id cria, com id corrige. A trilha guarda o antes e o depois. */
create or replace function op_expense_save(
  p_id uuid, p_spent_on date, p_code text, p_amount numeric, p_store uuid, p_document text, p_notes text
) returns jsonb
language plpgsql as $$
declare
  e expenses;
begin
  perform op_guard();
  if not access_can_expenses() then
    raise exception 'Sin permiso para los gastos.' using errcode = '42501';
  end if;
  if p_spent_on is null or p_spent_on > lima_today() then
    raise exception 'La fecha no puede ser futura.';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Indica el monto.';
  end if;
  if not exists (select 1 from articles where code = p_code and type in ('CS', 'SV')) then
    raise exception 'Elige un concepto de gasto.';
  end if;
  if p_store is not null and not exists (select 1 from stores where id = p_store) then
    raise exception 'La tienda no existe.';
  end if;

  if p_id is null then
    insert into expenses (spent_on, article_code, amount, store_id, document, notes, created_by, updated_by)
    values (p_spent_on, p_code, p_amount, p_store, nullif(trim(coalesce(p_document, '')), ''), nullif(trim(coalesce(p_notes, '')), ''), auth.uid(), auth.uid())
    returning * into e;
    insert into audit_log (actor, action, entity, entity_id, changes)
    values (auth.uid(), 'expense.create', 'expenses', e.id::text, to_jsonb(e));
  else
    select * into e from expenses where id = p_id for update;
    if not found then
      raise exception 'Gasto no encontrado.';
    end if;
    if e.voided_at is not null then
      raise exception 'Este gasto ya fue anulado.';
    end if;
    update expenses
       set spent_on = p_spent_on, article_code = p_code, amount = p_amount, store_id = p_store,
           document = nullif(trim(coalesce(p_document, '')), ''), notes = nullif(trim(coalesce(p_notes, '')), ''),
           updated_by = auth.uid()
     where id = p_id;
    insert into audit_log (actor, action, entity, entity_id, changes)
    values (auth.uid(), 'expense.update', 'expenses', p_id::text,
            jsonb_build_object('before', to_jsonb(e), 'after', (select to_jsonb(x) from expenses x where x.id = p_id)));
  end if;

  return jsonb_build_object('id', coalesce(p_id, e.id));
end;
$$;

/* Anular em vez de apagar: o lançamento continua na trilha e sai da soma. */
create or replace function op_expense_void(p_id uuid, p_reason text) returns void
language plpgsql as $$
declare
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  perform op_guard();
  if not access_can_expenses() then
    raise exception 'Sin permiso para los gastos.' using errcode = '42501';
  end if;
  if v_reason is null then
    raise exception 'Indica por qué se anula.';
  end if;
  update expenses set voided_at = now(), void_reason = v_reason, updated_by = auth.uid()
   where id = p_id and voided_at is null;
  if not found then
    raise exception 'Este gasto ya no se puede anular.';
  end if;
  insert into audit_log (actor, action, entity, entity_id, changes)
  values (auth.uid(), 'expense.void', 'expenses', p_id::text, jsonb_build_object('reason', v_reason));
end;
$$;
