-- =============================================================================
-- Tortas Fanor — base de artigos, fórmulas e execução da produção (fase 2)
--
-- Das conversas com o Joseka (docs/levantamento-fase-2-2026-11-02.md):
--
--   loja pede → o taller monta a ordem → cada etapa executa e faz checkout
--     → o aprovado segue; o reprovado vira perda e o sistema manda refazer,
--       já com os insumos do que falta → o estoque baixa pelo consumo real
--
-- `articles` é a planilha de códigos do Joseka, com matéria-prima, serviço e
-- gasto. Fica separada de `products` porque `products` é o que o site vende:
-- misturar 1.800 códigos de insumo ali colocaria farinha na vitrine.
--
-- Tudo aditivo. Nada aqui altera tabela existente; o fluxo atual de pedido,
-- despacho e vitrine continua igual.
--
-- Unidade do razão: tudo em `article_movements` e nas quantidades de fórmula
-- está na unidade de receita do artigo (gr., ml., un.). `conversion_factor` diz
-- quantas unidades de receita cabem em uma de estoque: 1 ovo = 60 gr.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Cadastro
-- -----------------------------------------------------------------------------
create table articles (
  code              text primary key,
  /* MP matéria-prima, PI intermediário, PF produto final, NV embalagem e
     revenda, CS consumível, SV serviço. Controla onde o artigo pode aparecer. */
  type              text not null check (type in ('MP', 'PI', 'PF', 'NV', 'CS', 'SV')),
  description       text not null,
  stock_unit        text,
  conversion_factor numeric(18,6),
  recipe_unit       text,
  cost              numeric(12,4),
  minimum_lot       numeric(14,3),
  active            boolean not null default true,
  source_row        integer,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index articles_type_idx on articles (type) where active;
create trigger articles_updated_at before update on articles
  for each row execute function set_updated_at();

create table formulas (
  id                 uuid primary key default gen_random_uuid(),
  output_code        text not null unique references articles(code),
  stage              text not null check (stage in ('preparados', 'batidas', 'horno', 'empate', 'decoracion', 'porcion')),
  /* Quanto uma execução da fórmula rende, na unidade de receita da saída. Na
     batida vale 1: os cakes consomem frações dela (1/12 de BAT-NARANJ), e o
     número da planilha (14.998) é peso, guardado em `source_yield`. */
  batch_yield        numeric(18,6) not null check (batch_yield > 0),
  source_yield       numeric(18,6),
  source_weight      numeric(18,6),
  /* Saída que nasce junto: separar ovo para ter gema também gera clara. */
  byproduct_code     text references articles(code),
  byproduct_quantity numeric(18,6),
  active             boolean not null default true,
  source_row         integer,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create trigger formulas_updated_at before update on formulas
  for each row execute function set_updated_at();

create table formula_lines (
  id                 uuid primary key default gen_random_uuid(),
  formula_id         uuid not null references formulas(id) on delete cascade,
  article_code       text not null references articles(code),
  quantity           numeric(20,10) not null check (quantity > 0),
  /* Como a receita escreve: 40 un. de ovo, mesmo com o razão em gramas. */
  source_quantity    numeric(20,10) not null,
  source_unit        text,
  /* Receita por peso de um artigo contado: quem produz informa quantos ovos
     quebrou de verdade. É esse número que baixa o estoque (Tres Leches). */
  count_on_execution boolean not null default false,
  source_row         integer
);

create index formula_lines_formula_idx on formula_lines (formula_id);
create index formula_lines_article_idx on formula_lines (article_code);

-- -----------------------------------------------------------------------------
-- 2. Execução
-- -----------------------------------------------------------------------------
create table production_batches (
  id               uuid primary key default gen_random_uuid(),
  number           bigserial,
  for_date         date not null default lima_today(),
  status           text not null default 'open' check (status in ('open', 'done', 'cancelled')),
  notes            text,
  /* Pedidos de loja que esta ordem atende. O taller decide sabores e formatos,
     então a ligação é por pedido, não por linha. */
  demand_order_ids uuid[] not null default '{}',
  created_by       uuid references auth.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  closed_at        timestamptz
);

create index production_batches_open_idx on production_batches (status, for_date);
create trigger production_batches_updated_at before update on production_batches
  for each row execute function set_updated_at();

create table production_batch_targets (
  id           uuid primary key default gen_random_uuid(),
  batch_id     uuid not null references production_batches(id) on delete cascade,
  article_code text not null references articles(code),
  quantity     numeric(18,6) not null check (quantity > 0)
);

create index production_batch_targets_batch_idx on production_batch_targets (batch_id);

create table production_tasks (
  id                uuid primary key default gen_random_uuid(),
  batch_id          uuid not null references production_batches(id) on delete cascade,
  stage             text not null,
  article_code      text not null references articles(code),
  formula_id        uuid not null references formulas(id),
  planned_quantity  numeric(18,6) not null check (planned_quantity > 0),
  /* Artigos que precisam estar prontos antes. Por código, não por tarefa: uma
     refação do mesmo artigo segura a etapa seguinte sem religar nada. */
  requires          text[] not null default '{}',
  rework_of         uuid references production_tasks(id),
  status            text not null default 'pending' check (status in ('pending', 'done', 'cancelled')),
  approved_quantity numeric(18,6),
  rejected_quantity numeric(18,6),
  reject_reason     text,
  notes             text,
  checked_out_by    uuid references auth.users(id) on delete set null,
  checked_out_at    timestamptz,
  created_at        timestamptz not null default now()
);

create index production_tasks_batch_idx on production_tasks (batch_id, status);

/* Cópia do que a fórmula pedia na hora: mudar a fórmula depois não reescreve
   o que a ordem previu. */
create table production_task_inputs (
  id                 uuid primary key default gen_random_uuid(),
  task_id            uuid not null references production_tasks(id) on delete cascade,
  article_code       text not null references articles(code),
  planned_quantity   numeric(20,6) not null,
  actual_quantity    numeric(20,6),
  display_unit       text,
  /* Unidades de receita por unidade mostrada: 60 quando a tela fala em ovos. */
  display_factor     numeric(18,6) not null default 1,
  count_on_execution boolean not null default false,
  out_of_tolerance   boolean not null default false,
  justification      text
);

create index production_task_inputs_task_idx on production_task_inputs (task_id);

/* Razão de insumos e intermediários. `store_id` nulo é o taller. O saldo pode
   ficar negativo enquanto não houver inventário inicial: a produção não pode
   parar por falta de um dado que ninguém lançou ainda. */
create table article_movements (
  id           uuid primary key default gen_random_uuid(),
  article_code text not null references articles(code),
  store_id     uuid references stores(id),
  kind         text not null check (kind in ('production_input', 'production_output', 'byproduct', 'purchase', 'adjustment', 'loss')),
  quantity     numeric(20,6) not null,
  task_id      uuid references production_tasks(id),
  notes        text,
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now()
);

create index article_movements_article_idx on article_movements (article_code, store_id);

create view article_balances with (security_invoker = true) as
  select article_code, store_id, sum(quantity) as quantity
  from article_movements
  group by article_code, store_id;

/* ±5% é sugestão inicial: o Joseka pediu "próximo do previsto" sem fixar número. */
insert into system_settings (key, value) values ('production_tolerance_pct', '5')
on conflict (key) do nothing;

-- -----------------------------------------------------------------------------
-- 3. Operações
-- -----------------------------------------------------------------------------
create or replace function production_task_insert(p_batch uuid, p_task jsonb, p_rework_of uuid default null)
returns uuid
language plpgsql as $$
declare
  v_task uuid;
begin
  insert into production_tasks (batch_id, stage, article_code, formula_id, planned_quantity, requires, rework_of)
  values (
    p_batch,
    p_task->>'stage',
    p_task->>'article_code',
    (p_task->>'formula_id')::uuid,
    (p_task->>'planned_quantity')::numeric,
    array(select jsonb_array_elements_text(coalesce(p_task->'requires', '[]'::jsonb))),
    p_rework_of)
  returning id into v_task;

  insert into production_task_inputs (task_id, article_code, planned_quantity, display_unit, display_factor, count_on_execution)
  select v_task,
         x->>'article_code',
         (x->>'planned_quantity')::numeric,
         x->>'display_unit',
         coalesce((x->>'display_factor')::numeric, 1),
         coalesce((x->>'count_on_execution')::boolean, false)
  from jsonb_array_elements(coalesce(p_task->'inputs', '[]'::jsonb)) x;

  return v_task;
end;
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

/* Checkout de uma etapa: acontece inteiro ou não acontece. O consumo real baixa
   mesmo quando a fornada queima: o insumo foi gasto. */
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
  if t.status <> 'pending' then
    raise exception 'Esta tarea ya fue cerrada. Recarga la página.';
  end if;
  select status into v_status from production_batches where id = t.batch_id for update;
  if v_status <> 'open' then
    raise exception 'Esta orden ya no está abierta.';
  end if;

  select a.description into v_blocked
  from production_tasks q join articles a on a.code = q.article_code
  where q.batch_id = t.batch_id and q.status = 'pending' and q.article_code = any(t.requires)
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

/* Cancelar não devolve o que já foi consumido: aquilo saiu do estoque de verdade. */
create or replace function op_production_cancel(p_batch uuid, p_reason text)
returns void
language plpgsql as $$
declare
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  perform op_guard();
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

-- -----------------------------------------------------------------------------
-- 4. Segurança
-- -----------------------------------------------------------------------------
alter table articles                 enable row level security;
alter table formulas                 enable row level security;
alter table formula_lines            enable row level security;
alter table production_batches       enable row level security;
alter table production_batch_targets enable row level security;
alter table production_tasks         enable row level security;
alter table production_task_inputs   enable row level security;
alter table article_movements        enable row level security;

create policy "admin gerencia artigos"       on articles                 for all using (is_admin()) with check (is_admin());
create policy "admin gerencia fórmulas"      on formulas                 for all using (is_admin()) with check (is_admin());
create policy "admin gerencia linhas fórm."  on formula_lines            for all using (is_admin()) with check (is_admin());
create policy "admin gerencia ordens"        on production_batches       for all using (is_admin()) with check (is_admin());
create policy "admin gerencia metas"         on production_batch_targets for all using (is_admin()) with check (is_admin());
create policy "admin gerencia tarefas"       on production_tasks         for all using (is_admin()) with check (is_admin());
create policy "admin gerencia consumos"      on production_task_inputs   for all using (is_admin()) with check (is_admin());
create policy "admin gerencia mov. artigos"  on article_movements        for all using (is_admin()) with check (is_admin());
