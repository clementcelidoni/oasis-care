import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui";
import { mondayOf, addDays, isoDay, type Intervention, type Team } from "@/lib/field/types";
import { WeekPlanner } from "./WeekPlanner";

/**
 * §11G — le planning.
 *
 * La SEMAINE est la vue par défaut, et la seule pour l'instant. C'est
 * l'horizon réel d'un conducteur de travaux : le mois ne tient pas dans
 * un écran lisible, et la journée ne montre pas ce qui arrive. Le jour
 * et le mois viendront quand la semaine aura servi.
 */
export default async function PlanningPage({ searchParams }: PageProps<"/planning">) {
  const params = await searchParams;
  const requested = typeof params.semaine === "string" ? new Date(params.semaine) : new Date();
  const monday = mondayOf(Number.isNaN(requested.getTime()) ? new Date() : requested);
  const sunday = addDays(monday, 7);

  const supabase = await createClient();
  const [{ data: interventions }, { data: teams }, { data: projects }, { data: customers }] =
    await Promise.all([
      supabase
        .from("field_interventions")
        .select("*")
        .gte("scheduled_start", monday.toISOString())
        .lt("scheduled_start", sunday.toISOString())
        .neq("status", "cancelled")
        .order("scheduled_start"),
      supabase.from("teams").select("id, name, color, lead_employee_id").is("archived_at", null).order("name"),
      supabase.from("projects").select("id, number, name").is("archived_at", null).order("created_at", { ascending: false }),
      supabase.from("crm_customers").select("id, display_name").is("archived_at", null).order("display_name"),
    ]);

  return (
    <div className="mx-auto max-w-7xl px-8 py-10">
      <PageHeader
        title="Planning"
        subtitle={`Semaine du ${monday.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })}`}
      />

      <WeekPlanner
        mondayIso={isoDay(monday)}
        interventions={(interventions ?? []) as Intervention[]}
        teams={(teams ?? []) as Team[]}
        projects={(projects ?? []) as { id: string; number: string; name: string }[]}
        customers={(customers ?? []) as { id: string; display_name: string }[]}
      />
    </div>
  );
}
