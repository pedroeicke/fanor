/**
 * Todo T-SQL do leitor mora aqui — e só aqui.
 *
 * Os nomes de tabela são o que ainda não conheço do Sisgeco real (as colunas
 * eu conheço, vieram das telas). Quando o banco de verdade chegar, ajusta-se
 * este arquivo e nada mais. O resto do leitor não sabe que "Guia" existe: ele
 * recebe linhas com campos nomeados e transporta.
 *
 * Só SELECT. O usuário que o leitor usa é db_datareader; se algum dia alguém
 * escrever um UPDATE aqui, o servidor recusa — e é para recusar.
 */

/** Nomes das tabelas do Sisgeco. Ajustar quando o banco real chegar. */
export const T = {
  guiaCab: "dbo.GuiaCab",
  guiaDet: "dbo.GuiaDet",
  ventaCab: "dbo.VentaCab",
  ventaDet: "dbo.VentaDet",
  articulo: "dbo.Articulo",
  almacen: "dbo.Almacen",
  vendedor: "dbo.Vendedor",
};

/**
 * Movimentos de estoque depois do cursor, com suas linhas.
 *
 * `numero` é o Nº Interno: correlativo único entre entradas (I004) e saídas
 * por venda (S003). É ele o cursor — nunca a data, porque data repete e o
 * relógio do PC da loja não é confiável.
 *
 * TOP com ORDER BY: em lote, em ordem, e o lote seguinte começa onde este
 * parou. Um dia parado na loja são ~300 movimentos; 500 por rodada alcança
 * em duas.
 */
/**
 * Do cabeçalho eu pego só o que uso (tipo de movimento e almacén decidem
 * o destino); do detalhe pego `d.*`, todas as colunas que existirem. Assim o
 * leitor não quebra se uma coluna do Sisgeco real tiver outro nome — foi o
 * que aconteceu com `total`, que não existe na GuiaDet desta instalação.
 * `groupMovements` no index.mjs lê cada campo com `?.`, então coluna ausente
 * vira null, nunca erro.
 *
 * `numero` é o Nº Interno: correlativo único entre entradas (I004) e saídas
 * por venda (S003). É ele o cursor. Ordena por `c.numero` só — a ordem das
 * linhas dentro de um movimento não importa para o espelho.
 */
export const movementsAfter = `
  select top (@batch)
    c.numero as h_numero, c.codalmacen, c.codtipomov, c.fecha, c.numguia, c.numdocref, c.codvendedor, c.observacion,
    d.*
  from ${T.guiaCab} c
  join ${T.guiaDet} d on d.numero = c.numero
  where c.numero > @cursor
  order by c.numero
`;

/** Catálogo inteiro. `select *` pela mesma razão: nomes de coluna variam. */
export const allArticles = `select * from ${T.articulo}`;

export const allWarehouses = `select codigo, des from ${T.almacen}`;
export const allSellers = `select codigo, des from ${T.vendedor}`;

/** Prova de vida: edição, versão e se o usuário é mesmo só de leitura. */
export const health = `
  select
    serverproperty('Edition') as edition,
    serverproperty('ProductVersion') as version,
    is_member('db_datareader') as reader,
    is_member('db_datawriter') as writer
`;
