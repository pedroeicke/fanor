-- =============================================================================
-- Tortas Fanor — a torta decorada segue para o despacho
--
-- Até aqui a produção terminava no saldo do taller e o despacho criava a torta
-- do zero, com sabor digitado de novo e validade contada do dia do envio.
--
--   checkout da decoração → fica "lista" no taller
--     → o despacho escolhe a lista → a torta nasce com série e etiqueta,
--       ligada à etapa que a fez e com a validade contada da decoração
--
-- O produto vem do artigo (T26-CHNRMC). A planilha não traz preço, então ele
-- nasce sem preço e em rascunho: a vendedora digita o valor até haver tabela, e
-- o site não mostra nada que não foi publicado.
--
-- O despacho manual continua: a redecoração e o que não passa por uma ordem de
-- produção ainda dependem dele.
-- =============================================================================

alter table production_tasks
  /* O que já saiu das listas, por despacho ou perda. */
  add column if not exists released_quantity numeric(18,6) not null default 0;

alter table cake_units
  add column if not exists production_task_id uuid references production_tasks(id) on delete set null;

create index if not exists cake_units_task_idx on cake_units (production_task_id) where production_task_id is not null;
create index if not exists production_tasks_ready_idx on production_tasks (article_code, checked_out_at)
  where stage = 'decoracion' and status = 'done';

alter table article_movements drop constraint if exists article_movements_kind_check;
alter table article_movements add constraint article_movements_kind_check
  check (kind in ('production_input', 'production_output', 'byproduct', 'purchase', 'adjustment', 'loss', 'dispatch'));

/* Produto que representa o artigo na vitrine, na venda e na etiqueta. Toda saída
   da decoração é torta, mesmo com prefixo que a família não reconhece (F05, FT26). */
create or replace function article_product(p_code text) returns uuid
language plpgsql as $$
declare
  v_id   uuid;
  v_name text;
begin
  select id into v_id from products where sku = p_code;
  if found then
    return v_id;
  end if;
  select description into v_name from articles where code = p_code;
  if not found then
    raise exception 'El artículo % no existe.', p_code;
  end if;
  insert into products (slug, sku, name, status, family_id, tracks_serial, sold_online)
  values ('art-' || regexp_replace(lower(p_code), '[^a-z0-9]+', '-', 'g'), p_code, v_name, 'draft',
          (select id from product_families where code = 'T'), true, false)
  on conflict (sku) where sku is not null do update set updated_at = now()
  returning id into v_id;
  return v_id;
end;
$$;

/* Tortas decoradas que ainda estão no taller, por etapa. A validade conta da
   decoração: a torta não fica mais nova por esperar a movilidade. */
create or replace view production_ready with (security_invoker = true) as
  select t.id as task_id,
         t.batch_id,
         b.number as batch_number,
         t.article_code,
         a.description,
         floor(t.approved_quantity - t.released_quantity) as quantity,
         (t.checked_out_at at time zone 'America/Lima')::date as decorated_on,
         (t.checked_out_at at time zone 'America/Lima')::date + coalesce(p.shelf_life_days, f.shelf_life_days, 2) as expires_on
  from production_tasks t
  join production_batches b on b.id = t.batch_id
  join articles a on a.code = t.article_code
  left join products p on p.sku = t.article_code
  left join product_families f on f.id = p.family_id or (p.id is null and f.code = 'T')
  where t.stage = 'decoracion'
    and t.status = 'done'
    and floor(t.approved_quantity - t.released_quantity) >= 1;

/* Torta lista que caiu ou passou do prazo antes de sair. A mais antiga primeiro:
   é a que venceu. */
create or replace function op_ready_discard(p_code text, p_reason text) returns void
language plpgsql as $$
declare
  v_task   uuid;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  perform op_guard();
  if v_reason is null then
    raise exception 'Indica el motivo.';
  end if;
  select t.id into v_task
    from production_tasks t
   where t.article_code = p_code and t.stage = 'decoracion' and t.status = 'done'
     and floor(t.approved_quantity - t.released_quantity) >= 1
   order by t.checked_out_at
   limit 1
   for update;
  if not found then
    raise exception 'Esta torta ya no está en el taller. Recarga la página.';
  end if;
  update production_tasks set released_quantity = released_quantity + 1 where id = v_task;
  insert into article_movements (article_code, kind, quantity, task_id, notes, created_by)
  values (p_code, 'loss', -1, v_task, v_reason, auth.uid());
