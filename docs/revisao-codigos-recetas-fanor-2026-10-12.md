# Revisão da base de códigos e receitas Fanor

**Recebido em:** 12/10/2026
**Fonte:** `Códigos _ Recetas_Fanor2026.xlsx`, abas `Códigos` e `RECETAS`.

Esta planilha amplia a versão `Codigos_Fanor2026.xlsx` analisada em setembro. O painel `/admin/recetas` mostra a prévia de leitura publicada no Supabase (`system_settings.production_recipes_preview`). A prévia permite consultar os dados e as pendências; ainda não lança estoque, produção ou custos.

## Volume e regras já aproveitáveis

- 1.749 códigos únicos com tipo, descrição, unidade de estoque, fator de conversão e unidade de receita.
- 1.032 fórmulas e 6.150 linhas de ingredientes, com código de saída e rendimento previsto.
- 24 linhas informam quantidade em unidade de estoque diferente da unidade de receita. O fator explícito do próprio código converte essas quantidades para a unidade da fórmula. A prévia conserva o valor e a unidade originais para auditoria.
- Nenhum custo foi preenchido na aba `Códigos`; não é possível calcular custo de produção com este arquivo isoladamente.

## Correções necessárias na planilha

| Aba e linha | Problema |
| --- | --- |
| `RECETAS` 174 | Falta o rendimento de `IN3-4MDLCH`. |
| `RECETAS` 377 | Falta o rendimento de `IN3-5RETAZ` e a fórmula não tem ingredientes. |
| `RECETAS` 2875, 2878 | As saídas `E20-3LE-VA` e `E20-3LE-MC` não constam em `Códigos`. |
| `RECETAS` 3281, 3287 | As saídas `T20-3LE-VA` e `T20-3LE-MC` não constam em `Códigos`; seus ingredientes `E20-3LE-VA` e `E20-3LE-MC` também não constam. |
| `RECETAS` 4991, 4997, 5877, 5883 | Repetem como ingredientes os códigos `E20-3LE-VA` e `E20-3LE-MC` ausentes do catálogo. |

São 13 ocorrências bloqueantes no total. Corrigir os quatro códigos ausentes no cadastro resolve também as referências repetidas, desde que os códigos e unidades sejam confirmados pelo Joseka.

## Regras a confirmar

- Em `Códigos` 1747–1750, `TP0-MOUSFR`, `TP0-MOUSMG`, `TP0-CSCKFR` e `TP0-CSCKMR` têm `un.` dos dois lados, mas fatores 2, 3, 4 e 5. Confirmar o significado desses fatores antes de aplicá-los.
- Em `RECETAS` 60–61, clara e gema aparecem como saídas separadas do mesmo ovo. A execução deverá representar uma transformação com duas saídas para não baixar o ovo duas vezes.
- Preços/custos e critério de rateio precisam de origem e regra própria. A integração com o Siscont continua dependente de um arquivo de importação de exemplo e do plano de contas.

## Reproduzir a prévia

```powershell
python scripts/preview-recetas-fanor2026.py 'C:\Users\pedro\Downloads\Códigos _ Recetas_Fanor2026.xlsx' --output '.data\recipes-2026\preview.json'
node --env-file=.env.local scripts/publish-recipes-preview.mjs .data/recipes-2026/preview.json
```

O segundo comando, sem `--apply`, apenas valida. Com `--apply`, publica a prévia de leitura e salva uma cópia da anterior na mesma pasta do JSON. A planilha original e os JSONs derivados ficam fora do Git.
