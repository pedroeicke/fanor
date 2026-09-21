-- =============================================================================
-- Tortas Fanor — chaves de idempotência: venda e mensagem da Meta
--
-- Duas frestas que a revisão da fase 1 apontou e que só o banco fecha:
--
-- 1. Venda de balcão. Se a rede cai depois de gravar, a vendedora não sabe se
--    cobrou; tocar de novo duplicava uma venda só de produtos (com torta, a
--    série já barrava). A tela procurava uma venda parecida nos últimos
--    minutos — heurística. Agora ela manda uma chave: mesma chave, mesma
--    venda, e a segunda chamada devolve a primeira.
-- 2. Webhook da Meta. Duas entregas simultâneas da mesma mensagem criavam
--    dois leads, porque a conferência era uma leitura antes da escrita. O id
--    da mensagem vira chave única no evento.
-- =============================================================================

alter table sales add column if not exists client_ref uuid;
create unique index if not exists sales_client_ref_idx on sales (client_ref) where client_ref is not null;

alter table lead_events add column if not exists external_id text;
create unique index if not exists lead_events_external_idx on lead_events (external_id) where external_id is not null;

comment on column sales.client_ref is
  'Chave que a tela de balcão gera por carrinho. Repetir a cobrança com a mesma chave devolve a venda já gravada.';
comment on column lead_events.external_id is
  'Id da mensagem na origem (wamid do WhatsApp, mid do Messenger). Único: reenvio da Meta não duplica lead nem nota.';

/* Assinaturas antigas saem: com as novas tendo valor padrão, as duas versões
   coexistindo deixariam a chamada ambígua ("function is not unique"). */
drop function if exists op_sale_register(uuid, jsonb, jsonb, uuid, uuid, text, uuid, text);
drop function if exists op_lead_note(uuid, text);
drop function if exists op_lead_create(text, text, text, text, text, date, uuid, uuid);

create or replace function op_sale_register(
  p_store uuid, p_lines jsonb, p_payments jsonb,
  p_seller uuid default null, p_customer uuid default null,
  p_kind text default 'counter', p_contract uuid default null, p_notes text default null,
  p_client_ref uuid default null
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
  v_done         record;
begin
  perform op_guard();

  /* A tela manda a mesma chave enquanto o carrinho é o mesmo. Se a rede caiu
     depois do commit e a vendedora tocou em cobrar de novo, devolve a venda
     que já existe em vez de cobrar duas vezes. */
  if p_client_ref is not null then
    select id, number, total into v_done from sales where client_ref = p_client_ref;
    if found then
      return jsonb_build_object('id', v_done.id, 'number', v_done.number, 'total', v_done.total,
                                'paid', v_done.total, 'change', 0, 'repeated', true);
    end if;
  end if;

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

  insert into sales (store_id, seller_id, customer_id, status, kind, contract_id, notes, created_by, client_ref)
  values (p_store, p_seller, p_customer, 'open', p_kind, p_contract, nullif(trim(coalesce(p_notes, '')), ''), auth.uid(), p_client_ref)
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

  return jsonb_build_object('id', v_sale, 'number', v_number, 'total', v_total, 'paid', v_paid,
                            'change', v_change, 'repeated', false);
end;
$$;

create or replace function op_lead_note(p_lead uuid, p_notes text, p_external_id text default null) returns void
language plpgsql as $$
begin
  perform op_guard();
  if nullif(trim(coalesce(p_notes, '')), '') is null then
    raise exception 'La nota está vacía.';
  end if;
  /* Duas entregas simultâneas da mesma mensagem: a chave única barra a
     segunda, e o webhook trata como repetida em vez de duplicar a nota. */
  insert into lead_events (lead_id, kind, notes, actor, external_id)
  values (p_lead, 'note', trim(p_notes), auth.uid(), nullif(trim(coalesce(p_external_id, '')), ''));
end;
$$;

create or replace function op_lead_create(
  p_name text, p_phone text default null, p_source text default 'messenger',
  p_context text default null, p_interest text default null, p_wanted_on date default null,
  p_store uuid default null, p_seller uuid default null, p_external_id text default null
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

  /* O id da mensagem que abriu o lead fica no evento: é a chave única que
     impede um segundo lead se a Meta reenviar a mesma mensagem. */
  insert into lead_events (lead_id, kind, actor, external_id)
  values (v_id, 'created', auth.uid(), nullif(trim(coalesce(p_external_id, '')), ''));
  if v_assigned then
    insert into lead_events (lead_id, kind, actor) values (v_id, 'assigned', auth.uid());
  end if;

  return jsonb_build_object('id', v_id, 'number', v_number, 'customer_id', v_customer);
end;
$$;
