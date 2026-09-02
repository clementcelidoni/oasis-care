import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requirePortal } from "@/lib/portal/access";
import { listClientProjectPhotos } from "@/lib/portal/photos";
import { Card, Badge } from "@/components/ui";
import { formatDate } from "@/lib/crm/types";
import { PHOTO_MOMENTS, PHOTO_MOMENT_LABELS, type PhotoMoment } from "@/lib/projects/types";
import {
  projectProgress,
  CLIENT_PROJECT_STATUS_LABELS, CLIENT_PROJECT_STATUS_TONE,
  type ClientProject, type ClientProjectPhase,
} from "@/lib/portal/types";

/**
 * §11S — « Suivre l'avancement de son chantier ».
 *
 * Les phases et leur pourcentage, les dates, les photos. Pas les
 * ressources, pas les pointages, pas les dépenses : `client_projects`
 * et `client_project_phases` ne portent aucune de ces colonnes, et les
 * tables où elles vivent restent fermées.
 *
 * Le budget est le cas le plus tentant et le plus dangereux. « Prévu
 * 12 000 € / réel 9 400 € » a l'air d'une information de transparence ;
 * c'est la marge de l'entreprise, énoncée à voix haute.
 */
export default async function PortalProjectPage({
  params,
}: PageProps<"/portail/chantiers/[id]">) {
  const { id } = await params;
  await requirePortal();
  const supabase = await createClient();

  const { data: project } = await supabase
    .from("client_projects")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (!project) notFound();
  const p = project as ClientProject;

  const [{ data: phases }, photos] = await Promise.all([
    supabase.from("client_project_phases").select("*").eq("project_id", id).order("position"),
    listClientProjectPhotos(id),
  ]);

  const allPhases = (phases ?? []) as ClientProjectPhase[];
  const progress = projectProgress(allPhases);

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <Link href="/portail" className="mb-4 inline-block text-sm text-ink-soft hover:text-ink">
        ← Vos documents
      </Link>

      <header className="mb-8">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{p.name}</h1>
          <Badge tone={CLIENT_PROJECT_STATUS_TONE[p.status] ?? "neutral"}>
            {CLIENT_PROJECT_STATUS_LABELS[p.status] ?? p.status}
          </Badge>
        </div>
        <p className="mt-1.5 text-sm text-ink-soft">
          {p.actual_start_on
            ? `Commencé le ${formatDate(p.actual_start_on)}`
            : p.planned_start_on
              ? `Début prévu le ${formatDate(p.planned_start_on)}`
              : "Date de début à définir"}
          {p.actual_end_on
            ? ` · terminé le ${formatDate(p.actual_end_on)}`
            : p.planned_end_on
              ? ` · fin prévue le ${formatDate(p.planned_end_on)}`
              : ""}
        </p>

        <div className="mt-5 flex items-center gap-3">
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-canvas">
            <div
              className="h-full rounded-full bg-accent transition-[width]"
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="tabular text-sm font-medium">{progress} %</span>
        </div>
      </header>

      <Card className="mb-4">
        <div className="border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold">Étapes</h2>
        </div>
        {allPhases.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-ink-faint">
            Les étapes de ce chantier n&apos;ont pas encore été définies.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {allPhases.map((phase) => (
              <li key={phase.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{phase.title}</span>
                  {(phase.planned_start_on || phase.planned_end_on) && (
                    <span className="block text-xs text-ink-soft">
                      {formatDate(phase.planned_start_on)} → {formatDate(phase.planned_end_on)}
                    </span>
                  )}
                </span>
                <span className="flex w-32 items-center gap-2">
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-canvas">
                    <span
                      className="block h-full rounded-full bg-accent"
                      style={{ width: `${phase.progress_percent}%` }}
                    />
                  </span>
                  <span className="tabular w-9 text-right text-xs text-ink-soft">
                    {phase.progress_percent} %
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {photos.length > 0 && (
        <Card>
          <div className="border-b border-line px-4 py-3">
            <h2 className="text-sm font-semibold">Photos</h2>
          </div>
          <div className="px-4 py-4">
            {PHOTO_MOMENTS.map((moment: PhotoMoment) => {
              const group = photos.filter((photo) => photo.moment === moment);
              if (group.length === 0) return null;
              return (
                <div key={moment} className="mb-4 last:mb-0">
                  <h3 className="mb-1.5 text-xs font-medium text-ink-soft">
                    {PHOTO_MOMENT_LABELS[moment]}
                  </h3>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {group.map((photo) => (
                      <figure
                        key={photo.id}
                        className="overflow-hidden rounded-lg border border-line bg-surface"
                      >
                        {photo.url ? (
                          /* URL signée d'un bucket privé, valable une heure :
                             `next/image` la mettrait en cache côté serveur
                             bien après son expiration, et l'image se
                             briserait. */
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={photo.url}
                            alt={photo.caption ?? "Photo de chantier"}
                            className="aspect-[4/3] w-full object-cover"
                          />
                        ) : (
                          <div className="flex aspect-[4/3] items-center justify-center bg-canvas text-xs text-ink-faint">
                            Image indisponible
                          </div>
                        )}
                        <figcaption className="px-2 py-1.5 text-[11px] text-ink-soft">
                          {photo.caption || "Sans légende"}
                          <span className="block text-ink-faint">
                            {formatDate(photo.takenOn)}
                          </span>
                        </figcaption>
                      </figure>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}
    </div>
  );
}
