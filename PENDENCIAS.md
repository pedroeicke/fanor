# Pendências — Site Fanor

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

## 1. Bloqueado — depende da Joseka

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
- **Trocar a senha do painel** antes de entregar à Joseka
- **Plano Pro do Supabase (US$ 25/mês)** — o gratuito pausa o projeto após 7 dias sem atividade, o que derruba a loja
- Definir hospedagem, também em São Paulo, para ficar junto do banco
- Homologação com a Joseka e treinamento do painel

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
entregar à Joseka.

```bash
npm run dev            # desenvolvimento
npm run catalog:fetch  # baixa catálogo da loja atual
npm run catalog        # gera data/catalog.json
npm run db:seed        # importa o catálogo para o Supabase
npm run db:admin       # cria acesso ao painel
npm run db:spin        # cadastra um conjunto 360°
```
