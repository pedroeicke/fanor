# Pendências — Site Fanor

## Etiquetas de produção (29/09/2026)

Impressora confirmada: TSC TE200. Formato padrão atualizado para 50 × 25 mm,
com margem interna de 3 mm e desenho baseado no gabarito enviado. Prova com
os 11 exemplos em `/admin/etiquetas/prueba`; Moca e Delicia Tropical sem linha
de sabores. Detalhes: `docs/etiquetas-tortas-50x25mm.md`.
Antes de um despacho real: configurar os códigos de tortas de três sabores
no catálogo operacional e cadastrar suas combinações. Falta conferir a
impressão física e a calibração do rolo na TE200.

## Fase 2 — produção, receitas e custos (24/09/2026)

Levantamento das gravações com Joseka, medida da prancha (50 × 70 cm), fluxo de
produção e relação com o Siscont: `docs/levantamento-producao-joseka-2026-09-21.md`.
A prévia de importação de `Codigos_Fanor2026.xlsx` já está em
`scripts/preview-codigos-fanor.py`; ela valida 1.256 códigos e 52 fórmulas sem
alterar o banco. Encontrou um rendimento ausente e dois pontos para revisão.
A tela `/admin/recetas` mostra a prévia dessas fórmulas em espanhol, com busca,
ingredientes e pendências. A prévia fica na chave `production_recipes_preview` de
`system_settings`, protegida por RLS; o script `publish-recipes-preview.mjs` a
publica sem expor o JSON no GitHub. As receitas ainda não movimentam estoque.

**Próximos insumos do Joseka:** o Excel completo `RECETAS 2026` visto nos vídeos,
correção do rendimento e da fórmula de separação do ovo, unidades/apresentações
de compra, exemplo de exportação para Siscont e plano de contas.

---

## Fase 1 — operação da loja (13/09/2026)

Especificação, fluxo e **pauta da reunião com o Joseka**: `docs/fase-1-operacao.md`.
Banco: migrações 0011–0015, aplicadas e testadas de ponta a ponta (dados de teste apagados).

**Pronto:** catálogos e ajustes, pedido da loja → taller → despacho com etiqueta QR →
recepção → Mi vitrina → devolução/redecoração, venda de balcão, encomendas ligadas à torta
exata, CRM automático, leads com tempo de resposta, alertas, `/vitrina` pública, fotos com IA,
relatório de operação, backup diário. Build de produção e 167 consultas conferidas contra o banco.

**A vitrine pública continua lendo o Sisgeco** (`system_settings.stock_source = "sisgeco"`).
Só virar em /admin/ajustes depois que a boleta sair pelo sistema novo.

### Para ligar em produção (Vercel)

| Variável | Para quê | Sem ela |
|---|---|---|
| `CRON_SECRET` | rotinas de alertas e backup | rotinas recusam |
| `ANTHROPIC_API_KEY` | análise de foto pelo Claude | só ajuste automático |
| `RESPALDO_TOKEN` | baixador do backup no PC do Joseka | rota fica fechada |
| `ALERTS_EMAIL` / `ALERTS_WEBHOOK_URL` | aviso de alerta urgente | alertas só no painel |
| `META_VERIFY_TOKEN` / `META_APP_SECRET` | lead automático do WhatsApp/Messenger | webhook inerte |

Plano: a rotina de alertas a cada 5 min e o backup com `maxDuration = 300` pedem Vercel Pro
(ou Fluid Compute). No Hobby, trocar o alerta para agendador externo com o mesmo Bearer.

### Depende do Joseka (reunião)

Close2U (credenciais e série), formato do Siscont e plano de contas, teste físico das etiquetas na TE200,
validade da redecorada, prazos dos alertas, permissões por papel, escopo de custos, número/app da
Meta, instalação do backup no PC dele, data da virada. Lista completa no doc.

### Ficou para depois (conhecido)

- **Nenhum produto publicado do site tem `sku`**: a vitrine mostra as tortas do Sisgeco sem foto
  nem link. Vincular `products.sku` (T26, T53…) aos produtos curados liga foto, preço e o selo.
- Ñ perdido em 6 nomes que vêm do Sisgeco ("PI�A"): a vitrine corrige na tela; o certo é o
  leitor ler em windows-1252 (exige gerar o `.exe` de novo).
