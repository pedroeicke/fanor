# Etiquetas de tortas — 50 × 25 mm

Atualização de 29/09/2026, com o gabarito `Etiqueta-Tortas_50x25mm.pdf`
enviado por Pedro e os 11 exemplos indicados para teste.

## Formato aprovado como referência

- Impressora existente: **TSC TE200**, 203 dpi / 8 pontos por mm.
- Etiqueta: **50 mm de largura × 25 mm de altura**.
- Margem interna: **3 mm** em todos os lados; área útil de 44 × 19 mm.
- Esquerda: loja e série, nome em negrito em até duas linhas e combinação
  de sabores apenas nas tortas cadastradas como **exatamente 3 sabores**.
- Campos delimitados `Vendedora` e `BV / Factura` para preenchimento na loja.
- Direita: QR com a série da torta, módulos inteiros na resolução da TE200
  e zona branca de quatro módulos. Texto e código são vetoriais.
- A guia de despacho permanece em A4, separada das etiquetas do rolo.
- A marca `REDECORADA` continua no nome quando aplicável. Produção e
  vencimento continuam na ficha da torta e no formato A4.

Os nomes e acentos são preservados integralmente. Linhas longas ajustam a
largura no SVG; não usam reticências. A fonte de referência é Arial Narrow
a 6 pt, como no gabarito, com fontes de fallback para outros computadores.

## Regra dos sabores

O cadastro existente `products.min_flavors = 3` e `max_flavors = 3` indica
que o produto exige três sabores. A etiqueta utiliza o nome da combinação
associada à torta em `flavors.name`; se não estiver preenchido, exibe
`Sabores por confirmar`. Produtos de sabor fixo não recebem essa linha.

**Moca e Delicia Tropical** permanecem no nome do produto e não geram uma
linha adicional de sabores. Os nove outros exemplos têm a combinação.

Os produtos operacionais importados do Sisgeco ainda têm mínimo e máximo
iguais a zero, e a lista operacional `flavors` ainda está vazia. Antes de
imprimir um despacho real de três sabores, é necessário identificar seus
códigos e configurar esses cadastros. Os exemplos desta prova não alteram
o catálogo nem o estoque.

## No sistema

- `/admin/etiquetas/[id]`: tamanho padrão de 50 × 25 mm para um despacho.
- `/admin/etiquetas/[id]?formato=a4`: guia e grade A4.
- `/admin/etiquetas/prueba`: os 11 exemplos, protegidos pelo login do painel.
- A prova utiliza `PRUEBA 01` a `PRUEBA 11` e QRs `FANOR-TEST:NN`, que não
  são séries válidas de estoque.
- O desenho compartilhado está em `lib/gestion/cake-label.ts`; exemplos
  reproduzíveis em `data/cake-label-tests.json`.

## Impressão na TE200

Selecionar a TSC TE200 no Windows e configurar papel personalizado de
**50 × 25 mm**, em orientação normal. Imprimir a **100 % / tamanho real**,
sem ajuste à página, sem cabeçalho/rodapé e sem margens extras do navegador.
O avanço e a calibração devem seguir o tipo de rolo existente; a largura
do espaço entre etiquetas não foi informada e não foi presumida no desenho.

Prova local em HTML:

```powershell
node --experimental-strip-types scripts/preview-cake-labels.mjs
```

O PDF de teste deve ter 11 páginas de 50 × 25 mm, uma por etiqueta. A
conferência digital inclui tamanho, integridade dos textos e leitura dos
11 QRs após renderização em 203 dpi. A impressão física precisa ser
conferida na TE200 com o rolo novo.

Referência técnica: [TSC — série TE](https://usca.tscprinters.com/en/products/te-series-4-inch-performance-desktop-printers).
