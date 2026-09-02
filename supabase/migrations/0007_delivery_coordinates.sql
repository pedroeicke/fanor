-- Guarda o ponto marcado pelo cliente para a operação abrir no mapa e para
-- auditar o cálculo de frete feito no servidor.
alter table orders add column if not exists delivery_lat numeric(9, 6);
alter table orders add column if not exists delivery_lng numeric(9, 6);

alter table orders drop constraint if exists orders_delivery_lat_check;
alter table orders add constraint orders_delivery_lat_check
  check (delivery_lat is null or delivery_lat between -90 and 90);

alter table orders drop constraint if exists orders_delivery_lng_check;
alter table orders add constraint orders_delivery_lng_check
  check (delivery_lng is null or delivery_lng between -180 and 180);

comment on column orders.delivery_lat is 'Latitude do ponto de entrega marcado no checkout.';
comment on column orders.delivery_lng is 'Longitude do ponto de entrega marcado no checkout.';
