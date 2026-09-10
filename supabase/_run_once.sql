-- =============================================================================
-- Tortas Fanor — migrações 0001 + 0002 combinadas
-- Cole tudo no SQL Editor do Supabase e execute uma vez.
-- =============================================================================

-- =============================================================================
-- Tortas Fanor — esquema inicial
--
-- Substitui o catálogo em arquivo por dados editáveis. É o que permite a
-- Joseka criar, editar, desativar e excluir produtos sem ajuda técnica —
-- critério de aceite do projeto.
--
-- Convenções:
--   · preços em NUMERIC(10,2), nunca float — dinheiro não admite arredondamento
--     binário;
--   · tudo que o cliente vê tem `status`, para permitir rascunho;
--   · RLS ligado em todas as tabelas: leitura pública só do que está ativo,
--     escrita só por administrador autenticado.
-- =============================================================================

create extension if not exists "pgcrypto";

-- -----------------------------------------------------------------------------
-- Utilitário: mantém updated_at correto sem depender da aplicação
-- -----------------------------------------------------------------------------
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Administradores
-- -----------------------------------------------------------------------------
create table admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  name       text not null,
  role       text not null default 'staff' check (role in ('owner', 'staff')),
  created_at timestamptz not null default now()
);

comment on table admins is
  'Quem pode entrar no painel. O vínculo é com auth.users do Supabase.';

create or replace function is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from admins where user_id = auth.uid());
$$;

