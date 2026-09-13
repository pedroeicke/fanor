-- =============================================================================
-- Tortas Fanor — alerta de encomenda aponta a encomenda, não a OP
--
-- Em `alerts_refresh()` o alerta `contract_due` gravava em `entity_id` o id da
-- ordem de produção, com `entity = 'contracts'`. O link da central de alertas
-- abriria uma encomenda inexistente. Mesma função, só a coluna certa.
-- (A 0012 também foi corrigida para instalações novas.)
-- =============================================================================

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
  for r in select c.id, c.number, po.store_id, po.for_date from production_orders po
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

-- alertas abertos com o id antigo: fecha; o próximo recálculo reabre certo.
update alerts set resolved_at = now() where kind = 'contract_due' and resolved_at is null;
