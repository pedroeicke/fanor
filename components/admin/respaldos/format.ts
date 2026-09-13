/** "845 KB", "12.4 MB". Tamanho de arquivo como a pessoa lê no Explorador. */
export function formatBytes(bytes: number | null | undefined) {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toLocaleString("es-PE", { maximumFractionDigits: value < 10 ? 1 : 0 })} ${units[unit]}`;
}

/** "1,284" com separador de milhar. */
export function formatCount(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return Number(value).toLocaleString("es-PE");
}
