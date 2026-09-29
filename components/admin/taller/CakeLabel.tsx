import { cakeLabelSvg, type CakeLabel as Label } from "@/lib/gestion/cake-label";

export function CakeLabel({ label }: { label: Label }) {
  return <article className="etq-label etq-cake" dangerouslySetInnerHTML={{ __html: cakeLabelSvg(label) }} />;
}
