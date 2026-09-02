import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, EmptyState, Badge } from "@/components/ui";
import { formatDate } from "@/lib/crm/types";
import {
  INSPECTION_RESULT_LABELS, INSPECTION_RESULT_TONE, LOT_STATUS_LABELS,
  formatCount, type InspectionResult, type LotStatus,
} from "@/lib/nursery/types";

/**
 * §11L — santé et traçabilité.
 *
 * Ce qui est en quarantaine d'abord : c'est ce qu'on vient chercher.
 * Les inspections récentes ensuite, tous lots confondus, parce qu'une
 * tendance ne se voit pas lot par lot.
 */
export default async function NurseryHealthPage() {
  const supabase = await createClient();

  const [{ data: quarantined }, { data: inspections }] = await Promise.all([
    supabase
      .from("nursery_lots")
      .select("id, lot_code, species_name, current_quantity, status, nursery_locations ( code, name )")
      .in("status", ["quarantine", "hold", "damaged"])
      .is("archived_at", null)
      .order("lot_code"),
    supabase
      .from("nursery_inspections")
      .select("id, inspected_on, result, findings, action_taken, nursery_lots ( id, lot_code, species_name )")
      .order("inspected_on", { ascending: false })
      .limit(50),
  ]);

  const isolated = (quarantined ?? []) as unknown as {
    id: string; lot_code: string; species_name: string; current_quantity: number;
    status: LotStatus; nursery_locations: { code: string; name: string } | null;
  }[];

  const recent = (inspections ?? []) as unknown as {
    id: string; inspected_on: string; result: InspectionResult;
    findings: string | null; action_taken: string | null;
    nursery_lots: { id: string; lot_code: string; species_name: string } | null;
  }[];

  const isolatedPlants = isolated.reduce((s, l) => s + l.current_quantity, 0);

  return (
    <div className="mx-auto max-w-4xl px-8 py-10">
      <PageHeader
        title="Santé"
        subtitle={
          isolated.length > 0
            ? `${formatCount(isolatedPlants)} plantes hors vente dans ${isolated.length} lot${isolated.length > 1 ? "s" : ""}`
            : "Aucun lot isolé"
        }
      />

      {isolated.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
            Lots isolés
          </h2>
          <ul className="divide-y divide-line rounded-lg border border-critical/30 bg-surface">
            {isolated.map((lot) => (
              <li key={lot.id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                <span className="min-w-0">
                  <Link href={`/pepiniere/lots/${lot.id}`} className="font-medium hover:text-accent">
                    {lot.lot_code}
                  </Link>
                  <span className="ml-2 text-ink-soft">{lot.species_name}</span>
                  {lot.nursery_locations && (
                    <span className="ml-2 text-[11px] text-ink-faint">
                      {lot.nursery_locations.code}
                    </span>
                  )}
                </span>
                <span className="flex shrink-0 items-center gap-3">
                  <span className="tabular text-xs">{formatCount(lot.current_quantity)}</span>
                  <Badge tone="critical">{LOT_STATUS_LABELS[lot.status]}</Badge>
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-ink-faint">
            Ces plantes comptent toujours dans le stock physique — elles existent — mais rien
            n&apos;en est vendable. Levez la quarantaine depuis la fiche du lot.
          </p>
        </section>
      )}

      <section>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
          Inspections récentes
        </h2>
        {recent.length === 0 ? (
          <EmptyState
            title="Aucune inspection"
            description="Les inspections s'enregistrent depuis la fiche d'un lot, onglet « Inspecter »."
          />
        ) : (
          <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
            {recent.map((i) => (
              <li key={i.id} className="flex items-start gap-3 px-4 py-2 text-sm">
                <span className="w-24 shrink-0 tabular text-xs text-ink-faint">
                  {formatDate(i.inspected_on)}
                </span>
                <Badge tone={INSPECTION_RESULT_TONE[i.result]}>
                  {INSPECTION_RESULT_LABELS[i.result]}
                </Badge>
                <span className="min-w-0 flex-1">
                  {i.nursery_lots && (
                    <Link
                      href={`/pepiniere/lots/${i.nursery_lots.id}`}
                      className="font-medium hover:text-accent"
                    >
                      {i.nursery_lots.lot_code}
                    </Link>
                  )}
                  {i.findings && <span className="ml-2 text-ink-soft">{i.findings}</span>}
                  {i.action_taken && (
                    <span className="block text-[11px] text-ink-faint">{i.action_taken}</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="mt-6 text-xs text-ink-faint">
        §PASSEPORT PHYTOSANITAIRE — Oasis Care aide à tenir et imprimer des informations.
        Il ne présume jamais qu&apos;une entreprise est légalement autorisée à délivrer un
        passeport phytosanitaire, et ne le délivre pas à sa place.
      </p>
    </div>
  );
}
