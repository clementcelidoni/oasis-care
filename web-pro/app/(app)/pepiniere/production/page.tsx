import { createClient } from "@/lib/supabase/server";
import { PageHeader, EmptyState } from "@/components/ui";
import { ensureStages } from "@/lib/nursery/actions";
import { formatCount } from "@/lib/nursery/types";

/**
 * §11J — le pipeline de production.
 *
 * Combien de plantes a chaque etape, dans l ordre du cycle. C est la
 * vue qui dit ce qui sortira vendable, et quand il faudra rempoter.
 */
export default async function ProductionPage() {
  await ensureStages();
  const supabase = await createClient();

  const [{ data: stages }, { data: lots }] = await Promise.all([
    supabase.from("nursery_stages").select("id, code, label, position, is_saleable").order("position"),
    supabase
      .from("nursery_lots")
      .select("stage_id, current_quantity, species_name")
      .is("archived_at", null),
  ]);

  const allStages = (stages ?? []) as {
    id: string; code: string; label: string; position: number; is_saleable: boolean;
  }[];
  const allLots = (lots ?? []) as {
    stage_id: string | null; current_quantity: number; species_name: string;
  }[];

  const totalPerStage = new Map<string, { quantity: number; lots: number }>();
  for (const lot of allLots) {
    const key = lot.stage_id ?? "none";
    const current = totalPerStage.get(key) ?? { quantity: 0, lots: 0 };
    current.quantity += lot.current_quantity;
    current.lots += 1;
    totalPerStage.set(key, current);
  }

  const unassigned = totalPerStage.get("none");
  const maximum = Math.max(1, ...allStages.map((s) => totalPerStage.get(s.id)?.quantity ?? 0));

  return (
    <div className="mx-auto max-w-3xl px-8 py-10">
      <PageHeader title="Production" subtitle="Repartition des lots par etape du cycle" />

      {allLots.length === 0 ? (
        <EmptyState
          title="Aucun lot en production"
          description="Les lots apparaitront ici des que vous leur aurez donne une etape."
        />
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
          {allStages.map((stage) => {
            const totals = totalPerStage.get(stage.id) ?? { quantity: 0, lots: 0 };
            const width = Math.round((totals.quantity / maximum) * 100);
            return (
              <li key={stage.id} className="flex items-center gap-3 px-4 py-2.5">
                <span className="w-28 shrink-0 text-sm font-medium">
                  {stage.label}
                  {stage.is_saleable && (
                    <span className="ml-1 text-[10px] uppercase text-positive">vendable</span>
                  )}
                </span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-canvas">
                  <div
                    className={`h-full rounded-full ${stage.is_saleable ? "bg-positive" : "bg-accent"}`}
                    style={{ width: `${width}%` }}
                  />
                </div>
                <span className="w-28 shrink-0 text-right text-sm">
                  <span className="tabular font-medium">{formatCount(totals.quantity)}</span>
                  <span className="ml-1 text-[11px] text-ink-faint">
                    {totals.lots > 0 ? `${totals.lots} lot${totals.lots > 1 ? "s" : ""}` : ""}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {unassigned && unassigned.lots > 0 && (
        <p className="mt-3 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
          <strong>{unassigned.lots} lot{unassigned.lots > 1 ? "s" : ""}</strong> sans etape
          ({formatCount(unassigned.quantity)} plantes) n apparaissent dans aucune barre.
          Donnez-leur une etape depuis leur fiche.
        </p>
      )}

      <p className="mt-4 text-xs text-ink-faint">
        Les etapes sont configurables : celles proposees ici sont celles du document
        (semis, bouture, division, BioLab, godet, C1, C3, C5, C10, vendable).
      </p>
    </div>
  );
}
