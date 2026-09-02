# Tortas Fanor — loja nova

Reconstrução da loja de [tortasfanor.com](https://tortasfanor.com) em Next.js 16,
com a identidade visual dos mockups e o funil de venda refeito.

O catálogo é real: 59 produtos, preços por tamanho e fotos extraídos da Store API
do WooCommerce da loja atual.

## Rodar

```bash
npm install && npm run dev
```

Sem variáveis de ambiente o site sobe inteiro: o catálogo vem de
`data/catalog.json` e o pagamento roda em modo demonstração. Para ligar banco e
pagamento, copie `.env.example` para `.env.local`.

## Banco (Supabase)

```bash
npm run db:seed   # importa data/catalog.json para o Supabase
```

As migrações estão em `supabase/migrations/`. Rode `0001_init.sql` (esquema +
RLS) e depois `0002_seed_reference.sql` (categorias, faixas, zonas) pelo SQL
Editor do painel, ou pelo CLI. `supabase/_run_once.sql` é as duas juntas, para
colar de uma vez.

Catálogo, pedidos e reclamações leem e escrevem no Supabase quando as
credenciais existem; sem elas caem para arquivo, o que serve ao
desenvolvimento e **não** à produção.

## O que mudou em relação ao site atual

O diagnóstico completo está no histórico do projeto; em resumo, o site antigo
era um catálogo que terminava numa conversa de WhatsApp. Os buracos que este
projeto fecha:

| Problema no site atual | Onde foi resolvido |
| --- | --- |
| Nenhuma seleção de data/hora de entrega, em tela nenhuma | `lib/delivery.ts`, `components/product/DeliveryPicker.tsx` |
| "FotoTorta" sem campo de upload de foto | `components/product/PhotoUpload.tsx`, `app/api/uploads` |
| Frete invisível até depois de pagar | `lib/delivery.ts`, resumo do carrinho e do checkout |
| Zero rastreamento (sem GA4, GTM ou Pixel) | `lib/analytics.ts` + dataLayer no `app/layout.tsx` |
| Sem meta description e sem Open Graph | `app/layout.tsx`, `app/opengraph-image.tsx` |
| "Sin valoración todavía" em 100% dos produtos | `data/reviews.ts` (ver aviso abaixo) |
| Catálogo organizado por geometria, não por ocasião | `lib/catalog.ts` → `OCCASIONS`, `app/ocasiones` |
| Tamanho em centímetros, sem dizer para quantas pessoas | `defaultServes` / `maxServings` em `scripts/build-catalog.mjs` |
| Botão principal amarelo com texto branco (1,57:1) | `app/globals.css` — dourado com tinta cacau, 8,77:1 |
| "Sobre el delivery" no rodapé apontando para um 404 | `app/delivery/page.tsx` |
| Preço confiando no cliente | `lib/orders.ts` → `priceOrder()` recalcula tudo no servidor |
| Nenhum e-mail ao cliente nem à cozinha | `lib/email/` + `email_log` com reenvio no painel |
| Catálogo só editável por programador | painel em `/admin` com CRUD e imagens |

## Estrutura

```
app/                 rotas (App Router) e endpoints
components/          UI por domínio: layout, product, cart, checkout, custom
lib/                 regras de negócio — catálogo, entrega, carrinho, pedidos
data/catalog.json    catálogo gerado; não editar à mão
scripts/             extração e transformação do catálogo
```

## Atualizar o catálogo

```bash
npm run catalog:fetch   # baixa produtos e preços de variação da loja atual
npm run catalog         # transforma em data/catalog.json
```

`build-catalog.mjs` é onde vivem as regras de porções, ocasiões e antecedência
de produção. Quando a loja migrar de vez, o passo `catalog:fetch` sai e o
catálogo passa a vir de um CMS ou banco.

As pendências completas estão em [PENDENCIAS.md](PENDENCIAS.md).

## Antes de publicar

Cinco pendências que exigem dados reais, todas marcadas com `⚠️` no código:

1. **`data/reviews.ts`** — as reseñas são de preenchimento. Popular com
   avaliações reais (a página do Facebook tem ~15 mil seguidores) ou pôr
   `SHOW_REVIEWS = false`. Publicar avaliações inventadas é infração ao Código
   de Protección al Consumidor.
2. **`lib/config.ts`** — WhatsApp, e-mail, contas bancárias e o par
   `rating`/`reviewCount` estão com valores de exemplo.
3. **`lib/delivery.ts`** — os distritos são de Lima, seguindo os mockups. A loja
   atual entrega em **Arequipa**; confirmar qual é a praça e ajustar a lista e as
   tarifas.
4. **Provedor de e-mail** — SMTP (`SMTP_HOST`) ou Resend (`RESEND_API_KEY`).
   Sem nenhum dos dois os envios são simulados e marcados como tal no painel.
   Ver `.env.example`.
5. **Textos legais** — privacidade e termos são base, não parecer jurídico.
   Revisar com advogado; a Ley 29733 tem exigências próprias.
