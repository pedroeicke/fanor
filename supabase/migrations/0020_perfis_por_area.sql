-- =============================================================================
-- Tortas Fanor — perfis por área
--
-- Até aqui toda conta do painel podia tudo. O perfil sai de `admins.role` e da
-- ficha em `sellers`; "Taller" com áreas marcadas só fecha a etapa daquelas áreas.
--
-- A navegação e as ações do servidor barram com a tabela de lib/gestion/access.ts.
-- Aqui fica a produção, onde a trava por área tem de valer para qualquer caminho.
-- =============================================================================

alter table sellers
  /* Vazio é o taller inteiro. */
  add column if not exists production_stages text[] not null default '{}';

do $$
begin
  alter table sellers add constraint sellers_production_stages_chk
    check (production_stages <@ array['preparados', 'batidas', 'horno', 'empate', 'decoracion']::text[]);
exception when duplicate_object then null;
end $$;

/* Mesma regra de profileOf() em lib/gestion/access.ts. */
create or replace function panel_access() returns jsonb
language sql stable security definer set search_path = public as $$
  select case
    when a.role = 'owner' then jsonb_build_object('profile', 'owner', 'stages', '[]'::jsonb)
    when s.role = 'manager' then jsonb_build_object('profile', 'manager', 'stages', '[]'::jsonb)
    when s.role = 'workshop' and cardinality(s.production_stages) > 0
      then jsonb_build_object('profile', 'area', 'stages', to_jsonb(s.production_stages))
    when s.role = 'workshop' then jsonb_build_object('profile', 'workshop', 'stages', '[]'::jsonb)
    else jsonb_build_object('profile', 'seller', 'stages', '[]'::jsonb)
  end
  from admins a
  left join sellers s on s.user_id = a.user_id and s.active
  where a.user_id = auth.uid();
$$;

create or replace function access_is_service() returns boolean
language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'service_role';
$$;

create or replace function access_can_stage(p_stage text) returns boolean
language sql stable security definer set search_path = public as $$
  select access_is_service()
      or coalesce(panel_access() ->> 'profile' in ('owner', 'manager', 'workshop'), false)
      or coalesce(panel_access() ->> 'profile' = 'area' and panel_access() -> 'stages' ? p_stage, false);
$$;

/* Abrir e cancelar ordem é de quem organiza o taller. */
create or replace function access_can_plan() returns boolean
language sql stable security definer set search_path = public as $$
  select access_is_service()
      or coalesce(panel_access() ->> 'profile' in ('owner', 'manager', 'workshop'), false);
$$;

create or replace function op_production_create(
  p_for_date date, p_notes text, p_demand uuid[], p_targets jsonb, p_tasks jsonb
) returns jsonb
language plpgsql as $$
declare
  v_batch  uuid;
  v_number bigint;
  t        jsonb;
begin
  perform op_guard();
  if not access_can_plan() then
    raise exception 'Solo quien organiza el taller puede crear órdenes.' using errcode = '42501';
  end if;
  if jsonb_array_length(coalesce(p_targets, '[]'::jsonb)) = 0 or jsonb_array_length(coalesce(p_tasks, '[]'::jsonb)) = 0 then
    raise exception 'La orden está vacía.';
  end if;

  insert into production_batches (for_date, notes, demand_order_ids, created_by)
  values (coalesce(p_for_date, lima_today()), nullif(trim(coalesce(p_notes, '')), ''), coalesce(p_demand, '{}'), auth.uid())
  returning id, number into v_batch, v_number;

  insert into production_batch_targets (batch_id, article_code, quantity)
  select v_batch, x->>'article_code', (x->>'quantity')::numeric
  from jsonb_array_elements(p_targets) x;

  for t in select * from jsonb_array_elements(p_tasks) loop
    perform production_task_insert(v_batch, t);
  end loop;

  return jsonb_build_object('id', v_batch, 'number', v_number);
end;
$$;

/* Cancelar não devolve o que já foi consumido: aquilo saiu do estoque de verdade. */
create or replace function op_production_cancel(p_batch uuid, p_reason text)
returns void
language plpgsql as $$
declare
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  perform op_guard();
  if not access_can_plan() then
    raise exception 'Solo quien organiza el taller puede cancelar órdenes.' using errcode = '42501';
  end if;
  if v_reason is null then
    raise exception 'Indica por qué se cancela la orden.';
  end if;
  update production_batches
     set status = 'cancelled', closed_at = now(), notes = concat_ws(' · ', notes, 'Cancelada: ' || v_reason)
   where id = p_batch and status = 'open';
  if not found then
    raise exception 'Esta orden ya no está abierta.';
  end if;
  update production_tasks set status = 'cancelled' where batch_id = p_batch and status = 'pending';
end;
$$;

/* Copiada da 0018, com a trava da área logo depois de achar a tarefa. */
create or replace function op_production_checkout(
  p_task uuid, p_approved numeric, p_rejected numeric, p_reason text, p_notes text,
  p_inputs jsonb, p_rework jsonb default '[]'::jsonb
) returns jsonb
language plpgsql as $$
declare
  t         production_tasks;
  f         formulas;
  i         production_task_inputs;
  x         jsonb;
  w         jsonb;
  v_status  text;
  v_blocked text;
  v_desc    text;
  v_type    text;
  v_actual  numeric;
  v_just    text;
  v_tol     numeric;
  v_margin  numeric;
  v_out     boolean;
  v_balance numeric;
  v_unit    text;
  v_reason  text := nullif(trim(coalesce(p_reason, '')), '');
  v_rework  integer := 0;
  v_done    boolean;
