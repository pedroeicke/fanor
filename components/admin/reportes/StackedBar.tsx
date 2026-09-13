import { cx } from "@/lib/format";

/**
 * Barra de 100% dividida em partes, com 2 px de fundo entre elas — o espaço
 * separa as partes, não uma borda desenhada.
 *
 * Nunca carrega informação sozinha: quem usa põe a legenda e os números ao
 * lado. A barra é o desenho do que os números já dizem.
 */

export type Segment = { key: string; label: string; value: number; className?: string; color?: string };

export function StackedBar({ segments, label, className }: { segments: Segment[]; label: string; className?: string }) {
  const visible = segments.filter((s) => s.value > 0);
  if (!visible.length) return <div className={cx("h-3 w-full rounded-[4px] bg-crema-100", className)} role="img" aria-label={`${label}: sin datos`} />;

  return (
    <div
      role="img"
      aria-label={`${label}: ${visible.map((s) => `${s.label} ${s.value}`).join(", ")}`}
      className={cx("flex h-3 w-full gap-[2px]", className)}
    >
      {visible.map((s) => (
        <span
          key={s.key}
          title={`${s.label}: ${s.value.toLocaleString("es-PE")}`}
          className={cx("block h-full min-w-[3px] first:rounded-l-[4px] last:rounded-r-[4px]", s.className)}
          style={{ flexGrow: s.value, flexBasis: 0, backgroundColor: s.color }}
        />
      ))}
    </div>
  );
}

export function Legend({ items }: { items: { key: string; label: string; className?: string; color?: string }[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-[12px] text-cacao-500">
      {items.map((item) => (
        <li key={item.key} className="flex items-center gap-1.5">
          <span aria-hidden className={cx("inline-block size-2.5 rounded-[2px]", item.className)} style={{ backgroundColor: item.color }} />
          {item.label}
        </li>
      ))}
    </ul>
  );
}
