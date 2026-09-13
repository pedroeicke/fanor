#!/usr/bin/env node
/**
 * Baixador do respaldo diário da Tortas Fanor — roda no PC do Joseka.
 *
 * Todo dia o site gera às 03:30 (Lima) um arquivo com todas as tabelas e o
 * guarda por 30 dias num balde privado. Este script pede ao site o link do
 * último arquivo, baixa para uma pasta local e mantém os 60 mais recentes.
 * Assim existe uma cópia fora da nuvem, na mão do dono, mesmo que a conta do
 * provedor tenha algum problema.
 *
 * Sem dependências: só Node 18 ou mais novo (fetch nativo). O passo a passo
 * de instalação está em docs/respaldo-pc-joseka.md.
 *
 * Uso:
 *   node descargar-respaldo.mjs --url https://tortasfanor.com --token XXXX --pasta "D:\Respaldos Fanor"
 *
 * Cada opção também pode vir de variável de ambiente: FANOR_URL,
 * RESPALDO_TOKEN e PASTA. Preferir a variável para o token — argumento de
 * linha de comando fica visível na configuração da tarefa agendada.
 *
 * Saída: 0 = baixou (ou já estava baixado); 1 = falhou; 2 = configuração
 * incompleta. O Programador de tareas mostra esse código em "Último resultado".
 */

import { createReadStream, createWriteStream } from "node:fs";
import { appendFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Readable, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";

/** Quantos arquivos ficam na pasta. Dois meses de histórico local. */
const KEEP = 60;
/* Nome que o site gera. Conferir o formato também impede que uma resposta
   estranha grave fora da pasta ("..\\..\\algo"). */
const FILE_RE = /^fanor-respaldo-\d{8}-\d{6}\.json\.gz$/;
const LOG_NAME = "descargas.log";
const LOG_MAX_BYTES = 1024 * 1024;
const API_TIMEOUT_MS = 60_000;
const DOWNLOAD_TIMEOUT_MS = 15 * 60_000;

let logFile = null;

function stamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** Escreve na tela e no descargas.log da pasta — a tarefa agendada não tem tela. */
async function log(message, level = "info") {
  const line = `[${stamp()}] ${level === "error" ? "ERROR: " : ""}${message}`;
  if (level === "error") console.error(line);
  else console.log(line);
  if (!logFile) return;
  try {
    await appendFile(logFile, `${line}\r\n`, "utf8");
  } catch {
    /* Log é conveniência: não poder escrevê-lo não pode derrubar o respaldo. */
  }
}

/** Mantém o log abaixo de 1 MB, guardando a metade mais recente. */
async function trimLog() {
  if (!logFile) return;
  try {
    const info = await stat(logFile);
    if (info.size <= LOG_MAX_BYTES) return;
    const text = await readFile(logFile, "utf8");
    const tail = text.slice(-Math.floor(LOG_MAX_BYTES / 2));
    await writeFile(logFile, tail.slice(tail.indexOf("\n") + 1), "utf8");
  } catch {
    /* Idem: sem log aparado, segue. */
  }
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h" || arg === "/?") {
      out.help = true;
      continue;
    }
    const match = /^--(url|token|pasta)(?:=(.*))?$/.exec(arg);
    if (!match) {
      out.unknown = arg;
      continue;
    }
    out[match[1]] = match[2] !== undefined ? match[2] : argv[++i];
  }
  return out;
}

const HELP = `Descarga el último respaldo de Tortas Fanor.

Uso:
  node descargar-respaldo.mjs --url <sitio> --token <token> --pasta <carpeta>

Opciones (o variables de entorno):
  --url     FANOR_URL        Dirección del sitio, por ejemplo https://tortasfanor.com
  --token   RESPALDO_TOKEN   Token de descarga de respaldos
  --pasta   PASTA            Carpeta donde se guardan los archivos

Guarda los ${KEEP} respaldos más recientes y un registro en ${LOG_NAME}.`;

