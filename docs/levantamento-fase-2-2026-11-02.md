# Levantamento da Fase 2 — produção, porções, embalagens e gastos

**Data:** 02/11/2026
**Fontes:** conversa em que as falas do Joseka foram transcritas e discutidas, e a planilha `Códigos _ Recetas_Fanor2026 (1).xlsx`.

Este documento separa o que veio do cliente do que foi apenas sugerido pelo assistente na conversa. Sugestão não é decisão até ser confirmada.

## O que o cliente definiu

### Cadastro e unidades

- Uma única tabela de artigos. A coluna de tipo controla o uso: a venda não oferece serviço nem matéria-prima, e a receita não aceita energia elétrica.
- Código, descrição e unidade andam juntos. A conversão é interna: por exemplo, 1 balde de manjar = 19.000 g.
- O mesmo insumo pode ser usado em unidades diferentes conforme a receita, e cada linha da receita informa a sua unidade. A planilha já marca isso: as batidas usam 40 ovos (`un.`) e as Tres Leches usam 2.500 g.
- Ovo: 1 ovo = 60 g = 35 g de clara + 25 g de gema. Esse dado fica no cadastro e já está na planilha. Substitui o exemplo anterior de 50 ml, 30 ml e 20 ml.
- Separar o ovo gera gema e clara na mesma operação. A clara que sobra precisa ter registro no sistema.
- Tres Leches é exceção: a receita pede peso, e o produtor informa quantos ovos realmente quebrou. É esse número que baixa o estoque.
- Banana e casos parecidos têm rendimento de processo (1 kg com casca → 750 g descascada). Isso não é conversão de unidade.

### Produção

- A fórmula é uma só e o sistema calcula as proporções. Uma batida atende vários formatos, cada um com seu rendimento. A planilha já traz isso como frações: `CAKE-T26NR` usa 1/12 de `BAT-NARANJ`, `CAKE-PLANR` usa 1/5.
- A produção informa quantas unidades quer de cada formato, inclusive misturando formatos na mesma batida. O sistema soma as frações e devolve os ingredientes.
- A produção pode fazer menos que a fórmula inteira (7 em vez de 13, por exemplo).
- O produtor confirma o que realmente usou, e o valor precisa ficar próximo do previsto.
- A ordem nasce da demanda: a loja pede, a decoração organiza e o forno executa. O forno não acompanha a loja ao vivo.
- Toda etapa tem checkout. Se der certo, segue para a próxima. Se der errado, o sistema manda refazer e calcula os insumos do que falta.

### Caixas e artigos da loja

- A caixa externa sai do estoque da loja, não do taller, e não entra na fórmula.
- Cada torta é vinculada à sua caixa por tamanho e formato. A venda baixa a caixa automaticamente. Velas, refrigerantes e similares seguem a mesma ideia de estoque por loja.

### Validade e porções

- A série da torta registra produção, empate e decoração, e o sistema emite alertas a partir dessas datas.
- Exemplo do cliente: saiu dia 27, vende até dia 28, volta para redecorar dia 29, tenta vender de novo, e se não vender é fracionada dia 30.
- A vendedora embala as porções na loja, com embalagem, tampa, colher e guardanapo.
- **Decisão:** o taller envia as etiquetas das porções junto com a torta, para a loja não precisar imprimir.
- O controle precisa impedir a venda de porção velha.

### Custos

- O peso de cada fórmula entra na planilha e serve para custo. Ainda não considera embalagens nem a base de cartão.
- Custo direto: fórmula × custo dos insumos.
- Custo indireto (salário, aluguel etc.) vem da contabilidade. O sistema entrega um relatório do período em que cada produto tem sua participação, e a soma dá 100%.
- A participação não é divisão igual. Cada produto terá um fator (1, 9 etc.) informado pela equipe do Peru, que ainda está preparando esses dados.
- Gastos administrativos: uma tela restrita a uma usuária específica, para lançar, editar e corrigir diariamente, com acompanhamento de como está em dia.

## Sugestões do assistente, ainda sem confirmação

- Tolerância de consumo em três faixas (±5% como exemplo).
- Confirmar "conforme a receita" e digitar só as diferenças, em vez de um checklist por ingrediente.
- Códigos de porção no formato `T00481-01`, ativados só no fracionamento e cancelados se a torta for vendida inteira.
- Rateio do custo da clara e da gema em 45%/55%.
- Tratar perda acidental como gasto, sem distorcer o custo unitário.
- Fórmula de participação: quantidade vendida × fator ÷ total ponderado.

## Dúvidas para o Joseka

