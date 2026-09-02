-- =============================================================================
-- Armazenamento de imagens
--
-- Dois baldes, com privacidade oposta e de propósito:
--
--   · product-images  — PÚBLICO. São fotos de catálogo, feitas para aparecer.
--   · customer-photos — PRIVADO. São imagens que o cliente envia para imprimir
--     na torta: rostos, crianças, fotos de família. Ficam atrás de URL
--     assinada com validade, nunca em link permanente.
--
-- Substitui a gravação em public/uploads, que é disco efêmero em hospedagem
-- serverless — as fotos sumiriam no primeiro deploy.
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'product-images',
  'product-images',
  true,
  8388608, -- 8 MB
  array['image/jpeg', 'image/png', 'image/webp', 'image/avif']
)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'customer-photos',
  'customer-photos',
  false,
  8388608,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic']
)
on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- Políticas
--
-- A escrita passa toda pelo servidor com a service role key, que ignora RLS.
-- Estas políticas existem para o que a chave anônima pode fazer — e a resposta
-- é: ler o catálogo, nada mais.
-- -----------------------------------------------------------------------------

create policy "qualquer um lê imagens de produto"
  on storage.objects for select
  using (bucket_id = 'product-images');

create policy "admin gerencia imagens de produto"
  on storage.objects for all
  using (bucket_id = 'product-images' and is_admin())
  with check (bucket_id = 'product-images' and is_admin());

-- customer-photos não recebe política de leitura pública: o acesso é só por
-- URL assinada, gerada no servidor no momento de exibir.
create policy "admin lê fotos de clientes"
  on storage.objects for select
  using (bucket_id = 'customer-photos' and is_admin());
