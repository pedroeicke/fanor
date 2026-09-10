/**
 * Cria o banco fictício do Sisgeco e o enche com dados REAIS da loja:
 *
 *   · as três guias de ingresso de 03/09/2026 (GI-265275/278/279), linha por
 *     linha, com série, lote e vencimento;
 *   · os 113 artigos que aparecem nos 17.454 comprovantes do Close2U;
 *   · uma amostra de vendas desses comprovantes, cada uma gerando a saída
 *     S003 correspondente — como o Sisgeco faz.
 *
 * Assim o leitor é testado contra o formato que a loja produz, não contra
 * dados inventados. Uso: npm run seed
 */
import sql from "mssql";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const SCRATCH = process.env.FANOR_SCRATCH ?? "C:/Users/pedro/AppData/Local/Temp/claude/C--projetos-fanor/ae4d6e0a-981e-4764-9a39-d39f43337dd2/scratchpad";
const JSON_DIR = process.env.FANOR_JSON_DIR ?? "C:/Users/pedro/Downloads/FanorSQL - copia/FanorSQL - copia/Json";

const config = {
  server: process.env.SISGECO_SQL_SERVER ?? "localhost",
  port: Number(process.env.SISGECO_SQL_PORT ?? 1433),
  user: process.env.SISGECO_SQL_USER ?? "sa",
  password: process.env.SISGECO_SQL_PASSWORD ?? fs.readFileSync(path.join(SCRATCH, "sql-sa.txt"), "utf8").trim(),
  database: "master",
  options: { encrypt: false, trustServerCertificate: true },
};

/* ---------- 1. esquema ---------- */
const pool = await sql.connect(config);
const script = fs.readFileSync(path.join(here, "fake-sisgeco.sql"), "utf8");
for (const batch of script.split(/^\s*go\s*$/im)) {
  if (batch.trim()) await pool.request().batch(batch);
}
await pool.request().batch("use Fanor");
console.log("esquema criado");

/* ---------- 2. artigos, dos comprovantes ---------- */
const files = fs.readdirSync(JSON_DIR).filter((f) => f.endsWith(".txt")).sort();
const articles = new Map();
const sales = [];
for (const f of files) {
  let d;
  try { d = JSON.parse(fs.readFileSync(path.join(JSON_DIR, f), "utf8")); } catch { continue; }
  for (const it of d.detalleDocumento ?? []) {
    const code = it.codigoProducto;
    if (!articles.has(code)) articles.set(code, { des: (it.descripcion ?? "").trim(), price: it.precioVentaUnitarioItem, unit: it.unidadMedida });
  }
  sales.push(d);
}
const family = (code) => (code.match(/^[A-Z]+/)?.[0] ?? "O");
for (const [code, a] of articles) {
  await pool.request()
    .input("codigo", sql.NVarChar(10), code).input("des", sql.NVarChar(80), a.des.slice(0, 80))
    .input("fam", sql.NVarChar(4), family(code)).input("serie", sql.Bit, family(code) === "T" ? 1 : 0)
    .input("precio", sql.Decimal(10, 2), a.price ?? 0)
    .query(`insert into dbo.Articulo (codigo, des, codfamilia, codunidad, usaserie, usalote, precio1)
            values (@codigo, @des, @fam, 'UND', @serie, @serie, @precio)`);
}
console.log(`artigos: ${articles.size}`);

/* ---------- 3. guias de ingresso reais (GI-*.txt extraídos dos PDFs) ---------- */
const guias = [
  { file: "GI-265275.txt", numero: 265275, alm: "2", numguia: "PERU 01729" },
  { file: "GI-265278.txt", numero: 265278, alm: "1", numguia: "PERU 01731" },
  { file: "GI-265279.txt", numero: 265279, alm: "1", numguia: "PERU 01732" },
];
const line = /^(\S+)\s+(.+?)\s+(UND|NIU)\s+1\.00([DG]\d{10})\s+(\d\d)\/(\d\d)\/(\d{4})\s+(\d\d)\/(\d\d)\/(\d{4})$/;
const serialsInStock = [];
for (const g of guias) {
  const txt = fs.readFileSync(path.join(SCRATCH, g.file), "utf8");
  const rows = txt.split("\n").map((l) => l.trim()).map((l) => l.match(line)).filter(Boolean);
  await pool.request().input("n", sql.Int, g.numero).input("alm", sql.NVarChar(2), g.alm).input("ng", sql.NVarChar(20), g.numguia)
    .input("items", sql.Int, rows.length)
    .query(`insert into dbo.GuiaCab (numero, codalmacen, numguia, fecha, fechadesp, codtipomov, codprovclie, codvendedor, moneda, TC, totalitem, totalunidad)
            values (@n, @alm, @ng, '2026-09-03', '2026-09-03', 'I004', '20454', '0000', 'S', 3.0, @items, @items)`);
  let i = 0;
  for (const m of rows) {
    const [, code, des, unit, serial, d1, m1, y1, d2, m2, y2] = m;
    await pool.request().input("n", sql.Int, g.numero).input("l", sql.Int, ++i)
      .input("code", sql.NVarChar(10), code).input("des", sql.NVarChar(80), des).input("unit", sql.NVarChar(3), unit)
      .input("serial", sql.NVarChar(15), serial).input("lote", sql.NVarChar(12), `${d1}/${m1}/${y1}`)
      .input("ven", sql.DateTime, new Date(`${y2}-${m2}-${d2}`))
      .query(`insert into dbo.GuiaDet (numero, linea, codarticulo, des, numlote, fechaven, numserie, codunidad, cantidad, valor, total)
              values (@n, @l, @code, @des, @lote, @ven, @serial, @unit, 1, 0, 0)`);
    serialsInStock.push({ serial, code, des, alm: g.alm, lote: `${d1}/${m1}/${y1}`, ven: new Date(`${y2}-${m2}-${d2}`) });
  }
  console.log(`guia ${g.numero}: ${rows.length} tortas no almacén ${g.alm}`);
}

