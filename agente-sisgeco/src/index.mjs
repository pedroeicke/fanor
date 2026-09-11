/**
 * Leitor do Sisgeco.
 *
 * Roda no PC da loja como serviço do Windows. A cada poucos segundos pergunta
 * ao SQL Server do Sisgeco "o que mudou desde o último Nº Interno que eu li?",
 * e manda a resposta, assinada, para o site. Nunca escreve no Sisgeco: o
 * usuário é db_datareader, e as consultas em queries.mjs são só SELECT.
 *
 * O que ele é feito para aguentar:
 *   · internet fora — guarda o cursor, espera com recuo crescente, alcança
 *     depois. O Sisgeco nem sabe que ele existe;
 *   · reinício do PC — o cursor vive no site (sync_state) e numa cópia local;
 *     ao subir, pergunta ao site onde parou;
 *   · reenvio — o site é idempotente por Nº Interno; mandar duas vezes o mesmo
 *     lote não cria nada em dobro.
 *
 * Configuração por variáveis de ambiente (ver .env.example ao lado).
 */
import sql from "mssql";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHmac } from "node:crypto";
import { allArticles, health, movementsAfter } from "./queries.mjs";

const VERSION = "0.1.0";

/**
 * Pasta do programa. Empacotado como executável único (SEA), é a pasta do
 * `.exe`; rodando com Node normal, o diretório atual. Config e estado moram
 * aqui, para o leitor não depender de qual pasta ele foi iniciado — como
 * serviço do Windows isso não é previsível.
 */
const APP_DIR = (() => {
  try {
    const sea = require("node:sea");
    if (sea.isSea()) return path.dirname(process.execPath);
  } catch {
    /* Node normal. */
  }
  return process.cwd();
})();

/**
 * Carrega a configuração de um arquivo `fanor-lector.env` ao lado do programa.
 *
 * Empacotado como executável único, não há `.env` nem terminal para exportar
 * variáveis: quem instala na loja só edita um bloco de notas. Cada linha é
 * `CHAVE=valor`; o que já veio pelo ambiente tem prioridade, para dar para
 * sobrepor em teste.
 */
function loadConfigFile() {
  for (const name of ["fanor-lector.env", ".env"]) {
    const file = path.join(APP_DIR, name);
    if (!fs.existsSync(file)) continue;
    for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq < 1) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if (value.length >= 2 && ((value[0] === '"' && value.endsWith('"')) || (value[0] === "'" && value.endsWith("'")))) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = value;
    }
    console.log(new Date().toISOString(), `configuração carregada de ${file}`);
    return;
  }
}

const env = (name, fallback) => process.env[name] ?? fallback ?? missing(name);
const missing = (name) => { throw new Error(`Falta a variável ${name}`); };

/* Carrega o arquivo de config ANTES de montar `cfg` — senão as variáveis
   ainda não existem quando cada `env(...)` é lido. */
loadConfigFile();

const cfg = {
  sql: {
    server: env("SISGECO_SQL_SERVER", "SRV00Y"),
    port: Number(env("SISGECO_SQL_PORT", "1433")),
    database: env("SISGECO_SQL_DATABASE", "Fanor"),
    user: env("SISGECO_SQL_USER", "fanor_lectura"),
    password: env("SISGECO_SQL_PASSWORD"),
    options: { encrypt: false, trustServerCertificate: true },
    pool: { max: 2 },
  },
  syncUrl: env("SYNC_URL", "https://fanor.vercel.app/api/sync/sisgeco"),
  secret: env("SYNC_SHARED_SECRET"),
  pollMs: Number(env("POLL_MS", "5000")),
  batch: Number(env("BATCH", "200")),
  /* Catálogo vai inteiro de tempos em tempos: são ~113 linhas. */
  catalogEveryMs: Number(env("CATALOG_EVERY_MS", String(10 * 60_000))),
  stateFile: env("STATE_FILE", path.join(APP_DIR, "state.json")),
};

const agent = `${os.hostname()}/agente-sisgeco@${VERSION}`;
const log = (...a) => console.log(new Date().toISOString(), ...a);

/* ------------------------------------------------------------------------ */
/*  Assinatura                                                              */
/* ------------------------------------------------------------------------ */
function sign(body, ts) {
  return createHmac("sha256", cfg.secret).update(`${ts}.${body}`).digest("hex");
}

async function post(payload) {
  const body = JSON.stringify(payload);
  const ts = String(Date.now());
  const res = await fetch(cfg.syncUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-fanor-timestamp": ts,
      "x-fanor-signature": `sha256=${sign(body, ts)}`,
      "x-fanor-agent": agent,
    },
    body,
    /* Um lote de 200 movimentos são ~8 chamadas ao banco do lado de lá; dois
       minutos é folga para hospedagem lenta, não para lentidão nossa. */
    signal: AbortSignal.timeout(120_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`site respondeu ${res.status}: ${data.error ?? ""}`);
  return data;
}

