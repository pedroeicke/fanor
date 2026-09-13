-- =============================================================================
-- Tortas Fanor — família do produto derivada do código do Sisgeco
--
-- Os 364 artigos que o espelho trouxe chegaram sem família: o leitor procurava
-- a família pelo `codfamilia` do Sisgeco, que não é o prefixo que usamos como
-- código (T, PS, ADL…), e na dúvida gravava nulo — a cada 10 minutos, na
-- atualização do catálogo.
--
-- Sem família, o fluxo novo não sabe que "T26 TRES LECHES" é torta: não exige
-- série na venda, não sabe a validade, e trataria o adiantamento (ADL) como
-- mercadoria. Gatilho em vez de só corrigir o leitor: vale para qualquer
-- caminho que grave produto, inclusive o leitor antigo que ainda roda na loja.
-- =============================================================================

create or replace function products_family_from_sku() returns trigger
language plpgsql as $$
begin
  if new.family_id is null and new.sku is not null then
    select id into new.family_id
      from product_families
     where code = substring(upper(new.sku) from '^[A-Z]+');
  end if;
  return new;
end;
$$;

drop trigger if exists products_family_from_sku on products;
create trigger products_family_from_sku before insert or update of family_id, sku on products
  for each row execute function products_family_from_sku();

update products p
   set family_id = f.id
  from product_families f
 where p.family_id is null
   and p.sku is not null
   and f.code = substring(upper(p.sku) from '^[A-Z]+');
