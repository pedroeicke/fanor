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
export const movementsAfter = `
  select top (@batch)
    c.numero, c.codalmacen, c.codtipomov, c.fecha, c.numguia, c.numdocref, c.codvendedor, c.observacion,
    d.linea, d.codarticulo, d.des, d.numserie, d.numlote, d.fechaven, d.cantidad, d.valor, d.total, d.numcomvta
  from ${T.guiaCab} c
  join ${T.guiaDet} d on d.numero = c.numero
  where c.numero > @cursor
  order by c.numero, d.linea
`;

/** Catálogo inteiro. São ~113 linhas; ler tudo é mais barato que detectar mudança. */
export const allArticles = `
  select a.codigo, a.des, a.codfamilia, a.codunidad, a.usaserie, a.usalote, a.precio1, a.codigosunat, a.stockM
  from ${T.articulo} a
`;

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
