-- =============================================================================
-- Tortas Fanor — correções vindas da revisão da fase 1
--
-- Achados dos revisores dos módulos do painel, todos do lado do banco:
--
-- 1. `audit_log` só tinha política de leitura desde a 0001. Todo registro de
--    auditoria feito pela sessão do painel era recusado pelo RLS em silêncio;
--    em produção a tabela estava vazia. Vale para o painel inteiro.
-- 2. `admins` só deixava ler a própria linha: "quem recebeu" e "quem escreveu
--    a nota" apareciam em branco para qualquer outro administrador.
-- 3. Redecorada: a torta de origem ficava 'returned' para sempre.
-- 4. Despacho aceitava loja diferente da do pedido e encomenda já fechada.
-- 5. Torta de encomenda entregue ou cancelada chegava 'reserved' e ficava presa.
-- 6. Entregar ou cancelar encomenda não fechava a OP do taller.
-- 7. Lead sem celular (Messenger) criava um cliente fantasma por conversa.
-- 8. A validade copiada da família para o produto pelo leitor do Sisgeco
--    congelava o valor: mudar a família não mudava o produto.
-- =============================================================================

do $$ begin
  create policy "admin grava auditoria" on audit_log for insert
    with check (is_admin() and actor = auth.uid());
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "admin lê equipe" on admins for select using (is_admin());
exception when duplicate_object then null; end $$;

-- Redecoradas que ficaram 'returned' com filha: fecha.
update cake_units o set status = 'discarded'
 where o.status = 'returned'
   and exists (select 1 from cake_units f where f.origin_unit_id = o.id);

-- Validade que só repetia a da família volta a herdar.
update products p set shelf_life_days = null
  from product_families f
 where p.family_id = f.id
   and p.shelf_life_days is not null
   and p.shelf_life_days = f.shelf_life_days;

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

  /* A torta de origem deixa de existir como tal: virou a nova. Fica
     'discarded' (terminal), com o evento dizendo que foi redecorada; senão
     contaria para sempre como devolvida esperando decisão. */
  update cake_units set status = 'discarded' where id = o.id;
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

  /* contract_open: a encomenda ainda espera a torta. Se já foi entregue (com
     outra da vitrine) ou cancelada, a que chega fica livre para vender;
     reservada para encomenda fechada, ficaria presa fora da vitrine. */
  for r in select u.id, u.serial, u.contract_id,
                  (c.id is not null and c.status not in ('delivered', 'cancelled')) as contract_open
             from cake_units u left join contracts c on c.id = u.contract_id
            where u.dispatch_id = p_dispatch and u.status = 'in_transit' for update of u loop
    if r.serial = any(coalesce(p_received, '{}')) then
      update cake_units
         set status = (case when r.contract_open then 'reserved' else 'in_stock' end)::cake_unit_status,
             contract_id = case when r.contract_open then r.contract_id else null end,
             received_at = now()
       where id = r.id;
      insert into cake_events (cake_unit_id, kind, store_id, actor, ref_id)
      values (r.id, 'received', v_store, auth.uid(), p_dispatch);
      if r.contract_id is not null and not r.contract_open then
        insert into cake_events (cake_unit_id, kind, store_id, actor, ref_id, notes)
        values (r.id, 'released', v_store, auth.uid(), r.contract_id, 'La encomienda ya estaba cerrada');
      end if;
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

create or replace function op_cake_resolve_missing(p_serial text, p_found boolean, p_notes text default null) returns void
language plpgsql as $$
declare
  u record;
begin
  perform op_guard();
  select cu.id, cu.store_id, cu.status,
         case when c.status in ('delivered', 'cancelled') then null else cu.contract_id end as contract_id
    into u
    from cake_units cu left join contracts c on c.id = cu.contract_id
   where cu.serial = p_serial and cu.source = 'native'
     for update of cu;
  if not found then
    raise exception 'Torta no encontrada.';
  end if;
  if u.status <> 'missing' then
    raise exception 'La torta % no está como faltante.', p_serial;
  end if;

  if p_found then
    update cake_units
       set status = (case when u.contract_id is not null then 'reserved' else 'in_stock' end)::cake_unit_status,
           contract_id = u.contract_id,
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

  /* Encomenda fechada não deixa ordem aberta no taller. Sem nada despachado,
     a OP é cancelada; com despacho parcial, encerrada como está. */
  update production_orders po
     set status = (case when exists (select 1 from production_order_lines l
                                      where l.production_order_id = po.id and l.produced_quantity > 0)
                        then 'done' else 'cancelled' end)::production_status,
         closed_at = now()
   where po.contract_id = p_contract and po.status in ('planned', 'in_progress');

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

  /* Encomenda fechada não deixa ordem aberta no taller. Sem nada despachado,
     a OP é cancelada; com despacho parcial, encerrada como está. */
  update production_orders po
     set status = (case when exists (select 1 from production_order_lines l
                                      where l.production_order_id = po.id and l.produced_quantity > 0)
                        then 'done' else 'cancelled' end)::production_status,
         closed_at = now()
   where po.contract_id = p_contract and po.status in ('planned', 'in_progress');
end;
$$;

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

  /* Sem celular não há como juntar a pessoa a nada: o nome sozinho criaria
     um cliente por conversa do Messenger no CRM. O cliente nasce quando o
     celular aparecer. */
  if normalize_phone(p_phone) is not null then
    v_customer := crm_upsert_customer(p_name, p_phone, null, 'NONE', null, p_source);
  end if;

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
