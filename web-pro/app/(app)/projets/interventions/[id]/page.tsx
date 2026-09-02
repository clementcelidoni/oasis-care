import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui";
import { formatDate } from "@/lib/crm/types";
import { formatCents } from "@/lib/quotes/types";
import {
  INTERVENTION_KIND_LABELS, INTERVENTION_STATUS_LABELS, INTERVENTION_STATUS_TONE,
  scheduledHours,
  type Intervention, type Employee, type Team, type TimeEntry,
} from "@/lib/field/types";
import { InterventionHeader } from "./InterventionHeader";
import { Checklist } from "./Checklist";
import { TimeSheet } from "./TimeSheet";
import { Materials } from "./Materials";
import { Signature } from "./Signature";

/**
 * §INTERVENTIONS — la fiche.
 *
 * L'ordre suit celui de la journée : ce qu'il faut faire, ce qui a été
 * consommé, les heures passées, puis l'accusé de passage. Un chef
 * d'équipe la remplit du haut vers le bas, le soir, sur un téléphone.
 */
export default async function InterventionPage({
  params,
}: PageProps<"/projets/interventions/[id]">) {
  const { id } = await params;
  const supabase = await createClient();

  const { data } = await supabase
    .from("field_interventions")
    .select("*, teams ( id, name, color ), crm_customers ( id, display_name ), projects ( id, number, name )")
    .eq("id", id)
    .maybeSingle();

  if (!data) notFound();

  const intervention = data as Intervention & {
    teams: { id: string; name: string; color: string } | null;
    crm_customers: { id: string; display_name: string } | null;
    projects: { id: string; number: string; name: string } | null;
  };

  const [{ data: tasks }, { data: materials }, { data: entries }, { data: employees }, { data: teams }] =
    await Promise.all([
      supabase.from("intervention_tasks").select("*").eq("intervention_id", id).order("position"),
      supabase.from("intervention_materials").select("*").eq("intervention_id", id).order("created_at"),
      supabase
        .from("time_entries")
        .select("*, employees ( first_name, last_name )")
        .eq("intervention_id", id)
        .order("worked_on", { ascending: false }),
      supabase
        .from("employees")
        .select("id, first_name, last_name, job_title, email, phone, hourly_cost_cents")
        .is("archived_at", null)
        .order("last_name"),
      supabase.from("teams").select("id, name, color, lead_employee_id").is("archived_at", null).order("name"),
    ]);

  const timeEntries = (entries ?? []) as unknown as (TimeEntry & {
    employees: { first_name: string; last_name: string } | null;
  })[];

  const validatedCents = timeEntries
    .filter((e) => e.validated && e.kind === "work")
    .reduce((s, e) => s + e.total_cents, 0);
  const totalHours = timeEntries
    .filter((e) => e.kind === "work")
    .reduce((s, e) => s + Number(e.hours), 0);

  return (
    <div className="mx-auto max-w-4xl px-8 py-10">
      <div className="mb-1 flex items-center gap-2 text-sm text-ink-faint">
        <Link href="/projets/interventions" className="hover:text-ink">Interventions</Link>
        <span>/</span>
        <span>{INTERVENTION_KIND_LABELS[intervention.kind]}</span>
      </div>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{intervention.title}</h1>
          <p className="mt-1 text-sm text-ink-soft">
            {intervention.crm_customers && (
              <Link href={`/crm/clients/${intervention.crm_customers.id}`} className="hover:text-ink">
                {intervention.crm_customers.display_name}
              </Link>
            )}
            {intervention.projects && (
              <>
                {intervention.crm_customers ? " · " : ""}
                <Link href={`/projets/${intervention.projects.id}`} className="hover:text-ink">
                  {intervention.projects.number} — {intervention.projects.name}
                </Link>
              </>
            )}
            {intervention.scheduled_start && ` · ${formatDate(intervention.scheduled_start)}`}
          </p>
        </div>
        <Badge tone={INTERVENTION_STATUS_TONE[intervention.status]}>
          {INTERVENTION_STATUS_LABELS[intervention.status]}
        </Badge>
      </div>

      <InterventionHeader
        intervention={intervention}
        teams={(teams ?? []) as Team[]}
      />

      <Checklist
        interventionId={id}
        tasks={(tasks ?? []) as { id: string; title: string; done: boolean }[]}
        instructions={intervention.instructions}
      />

      <Materials
        interventionId={id}
        materials={(materials ?? []) as { id: string; description: string; quantity: number; unit: string }[]}
      />

      <TimeSheet
        interventionId={id}
        entries={timeEntries}
        employees={(employees ?? []) as Employee[]}
        hasTeam={intervention.team_id !== null}
        suggestedHours={scheduledHours(intervention.scheduled_start, intervention.scheduled_end)}
      />

      {totalHours > 0 && (
        <p className="mb-8 -mt-6 text-xs text-ink-faint">
          {totalHours.toLocaleString("fr-FR")} h de travail pointées, dont{" "}
          <strong>{formatCents(validatedCents)}</strong> validés et imputés au chantier.
          Un pointage non validé n&apos;entre dans aucun budget.
        </p>
      )}

      <Signature intervention={intervention} />
    </div>
  );
}
