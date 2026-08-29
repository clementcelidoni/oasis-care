"use client";

import { addSkill, setEmployeeSkill } from "@/lib/field/actions";
import { employeeName, SKILL_LEVEL_LABELS, type Employee } from "@/lib/field/types";

/**
 * Qui sait faire quoi.
 *
 * Trois niveaux — notions, autonome, référent — et pas une note sur
 * dix : personne ne sait ce que « 7/10 en taille douce » veut dire, et
 * deux responsables ne mettraient pas le même chiffre.
 *
 * Sert à composer une équipe en sachant qui peut conduire la minipelle.
 */
export function SkillMatrix({
  employees, skills, employeeSkills,
}: {
  employees: Employee[];
  skills: { id: string; name: string }[];
  employeeSkills: { employee_id: string; skill_id: string; level: number }[];
}) {
  const levelOf = (employeeId: string, skillId: string) =>
    employeeSkills.find((s) => s.employee_id === employeeId && s.skill_id === skillId)?.level ?? 0;

  return (
    <section className="mb-8">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
        Compétences
      </h2>

      <div className="overflow-hidden rounded-lg border border-line bg-surface">
        {skills.length > 0 && employees.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-ink-faint">
                  <th className="py-2 pl-4 pr-2 font-medium">Salarié</th>
                  {skills.map((s) => (
                    <th key={s.id} className="px-2 py-2 font-medium">{s.name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {employees.map((e) => (
                  <tr key={e.id} className="border-b border-line last:border-0">
                    <td className="py-1.5 pl-4 pr-2">{employeeName(e)}</td>
                    {skills.map((s) => (
                      <td key={s.id} className="px-2 py-1">
                        <form action={setEmployeeSkill}>
                          <input type="hidden" name="employee_id" value={e.id} />
                          <input type="hidden" name="skill_id" value={s.id} />
                          <select
                            name="level"
                            defaultValue={String(levelOf(e.id, s.id))}
                            onChange={(ev) => ev.currentTarget.form?.requestSubmit()}
                            className="rounded border border-transparent bg-transparent px-1 py-0.5 text-xs outline-none hover:border-line focus:border-accent focus:bg-surface"
                          >
                            <option value="0">—</option>
                            {[1, 2, 3].map((l) => (
                              <option key={l} value={l}>{SKILL_LEVEL_LABELS[l]}</option>
                            ))}
                          </select>
                        </form>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <form action={addSkill} className="flex items-center gap-2 border-t border-line bg-canvas px-4 py-2.5">
          <input
            name="name"
            required
            placeholder="Nouvelle compétence — Conduite d'engin, Taille douce, Élagage…"
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
