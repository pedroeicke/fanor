/** Gera a mesma prova do painel como HTML local, sem login ou dados de produção.
 * node --experimental-strip-types scripts/preview-cake-labels.mjs [arquivo.html]
 */
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { CAKE_LABEL_CSS, cakeLabelContent, cakeLabelSvg } from "../lib/gestion/cake-label.ts";

const cases = JSON.parse(await readFile(new URL("../data/cake-label-tests.json", import.meta.url), "utf8"));
const labels = cases.map((sample, i) => {
  const number = String(i + 1).padStart(2, "0");
  return cakeLabelSvg({
    ...cakeLabelContent({ name: sample.name, minFlavors: sample.flavors.length, maxFlavors: sample.flavors.length, flavorName: sample.flavors.join("-") }),
    store: "PERU", serial: `PRUEBA ${number}`, qrValue: `FANOR-TEST:${number}`,
  });
});
const html = `<!doctype html><html lang="es"><meta charset="utf-8"><title>Prueba TSC TE200 · 50 × 25 mm</title><style>
body { margin: 0; background: white; }
${CAKE_LABEL_CSS}
</style><body><main class="etq-50">${labels.map(svg => `<article class="etq-cake">${svg}</article>`).join("")}</main></body></html>`;
const path = resolve(process.argv[2] ?? ".data/etiquetas/prueba-50x25mm.html");
await mkdir(dirname(path), { recursive: true });
await writeFile(path, html);
console.log(`11 etiquetas de prueba: ${path}`);
