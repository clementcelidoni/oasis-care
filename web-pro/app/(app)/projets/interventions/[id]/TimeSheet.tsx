"use client";

import { logTeamTime, logTime, setTimeEntryValidation, deleteTimeEntry } from "@/lib/field/actions";
import { formatDate } from "@/lib/crm/types";
import { formatCents } from "@/lib/quotes/types";
import {
  TIME_KINDS, TIME_KIND_LABELS, employeeName,
  type Employee, type TimeEntry,
} from "@/lib/field/types";

/**
 * §timeEntries — le pointage.
 *
 * Deux gestes, parce qu'il y a deux moments. Le soir, tout le monde a
 * fait la même journée : un seul champ pointe l'équipe entière. Le
 * reste du temps on corrige une ligne, et c'est le formulaire du bas.
 *
 * VALIDER EST UN ACTE SÉPARÉ. Une heure ne devient de l'argent qu'une
 * fois relue : un chef d'équipe qui se trompe de ligne le soir ne doit
 * pas faire bouger le budget d'un chantier avant que quelqu'un vérifie.
 */
export function TimeSheet({
  interventionId, entries, employees, hasTeam, suggestedHours,
}: {
  interventionId: string;
  entries: (TimeEntry & { employees: { first_name: string; last_name: string } | null })[];
  employees: Employee[];
  hasTeam: boolean;
  suggestedHours: number;
}) {
  const today = new Date().toISOString().slice(0, 10);

  return (
    <section className="mb-8">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
        Heures
      </h2>

      <div className="overflow-hidden rounded-lg border border-line bg-surface">
        {hasTeam && (
          <form
            action={logTeamTime}
            className="flex flex-wrap items-center gap-2 border-b border-line bg-accent-wash px-4 py-2.5"
          >
            <input type="hidden" name="intervention_id" value={interventionId} />
            <span className="text-xs font-medium">Pointer toute l&apos;équipe</span>
            <input
              name="hours"
              defaultValue={suggestedHours > 0 ? String(suggestedHours) : "7"}
              className="w-16 rounded-md border border-line-strong bg-surface px-2 py-1.5 text-right text-xs tabular outline-none focus:border-accent"
            />
            <span className="text-xs text-ink-soft">h le</span>
            <input
              type="date"
              name="worked_on"
              defaultValue={today}
              className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-xs outline-none focus:border-accent"
            />
            <button
              type="submit"
              className="rounded-md bg-accent px-2.5 py-1.5 text-xs font-medium text-accent-ink"
            >
              Pointer
            </button>
            <span className="text-[11px] text-ink-soft">
              Repointer le même jour corrige les heures au lieu de les doubler.
            </span>
          </form>
        )}

        {entries.length > 0 && (
          <ul className="divide-y divide-line">
            {entries.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-center gap-3 px-4 py-2 text-sm">
                <span className="w-24 shrink-0 tabular text-xs text-ink-faint">
                  {formatDate(entry.worked_on)}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  {entry.employees ? employeeName(entry.employees) : "Salarié supprimé"}
                  {entry.kind !== "work" && (
                    <span className="ml-1.5 text-[11px] text-ink-faint">
                      {TIME_KIND_LABELS[entry.kind]}
                    </span>
                  )}
                </span>
                <span className="shrink-0 tabular text-xs">
                  {Number(entry.hours).toLocaleString("fr-FR")} h
                </span>
                <span
                  className={`w-24 shrink-0 tabular text-right text-xs ${
                    entry.validated && entry.kind === "work" ? "font-medium" : "text-ink-faint"
                  }`}
                >
                  {formatCents(entry.total_cents)}
                </span>

                <form action={setTimeEntryValidation} className="shrink-0">
                  <input type="hidden" name="entry_id" value={entry.id} />
                  <input type="hidden" name="validated" value={entry.validated ? "false" : "true"} />
                  <button
                    type="submit"
                    title={
                      entry.validated
                        ? "Retirer la validation : cette heure sortira du coût du chantier."
                        : "Valider : cette heure entrera dans le coût du chantier."
                    }
                    className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${
                      entry.validated
                        ? "bg-positive/10 text-positive"
                        : "border border-line-strong text-ink-faint hover:border-accent hover:text-accent"
                    }`}
                  >
                    {entry.validated ? "Validé" : "À valider"}
                  </button>
                </form>

                <form action={deleteTimeEntry} className="shrink-0">
                  <input type="hidden" name="entry_id" value={entry.id} />
                  <button type="submit" className="px-1 text-xs text-ink-faint hover:text-critical">
                    ✕
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}

        <form
          action={logTime}
          className="flex flex-wrap items-center gap-2 border-t border-line bg-canvas px-4 py-2.5"
        >
          <input type="hidden" name="intervention_id" value={interventionId} />
          <select
            name="employee_id"
            required
            defaultValue=""
            className="max-w-40 rounded-md border border-line-strong bg-surface px-2 py-1.5 text-xs outline-none focus:border-accent"
          >
            <option value="" disabled>Salarié…</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>{employeeName(e)}</option>
            ))}
          </select>
          <input
            name="hours"
            placeholder="h"
            className="w-16 rounded-md border border-line-strong bg-surface px-2 py-1.5 text-right text-xs tabular outline-none placeholder:text-ink-faint focus:border-accent"
          />
          <select
            name="kind"
            defaultValue="work"
            className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-xs outline-none focus:border-accent"
          >
            {TIME_KINDS.map((k) => (
              <option key={k} value={k}>{TIME_KIND_LABELS[k]}</option>
            ))}
          </select>
          <input
            type="date"
            name="worked_on"
            defaultValue={today}
            className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-xs outline-none focus:border-accent"
          />
          <button
            type="submit"
            className="rounded-md border border-line-strong px-2.5 py-1.5 text-xs font-medium text-ink-soft hover:border-accent hover:text-accent"
          >
            Ajouter une ligne
          </button>
          <span className="text-[11px] text-ink-faint">
            Seul le travail est imputé au chantier — pas le trajet ni les pauses.
          </span>
        </form>
      </div>
    </section>
  );
}
