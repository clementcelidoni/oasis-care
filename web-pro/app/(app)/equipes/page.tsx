import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui";
import { type Employee, type Team } from "@/lib/field/types";
import { EmployeeTable } from "./EmployeeTable";
import { TeamList } from "./TeamList";
import { SkillMatrix } from "./SkillMatrix";

/**
 * §11H — équipes.
 *
 * Trois choses sur un écran, parce qu'elles ne se règlent qu'ensemble :
 * qui travaille ici, comment ils sont groupés, et qui sait faire quoi.
 * Trois pages obligeraient à faire des allers-retours pour composer une
 * équipe.
 */
export default async function TeamsPage() {
  const supabase = await createClient();

  const [{ data: employees }, { data: teams }, { data: members }, { data: skills }, { data: employeeSkills }] =
    await Promise.all([
      supabase
        .from("employees")
        .select("id, first_name, last_name, job_title, email, phone, hourly_cost_cents")
        .is("archived_at", null)
        .order("last_name"),
      supabase.from("teams").select("id, name, color, lead_employee_id").is("archived_at", null).order("name"),
      supabase.from("team_members").select("team_id, employee_id"),
      supabase.from("skills").select("id, name").order("name"),
      supabase.from("employee_skills").select("employee_id, skill_id, level"),
    ]);

  const allEmployees = (employees ?? []) as Employee[];

  // Ce que la suppression d'un salarié emporterait avec elle (voir
  // `deleteEmployee`). Un COUNT par personne plutôt qu'un chargement de
  // tous les pointages : le nombre de requêtes suit l'effectif, pas les
  // années d'historique — huit salariés qui pointent chaque jour font
  // deux mille lignes par an, et cette page n'a besoin d'aucune.
  const timeEntryCounts = Object.fromEntries(
    await Promise.all(
      allEmployees.map(async (employee) => {
        const { count } = await supabase
          .from("time_entries")
          .select("id", { count: "exact", head: true })
          .eq("employee_id", employee.id);
        return [employee.id, count ?? 0] as const;
      }),
    ),
  );

  return (
    <div className="mx-auto max-w-5xl px-8 py-10">
      <PageHeader
        title="Équipes"
        subtitle={`${allEmployees.length} personne${allEmployees.length > 1 ? "s" : ""}`}
      />

      <EmployeeTable employees={allEmployees} timeEntryCounts={timeEntryCounts} />

      <TeamList
        teams={(teams ?? []) as Team[]}
        employees={allEmployees}
        members={(members ?? []) as { team_id: string; employee_id: string }[]}
      />

      <SkillMatrix
        employees={allEmployees}
        skills={(skills ?? []) as { id: string; name: string }[]}
        employeeSkills={(employeeSkills ?? []) as { employee_id: string; skill_id: string; level: number }[]}
      />

      <p className="mt-6 text-xs text-ink-faint">
        Le coût horaire est le coût <strong>pour l&apos;entreprise</strong>, charges
        comprises — ni le salaire brut, ni un taux de facturation. C&apos;est lui qui
        alimente le coût réel de main-d&apos;œuvre des chantiers. Oasis ne calcule
        aucun bulletin de paie et n&apos;applique aucune convention collective.
      </p>
    </div>
  );
}
