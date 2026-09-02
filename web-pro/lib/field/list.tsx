import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, Card, EmptyState, Badge } from "@/components/ui";
import { formatDate } from "@/lib/crm/types";
import {
  INTERVENTION_KIND_LABELS, INTERVENTION_STATUS_LABELS, INTERVENTION_STATUS_TONE,
  formatTime, type Intervention, type InterventionKind,
} from "./types";

/**
 * La liste des interventions, éventuellement bornée à un type.
 *
 * Partagée par deux écrans : « Interventions » les montre toutes,
 * « Visites » ne montre que celles de type `visit`. Une seule liste et
 * un filtre plutôt que deux pages : ce sont les mêmes lignes, avec les
 * mêmes colonnes, et une visite qui devient un chantier ne doit pas
 * changer de table.
 */
export async function InterventionList({
  kind, title, subtitle, emptyDescription,
}: {
  kind?: InterventionKind;
  title: string;
  subtitle?: string;
  emptyDescription: string;
}) {
  const supabase = await createClient();

  let request = supabase
    .from("field_interventions")
    .select("*, teams ( name, color ), crm_customers ( display_name ), projects ( number )")
    .order("scheduled_start", { ascending: false, nullsFirst: false })
    .limit(200);
  if (kind) request = request.eq("kind", kind);

  const { data, error } = await request;

  const rows = (data ?? []) as unknown as (Intervention & {
    teams: { name: string; color: string } | null;
    crm_customers: { display_name: string } | null;
    projects: { number: string } | null;
  })[];

  return (
    <div className="mx-auto max-w-5xl px-8 py-10">
      <PageHeader
        title={title}
        subtitle={subtitle ?? `${rows.length} ${rows.length > 1 ? "lignes" : "ligne"}`}
        action={
          <Link
            href="/planning"
            className="rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-accent-ink"
          >
            Planifier
          </Link>
        }
      />

      {error && (
        <p className="mb-4 rounded-lg bg-critical-wash px-3 py-2 text-sm text-critical">
          {error.message}
        </p>
      )}

      {rows.length === 0 ? (
        <EmptyState title="Rien pour l'instant" description={emptyDescription} />
      ) : (
        <Card>
          <ul className="divide-y divide-line">
            {rows.map((iv) => (
              <li key={iv.id}>
                <Link
                  href={`/projets/interventions/${iv.id}`}
                  className="flex items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-canvas"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span
                      className="h-8 w-1 shrink-0 rounded-full"
                      style={{ backgroundColor: iv.teams?.color ?? "#cbd6cf" }}
                    />
                    <div className="min-w-0">
                      <p className="truncate font-medium">{iv.title}</p>
                      <p className="truncate text-sm text-ink-soft">
                        {[
                          INTERVENTION_KIND_LABELS[iv.kind],
                          iv.crm_customers?.display_name,
                          iv.projects?.number,
                          iv.teams?.name,
                        ].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="text-right text-xs text-ink-soft">
                      {iv.scheduled_start ? (
                        <>
                          <span className="block">{formatDate(iv.scheduled_start)}</span>
                          <span className="block tabular text-ink-faint">
                            {formatTime(iv.scheduled_start)}
                            {iv.scheduled_end ? `–${formatTime(iv.scheduled_end)}` : ""}
                          </span>
                        </>
                      ) : (
                        <span className="text-ink-faint">Non planifiée</span>
                      )}
                    </span>
                    <Badge tone={INTERVENTION_STATUS_TONE[iv.status]}>
                      {INTERVENTION_STATUS_LABELS[iv.status]}
                    </Badge>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
