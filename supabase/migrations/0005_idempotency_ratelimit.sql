-- =============================================================================
-- Idempotência de pedidos e limite de requisições
-- =============================================================================

-- Chave de idempotência enviada pelo navegador. UNIQUE parcial: pedidos
-- antigos, sem chave, continuam válidos.
alter table orders add column if not exists idempotency_key text;

create unique index if not exists orders_idempotency_key_idx
  on orders (idempotency_key)
  where idempotency_key is not null;

comment on column orders.idempotency_key is
  'Gerada no navegador por tentativa de compra. Impede que duplo clique ou retry de rede criem dois pedidos — e, no cartão, duas cobranças.';

-- -----------------------------------------------------------------------------
-- Limite de requisições
--
-- Janela deslizante contada no banco. Não é tão preciso quanto Redis, mas não
-- exige mais um serviço, e o volume de uma confeitaria cabe folgado.
-- -----------------------------------------------------------------------------
create table if not exists rate_limits (
  id         bigint generated always as identity primary key,
  bucket     text not null,
  identifier text not null,
  created_at timestamptz not null default now()
);

create index if not exists rate_limits_lookup_idx
  on rate_limits (bucket, identifier, created_at desc);

alter table rate_limits enable row level security;

/**
 * Registra a tentativa e devolve quantas houve na janela.
 *
 * SECURITY DEFINER porque roda com a chave de serviço a partir das rotas —
 * nunca é exposta ao cliente.
 */
create or replace function hit_rate_limit(
  p_bucket text,
  p_identifier text,
  p_window_seconds integer
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  -- Limpeza oportunista: evita cron só para isto.
  delete from rate_limits
   where created_at < now() - make_interval(secs => p_window_seconds * 4);

  insert into rate_limits (bucket, identifier) values (p_bucket, p_identifier);

  select count(*) into v_count
    from rate_limits
   where bucket = p_bucket
     and identifier = p_identifier
     and created_at > now() - make_interval(secs => p_window_seconds);

  return v_count;
end;
$$;
