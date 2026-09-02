"use client";

import { createEmployee, updateEmployee, archiveEmployee, deleteEmployee } from "@/lib/field/actions";
import { centsToInput, formatCents } from "@/lib/quotes/types";
import { type Employee, employeeName } from "@/lib/field/types";
import { ConfirmDialog } from "@/components/ui";

/**
 * Les salariés, modifiables sur place.
 *
 * Deux sorties, pas une, parce que ce ne sont pas la même chose :
 * ARCHIVER retire quelqu'un de l'effectif en gardant ses heures, donc
 * le coût réel des chantiers passés ; SUPPRIMER efface la personne et
 * ses pointages avec. La première convient à un départ, la seconde à
 * une fiche créée par erreur. Les proposer côte à côte, en disant ce
 * que chacune emporte, vaut mieux que de choisir à la place de
 * l'utilisateur.
 */
export function EmployeeTable({
  employees,
  timeEntryCounts,
}: {
  employees: Employee[];
  /** Nombre de pointages par salarié — ce qu'une suppression détruirait. */
  timeEntryCounts: Record<string, number>;
}) {
  return (
    <section className="mb-8">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
        Salariés
      </h2>

      <div className="overflow-hidden rounded-lg border border-line bg-surface">
        {employees.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-ink-faint">
                  <th className="py-2 pl-4 pr-2 font-medium">Prénom</th>
                  <th className="px-2 py-2 font-medium">Nom</th>
                  <th className="px-2 py-2 font-medium">Poste</th>
                  <th className="px-2 py-2 font-medium">Téléphone</th>
                  <th className="w-28 px-2 py-2 text-right font-medium">Coût / h</th>
                  <th className="w-32 py-2 pr-3" />
                </tr>
              </thead>
              <tbody>
                {employees.map((e) => (
                  <tr key={e.id} className="border-b border-line last:border-0">
                    <td colSpan={5} className="p-0">
                      <form
                        action={updateEmployee}
                        className="flex items-center gap-1 px-2 py-1"
                        onBlur={(ev) => {
                          if (!ev.currentTarget.contains(ev.relatedTarget as Node | null)) {
                            ev.currentTarget.requestSubmit();
                          }
                        }}
                      >
                        <input type="hidden" name="employee_id" value={e.id} />
                        <Cell name="first_name" defaultValue={e.first_name} />
                        <Cell name="last_name" defaultValue={e.last_name} />
                        <Cell name="job_title" defaultValue={e.job_title ?? ""} placeholder="Poste" />
                        <Cell name="phone" defaultValue={e.phone ?? ""} placeholder="Téléphone" />
                        <input
                          name="hourly_cost"
                          defaultValue={centsToInput(e.hourly_cost_cents)}
                          title="Coût horaire pour l'entreprise"
                          className="w-24 rounded border border-transparent bg-transparent px-1.5 py-1 text-right text-sm tabular outline-none hover:border-line focus:border-accent focus:bg-surface"
                        />
                      </form>
                    </td>
                    <td className="py-1 pr-3">
                      <div className="flex items-center justify-end gap-1">
                        <form action={archiveEmployee}>
                          <input type="hidden" name="employee_id" value={e.id} />
                          <button
                            type="submit"
                            title="Archiver. Ses pointages et le coût des chantiers passés sont conservés."
                            className="rounded px-1.5 py-1 text-xs text-ink-faint hover:bg-canvas hover:text-ink"
                          >
                            Archiver
                          </button>
                        </form>
                        <ConfirmDialog
                          triggerLabel="✕"
                          triggerTitle={`Supprimer définitivement ${employeeName(e)}`}
                          triggerVariant="ghost"
                          title={`Supprimer ${employeeName(e)} ?`}
                          message={deletionWarning(timeEntryCounts[e.id] ?? 0)}
                          confirmLabel="Supprimer définitivement"
                          confirmVariant="danger"
                          action={deleteEmployee}
                          hidden={{
                            employee_id: e.id,
                            // Le nombre AFFICHÉ repart au serveur, qui le
                            // recompte : c'est ce qui garantit que le
                            // chiffre lu dans ce message est bien celui
                            // qui sera détruit.
                            known_entries: String(timeEntryCounts[e.id] ?? 0),
                          }}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-line">
                  <td colSpan={4} className="py-1.5 pl-4 pr-2 text-xs text-ink-faint">
                    Coût horaire cumulé de l&apos;effectif
                  </td>
                  <td className="tabular px-2 py-1.5 text-right text-xs font-medium">
                    {formatCents(employees.reduce((s, e) => s + e.hourly_cost_cents, 0))}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        <form action={createEmployee} className="flex flex-wrap items-center gap-2 border-t border-line bg-canvas px-4 py-2.5">
          <input
            name="first_name"
            required
            placeholder="Prénom"
            className="w-28 rounded-md border border-line-strong bg-surface px-2 py-1.5 text-xs outline-none placeholder:text-ink-faint focus:border-accent"
          />
          <input
            name="last_name"
            placeholder="Nom"
            className="w-28 rounded-md border border-line-strong bg-surface px-2 py-1.5 text-xs outline-none placeholder:text-ink-faint focus:border-accent"
          />
          <input
            name="job_title"
            placeholder="Poste"
            className="w-32 rounded-md border border-line-strong bg-surface px-2 py-1.5 text-xs outline-none placeholder:text-ink-faint focus:border-accent"
          />
          <input
            name="phone"
            placeholder="Téléphone"
            className="w-32 rounded-md border border-line-strong bg-surface px-2 py-1.5 text-xs outline-none placeholder:text-ink-faint focus:border-accent"
          />
          <input
            name="hourly_cost"
            placeholder="Coût / h"
            className="w-24 rounded-md border border-line-strong bg-surface px-2 py-1.5 text-right text-xs tabular outline-none placeholder:text-ink-faint focus:border-accent"
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

/**
 * Ce que la suppression emporte, dit AVANT le clic et chiffré.
 *
 * « Cette action est irréversible » ne renseigne sur rien. Le nombre de
 * pointages, lui, dit exactement ce qui disparaît — et c'est le seul
 * élément qui permette de distinguer une fiche créée par erreur, qu'on
 * supprime sans hésiter, d'un ancien salarié dont les heures tiennent
 * la marge de trois chantiers.
 */
function deletionWarning(entries: number): string {
  if (entries === 0) {
    return "Cette fiche n'a aucun pointage : rien d'autre ne disparaîtra avec elle. La suppression reste définitive, sans corbeille.";
  }
  const s = entries > 1 ? "s" : "";
  return (
    `${entries} pointage${s} disparaîtra${entries > 1 ? "ont" : ""} avec cette fiche. ` +
    "Le coût de main-d'œuvre des chantiers concernés sera recalculé sans ces heures, " +
    "et leur marge changera. Pour un départ, préférez « Archiver » : la personne quitte " +
    "l'effectif et ses heures restent."
  );
}

function Cell({
  name, defaultValue, placeholder,
}: { name: string; defaultValue: string; placeholder?: string }) {
  return (
    <input
      name={name}
      defaultValue={defaultValue}
      placeholder={placeholder}
      className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1.5 py-1 text-sm outline-none placeholder:text-ink-faint hover:border-line focus:border-accent focus:bg-surface"
    />
  );
}