- Webhook da Meta: duas entregas simultâneas da mesma mensagem podem criar 2 leads (falta chave
  única por id de mensagem). Só importa quando a Meta for ligada.
- Venda de balcão sem chave de idempotência no banco: a tela procura a venda recente antes de
  cobrar de novo, o que cobre queda de rede; uma coluna `client_ref` única fecharia de vez.
- "Devolver al taller" aceita qualquer torta em vitrina no servidor (a tela limita às vencidas).
  Esperar a regra: torta danificada ainda na validade pode voltar?
- Telas do painel não foram abertas logadas no navegador por mim (o login é do cliente).

---

## Site (estado de 02/09/2026)

Estado em 02/09/2026, após a rodada de busca de endereço, mapa e logo. Cruzado com o `checklist_implementacao_site_fanor.md`.

---

## Pronto e verificado

Loja completa em Next.js 16, catálogo no Supabase (São Paulo), 95 páginas.

| | |
|---|---|
| Catálogo | 59 produtos com preço real por tamanho, no banco, editáveis pelo painel |
| Navegação | 10 ocasiões, filtro por sabor e por número de convidados, busca |
| Produto | tamanho em porções, sabores com regra "exatamente N", data e hora de entrega, mensagem na torta, upload de foto |
| Vista 360° | Red Velvet com 30 quadros — 2.400 KB → 473 KB otimizados |
| Personalizadas | configurador com preço fechado, precificado no servidor |
| Carrinho e checkout | frete por distrito visível antes de pagar, complementos |
| Pagamento | Culqi implementado; sem chaves roda em modo demonstração |
| Pedidos | gravados no Postgres, com validação total no servidor |
| E-mail | SMTP ou Resend, confirmação ao cliente + ordem de produção, com registro e reenvio |
| Painel `/admin` | login, produção do dia, pedidos com mudança de estado, CRUD completo de produtos, tamanhos, sabores, categorias, imagens e 360° |
| Configuração de entrega | distritos, tarifas, faixas, capacidade e feriados editáveis pelo painel |
| Busca de endereço | sugere enquanto digita, no próprio campo "Dirección"; Photon + Nominatim sobre OpenStreetMap, sem chave e sem cartão |
| Mapa de entrega | Leaflet + tiles CARTO Voyager; escolher o endereço põe o pino e enquadra; o ponto vai junto no pedido para quem entrega |
| Entrega por distância | implementada e **desligada**: o preço vem da tabela de distritos. Religa em /admin/entrega |
| Logo | arquivo oficial da marca no cabeçalho, rodapé e login do painel |
| Cookies | banner com recusa real, ligado ao Consent Mode do Google |
| Retenção | rotina que apaga fotos de clientes após 90 dias |
| Segurança | limite de requisições nas rotas públicas, idempotência de pedido |
| Erros | páginas de erro da marca, esqueletos de carregamento, 404 com status correto |
| Medição | 8 eventos GA4, incluindo variação, frete e clique no WhatsApp |
| Pagamentos assíncronos | webhook Culqi idempotente, estados recusado/cancelado/abandonado e expiração automática |
| Gestão | detalhe completo do pedido e relatórios por período/produto no painel |
| Monitoramento | erros de servidor e navegador enviados a webhook ou aos logs do hosting |
| Agendamentos | expiração de pagamentos e limpeza diária de fotos configuradas em `vercel.json` |
| Armazenamento | Supabase Storage — fotos de cliente em balde privado com URL assinada |
| Legais | privacidade, termos, FAQ, delivery, Libro de Reclamaciones funcional |
| SEO | meta, Open Graph gerado, JSON-LD, sitemap, robots |
| Acessibilidade | paleta em WCAG AA, um só `h1`, sem salto de nível de título, todo controle com nome acessível, alvos de toque de 44px |

---

## 1. Bloqueado — depende do Joseka

Nada disso eu consigo destravar sozinho.

