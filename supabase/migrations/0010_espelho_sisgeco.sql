-- =============================================================================
-- Tortas Fanor — o que o espelho do Sisgeco precisa para ser idempotente
--
-- O leitor que roda no PC da loja copia movimentos do Sisgeco para cá. Ele
-- vai reenviar em algum momento — internet caiu no meio, serviço reiniciou,
-- cursor ficou para trás — e cada reenvio tem de cair na mesma linha, não
-- criar outra. Para isso cada coisa espelhada guarda o número que tinha na
-- origem, com índice único.
-- =============================================================================

-- Nº Interno do Sisgeco: correlativo único para entradas e saídas.
alter table stock_movements add column if not exists source_number bigint;
create unique index if not exists stock_movements_source_idx
  on stock_movements (source_number) where source_number is not null;

-- Nº da venda no Sisgeco (VentaCab.numero) e o comprovante que ela gerou.
alter table sales add column if not exists source_number bigint;
create unique index if not exists sales_source_idx
  on sales (source_number) where source_number is not null;

-- Código do artigo (T14, PS12) é a chave de espelho do produto. Só pode ser
-- chave se for único; produto sem código (só site) fica fora do índice.
create unique index if not exists products_sku_idx
  on products (sku) where sku is not null;

-- Código do Sisgeco nas listas que ele mantém.
alter table sellers   add column if not exists source_code text;
alter table customers add column if not exists source_code text;
create unique index if not exists customers_source_idx on customers (source_code) where source_code is not null;

-- Onde o leitor parou. Vive aqui, e não só num arquivo no PC da loja, para
-- que trocar de máquina não faça o espelho recomeçar do zero nem pular nada.
create table if not exists sync_state (
  key        text primary key,          -- 'sisgeco:guias', 'sisgeco:articulos'
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

alter table sync_state enable row level security;
create policy "admin lê estado de sync" on sync_state for select using (is_admin());

-- Toda chegada do leitor fica registrada: quantos movimentos, em quanto
-- tempo, com que erro. É o que responde "o espelho está atrasado?" sem
-- abrir o PC da loja.
create table if not exists sync_runs (
  id           bigserial primary key,
  source       text not null,           -- 'sisgeco'
  cursor_from  bigint,
  cursor_to    bigint,
  movements    integer not null default 0,
  cake_units   integer not null default 0,
  products     integer not null default 0,
  error        text,
  agent        text,                    -- nome do PC + versão do leitor
  started_at   timestamptz not null default now(),
  finished_at  timestamptz
);

alter table sync_runs enable row level security;
create policy "admin lê execuções de sync" on sync_runs for select using (is_admin());
