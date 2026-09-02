-- =============================================================================
-- Registro de e-mails transacionais
--
-- Existe por três motivos, nesta ordem de importância:
--
--   1. Idempotência. A UNIQUE em (order_code, kind) é o que impede o mesmo
--      e-mail de sair duas vezes se a rota for chamada de novo — por retry do
--      gateway, duplo clique ou reprocessamento.
--   2. Rastro. Sem `last_error` e `attempts`, uma falha de envio é invisível:
--      o pedido existe, ninguém foi avisado, e não há como saber por quê.
--   3. Reenvio. O painel precisa saber o que falhou para poder tentar de novo.
-- =============================================================================

create type email_kind as enum ('customer_confirmation', 'ops_notification');
create type email_status as enum ('pending', 'sent', 'failed');

create table email_log (
  id          uuid primary key default gen_random_uuid(),
  order_code  text not null references orders (code) on delete cascade,
  kind        email_kind not null,
  recipient   text not null,
  subject     text,

  status      email_status not null default 'pending',
  attempts    integer not null default 0,
  last_error  text,

  provider    text,
  /* Id da mensagem no provedor, para rastrear entrega e bounce depois. */
  provider_id text,
  /* Marca envio sem credenciais reais, para não se confundir com envio real. */
  simulated   boolean not null default false,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  sent_at     timestamptz,

  -- Um e-mail de cada tipo por pedido. É a trava contra duplicidade.
  unique (order_code, kind)
);

create index email_log_status_idx on email_log (status, created_at desc);

create trigger email_log_updated_at before update on email_log
  for each row execute function set_updated_at();

alter table email_log enable row level security;

create policy "admin lê o registro de e-mails" on email_log
  for select using (is_admin());
