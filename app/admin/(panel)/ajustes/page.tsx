import type { Metadata } from "next";
import { DEFAULT_SLA, getOperator } from "@/lib/gestion/server";
import { limaToday, minutesBetween } from "@/lib/gestion/dates";
import { Notice, PageHeader } from "@/components/admin/ui";
import { LeadTemplateForm } from "@/components/admin/ajustes/LeadTemplateForm";
import { RedecoratedForm } from "@/components/admin/ajustes/RedecoratedForm";
import { SlaForm } from "@/components/admin/ajustes/SlaForm";
import { StockSourceForm } from "@/components/admin/ajustes/StockSourceForm";
import {
  DEFAULT_LEAD_TEMPLATE,
  REDECORATED_DEFAULT,
  SLA_FIELDS,
  isStockSource,
  type SlaValues,
  type StockSource,
} from "@/components/admin/ajustes/config";

export const metadata: Metadata = { title: "Ajustes" };
export const dynamic = "force-dynamic";

/**
 * Ajustes do sistema. Todo mundo do painel vê — a vendedora entende por que
 * o alerta disparou —, só o dono muda.
 *
 * Valor estranho no banco (chave apagada, tipo errado) cai no padrão da
 * migração em vez de quebrar a tela: é a tela onde se conserta isso.
 */
export default async function AjustesPage() {
  const op = await getOperator();
  if (!op) return <Notice tone="bad">Sesión expirada. Vuelve a entrar.</Notice>;

  const canEdit = op.user.role === "owner";
  const today = limaToday();

  /* Tortas `in_stock` por fonte, e quantas delas a vitrine mostra de fato.
     A vitrine (lib/stock.ts) esconde as vencidas nas duas fontes — no
     espelho são mais da metade, que o Sisgeco nunca baixou. Contar só o
     `in_stock` prometeria o dobro do que o cliente vê. */
  const cakes = (source: StockSource, onlyShowable: boolean) => {
    const query = op.db.from("cake_units").select("id", { count: "exact", head: true }).eq("status", "in_stock").eq("source", source);
    return onlyShowable ? query.gte("expires_on", today) : query;
  };

  const [settings, sisgecoStock, sisgecoShowable, nativeStock, nativeShowable, lastSync] = await Promise.all([
    op.db.from("system_settings").select("key, value"),
    cakes("sisgeco", false),
    cakes("sisgeco", true),
    cakes("native", false),
    cakes("native", true),
    op.db.from("sync_runs").select("finished_at").not("finished_at", "is", null).order("finished_at", { ascending: false }).limit(1).maybeSingle(),
  ]);

  if (settings.error) {
    return <Notice tone="bad">No se pudieron cargar los ajustes. Recarga la página en unos segundos.</Notice>;
  }

  const byKey = new Map((settings.data ?? []).map((row) => [row.key as string, row.value as unknown]));

  const source = byKey.get("stock_source");
  const slaRaw = byKey.get("sla");
  const sla = Object.fromEntries(
    SLA_FIELDS.map((f) => {
      const v = slaRaw && typeof slaRaw === "object" ? (slaRaw as Record<string, unknown>)[f.key] : undefined;
      return [f.key, typeof v === "number" && Number.isInteger(v) ? v : DEFAULT_SLA[f.key]];
    }),
  ) as SlaValues;
  const redecorated = byKey.get("redecorated_shelf_life_days");
  const template = byKey.get("lead_whatsapp_template");
  const finishedAt = (lastSync.data?.finished_at as string | undefined) ?? null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Ajustes"
        description="De dónde lee la vitrina pública, cuándo un atraso se vuelve alerta, cuánto dura la torta redecorada y el mensaje que reciben los leads."
      />

      {!canEdit && <Notice tone="warn">Solo el dueño puede cambiar estos ajustes. Puedes verlos como referencia.</Notice>}

      <StockSourceForm
        current={isStockSource(source) ? source : "sisgeco"}
        counts={{
          sisgeco: { stock: sisgecoStock.count ?? 0, showable: sisgecoShowable.count ?? 0 },
          native: { stock: nativeStock.count ?? 0, showable: nativeShowable.count ?? 0 },
        }}
        lastSyncMinutes={finishedAt ? minutesBetween(finishedAt) : null}
        staleAfterMin={sla.sync_stale_min}
        canEdit={canEdit}
      />
      <SlaForm values={sla} canEdit={canEdit} />
      <RedecoratedForm
        value={typeof redecorated === "number" && Number.isInteger(redecorated) ? redecorated : REDECORATED_DEFAULT}
        today={today}
        canEdit={canEdit}
      />
      <LeadTemplateForm value={typeof template === "string" ? template : DEFAULT_LEAD_TEMPLATE} canEdit={canEdit} />
    </div>
  );
}
