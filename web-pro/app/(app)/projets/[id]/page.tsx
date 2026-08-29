import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui";
import { formatDate } from "@/lib/crm/types";
import { formatCents } from "@/lib/quotes/types";
import { listProjectPhotos } from "@/lib/projects/actions";
import {
  PROJECT_STATUS_LABELS, PROJECT_STATUS_TONE, overallProgress,
  type Project, type ProjectPhase, type ProjectTask,
  type ProjectResource, type ProjectCost, type CostSummaryRow,
} from "@/lib/projects/types";
import { ProjectHeader } from "./ProjectHeader";
import { Phases } from "./Phases";
import { CostTracking } from "./CostTracking";
import { Photos } from "./Photos";

/**
 * §11F — la fiche d'un chantier.
 *
 * Trois questions, dans cet ordre : où en est-on, combien ça coûte,
 * à quoi ça ressemble. L'avancement et le budget sont côte à côte
 * SANS être reliés : leur écart est l'information la plus utile de la
 * page — 30 % fait pour 70 % dépensé est un signal, et personne ne le
 * verrait si l'un se déduisait de l'autre.
 */
export default async function ProjectPage({ params }: PageProps<"/projets/[id]">) {
  const { id } = await params;
  const supabase = await createClient();

  const { data } = await supabase
    .from("projects")
    .select("*, crm_customers ( id, display_name ), quotes ( id, number )")
    .eq("id", id)
    .maybeSingle();

  if (!data) notFound();

  const project = data as Project & {
    crm_customers: { id: string; display_name: string } | null;
    quotes: { id: string; number: string } | null;
  };

  const [
    { data: phases }, { data: tasks }, { data: resources },
    { data: costs }, { data: summary }, { data: suppliers }, photos,
  ] = await Promise.all([
    supabase.from("project_phases").select("*").eq("project_id", id).order("position"),
    supabase.from("project_tasks").select("*").eq("project_id", id).order("position"),
    supabase.from("project_resources").select("*").eq("project_id", id),
    supabase.from("project_costs").select("*").eq("project_id", id).order("incurred_on", { ascending: false }),
    supabase.from("project_cost_summary").select("*").eq("project_id", id),
    supabase.from("suppliers").select("id, name").is("archived_at", null).order("name"),
    listProjectPhotos(id),
  ]);

  const allPhases = (phases ?? []) as ProjectPhase[];
  const allResources = (resources ?? []) as ProjectResource[];
  const rows = (summary ?? []) as CostSummaryRow[];

  const planned = rows.reduce((s, r) => s + r.planned_cents, 0);
  const actual = rows.reduce((s, r) => s + r.actual_cents, 0);

  // Le budget prévu par phase, pour pondérer l'avancement : une phase à
  // 40 % du budget pèse plus qu'une phase de finitions.
  const plannedByPhase = new Map<string | null, number>();
  for (const r of allResources) {
    plannedByPhase.set(r.phase_id, (plannedByPhase.get(r.phase_id) ?? 0) + r.planned_total_cents);
  }
  const progress = overallProgress(allPhases, plannedByPhase);
  const spentPercent = planned > 0 ? Math.round((actual / planned) * 100) : 0;

  return (
    <div className="mx-auto max-w-5xl px-8 py-10">
      <div className="mb-1 flex items-center gap-2 text-sm text-ink-faint">
        <Link href="/projets" className="hover:text-ink">Chantiers</Link>
        <span>/</span>
        <span className="tabular">{project.number}</span>
      </div>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{project.name}</h1>
          <p className="mt-1 text-sm text-ink-soft">
            {project.crm_customers ? (
              <Link href={`/crm/clients/${project.crm_customers.id}`} className="hover:text-ink">
                {project.crm_customers.display_name}
              </Link>
            ) : "Client supprimé"}
            {project.quotes && (
              <>
                {" · issu du devis "}
                <Link href={`/devis/${project.quotes.id}`} className="tabular hover:text-ink">
                  {project.quotes.number}
                </Link>
              </>
            )}
            {project.actual_start_on && ` · démarré le ${formatDate(project.actual_start_on)}`}
          </p>
        </div>
        <Badge tone={PROJECT_STATUS_TONE[project.status]}>
          {PROJECT_STATUS_LABELS[project.status]}
        </Badge>
      </div>

      <ProjectHeader project={project} />

      {/*
        Avancement et dépense côte à côte, jamais l'un déduit de l'autre.
        C'est leur écart qui informe : 30 % fait pour 70 % dépensé
        annonce un dépassement bien avant qu'il soit consommé.
      */}
      <section className="mb-6 grid gap-3 sm:grid-cols-3">
        <Gauge label="Avancement" percent={progress} hint="Saisi phase par phase" />
        <Gauge
          label="Budget consommé"
          percent={spentPercent}
          hint={`${formatCents(actual)} sur ${formatCents(planned)} prévus`}
          alarm={planned > 0 && spentPercent > 100}
        />
        <div className="rounded-lg border border-line bg-surface p-4">
          <p className="text-[11px] uppercase tracking-wide text-ink-faint">Écart</p>
          <p
            className={`mt-1 text-xl font-semibold tabular ${
              actual - planned > 0 ? "text-critical" : "text-ink"
            }`}
          >
            {actual - planned > 0 ? "+" : ""}{formatCents(actual - planned)}
          </p>
          <p className="mt-1 text-[11px] text-ink-faint">
            {progress > 0 && spentPercent > progress + 15
              ? "La dépense va plus vite que le chantier."
              : "Réel moins prévu, toutes natures confondues."}
          </p>
        </div>
      </section>

      <Phases
        projectId={id}
        phases={allPhases}
        tasks={(tasks ?? []) as ProjectTask[]}
        plannedByPhase={Object.fromEntries(
          [...plannedByPhase].filter(([k]) => k !== null) as [string, number][],
        )}
      />

      <CostTracking
        projectId={id}
        summary={rows}
        resources={allResources}
        costs={(costs ?? []) as ProjectCost[]}
        phases={allPhases}
        suppliers={(suppliers ?? []) as { id: string; name: string }[]}
      />

      <Photos projectId={id} photos={photos} phases={allPhases} />
    </div>
  );
}

function Gauge({
  label, percent, hint, alarm,
}: {
  label: string;
  percent: number;
  hint: string;
  alarm?: boolean;
}) {
  const width = Math.min(100, Math.max(0, percent));
  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <p className="text-[11px] uppercase tracking-wide text-ink-faint">{label}</p>
      <p className={`mt-1 text-xl font-semibold tabular ${alarm ? "text-critical" : ""}`}>
        {percent} %
      </p>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-canvas">
        <div
          className={`h-full rounded-full ${alarm ? "bg-critical" : "bg-accent"}`}
          style={{ width: `${width}%` }}
        />
      </div>
      <p className="mt-1.5 text-[11px] text-ink-faint">{hint}</p>
    </div>
  );
}
