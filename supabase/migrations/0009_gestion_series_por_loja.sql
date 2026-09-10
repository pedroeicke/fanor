-- =============================================================================
-- Tortas Fanor — correções ao núcleo de gestão, vindas de documentos reais da
-- loja (guias de ingresso GI-265275/278/279, Registro de Ventas e Kardex de
-- 03/09/2026)
-- =============================================================================

-- 1. A série da torta nasce na GUIA DE INGRESSO (produção → almacén), e o
--    prefixo é do almacén, não da empresa: 'G' no almacén 1-PERU FANOR,
--    'D' no 2-EE.UU. FANOR. A migração 0008 supôs um único 'D'.
alter table stores add column if not exists serial_prefix char(1);
comment on column stores.serial_prefix is
  'Letra que abre a série das tortas produzidas nesta loja (G = Calle Perú, D = Av. EE.UU.), como nas guias de ingresso do Sisgeco.';

update stores set serial_prefix = 'G' where serial_prefix is null and (name ilike '%per_%' or address ilike '%per_%');
update stores set serial_prefix = 'D' where serial_prefix is null and (name ilike '%estados unidos%' or name ilike '%ee.uu%' or address ilike '%estados unidos%');

-- Uma sequência por prefixo. As duas começam em 100000: a última série vista
-- é D0000083440 / G0000006302, e um só piso evita cruzar com qualquer uma.
create sequence if not exists cake_serial_seq_g start with 100000;
alter sequence cake_serial_seq restart with 100000;   -- passa a ser a do 'D'

create or replace function next_cake_serial(p_store uuid) returns text
language plpgsql volatile as $$
declare
  prefix char(1);
begin
  select serial_prefix into prefix from stores where id = p_store;
  if prefix is null then
    raise exception 'Loja % sem prefixo de série (stores.serial_prefix)', p_store;
  end if;
  return prefix || lpad(
    (case prefix when 'G' then nextval('cake_serial_seq_g') else nextval('cake_serial_seq') end)::text,
    10, '0');
end;
$$;

-- O default de coluna não enxerga store_id; a série é atribuída por gatilho.
alter table cake_units alter column serial drop default;

create or replace function cake_units_assign_serial() returns trigger
language plpgsql as $$
begin
  if new.serial is null then
    new.serial := next_cake_serial(new.store_id);
  end if;
  return new;
end;
$$;

create trigger cake_units_serial before insert on cake_units
  for each row execute function cake_units_assign_serial();

-- 2. Validade é do produto, não regra geral: nas guias, quase tudo vence em
--    2 dias, mas "Torta Pasión de Fresa" vence em 1. `products.shelf_life_days`
--    já existe; aqui só o padrão da família torta, para produto novo não
--    nascer sem validade.
alter table product_families add column if not exists shelf_life_days integer;
update product_families set shelf_life_days = 2 where code = 'T';

-- 3. Séries fiscais em uso que os JSONs do Close2U não mostravam. O Registro
--    de Ventas de 03/09/2026 tem boletas B001 (outra vendedora, outro ponto
--    de venda) e facturas F001, além das B003/F010 conhecidas.
insert into fiscal_series (serie, doc_type, channel, next_number) values
  ('F001', '01', 'counter', 1)
on conflict (serie) do nothing;

-- 4. Guias de ingresso e saídas por venda compartilham um único correlativo
--    no Sisgeco (Nº Interno 265279 na guia, 265295 no kardex do mesmo dia).
--    `stock_movements.number` já é uma sequência única para todos os tipos —
--    fica registrado que isso foi de propósito. Códigos do Sisgeco, para a
--    migração do histórico: I004 = ingresso por produção, S003 = saída por
--    venda.
comment on column stock_movements.number is
  'Correlativo único para todos os tipos de movimento, como o Nº Interno do Sisgeco (I004 ingresso, S003 saída por venda).';