-- -----------------------------------------------------------------------------
-- Lojas
-- -----------------------------------------------------------------------------
create table stores (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  address    text not null,
  district   text,
  -- Coordenadas alimentam a escolha da loja mais próxima no cálculo de entrega.
  lat        double precision,
  lng        double precision,
  phone      text,
  hours      jsonb not null default '[]'::jsonb,
  active     boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger stores_updated_at before update on stores
  for each row execute function set_updated_at();

-- -----------------------------------------------------------------------------
-- Categorias — por ocasião (como se compra) e por tipo (como se produz)
-- -----------------------------------------------------------------------------
create table categories (
  id         uuid primary key default gen_random_uuid(),
  slug       text not null unique,
  name       text not null,
  kind       text not null check (kind in ('ocasion', 'tipo')),
  headline   text,
  blurb      text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

comment on column categories.kind is
  'ocasion navega a loja (cumpleaños, aniversario); tipo é classificação interna (redonda, rectangular) e vira filtro secundário.';

-- -----------------------------------------------------------------------------
-- Produtos
-- -----------------------------------------------------------------------------
create table products (
  id                uuid primary key default gen_random_uuid(),
  slug              text not null unique,
  sku               text unique,
  name              text not null,
  short_description text,
  description       text,

  kind   text not null default 'simple'
         check (kind in ('simple', 'variable', 'custom')),
  status text not null default 'draft'
         check (status in ('active', 'draft', 'unavailable')),

  -- Produto simples usa base_price. Variável usa product_sizes.price.
  base_price numeric(10, 2) check (base_price is null or base_price >= 0),

  -- "Escolher exatamente 3 entre 9" é min = max = 3, com 9 linhas em
  -- product_flavors. "Até 3" seria min 1, max 3. A mesma estrutura cobre as duas.
  min_flavors integer not null default 0 check (min_flavors >= 0),
  max_flavors integer not null default 0 check (max_flavors >= min_flavors),

  lead_time_hours integer not null default 24 check (lead_time_hours >= 0),

  accepts_photo   boolean not null default false,
  accepts_message boolean not null default true,
  message_limit   integer not null default 80,

  -- Porções do tamanho padrão e teto de porções, para o filtro de convidados.
  default_serves text,
  max_servings   integer,

  featured        boolean not null default false,
  seo_title       text,
  seo_description text,
  sort_order      integer not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index products_status_idx on products (status);
create index products_featured_idx on products (featured) where status = 'active';

create trigger products_updated_at before update on products
  for each row execute function set_updated_at();

-- Tamanhos de um produto variável
create table product_sizes (
  id         uuid primary key default gen_random_uuid(),
  product_id uuid not null references products (id) on delete cascade,
  slug       text not null,
  label      text not null,
  serves     text,
  price      numeric(10, 2) not null check (price >= 0),
  sort_order integer not null default 0,
  active     boolean not null default true,
  unique (product_id, slug)
);

create index product_sizes_product_idx on product_sizes (product_id);

-- Sabores oferecidos por produto
create table product_flavors (
  id         uuid primary key default gen_random_uuid(),
  product_id uuid not null references products (id) on delete cascade,
  slug       text not null,
  label      text not null,
  sort_order integer not null default 0,
  active     boolean not null default true,
  unique (product_id, slug)
);

create index product_flavors_product_idx on product_flavors (product_id);

-- Imagens. `kind` separa a galeria comum do conjunto de giro 360°.
create table product_images (
  id         uuid primary key default gen_random_uuid(),
  product_id uuid not null references products (id) on delete cascade,
  url        text not null,
  alt        text,
  kind       text not null default 'gallery' check (kind in ('gallery', 'spin360')),
  width      integer,
  height     integer,
  -- Para spin360 é o número do quadro; a ordem define o sentido do giro.
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index product_images_product_idx on product_images (product_id, kind, sort_order);

create table product_categories (
  product_id  uuid not null references products (id) on delete cascade,
  category_id uuid not null references categories (id) on delete cascade,
  primary key (product_id, category_id)
);

-- Disponibilidade por loja. Sem linha aqui, o produto vale para todas.
create table product_stores (
  product_id uuid not null references products (id) on delete cascade,
  store_id   uuid not null references stores (id) on delete cascade,
  primary key (product_id, store_id)
);

-- -----------------------------------------------------------------------------
-- Entrega
-- -----------------------------------------------------------------------------
create table delivery_zones (
  id         uuid primary key default gen_random_uuid(),
  slug       text not null unique,
  name       text not null,
  coverage   text not null default 'principal',
  fee        numeric(10, 2) not null check (fee >= 0),
  store_id   uuid references stores (id) on delete set null,
  active     boolean not null default true,
  sort_order integer not null default 0
);

comment on table delivery_zones is
  'Tarifa por distrito. Fica como base e como fallback quando a fórmula por distância não puder ser aplicada.';

create table delivery_slots (
  id         uuid primary key default gen_random_uuid(),
  slug       text not null unique,
  label      text not null,
  start_hour integer not null check (start_hour between 0 and 23),
  end_hour   integer not null check (end_hour between 1 and 24),
  -- Dias em que a faixa existe: 0 = domingo … 6 = sábado.
  weekdays   integer[] not null default '{0,1,2,3,4,5,6}',
  -- Teto de pedidos aceitos na faixa; null = sem limite.
  capacity   integer check (capacity is null or capacity > 0),
  active     boolean not null default true,
  sort_order integer not null default 0
);

-- Feriados e dias em que a operação não entrega.
create table delivery_blackouts (
  id      uuid primary key default gen_random_uuid(),
  date    date not null,
  slot_id uuid references delivery_slots (id) on delete cascade,
  reason  text,
  -- slot_id nulo bloqueia o dia inteiro.
  unique nulls not distinct (date, slot_id)
);

create table delivery_settings (
  id                 boolean primary key default true check (id),
  free_delivery_from numeric(10, 2) not null default 150,
  -- Fórmula por distância, a confirmar com a operação.
  base_fee           numeric(10, 2) not null default 12,
  fee_per_km         numeric(10, 2) not null default 0,
  max_distance_km    numeric(10, 2) not null default 25,
  updated_at         timestamptz not null default now()
);

comment on table delivery_settings is
  'Linha única com os parâmetros comerciais da entrega, editáveis no painel.';

-- -----------------------------------------------------------------------------
-- Pedidos
-- -----------------------------------------------------------------------------
create table orders (
  code       text primary key,
  status     text not null default 'pending_payment'
             check (status in ('pending_payment', 'paid', 'failed', 'cancelled')),

  customer_name  text not null,
  customer_phone text not null,
  customer_email text not null,

  delivery_method   text not null check (delivery_method in ('delivery', 'pickup')),
  delivery_date     date not null,
  delivery_slot     text not null,
  delivery_zone     text,
  delivery_address  text,
  delivery_reference text,
  store_id          uuid references stores (id) on delete set null,

  subtotal numeric(10, 2) not null check (subtotal >= 0),
  shipping numeric(10, 2) not null default 0 check (shipping >= 0),
  total    numeric(10, 2) not null check (total >= 0),
  currency text not null default 'PEN',

  payment_method    text not null check (payment_method in ('card', 'transfer')),
  payment_provider  text,
  -- Identificador da cobrança no provedor. UNIQUE é o que torna o webhook
  -- idempotente: uma segunda notificação da mesma cobrança não cria pedido novo.
  payment_reference text unique,
  paid_at           timestamptz,
  simulated         boolean not null default false,

  notes      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index orders_delivery_date_idx on orders (delivery_date, delivery_slot);
create index orders_status_idx on orders (status, created_at desc);

create trigger orders_updated_at before update on orders
  for each row execute function set_updated_at();

create table order_items (
  id           uuid primary key default gen_random_uuid(),
  order_code   text not null references orders (code) on delete cascade,
  -- Sem cascade: apagar um produto não pode apagar histórico de venda.
  product_id   uuid references products (id) on delete set null,
  -- Nome e preço copiados no momento da compra: o pedido não muda se o
  -- catálogo mudar depois.
  product_name text not null,
  size_label   text,
  flavors      text[] not null default '{}',
  quantity     integer not null check (quantity between 1 and 20),
  unit_price   numeric(10, 2) not null check (unit_price >= 0),
  cake_message text,
  photo_url    text,
  instructions text
);

create index order_items_order_idx on order_items (order_code);

-- Libro de Reclamaciones (exigência do Código de Protección al Consumidor)
create table complaints (
  code       text primary key,
  status     text not null default 'recibido'
             check (status in ('recibido', 'en_proceso', 'respondido')),
  name       text not null,
  document   text not null,
  email      text not null,
  phone      text not null,
  address    text not null,
  kind       text not null check (kind in ('reclamo', 'queja')),
  order_code text references orders (code) on delete set null,
  detail     text not null,
  request    text not null,
  response   text,
  created_at timestamptz not null default now(),
  responded_at timestamptz
);

-- Trilha de alterações do painel
create table audit_log (
  id         bigint generated always as identity primary key,
  actor      uuid references auth.users (id) on delete set null,
  action     text not null,
  entity     text not null,
  entity_id  text,
  changes    jsonb,
  created_at timestamptz not null default now()
);

create index audit_log_created_idx on audit_log (created_at desc);

-- =============================================================================
-- Row Level Security
--
-- A chave anônima é pública por natureza — ela vai no navegador. Quem protege
-- os dados é a política, não o segredo da chave.
-- =============================================================================

alter table admins             enable row level security;
alter table stores             enable row level security;
alter table categories         enable row level security;
alter table products           enable row level security;
alter table product_sizes      enable row level security;
alter table product_flavors    enable row level security;
alter table product_images     enable row level security;
alter table product_categories enable row level security;
alter table product_stores     enable row level security;
alter table delivery_zones     enable row level security;
alter table delivery_slots     enable row level security;
alter table delivery_blackouts enable row level security;
alter table delivery_settings  enable row level security;
alter table orders             enable row level security;
alter table order_items        enable row level security;
alter table complaints         enable row level security;
alter table audit_log          enable row level security;

-- Leitura pública: só o que está publicado.
create policy "público lê produtos ativos" on products
  for select using (status = 'active');

create policy "público lê tamanhos de produtos ativos" on product_sizes
  for select using (
    active and exists (
      select 1 from products p where p.id = product_id and p.status = 'active'
    )
  );

create policy "público lê sabores de produtos ativos" on product_flavors
  for select using (
    active and exists (
      select 1 from products p where p.id = product_id and p.status = 'active'
    )
  );

create policy "público lê imagens de produtos ativos" on product_images
  for select using (
    exists (select 1 from products p where p.id = product_id and p.status = 'active')
  );

create policy "público lê vínculos de categoria" on product_categories
  for select using (
    exists (select 1 from products p where p.id = product_id and p.status = 'active')
  );

create policy "público lê vínculos de loja" on product_stores
  for select using (
    exists (select 1 from products p where p.id = product_id and p.status = 'active')
  );

create policy "público lê categorias"        on categories        for select using (true);
create policy "público lê lojas ativas"      on stores            for select using (active);
create policy "público lê zonas ativas"      on delivery_zones    for select using (active);
create policy "público lê faixas ativas"     on delivery_slots    for select using (active);
create policy "público lê bloqueios"         on delivery_blackouts for select using (true);
create policy "público lê parâmetros"        on delivery_settings for select using (true);

-- Pedidos e reclamações: nenhuma leitura ou escrita pela chave anônima.
-- Passam exclusivamente pelas rotas do servidor, com a service role key.
create policy "admin lê pedidos"        on orders     for select using (is_admin());
create policy "admin lê itens"          on order_items for select using (is_admin());
create policy "admin lê reclamações"    on complaints for select using (is_admin());
create policy "admin lê auditoria"      on audit_log  for select using (is_admin());
create policy "admin lê a si mesmo"     on admins     for select using (user_id = auth.uid());

-- Escrita do catálogo: administrador autenticado.
create policy "admin gerencia produtos"    on products           for all using (is_admin()) with check (is_admin());
create policy "admin gerencia tamanhos"    on product_sizes      for all using (is_admin()) with check (is_admin());
create policy "admin gerencia sabores"     on product_flavors    for all using (is_admin()) with check (is_admin());
create policy "admin gerencia imagens"     on product_images     for all using (is_admin()) with check (is_admin());
create policy "admin gerencia categorias"  on categories         for all using (is_admin()) with check (is_admin());
create policy "admin gerencia vínc. cat"   on product_categories for all using (is_admin()) with check (is_admin());
create policy "admin gerencia vínc. loja"  on product_stores     for all using (is_admin()) with check (is_admin());
create policy "admin gerencia lojas"       on stores             for all using (is_admin()) with check (is_admin());
create policy "admin gerencia zonas"       on delivery_zones     for all using (is_admin()) with check (is_admin());
create policy "admin gerencia faixas"      on delivery_slots     for all using (is_admin()) with check (is_admin());
create policy "admin gerencia bloqueios"   on delivery_blackouts for all using (is_admin()) with check (is_admin());
create policy "admin gerencia parâmetros"  on delivery_settings  for all using (is_admin()) with check (is_admin());
create policy "admin atualiza pedidos"     on orders             for update using (is_admin()) with check (is_admin());
create policy "admin atualiza reclamações" on complaints         for update using (is_admin()) with check (is_admin());


-- =============================================================================
-- Dados de referência: categorias, zonas, faixas horárias e parâmetros.
--
-- Produtos NÃO entram aqui — eles vêm por importação (npm run db:seed), porque
-- a lista definitiva ainda depende do CSV do Joseka.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Ocasiões — como a pessoa realmente procura uma torta
-- -----------------------------------------------------------------------------
insert into categories (slug, name, kind, headline, blurb, sort_order) values
  ('cumpleanos', 'Cumpleaños', 'ocasion', 'Tortas de cumpleaños',
   'Clásicos que nunca fallan, con mensaje personalizado incluido.', 1),
  ('infantil', 'Infantiles', 'ocasion', 'Tortas infantiles',
   'Temáticas y colores que a los chicos les encantan.', 2),
  ('romance', 'Aniversarios', 'ocasion', 'Tortas para aniversarios',
   'Diseños elegantes para celebrar a dos.', 3),
  ('quince', 'Quinceañeras', 'ocasion', 'Tortas de 15 años',
   'La torta que se recuerda toda la vida.', 4),
  ('boda', 'Bodas', 'ocasion', 'Tortas de boda',
   'Diseños de varios pisos, decorados a mano.', 5),
  ('bautizo', 'Bautizos', 'ocasion', 'Tortas de bautizo',
   'Delicadas y en tonos suaves, para el día del bautizo.', 6),
  ('graduacion', 'Graduaciones', 'ocasion', 'Tortas de graduación',
   'Para cerrar la etapa con algo dulce.', 7),
  ('para-compartir', 'Para compartir', 'ocasion', 'Tortas para grupos grandes',
   'Desde 20 hasta 35 porciones, para oficinas y reuniones familiares.', 8),
  ('personalizadas', 'Personalizadas', 'ocasion', 'Tortas personalizadas',
   'Tu foto y tu diseño impresos en calidad fotográfica comestible.', 9),
  ('fechas-especiales', 'Fechas especiales', 'ocasion', 'Fechas especiales',
   'Navidad, Día de la Madre, Día del Padre y más.', 10)
on conflict (slug) do nothing;

-- -----------------------------------------------------------------------------
-- Tipos — classificação de produção, usada só como filtro secundário
-- -----------------------------------------------------------------------------
insert into categories (slug, name, kind, sort_order) values
  ('redondas', 'Redondas', 'tipo', 1),
  ('rectangulares', 'Rectangulares', 'tipo', 2),
  ('altezas', 'Altezas', 'tipo', 3),
  ('semi-frios', 'Semi-fríos', 'tipo', 4),
  ('fototortas', 'FotoTortas', 'tipo', 5),
  ('fototopper', 'FotoTopper', 'tipo', 6),
  ('corazones', 'Corazones', 'tipo', 7),
  ('tres-sabores', 'Tortas 3 sabores', 'tipo', 8)
on conflict (slug) do nothing;

-- -----------------------------------------------------------------------------
-- Faixas de entrega
--
-- A partir das 10h, conforme confirmado com a operação. O horário de
-- atendimento é 9h–20h de segunda a sábado e 8h–18h no domingo, por isso a
-- última faixa não existe aos domingos.
-- -----------------------------------------------------------------------------
insert into delivery_slots (slug, label, start_hour, end_hour, weekdays, sort_order) values
  ('10-13', '10:00 a.m. – 1:00 p.m.', 10, 13, '{0,1,2,3,4,5,6}', 1),
  ('13-16', '1:00 p.m. – 4:00 p.m.',  13, 16, '{0,1,2,3,4,5,6}', 2),
  ('16-18', '4:00 p.m. – 6:00 p.m.',  16, 18, '{0,1,2,3,4,5,6}', 3),
  ('18-20', '6:00 p.m. – 8:00 p.m.',  18, 20, '{1,2,3,4,5,6}',   4)
on conflict (slug) do nothing;

-- -----------------------------------------------------------------------------
-- Parâmetros comerciais da entrega
--
-- fee_per_km em zero mantém o comportamento por zona enquanto a fórmula por
-- distância não é confirmada. Assim que vier, é atualizar esta linha.
-- -----------------------------------------------------------------------------
insert into delivery_settings (id, free_delivery_from, base_fee, fee_per_km, max_distance_km)
values (true, 150, 12, 0, 25)
on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- Zonas de entrega
--
-- ⚠️ PENDENTE DE CONFIRMAÇÃO: esta lista é de Lima, seguindo os mockups. A loja
-- atual entrega em Arequipa. Confirmar a praça antes de publicar e trocar as
-- linhas abaixo.
-- -----------------------------------------------------------------------------
insert into delivery_zones (slug, name, coverage, fee, sort_order) values
  ('miraflores',              'Miraflores',              'principal', 12,  1),
  ('san-isidro',              'San Isidro',              'principal', 12,  2),
  ('surquillo',               'Surquillo',               'principal', 12,  3),
  ('san-borja',               'San Borja',               'principal', 12,  4),
  ('santiago-de-surco',       'Santiago de Surco',       'principal', 12,  5),
  ('barranco',                'Barranco',                'principal', 12,  6),
  ('lince',                   'Lince',                   'principal', 12,  7),
  ('jesus-maria',             'Jesús María',             'principal', 12,  8),
  ('magdalena-del-mar',       'Magdalena del Mar',       'principal', 12,  9),
  ('pueblo-libre',            'Pueblo Libre',            'principal', 12, 10),
  ('san-miguel',              'San Miguel',              'principal', 12, 11),
  ('la-molina',               'La Molina',               'extendida', 18, 12),
  ('la-victoria',             'La Victoria',             'extendida', 18, 13),
  ('cercado-de-lima',         'Cercado de Lima',         'extendida', 18, 14),
  ('rimac',                   'Rímac',                   'extendida', 18, 15),
  ('brena',                   'Breña',                   'extendida', 18, 16),
  ('chorrillos',              'Chorrillos',              'extendida', 18, 17),
  ('santa-anita',             'Santa Anita',             'extendida', 18, 18),
  ('ate',                     'Ate',                     'extendida', 18, 19),
  ('san-juan-de-lurigancho',  'San Juan de Lurigancho',  'extendida', 18, 20),
  ('independencia',           'Independencia',           'extendida', 18, 21),
  ('los-olivos',              'Los Olivos',              'extendida', 18, 22),
  ('san-martin-de-porres',    'San Martín de Porres',    'extendida', 18, 23),
  ('comas',                   'Comas',                   'extendida', 18, 24)
on conflict (slug) do nothing;