| Pendência | Por quê | Impacto |
|---|---|---|
| **CSV oficial do catálogo** | SKUs (só 1 de 60 tem), confirmar 52 vs 59 produtos, quais tortas têm a regra "3 sabores entre 9" | O painel já aceita tudo isso; falta o dado |
| **Fotos 1080 × 1350** | As atuais são quadradas. O checklist pede retrato | Cards seguem quadrados até chegarem |
| **Documentação do Easy Pay** | Hoje está implementado Culqi | Sem isso não há cobrança real |
| **Fórmula comercial do frete** | Decidir se fica por distrito (hoje: S/12 central, S/18 estendido) ou por km | Por distrito já funciona; por km precisa de tarifa e raio |
| **Lima ou Arequipa** | Mockups dizem Lima; a loja atual entrega em Arequipa | Agora editável no painel de entrega, sem código |
| **Revisão jurídica** | Privacidade e termos são texto base, não parecer | Ley 29733 tem exigências próprias |
| **Avaliações reais** | Prova social está desligada | Publicar avaliação inventada é infração ao Código de Protección al Consumidor |
| **Credenciais de e-mail** | SMTP da caixa que já existe, ou chave do Resend | Envios ficam em modo simulado até chegarem |
| **Contas para transferência** | Yape/Plin, BCP e Interbank reais | Nenhuma conta aparece na página do pedido enquanto faltarem |

---

## 2. Falta construir

### Pagamento

- Trocar Culqi por Easy Pay
- Adaptar o webhook ao contrato do Easy Pay quando a documentação chegar

### Menores

- Conectar o webhook de monitoramento ao serviço escolhido; sem URL, os erros ficam nos logs do hosting
- **Testar em Android e iPhone físicos** — os viewports equivalentes (390×844 e 430×932) passaram sem overflow, mas isso não substitui Safari/iOS e Chrome/Android em aparelho real
- Medir Core Web Vitals em produção
- Trocar proporção para 1080 × 1350 quando as fotos chegarem
- Webhook de bounce do e-mail *(hoje sabemos se o provedor aceitou, não se a caixa recebeu)*
- Confirmar que o provedor de hospedagem executa os agendamentos de `vercel.json` (configuração pronta para Vercel)

---

## 3. Operacional

- **Rotacionar as chaves do Supabase e o Personal Access Token** — passaram pelo chat
- **Apagar o projeto Supabase de Oregon** (`uuavvitjiwlkznvbcysp`) — tem cópia completa dos dados
- **Trocar a senha do painel** antes de entregar ao Joseka
- **Plano Pro do Supabase (US$ 25/mês)** — o gratuito pausa o projeto após 7 dias sem atividade, o que derruba a loja
- Definir hospedagem, também em São Paulo, para ficar junto do banco
- Homologação com o Joseka e treinamento do painel

---

## 4. Riscos conhecidos

**Sem credenciais de e-mail, ninguém é avisado de nada.** O pedido entra e só existe se alguém abrir o painel. O código está pronto e testado nos dois caminhos — falta só o dado de acesso.

**A cobrança real nunca foi testada.** O fluxo inteiro funciona em modo demonstração; sem credenciais do provedor, não há como validar aprovação, recusa e webhook.

**O 360° existe para um produto só.** O componente e o importador estão prontos (`npm run db:spin`), mas só a Red Velvet tem conjunto fotografado.

**Monitoramento ainda sem destino externo.** O código captura erros no servidor e navegador, mas sem `MONITORING_WEBHOOK_URL` eles ficam apenas nos logs do hosting.

**A entrega por distância está pronta, mas desativada por configuração.** As duas lojas e coordenadas já estão no banco. Foi desligada de propósito: com `fee_per_km` em zero ela cobrava S/12 fixo, inclusive para Characato e Uchumayo, que na tabela de distritos custam S/18. Enquanto não houver tarifa por km decidida, a tabela de distritos manda no preço.

**O Google Maps foi descartado.** A chave testada carregava o script mas os tiles voltavam 403 — falta faturamento vinculado no projeto do Google, que exige cartão mesmo no nível gratuito. O mapa e a busca de endereço hoje rodam sobre OpenStreetMap, sem chave e sem custo. O código do Google continua no projeto atrás de `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`, caso um dia se decida pagar.

---

## Acessos

O acesso ao painel fica em `/admin/login`. Usuário e senha **não** são
versionados: este repositório é público. Estão no `.env.local`, que o
`.gitignore` mantém fora — e a senha de teste precisa ser trocada antes de
entregar ao Joseka.

```bash
npm run dev            # desenvolvimento
npm run catalog:fetch  # baixa catálogo da loja atual
npm run catalog        # gera data/catalog.json
npm run db:seed        # importa o catálogo para o Supabase
npm run db:admin       # cria acesso ao painel
npm run db:spin        # cadastra um conjunto 360°
```