begin
  perform op_guard();

  select * into t from production_tasks where id = p_task for update;
  if not found then
    raise exception 'Tarea no encontrada.';
  end if;
  if not access_can_stage(t.stage) then
    raise exception 'Esta etapa es de otra área.' using errcode = '42501';
  end if;
  if t.status <> 'pending' then
    raise exception 'Esta tarea ya fue cerrada. Recarga la página.';
  end if;
  select status into v_status from production_batches where id = t.batch_id for update;
  if v_status <> 'open' then
    raise exception 'Esta orden ya no está abierta.';
  end if;

  select a.description into v_blocked
  from production_tasks q
  join articles a on a.code = q.article_code
  left join production_tasks p on p.id = q.rework_of
  where q.batch_id = t.batch_id and q.status = 'pending' and q.article_code = any(t.requires)
    and (q.rework_of is null or q.rework_of = t.rework_of or p.article_code = q.article_code)
  limit 1;
  if v_blocked is not null then
    raise exception 'Primero hay que terminar: %.', v_blocked;
  end if;

  if p_approved is null or p_rejected is null or p_approved < 0 or p_rejected < 0 or p_approved + p_rejected <= 0 then
    raise exception 'Indica cuánto salió bien y cuánto se perdió.';
  end if;
  if p_rejected > 0 and v_reason is null then
    raise exception 'Indica el motivo de lo que se perdió.';
  end if;
  select recipe_unit into v_unit from articles where code = t.article_code;
  if t.stage <> 'batidas' and v_unit = 'un.' and (p_approved <> trunc(p_approved) or p_rejected <> trunc(p_rejected)) then
    raise exception 'Este producto se cuenta entero: no puede salir una fracción.';
  end if;

  select (value #>> '{}')::numeric into v_tol from system_settings where key = 'production_tolerance_pct';
  v_tol := coalesce(v_tol, 5);

  for i in select * from production_task_inputs where task_id = p_task for update loop
    select e into x from jsonb_array_elements(coalesce(p_inputs, '[]'::jsonb)) e where e->>'id' = i.id::text;
    select description, type into v_desc, v_type from articles where code = i.article_code;
    if x is null or x->>'actual_quantity' is null then
      raise exception 'Falta confirmar cuánto se usó de %.', v_desc;
    end if;
    v_actual := (x->>'actual_quantity')::numeric;
    if v_actual < 0 then
      raise exception 'La cantidad usada de % no puede ser negativa.', v_desc;
    end if;
    v_just := nullif(trim(coalesce(x->>'justification', '')), '');

    /* Matéria-prima contada: a receita proporcional dá 16,67 ovos e ninguém
       quebra dois terços de ovo, então até uma unidade é normal. Intermediário
       não entra: meio cake é meio cake. */
    v_margin := greatest(i.planned_quantity * v_tol / 100,
                         case when i.display_unit = 'un.' and v_type = 'MP' then i.display_factor else 0 end);
    v_out := abs(v_actual - i.planned_quantity) > v_margin + 0.000001;
    if v_out and v_just is null then
      raise exception 'Indica por qué % se aleja de la receta.', v_desc;
    end if;

    /* Batida perdida sem refação: o forno não pode fechar cake com massa que não
       existe sem ninguém explicar. Só para o que o taller produz: matéria-prima
       ainda não tem inventário inicial, e o saldo dela não diz nada. */
    if v_type = 'PI' and v_just is null and exists (select 1 from formulas where output_code = i.article_code and active) then
      select coalesce(sum(quantity), 0) into v_balance from article_movements where article_code = i.article_code and store_id is null;
      if v_actual > v_balance + v_margin + 0.000001 then
        raise exception 'No hay % suficiente en el taller. Indica de dónde salió.', v_desc;
      end if;
    end if;

    update production_task_inputs
       set actual_quantity = v_actual, out_of_tolerance = v_out, justification = v_just
     where id = i.id;

    if v_actual > 0 then
      insert into article_movements (article_code, kind, quantity, task_id, created_by)
      values (i.article_code, 'production_input', -v_actual, p_task, auth.uid());
    end if;
  end loop;

  update production_tasks
     set status = 'done', approved_quantity = p_approved, rejected_quantity = p_rejected,
         reject_reason = v_reason, notes = nullif(trim(coalesce(p_notes, '')), ''),
         checked_out_by = auth.uid(), checked_out_at = now()
   where id = p_task;

  if p_approved > 0 then
    insert into article_movements (article_code, kind, quantity, task_id, created_by)
    values (t.article_code, 'production_output', p_approved, p_task, auth.uid());

    select * into f from formulas where id = t.formula_id;
    if f.byproduct_code is not null then
      insert into article_movements (article_code, kind, quantity, task_id, created_by)
      values (f.byproduct_code, 'byproduct', p_approved * f.byproduct_quantity / f.batch_yield, p_task, auth.uid());
    end if;
  end if;

  for w in select * from jsonb_array_elements(coalesce(p_rework, '[]'::jsonb)) loop
    perform production_task_insert(t.batch_id, w, p_task);
    v_rework := v_rework + 1;
  end loop;

  v_done := not exists (select 1 from production_tasks where batch_id = t.batch_id and status = 'pending');
  if v_done then
    update production_batches set status = 'done', closed_at = now() where id = t.batch_id;
  end if;

  return jsonb_build_object('rework_tasks', v_rework, 'batch_done', v_done);
end;
$$;
