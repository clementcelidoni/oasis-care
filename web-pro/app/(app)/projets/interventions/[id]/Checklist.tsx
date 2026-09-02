"use client";

import { addInterventionTask, toggleInterventionTask, updateIntervention } from "@/lib/field/actions";

/** §tasks et §instructions — ce qu'il y a à faire sur place. */
export function Checklist({
  interventionId, tasks, instructions,
}: {
  interventionId: string;
  tasks: { id: string; title: string; done: boolean }[];
  instructions: string | null;
}) {
  const done = tasks.filter((t) => t.done).length;

  return (
    <section className="mb-6">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
        À faire {tasks.length > 0 && `— ${done}/${tasks.length}`}
      </h2>

      <div className="overflow-hidden rounded-lg border border-line bg-surface">
        <form action={updateIntervention} className="border-b border-line px-4 py-2.5">
          <input type="hidden" name="intervention_id" value={interventionId} />
          <textarea
            name="instructions"
            defaultValue={instructions ?? ""}
            onBlur={(e) => e.currentTarget.form?.requestSubmit()}
            rows={2}
            placeholder="Consignes pour l'équipe — accès, code du portail, chien, personne à prévenir…"
            className="w-full resize-y rounded-md border border-transparent bg-transparent px-1.5 py-1 text-sm outline-none placeholder:text-ink-faint hover:border-line focus:border-accent focus:bg-surface"
          />
        </form>

        {tasks.length > 0 && (
          <ul className="divide-y divide-line">
            {tasks.map((task) => (
              <li key={task.id} className="px-4 py-1.5">
                <form action={toggleInterventionTask} className="flex items-center gap-2">
                  <input type="hidden" name="intervention_id" value={interventionId} />
                  <input type="hidden" name="task_id" value={task.id} />
                  <input type="hidden" name="done" value={task.done ? "false" : "true"} />
                  <button
                    type="submit"
                    className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] ${
                      task.done
                        ? "border-accent bg-accent text-accent-ink"
                        : "border-line-strong hover:border-accent"
                    }`}
                    aria-label={task.done ? "Décocher" : "Cocher"}
                  >
                    {task.done ? "✓" : ""}
                  </button>
                  <span className={`text-sm ${task.done ? "text-ink-faint line-through" : ""}`}>
                    {task.title}
                  </span>
                </form>
              </li>
            ))}
          </ul>
        )}

        <form
          action={addInterventionTask}
          className="flex items-center gap-2 border-t border-line bg-canvas px-4 py-2.5"
        >
          <input type="hidden" name="intervention_id" value={interventionId} />
          <input
            name="title"
            required
            placeholder="Ajouter une tâche"
            className="min-w-0 flex-1 rounded-md border border-line-strong bg-surface px-2 py-1.5 text-xs outline-none placeholder:text-ink-faint focus:border-accent"
          />
          <button
            type="submit"
            className="rounded-md bg-accent px-2.5 py-1.5 text-xs font-medium text-accent-ink"
          >
            Ajouter
          </button>
        </form>
      </div>
    </section>
  );
}
