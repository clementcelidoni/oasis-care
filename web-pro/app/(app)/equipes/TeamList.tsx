"use client";

import { createTeam, updateTeam, setTeamMembership } from "@/lib/field/actions";
import { employeeName, TEAM_COLORS, type Employee, type Team } from "@/lib/field/types";

/**
 * Les équipes et leur composition.
 *
 * La couleur n'est pas décorative : c'est à elle qu'on reconnaît une
 * équipe sur une semaine chargée du planning, où les noms sont écrits
 * trop petit pour se lire d'un coup d'œil.
 */
export function TeamList({
  teams, employees, members,
}: {
  teams: Team[];
  employees: Employee[];
  members: { team_id: string; employee_id: string }[];
}) {
  return (
    <section className="mb-8">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
        Équipes
      </h2>

      {teams.map((team) => {
        const memberIds = new Set(
          members.filter((m) => m.team_id === team.id).map((m) => m.employee_id),
        );
        return (
          <div key={team.id} className="mb-3 overflow-hidden rounded-lg border border-line bg-surface">
            <form
              action={updateTeam}
              className="flex flex-wrap items-center gap-2 border-b border-line bg-canvas px-4 py-2"
            >
              <input type="hidden" name="team_id" value={team.id} />
              <span
                className="h-4 w-4 shrink-0 rounded-full border border-line"
                style={{ backgroundColor: team.color }}
              />
              <input
                name="name"
                defaultValue={team.name}
                onBlur={(e) => e.currentTarget.form?.requestSubmit()}
                className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-sm font-semibold outline-none hover:border-line focus:border-accent focus:bg-surface"
              />
              <select
                name="color"
                defaultValue={team.color}
                onChange={(e) => e.currentTarget.form?.requestSubmit()}
                className="rounded border border-line bg-surface px-1.5 py-1 text-xs outline-none focus:border-accent"
              >
                {TEAM_COLORS.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              <select
                name="lead_employee_id"
                defaultValue={team.lead_employee_id ?? ""}
                onChange={(e) => e.currentTarget.form?.requestSubmit()}
                className="rounded border border-line bg-surface px-1.5 py-1 text-xs outline-none focus:border-accent"
              >
                <option value="">Sans chef d&apos;équipe</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>{employeeName(e)}</option>
                ))}
              </select>
            </form>

            <form action={setTeamMembership} className="px-4 py-2.5">
              <input type="hidden" name="team_id" value={team.id} />
              <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                {employees.length === 0 && (
                  <span className="text-xs text-ink-faint">
                    Ajoutez d&apos;abord des salariés.
                  </span>
                )}
                {employees.map((e) => (
                  <label key={e.id} className="flex items-center gap-1.5 text-sm">
                    <input
                      type="checkbox"
                      name="member"
                      value={e.id}
                      defaultChecked={memberIds.has(e.id)}
                    />
                    {employeeName(e)}
                  </label>
                ))}
              </div>
              {employees.length > 0 && (
                <button
                  type="submit"
                  className="mt-2 rounded-md border border-line-strong px-2.5 py-1 text-xs font-medium text-ink-soft hover:border-accent hover:text-accent"
                >
                  Enregistrer la composition
                </button>
              )}
            </form>
          </div>
        );
      })}

      <form action={createTeam} className="flex flex-wrap items-center gap-2">
        <input
          name="name"
          required
          placeholder="Nouvelle équipe"
          className="min-w-40 flex-1 rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm outline-none placeholder:text-ink-faint focus:border-accent"
        />
        <select
          name="color"
          defaultValue={TEAM_COLORS[0]}
          className="rounded-lg border border-line-strong bg-surface px-2 py-2 text-sm outline-none focus:border-accent"
        >
          {TEAM_COLORS.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <button
          type="submit"
          className="rounded-lg border border-line-strong px-3 py-2 text-sm font-medium text-ink-soft hover:border-accent hover:text-accent"
        >
          Créer l&apos;équipe
        </button>
      </form>
    </section>
  );
}