1. **Validade:** o dia 28 é validade sanitária ou só prazo comercial da torta inteira? Se for sanitária, o fluxo de redecorar e fracionar depois não pode continuar. A conversa fez essa pergunta e não houve resposta.
2. **Porções por torta:** a conversa fala em 8, mas a planilha traz 12 (tortas de 26 e 24) ou 10 (de 20). Qual vale?
3. **Porção de torta de 3 sabores:** o cliente citou tortas de 3 sabores e especiais, mas as 23 fórmulas de porção da planilha são todas de tortas de um produto só (Chocolate, Moca, Selva Negra etc.). Faltam códigos ou essas tortas não são fracionadas?
4. **Validade na etiqueta da porção:** a etiqueta sai antes de se saber a data do corte. A validade fica só no sistema, lida pelo QR, ou a vendedora anota na embalagem?
5. **Gastos e custo indireto:** ele disse que o indireto fica fora do sistema, no Excel da contabilidade, mas a tela de gastos seria usada "no cálculo de custo". A tela só registra e acompanha, ou também alimenta o rateio?
6. **Base do rateio:** usa o que foi vendido ou o que foi produzido no período?

## Planilha de 02/11/2026

| | 12/10 | 02/11 |
| --- | ---: | ---: |
| Códigos | 1.749 | 1.831 |
| Fórmulas | 1.032 | 1.032 |
| Linhas de ingredientes | 6.150 | 5.988 |
| Bloqueios | 13 | 17 |
| Custos preenchidos | 0 | 0 |

**O que mudou:**

- 85 códigos novos, a maioria de gastos administrativos (`ADM-*`, `SER-*`, `CON_*`), e 3 removidos.
- 342 quantidades alteradas, sendo 312 de `IN3-2CHAPR` (Chantilly Preparado).
- `MPP-100068` (Jalea Glasé) saiu de 320 fórmulas, e `MPP-110091` (Masa Fondant Blanco) entrou em 164.
- As unidades de ovo já estão como o Joseka descreveu.

**Correções ainda necessárias:** ver [revisão da base](revisao-codigos-recetas-fanor-2026-10-12.md).

**Pontos para conferir:**

- `TP0-MOUSFR`, `TP0-MOUSMG`, `TP0-CSCKFR` e `TP0-CSCKMR` têm fator e lote mínimo 2, 3, 4 e 5, em sequência. Parece arraste de célula no Excel, e o esperado seria 1.
- `SER-100005`, `SER-100013` e `SER-100017` mudaram de significado entre as versões (`SER-100005` era aluguel e agora é telefone). Nenhuma fórmula usa esses códigos, mas confirmar antes de vincular histórico.
- Os itens `CS` e `SV` sem unidade não bloqueiam mais a validação, porque são gastos e não entram em fórmula.

## O que o sistema já tem e o que falta

| Necessidade | Hoje |
| --- | --- |
| Série da torta, eventos, validade e alertas | Pronto |
| Devolução ao taller e uma redecoração | Pronto |
| Estoque por loja e despacho com QR | Pronto |
| Consulta de códigos e fórmulas | Pronto, só leitura |
| Artigos e fórmulas em tabelas operacionais | Falta |
| Ordem de produção com mistura de formatos e cálculo de insumos | Falta |
| Checkout por etapa, refação e consumo real | Falta (a simulação só demonstra) |
| Transformação do ovo e rendimento de processo | Falta |
| Vínculo produto–caixa e baixa na venda | Falta |
| Fracionamento, etiquetas de porção e bloqueio na venda | Falta |
| Tela de gastos com perfil restrito | Falta |
| Custo direto e relatório de participação | Falta, depende de custos e fatores |
| Exportação para o Siscont | Falta, depende de exemplo e plano de contas |

## Ordem sugerida

1. **Base:** corrigir os 17 bloqueios e levar artigos e fórmulas para tabelas operacionais.
2. **Produção:** ordem a partir da demanda, cálculo de insumos, checkout por etapa, refação e baixa do consumo real.
3. **Loja:** vínculo com caixas e fracionamento com etiquetas. O fracionamento depende das dúvidas 1 a 4.
4. **Gastos:** tela restrita. Pode andar em paralelo à produção, porque os códigos já vieram na planilha.
5. **Custos e Siscont:** dependem dos custos, dos fatores do Peru, do exemplo de importação e do plano de contas.

## Limites desta leitura

A conversa compartilhada não dá acesso aos anexos: o documento original das decisões sobre ovos e custos (lido só pelo resumo) e as três imagens enviadas no meio da conversa.