end;
$$;

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
  v_article  text;
  v_balance  numeric;
  v_task     uuid;
  v_made     date;
  v_free     numeric;
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
  /* A torta nasce com a série da loja de destino: mandar o pedido de uma loja
     para outra trocaria a série e o estoque de lugar. */
  if p_order is not null and exists (
    select 1 from production_orders where id = p_order and store_id <> p_store
  ) then
    raise exception 'El despacho debe ir a la tienda del pedido.';
  end if;
  if p_order is not null and exists (
    select 1 from production_orders po join contracts c on c.id = po.contract_id
     where po.id = p_order and c.status in ('delivered', 'cancelled')
  ) then
    raise exception 'La encomienda ya fue entregada o cancelada.';
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
    v_article := nullif(c->>'article_code', '');
    v_qty     := (c->>'quantity')::numeric;
    v_line    := nullif(c->>'production_order_line_id', '')::uuid;

    if v_qty is null or v_qty < 1 or v_qty > 200 or v_qty <> trunc(v_qty) then
      raise exception 'Cantidad de tortas inválida.';
    end if;

    if v_article is not null then
      v_product := article_product(v_article);
      /* Torta que virou ingrediente de outra saiu do saldo, não das listas. */
      select coalesce(sum(quantity), 0) into v_balance
        from article_movements where article_code = v_article and store_id is null;
      if v_balance < v_qty then
        raise exception 'Solo quedan % de % en el taller.', greatest(floor(v_balance), 0), (select description from articles where code = v_article);
      end if;
    else
      v_product := nullif(c->>'product_id', '')::uuid;
      if not exists (select 1 from products where id = v_product) then
        raise exception 'Producto no encontrado.';
      end if;
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
    v_task := null;
    v_free := 0;
    v_made := v_today;

    for k in 1..v_qty::integer loop
      /* A mais antiga que ainda vale. Vencida não sai: fica na lista para o taller
         dar baixa. */
      if v_article is not null and v_free < 1 then
        select t.id, (t.checked_out_at at time zone 'America/Lima')::date, floor(t.approved_quantity - t.released_quantity)
          into v_task, v_made, v_free
          from production_tasks t
         where t.article_code = v_article and t.stage = 'decoracion' and t.status = 'done'
           and floor(t.approved_quantity - t.released_quantity) >= 1
           and (t.checked_out_at at time zone 'America/Lima')::date + v_life >= v_today
         order by t.checked_out_at
         limit 1
         for update;
        if not found then
          raise exception 'No quedan % listas y vigentes en el taller.', (select description from articles where code = v_article);
        end if;
      end if;

      insert into cake_units (
        product_id, store_id, source, status, produced_on, expires_on,
        flavor_id, decorator_id, cake_type_id, dispatch_id, production_order_line_id, contract_id, notes, production_task_id)
      values (
        v_product, p_store, 'native', 'in_transit', v_made, v_made + v_life,
        nullif(c->>'flavor_id', '')::uuid, nullif(c->>'decorator_id', '')::uuid, nullif(c->>'cake_type_id', '')::uuid,
        v_dispatch, v_line, v_contract, nullif(trim(coalesce(c->>'notes', '')), ''), v_task)
      returning id, serial into v_unit, v_serial;

      insert into cake_events (cake_unit_id, kind, store_id, actor, ref_id)
      values (v_unit, 'dispatched', p_store, auth.uid(), v_dispatch);
      insert into stock_movement_lines (movement_id, product_id, quantity, cake_unit_id, lot_date)
      values (v_mov, v_product, 1, v_unit, v_made);

      if v_task is not null then
        update production_tasks set released_quantity = released_quantity + 1 where id = v_task;
        insert into article_movements (article_code, kind, quantity, task_id, notes, created_by)
        values (v_article, 'dispatch', -1, v_task, 'Despacho #' || v_number, auth.uid());
        v_free := v_free - 1;
      end if;

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