/* ---------- 4. vendas: uma amostra dos comprovantes vira VentaCab/Det + saída S003 ---------- */
/* Vende as primeiras 12 tortas que entraram, para o leitor ver série entrando
   e depois saindo — o caso que importa para a vitrine. */
let mov = 265279;
let venta = 84000;
const sample = sales.filter((d) => d.datosDocumento?.serie === "B003").slice(-12);
for (let k = 0; k < sample.length && k < serialsInStock.length; k++) {
  const d = sample[k]; const cake = serialsInStock[k]; const n = String(++venta);
  const numdoc = `${d.datosDocumento.serie}-${String(d.datosDocumento.numero).padStart(8, "0")}`;
  await pool.request().input("n", sql.NVarChar(6), n).input("numdoc", sql.NVarChar(20), numdoc)
    .input("total", sql.Decimal(12, 2), d.detalleDocumento?.[0]?.precioVentaUnitarioItem ?? 0)
    .query(`insert into dbo.VentaCab (numero, codtipodoc, numdoc, fecha, codprovclie, codvendedor, moneda, TC, totalitem, totalunidad, total, pagado)
            values (@n, 'BO', @numdoc, '2026-09-03', '00620', '0001', 'S', 3.0, 1, 1, @total, 1)`);
  await pool.request().input("n", sql.NVarChar(6), n).input("code", sql.NVarChar(10), cake.code).input("des", sql.NVarChar(80), cake.des)
    .input("serial", sql.NVarChar(15), cake.serial).input("lote", sql.NVarChar(12), cake.lote).input("ven", sql.DateTime, cake.ven)
    .input("total", sql.Decimal(12, 2), d.detalleDocumento?.[0]?.precioVentaUnitarioItem ?? 0).input("mov", sql.Int, mov + 1)
    .query(`insert into dbo.VentaDet (numero, linea, codarticulo, des, numlote, fechaven, numserie, codunidad, cantidad, valor, total, numguia)
            values (@n, 1, @code, @des, @lote, @ven, @serial, 'UND', 1, @total, @total, @mov)`);
  /* A saída de estoque que a venda gera (kardex: T.Mov S003, Nº Doc Ref BO/B003-…). */
  mov += 1;
  await pool.request().input("n", sql.Int, mov).input("alm", sql.NVarChar(2), cake.alm).input("ref", sql.NVarChar(30), `BO/${numdoc}`)
    .query(`insert into dbo.GuiaCab (numero, codalmacen, numguia, fecha, fechadesp, codtipomov, codprovclie, codvendedor, moneda, TC, numdocref, totalitem, totalunidad)
            values (@n, @alm, concat('0200-', right(concat('00000000', @n), 8)), '2026-09-03', '2026-09-03', 'S003', '00620', '0001', 'S', 3.0, @ref, 1, 1)`);
  await pool.request().input("n", sql.Int, mov).input("code", sql.NVarChar(10), cake.code).input("des", sql.NVarChar(80), cake.des)
    .input("serial", sql.NVarChar(15), cake.serial).input("lote", sql.NVarChar(12), cake.lote).input("ven", sql.DateTime, cake.ven)
    .input("vn", sql.NVarChar(20), numdoc)
    .query(`insert into dbo.GuiaDet (numero, linea, codarticulo, des, numlote, fechaven, numserie, codunidad, cantidad, valor, total, comvta, numcomvta)
            values (@n, 1, @code, @des, @lote, @ven, @serial, 'UND', 1, 0, 0, 'BO', @vn)`);
}
console.log(`vendas: ${Math.min(sample.length, serialsInStock.length)} (saídas S003 até o Nº Interno ${mov})`);

/* ---------- 5. usuário só-leitura, igual ao que a loja vai criar ---------- */
await pool.request().batch(`
  if not exists (select 1 from sys.sql_logins where name = 'agente_lectura')
    create login agente_lectura with password = 'Lectura#Fanor2026', check_policy = off;
  if not exists (select 1 from sys.database_principals where name = 'agente_lectura')
    create user agente_lectura for login agente_lectura;
  alter role db_datareader add member agente_lectura;
`);
console.log("usuário agente_lectura (db_datareader) criado");

await pool.close();
