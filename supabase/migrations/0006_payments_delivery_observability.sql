-- Estados assíncronos e trilha idempotente de eventos do provedor.
alter table orders drop constraint if exists orders_status_check;
alter table orders add constraint orders_status_check
  check (status in ('pending_payment', 'paid', 'failed', 'cancelled', 'abandoned'));

create table if not exists payment_events (
  id bigint generated always as identity primary key,
  provider text not null,
  event_id text not null,
  event_type text not null,
  order_code text references orders (code) on delete set null,
  payment_reference text,
  payload jsonb not null default '{}'::jsonb,
  processed_at timestamptz not null default now(),
  unique (provider, event_id)
);

create index if not exists payment_events_order_idx
  on payment_events (order_code, processed_at desc);

alter table payment_events enable row level security;
drop policy if exists "admin lê eventos de pagamento" on payment_events;
create policy "admin lê eventos de pagamento" on payment_events
  for select using (is_admin());

comment on table payment_events is
  'Recebe webhooks e mudanças locais de pagamento. provider+event_id impede processamento duplicado.';