async function remoteCursor() {
  const ts = String(Date.now());
  const res = await fetch(`${cfg.syncUrl}?source=sisgeco`, {
    headers: { "x-fanor-timestamp": ts, "x-fanor-signature": `sha256=${sign("", ts)}`, "x-fanor-agent": agent },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`site respondeu ${res.status} ao pedir o cursor`);
  return (await res.json()).cursor ?? 0;
}

/* ------------------------------------------------------------------------ */
/*  Cursor: site manda, arquivo local é cópia                               */
/* ------------------------------------------------------------------------ */
function readLocalCursor() {
  try { return JSON.parse(fs.readFileSync(cfg.stateFile, "utf8")).cursor ?? 0; } catch { return 0; }
}
function writeLocalCursor(cursor) {
  fs.writeFileSync(cfg.stateFile, JSON.stringify({ cursor, at: new Date().toISOString() }));
}

/* ------------------------------------------------------------------------ */
/*  Leitura                                                                 */
/* ------------------------------------------------------------------------ */
function groupMovements(rows) {
  const byNumber = new Map();
  for (const r of rows) {
    if (!byNumber.has(r.numero)) {
      byNumber.set(r.numero, {
        numero: r.numero, almacen: r.codalmacen?.trim(), tipo: r.codtipomov?.trim(), fecha: r.fecha,
        numguia: r.numguia?.trim(), numdocref: r.numdocref?.trim(), vendedor: r.codvendedor?.trim(),
        observacion: r.observacion?.trim(), lines: [],
      });
    }
    byNumber.get(r.numero).lines.push({
      linea: r.linea, codigo: r.codarticulo?.trim(), des: r.des?.trim(), serie: r.numserie?.trim() || null,
      lote: r.numlote?.trim() || null, vence: r.fechaven, cantidad: Number(r.cantidad ?? 0),
      valor: Number(r.valor ?? 0), total: Number(r.total ?? 0), comprobante: r.numcomvta?.trim() || null,
    });
  }
  return [...byNumber.values()];
}

async function readMovements(pool, cursor) {
  const { recordset } = await pool.request().input("cursor", sql.Int, cursor).input("batch", sql.Int, cfg.batch).query(movementsAfter);
  return groupMovements(recordset);
}

async function readCatalog(pool) {
  const { recordset } = await pool.request().query(allArticles);
  return recordset.map((a) => ({
    codigo: a.codigo?.trim(), des: a.des?.trim(), familia: a.codfamilia?.trim(), unidad: a.codunidad?.trim(),
    usaSerie: Boolean(a.usaserie), usaLote: Boolean(a.usalote), precio: Number(a.precio1 ?? 0),
    codigoSunat: a.codigosunat?.trim() || null, stockMin: a.stockM == null ? null : Number(a.stockM),
  }));
}

/* ------------------------------------------------------------------------ */
/*  Laço                                                                    */
/* ------------------------------------------------------------------------ */
async function main() {
  log(`subindo ${agent}`);
  const pool = await sql.connect(cfg.sql);
  const { recordset: [h] } = await pool.request().query(health);
  log(`SQL Server ${h.edition} ${h.version} · leitura=${h.reader} escrita=${h.writer}`);
  if (h.writer) log("AVISO: o usuário tem permissão de escrita. Deveria ser só db_datareader.");

  let cursor;
  try { cursor = await remoteCursor(); log(`cursor no site: ${cursor}`); }
  catch (e) { cursor = readLocalCursor(); log(`site indisponível (${e.message}); cursor local: ${cursor}`); }

  let lastCatalog = 0;
  let backoff = cfg.pollMs;

  for (;;) {
    try {
      const movements = await readMovements(pool, cursor);
      const sendCatalog = Date.now() - lastCatalog > cfg.catalogEveryMs;
      const articles = sendCatalog ? await readCatalog(pool) : undefined;

      if (movements.length || sendCatalog) {
        const from = cursor;
        const to = movements.length ? movements[movements.length - 1].numero : cursor;
        const reply = await post({ source: "sisgeco", agent, cursorFrom: from, cursorTo: to, movements, articles });
        cursor = reply.cursor ?? to;
        writeLocalCursor(cursor);
        if (sendCatalog) lastCatalog = Date.now();
        if (movements.length) log(`${movements.length} movimentos (${from} → ${cursor})${sendCatalog ? ` + catálogo ${articles.length}` : ""}`);
      }
      backoff = cfg.pollMs;
      /* Lote cheio: há mais esperando; não dorme. */
      await sleep(movements.length >= cfg.batch ? 0 : cfg.pollMs);
    } catch (e) {
      log(`erro: ${e.message} — tentando de novo em ${Math.round(backoff / 1000)}s`);
      await sleep(backoff);
      backoff = Math.min(backoff * 2, 60_000);
    }
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

process.on("SIGTERM", () => { log("encerrando"); process.exit(0); });
main().catch((e) => { log(`fatal: ${e.stack ?? e}`); process.exit(1); });