function humanBytes(bytes) {
  if (!Number.isFinite(bytes)) return "?";
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function exists(path) {
  try {
    return await stat(path);
  } catch {
    return null;
  }
}

/** Mensagem legível para falha de rede, em vez do "fetch failed" cru. */
function networkMessage(error, what) {
  if (error?.name === "TimeoutError" || error?.name === "AbortError") return `${what}: se agotó el tiempo de espera.`;
  const cause = error?.cause?.code ?? error?.cause?.message ?? error?.message ?? String(error);
  return `${what}: no se pudo conectar (${cause}). ¿Hay internet?`;
}

/** Descomprime até o fim sem guardar nada: prova que o arquivo não chegou truncado. */
async function verifyGzip(path) {
  const sink = new Writable({ write: (_chunk, _encoding, callback) => callback() });
  await pipeline(createReadStream(path), createGunzip(), sink);
}

/** Apaga os respaldos além dos KEEP mais novos e restos de download interrompido. */
async function applyRetention(folder, keepPart) {
  const entries = await readdir(folder);
  for (const name of entries.filter((n) => n.endsWith(".part") && n !== keepPart)) {
    await rm(join(folder, name), { force: true });
  }
  /* O nome carrega data e hora (AAAAMMDD-HHMMSS): ordem alfabética é ordem cronológica. */
  const backups = entries.filter((n) => FILE_RE.test(n)).sort().reverse();
  const old = backups.slice(KEEP);
  for (const name of old) {
    await rm(join(folder, name), { force: true });
  }
  if (old.length) await log(`Se borraron ${old.length} respaldo(s) antiguo(s); se conservan los ${KEEP} más recientes.`);
  return Math.min(backups.length, KEEP);
}

async function main() {
  const major = Number(process.versions.node.split(".")[0]);
  if (major < 18) {
    console.error(`ERROR: se necesita Node.js 18 o más nuevo (instalado: ${process.versions.node}).`);
    return 2;
  }

  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(HELP);
    return 0;
  }
  if (args.unknown) {
    console.error(`ERROR: opción desconocida "${args.unknown}".\n\n${HELP}`);
    return 2;
  }

  const baseUrl = (args.url ?? process.env.FANOR_URL ?? "").trim().replace(/\/+$/, "");
  const token = (args.token ?? process.env.RESPALDO_TOKEN ?? "").trim();
  const folderArg = (args.pasta ?? process.env.PASTA ?? "").trim();

  if (!folderArg) {
    console.error(`ERROR: falta la carpeta (--pasta o PASTA).\n\n${HELP}`);
    return 2;
  }

  /* A pasta vem primeiro: com ela o log existe, e a tarefa agendada — que
     não tem tela — deixa registrado até o erro de configuração. */
  const folder = resolve(folderArg);
  try {
    await mkdir(folder, { recursive: true });
  } catch (error) {
    console.error(`ERROR: no se pudo crear la carpeta ${folder}: ${error.message}`);
    return 1;
  }
  logFile = join(folder, LOG_NAME);
  await trimLog();

  const missing = [
    !baseUrl && "la dirección del sitio (--url o FANOR_URL)",
    !token && "el token (--token o RESPALDO_TOKEN)",
  ].filter(Boolean);
  if (missing.length) {
    await log(`Falta ${missing.join(" y ")}. Si acabas de crear la variable con setx, cierra sesión en Windows y vuelve a entrar.`, "error");
    return 2;
  }
  if (!/^https?:\/\//i.test(baseUrl)) {
    await log(`La dirección del sitio debe empezar con https:// (recibido: ${baseUrl}).`, "error");
    return 2;
  }

  await log(`Consultando el último respaldo en ${baseUrl}…`);

  let response;
  try {
    response = await fetch(`${baseUrl}/api/respaldo/ultimo`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
  } catch (error) {
    await log(networkMessage(error, "Consulta al sitio"), "error");
    return 1;
  }

  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (!response.ok) {
    const detail = body?.error ? ` (${body.error})` : "";
    const reason =
      response.status === 401 ? "el token no es válido. Revisa RESPALDO_TOKEN."
      : response.status === 404 ? "todavía no hay ningún respaldo terminado en la nube."
      : response.status === 503 ? "la descarga de respaldos no está configurada en el sitio."
      : `el sitio respondió con el código ${response.status}.`;
    await log(`No se pudo obtener el respaldo: ${reason}${detail}`, "error");
    return 1;
  }

  if (!body || typeof body.url !== "string" || typeof body.path !== "string") {
    await log("El sitio devolvió una respuesta inesperada.", "error");
    return 1;
  }

  const fileName = body.path.split("/").pop();
  if (!FILE_RE.test(fileName ?? "")) {
    await log(`Nombre de archivo inesperado: ${fileName}.`, "error");
    return 1;
  }
  const expectedBytes = Number.isFinite(body.bytes) ? Number(body.bytes) : null;
  const destination = join(folder, fileName);

  const already = await exists(destination);
  if (already && (expectedBytes === null || already.size === expectedBytes)) {
    await log(`Ya estaba descargado: ${fileName} (${humanBytes(already.size)}). Nada que hacer.`);
    const count = await applyRetention(folder, null);
    await log(`En la carpeta hay ${count} respaldo(s).`);
    return 0;
  }

  const partName = `${fileName}.part`;
  const partPath = join(folder, partName);
  await log(`Descargando ${fileName}${expectedBytes !== null ? ` (${humanBytes(expectedBytes)})` : ""}…`);

  try {
    const file = await fetch(body.url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
    if (!file.ok || !file.body) {
      await log(`La descarga falló: el almacenamiento respondió con el código ${file.status}.`, "error");
      return 1;
    }
    await pipeline(Readable.fromWeb(file.body), createWriteStream(partPath));
  } catch (error) {
    await rm(partPath, { force: true });
    await log(networkMessage(error, "Descarga del archivo"), "error");
    return 1;
  }

  const downloaded = await stat(partPath);
  if (expectedBytes !== null && downloaded.size !== expectedBytes) {
    await rm(partPath, { force: true });
    await log(`El archivo llegó incompleto (${downloaded.size} de ${expectedBytes} bytes). Se intentará de nuevo en la próxima ejecución.`, "error");
    return 1;
  }

  try {
    await verifyGzip(partPath);
  } catch (error) {
    await rm(partPath, { force: true });
    await log(`El archivo descargado está dañado (${error.message}). Se intentará de nuevo en la próxima ejecución.`, "error");
    return 1;
  }

  /* Só vira .json.gz depois de conferido: arquivo com o nome final é sempre
     um respaldo inteiro. */
  await rename(partPath, destination);
  await log(`Listo: ${destination} (${humanBytes(downloaded.size)}).`);

  const count = await applyRetention(folder, null);
  await log(`En la carpeta hay ${count} respaldo(s).`);
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch(async (error) => {
    await log(`Error inesperado: ${error?.stack ?? error}`, "error");
    process.exitCode = 1;
  });
