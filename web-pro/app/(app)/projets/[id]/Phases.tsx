"use client";

import { addPhase, updatePhase, deletePhase, addTask, updateTask, deleteTask } from "@/lib/projects/actions";
import { formatCents } from "@/lib/quotes/types";
import {
  PHASE_STATUSES, PHASE_STATUS_LABELS, PHASE_STATUS_TONE,
  TASK_STATUSES, TASK_STATUS_LABELS,
  type ProjectPhase, type ProjectTask,
} from "@/lib/projects/types";

const TONE_TEXT: Record<string, string> = {
  neutral: "text-ink-faint",
  info: "text-info",
  positive: "text-positive",
  warning: "text-warning",
  critical: "text-critical",
  accent: "text-accent",
};

/**
 * §PHASES et §TASKS.
 *
 * L'avancement est un champ, pas un calcul. Le déduire des tâches
 * cochées supposerait qu'elles pèsent toutes pareil, ce qui est faux
 * sur un chantier — « poser le géotextile » et « planter 40 arbres »
 * ne sont pas deux moitiés. Le conducteur de travaux sait où il en est ;
 * on lui demande, on ne le devine pas.
 */
export function Phases({
  projectId, phases, tasks, plannedByPhase,
}: {
  projectId: string;
  phases: ProjectPhase[];
  tasks: ProjectTask[];
  plannedByPhase: Record<string, number>;
}) {
  const orphanTasks = tasks.filter((t) => t.phase_id === null);

  return (
    <section className="mb-8">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
        Phases
      </h2>

      {phases.length === 0 && orphanTasks.length === 0 && (
        <p className="mb-3 rounded-lg border border-dashed border-line-strong px-4 py-6 text-center text-sm text-ink-soft">
          Aucune phase. Un chantier issu d&apos;un devis reprend ses postes ;
          ajoutez-les ici sinon.
        </p>
      )}

      {phases.map((phase) => (
        <PhaseBlock
          key={phase.id}
          projectId={projectId}
          phase={phase}
          tasks={tasks.filter((t) => t.phase_id === phase.id)}
          plannedCents={plannedByPhase[phase.id] ?? 0}
        />
      ))}

      {orphanTasks.length > 0 && (
        <div className="mb-3 overflow-hidden rounded-lg border border-line bg-surface">
          <header className="border-b border-line bg-canvas px-4 py-2">
            <h3 className="text-sm font-semibold">Sans phase</h3>
          </header>
          <TaskList projectId={projectId} tasks={orphanTasks} />
        </div>
      )}

      <form action={addPhase} className="flex items-center gap-2">
        <input type="hidden" name="project_id" value={projectId} />
        <input
          name="title"
          required
          placeholder="Nouvelle phase — Terrassement, Réception…"
          className="min-w-0 flex-1 rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm outline-none placeholder:text-ink-faint focus:border-accent"
        />
        <button
          type="submit"
          className="shrink-0 rounded-lg border border-line-strong px-3 py-2 text-sm font-medium text-ink-soft hover:border-accent hover:text-accent"
        >
          Ajouter une phase
        </button>
      </form>
    </section>
  );
}

