import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, Card, EmptyState, Badge } from "@/components/ui";
import { formatDate } from "@/lib/crm/types";
import { formatCents } from "@/lib/quotes/types";
import {
  PROJECT_STATUSES, PROJECT_STATUS_LABELS, PROJECT_STATUS_TONE,
  varianceTone, type ProjectStatus,
} from "@/lib/projects/types";
import { NewProjectForm } from "./NewProjectForm";

/**
 * §11F — la liste des chantiers.
 *
 * Chaque ligne montre le prévu, le réel et leur écart, parce que c'est
 * la question qu'on se pose en ouvrant cette page : lequel dérape ?
 */
export default async function ProjectsPage({ searchParams }: PageProps<"/projets">) {
  const params = await searchParams;
  const status = typeof params.statut === "string" ? params.statut : "";

  const supabase = await createClient();

  let request = supabase
    .from("projects")
    .select("id, number, name, status, planned_start_on, actual_start_on, crm_customers ( display_name )")
    .is("archived_at", null)
    .order("created_at", { ascending: false })
    .limit(200);
  if (status) request = request.eq("status", status);

  const [{ data: projects, error }, { data: summary }, { data: customers }] = await Promise.all([
    request,
    supabase.from("project_cost_summary").select("*"),
    supabase
      .from("crm_customers")
      .select("id, display_name")
      .is("archived_at", null)
      .order("display_name"),
  ]);

  // Les écarts sont donnés par nature : on les additionne par chantier.
  const budget = new Map<string, { planned: number; actual: number }>();
  for (const row of summary ?? []) {
    const key = row.project_id as string;
    const current = budget.get(key) ?? { planned: 0, actual: 0 };
    current.planned += (row.planned_cents as number) ?? 0;
    current.actual += (row.actual_cents as number) ?? 0;
    budget.set(key, current);
  }

  const rows = (projects ?? []) as unknown as {
    id: string; number: string; name: string; status: ProjectStatus;
    planned_start_on: string | null; actual_start_on: string | null;
    crm_customers: { display_name: string } | null;
  }[];

  return (
    <div className="mx-auto max-w-5xl px-8 py-10">
      <PageHeader
        title="Chantiers"
        subtitle={`${rows.length} chantier${rows.length > 1 ? "s" : ""}`}
        action={<NewProjectForm customers={customers ?? []} />}
      />

      <nav className="mb-4 flex flex-wrap gap-1.5">
        <FilterLink current={status} value="" label="Tous" />
        {PROJECT_STATUSES.map((s) => (
          <FilterLink key={s} current={status} value={s} label={PROJECT_STATUS_LABELS[s]} />
        ))}
      </nav>

      {error && (
        <p className="mb-4 rounded-lg bg-critical-wash px-3 py-2 text-sm text-critical">
          {error.message}
        </p>
      )}

      {rows.length === 0 ? (
        <EmptyState
          title={status ? "Aucun chantier dans cet état" : "Aucun chantier pour l'instant"}
          description={
            status
              ? "Changez de filtre pour voir les autres."
              : "Un chantier naît d'un devis accepté — le bouton « Transformer en chantier » est sur la fiche du devis."
          }
        />
      ) : (
        <Card>
          <ul className="divide-y divide-line">
            {rows.map((project) => {
              const b = budget.get(project.id) ?? { planned: 0, actual: 0 };
              const variance = b.actual - b.planned;
              return (
                <li key={project.id}>
                  <Link
                    href={`/projets/${project.id}`}
                    className="flex items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-canvas"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">
                        <span className="tabular text-ink-faint">{project.number}</span>{" "}
                        {project.name}
                      </p>
                      <p className="truncate text-sm text-ink-soft">
                        {project.crm_customers?.display_name ?? "Client supprimé"}
                        {project.actual_start_on
                          ? ` · démarré le ${formatDate(project.actual_start_on)}`
                          : project.planned_start_on
                            ? ` · prévu le ${formatDate(project.planned_start_on)}`
                            : ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <span className="text-right text-xs">
                        <span className="block tabular text-ink-soft">
                          {formatCents(b.actual)} / {formatCents(b.planned)}
                        </span>
                        {variance > 0 && (
                          <span
                            className={`block tabular ${
                              varianceTone(variance, b.planned) === "critical"
                                ? "text-critical" : "text-warning"
                            }`}
                          >
                            +{formatCents(variance)}
                          </span>
                        )}
                      </span>
                      <Badge tone={PROJECT_STATUS_TONE[project.status]}>
                        {PROJECT_STATUS_LABELS[project.status]}
                      </Badge>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}

function FilterLink({ current, value, label }: { current: string; value: string; label: string }) {
  const active = current === value;
  return (
    <Link
      href={value ? `/projets?statut=${value}` : "/projets"}
      className={`rounded-md px-2.5 py-1 text-xs font-medium ${
        active ? "bg-accent-wash text-accent" : "text-ink-soft hover:bg-canvas"
      }`}
    >
      {label}
    </Link>
  );
}
