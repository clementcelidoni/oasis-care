"use client";

import { updateProject } from "@/lib/projects/actions";
import { PROJECT_STATUSES, PROJECT_STATUS_LABELS, type Project } from "@/lib/projects/types";

/**
 * L'état du chantier et ses dates.
 *
 * Les dates réelles se posent toutes seules au changement d'état :
 * passer « en cours » écrit la date du jour comme date de démarrage.
 * Personne ne devrait avoir à taper « aujourd'hui », et personne ne le
 * ferait — le champ resterait vide.
 */
export function ProjectHeader({ project }: { project: Project }) {
  return (
    <form
      action={updateProject}
      className="mb-6 flex flex-wrap items-end gap-3 rounded-lg border border-line bg-surface px-4 py-3"
    >
      <input type="hidden" name="project_id" value={project.id} />

      <label className="flex flex-col gap-1">
        <span className="text-[11px] text-ink-faint">État</span>
        <select
          name="status"
          defaultValue={project.status}
          onChange={(e) => e.currentTarget.form?.requestSubmit()}
          className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent"
        >
          {PROJECT_STATUSES.map((s) => (
            <option key={s} value={s}>{PROJECT_STATUS_LABELS[s]}</option>
          ))}
        </select>
      </label>

      <DateField
        name="planned_start_on" label="Début prévu" value={project.planned_start_on}
      />
      <DateField
        name="planned_end_on" label="Fin prévue" value={project.planned_end_on}
      />
      <DateField
        name="actual_start_on" label="Début réel" value={project.actual_start_on}
      />
      <DateField
        name="actual_end_on" label="Fin réelle" value={project.actual_end_on}
      />

      <label className="flex min-w-48 flex-1 flex-col gap-1">
        <span className="text-[11px] text-ink-faint">Notes internes</span>
        <input
          name="notes"
          defaultValue={project.notes ?? ""}
          onBlur={(e) => e.currentTarget.form?.requestSubmit()}
          placeholder="Accès, contraintes, contacts sur place…"
          className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm outline-none placeholder:text-ink-faint focus:border-accent"
        />
      </label>
    </form>
  );
}

function DateField({
  name, label, value,
}: { name: string; label: string; value: string | null }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] text-ink-faint">{label}</span>
      <input
        type="date"
        name={name}
        defaultValue={value ?? ""}
        onBlur={(e) => e.currentTarget.form?.requestSubmit()}
        className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent"
      />
    </label>
  );
}