function PhaseBlock({
  projectId, phase, tasks, plannedCents,
}: {
  projectId: string;
  phase: ProjectPhase;
  tasks: ProjectTask[];
  plannedCents: number;
}) {
  const done = tasks.filter((t) => t.status === "done").length;

  return (
    <div className="mb-3 overflow-hidden rounded-lg border border-line bg-surface">
      <header className="flex flex-wrap items-center gap-3 border-b border-line bg-canvas px-4 py-2">
        <form action={updatePhase} className="flex min-w-0 flex-1 items-center gap-3">
          <input type="hidden" name="project_id" value={projectId} />
          <input type="hidden" name="phase_id" value={phase.id} />

          <input
            name="title"
            defaultValue={phase.title}
            onBlur={(e) => e.currentTarget.form?.requestSubmit()}
            className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-sm font-semibold outline-none hover:border-line focus:border-accent focus:bg-surface"
          />

          <select
            name="status"
            defaultValue={phase.status}
            onChange={(e) => e.currentTarget.form?.requestSubmit()}
            className={`rounded border border-line bg-surface px-1.5 py-1 text-xs outline-none focus:border-accent ${TONE_TEXT[PHASE_STATUS_TONE[phase.status]]}`}
          >
            {PHASE_STATUSES.map((s) => (
              <option key={s} value={s}>{PHASE_STATUS_LABELS[s]}</option>
            ))}
          </select>

          <label className="flex shrink-0 items-center gap-1.5" title="Avancement de la phase, saisi">
            <input
              name="progress_percent"
              defaultValue={String(phase.progress_percent)}
              onBlur={(e) => e.currentTarget.form?.requestSubmit()}
              className="w-12 rounded border border-line bg-surface px-1 py-1 text-right text-xs tabular outline-none focus:border-accent"
            />
            <span className="text-xs text-ink-faint">%</span>
          </label>
        </form>

        {plannedCents > 0 && (
          <span className="tabular text-xs text-ink-faint" title="Budget prévu sur cette phase">
            {formatCents(plannedCents)}
          </span>
        )}

        <form action={deletePhase}>
          <input type="hidden" name="project_id" value={projectId} />
          <input type="hidden" name="phase_id" value={phase.id} />
          <button
            type="submit"
            title="Supprimer la phase. Ses tâches, ressources et dépenses sont conservées."
            className="text-xs text-ink-faint hover:text-critical"
          >
            ✕
          </button>
        </form>
      </header>

      <div className="h-1 bg-canvas">
        <div
          className="h-full bg-accent"
          style={{ width: `${Math.min(100, Math.max(0, phase.progress_percent))}%` }}
        />
      </div>

      {tasks.length > 0 && <TaskList projectId={projectId} tasks={tasks} />}

      <form action={addTask} className="flex items-center gap-2 border-t border-line bg-canvas px-4 py-2">
        <input type="hidden" name="project_id" value={projectId} />
        <input type="hidden" name="phase_id" value={phase.id} />
        <input
          name="title"
          required
          placeholder="Ajouter une tâche"
          className="min-w-0 flex-1 rounded-md border border-line-strong bg-surface px-2 py-1.5 text-xs outline-none placeholder:text-ink-faint focus:border-accent"
        />
        <input
          name="planned_hours"
          placeholder="h"
          title="Heures prévues"
          className="w-14 rounded-md border border-line-strong bg-surface px-2 py-1.5 text-right text-xs tabular outline-none placeholder:text-ink-faint focus:border-accent"
        />
        <button
          type="submit"
          className="rounded-md bg-accent px-2.5 py-1.5 text-xs font-medium text-accent-ink"
        >
          Ajouter
        </button>
        {tasks.length > 0 && (
          <span className="text-[11px] text-ink-faint">
            {done}/{tasks.length} faite{done > 1 ? "s" : ""}
          </span>
        )}
      </form>
    </div>
  );
}

function TaskList({ projectId, tasks }: { projectId: string; tasks: ProjectTask[] }) {
  return (
    <ul className="divide-y divide-line">
      {tasks.map((task) => (
        <li key={task.id} className="flex items-center gap-2 px-4 py-1.5">
          <form action={updateTask} className="flex min-w-0 flex-1 items-center gap-2">
            <input type="hidden" name="project_id" value={projectId} />
            <input type="hidden" name="task_id" value={task.id} />
            <select
              name="status"
              defaultValue={task.status}
              onChange={(e) => e.currentTarget.form?.requestSubmit()}
              className="rounded border border-line bg-surface px-1 py-0.5 text-[11px] outline-none focus:border-accent"
            >
              {TASK_STATUSES.map((s) => (
                <option key={s} value={s}>{TASK_STATUS_LABELS[s]}</option>
              ))}
            </select>
            <input
              name="title"
              defaultValue={task.title}
              onBlur={(e) => e.currentTarget.form?.requestSubmit()}
              className={`min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-sm outline-none hover:border-line focus:border-accent focus:bg-surface ${
                task.status === "done" ? "text-ink-faint line-through" : ""
              }`}
            />
            {task.planned_hours !== null && (
              <span className="shrink-0 tabular text-[11px] text-ink-faint">
                {task.planned_hours} h
              </span>
            )}
          </form>
          <form action={deleteTask}>
            <input type="hidden" name="project_id" value={projectId} />
            <input type="hidden" name="task_id" value={task.id} />
            <button type="submit" className="px-1 text-xs text-ink-faint hover:text-critical">
              ✕
            </button>
          </form>
        </li>
      ))}
    </ul>
  );
}
