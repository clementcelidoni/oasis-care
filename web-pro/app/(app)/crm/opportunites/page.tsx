import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, Card, EmptyState, Badge } from "@/components/ui";
import {
  OPPORTUNITY_STAGES,
  OPPORTUNITY_STAGE_LABELS,
  formatAmount,
  formatDate,
  type Opportunity,
  type OpportunityStage,
} from "@/lib/crm/types";

type Row = Opportunity & {
  crm_customers: { id: string; display_name: string } | null;
};

const OPEN_STAGES = OPPORTUNITY_STAGES.filter((s) => s !== "won" && s !== "lost");

export default async function OpportunitiesPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("crm_opportunities")
    .select("*, crm_customers ( id, display_name )")
    .is("archived_at", null)
    .order("created_at", { ascending: false });

  const rows = (data ?? []) as unknown as Row[];
  const open = rows.filter((r) => r.stage !== "won" && r.stage !== "lost");

  // The pipeline total counts open opportunities only. Adding won and
  // lost deals into one number would produce a figure that means
  // nothing — and it is exactly the kind of number someone quotes in a
  // meeting.
  const pipelineCents = open.reduce((sum, r) => sum + (r.estimated_value_cents ?? 0), 0);

  return (
    <div className="mx-auto max-w-5xl px-8 py-10">
      <PageHeader
        title="Opportunités"
        subtitle={`${open.length} en cours · ${formatAmount(pipelineCents)} de pipeline estimé`}
      />

      {rows.length === 0 ? (
        <EmptyState
          title="Aucune opportunité"
          description="Les affaires en cours se créent depuis la fiche d'un client ou d'un prospect."
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {OPEN_STAGES.map((stage) => (
            <StageColumn key={stage} stage={stage} rows={rows.filter((r) => r.stage === stage)} />
          ))}
        </div>
      )}

      {rows.some((r) => r.stage === "won" || r.stage === "lost") && (
        <section className="mt-8">
          <h2 className="mb-2 text-sm font-semibold">Affaires closes</h2>
          <Card>
            <ul className="divide-y divide-line">
              {rows
                .filter((r) => r.stage === "won" || r.stage === "lost")
                .map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                    <span className="truncate text-sm">{r.title}</span>
                    <div className="flex shrink-0 items-center gap-3">
                      <Badge tone={r.stage === "won" ? "accent" : "critical"}>
                        {OPPORTUNITY_STAGE_LABELS[r.stage]}
                      </Badge>
                      <span className="tabular text-sm">{formatAmount(r.estimated_value_cents)}</span>
                    </div>
                  </li>
                ))}
            </ul>
          </Card>
        </section>
      )}
    </div>
  );
}

function StageColumn({ stage, rows }: { stage: OpportunityStage; rows: Row[] }) {
  const total = rows.reduce((sum, r) => sum + (r.estimated_value_cents ?? 0), 0);

  return (
    <Card className="p-3">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
          {OPPORTUNITY_STAGE_LABELS[stage]}
        </h2>
        <span className="tabular text-xs text-ink-faint">{rows.length}</span>
      </div>
      {rows.length === 0 ? (
        <p className="py-4 text-center text-xs text-ink-faint">—</p>
      ) : (
        <>
          <ul className="flex flex-col gap-1.5">
            {rows.map((r) => (
              <li key={r.id}>
                <Link
                  href={r.crm_customers ? `/crm/clients/${r.crm_customers.id}` : "/crm/opportunites"}
                  className="block rounded-lg border border-line bg-surface-raised px-3 py-2 transition-colors hover:border-line-strong"
                >
                  <p className="truncate text-sm font-medium">{r.title}</p>
                  <p className="truncate text-xs text-ink-soft">
                    {r.crm_customers?.display_name ?? "—"}
                  </p>
                  <div className="mt-1 flex items-center justify-between">
                    <span className="tabular text-sm">{formatAmount(r.estimated_value_cents)}</span>
                    {r.expected_close_date && (
                      <span className="text-xs text-ink-faint">{formatDate(r.expected_close_date)}</span>
                    )}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
          <p className="tabular mt-2 border-t border-line pt-2 text-right text-xs text-ink-soft">
            {formatAmount(total)}
          </p>
        </>
      )}
    </Card>
  );
}
