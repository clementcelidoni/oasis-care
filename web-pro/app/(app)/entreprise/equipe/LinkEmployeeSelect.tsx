"use client";

import { linkEmployeeAccount } from "@/lib/field/actions";
import { employeeName } from "@/lib/field/types";

/**
 * « Ce compte, c'est quel salarié ? »
 *
 * Le choix s'enregistre au changement plutôt que derrière un bouton
 * « Enregistrer ». Une liste déroulante à une seule valeur n'a pas
 * d'état intermédiaire à valider : on choisit une personne, et c'est
 * fait. Un bouton en plus ne protégerait de rien, puisque se tromper
 * se répare en rechoisissant.
 */
export function LinkEmployeeSelect({
  memberUserId,
  currentEmployeeId,
  options,
}: {
  memberUserId: string;
  currentEmployeeId: string | null;
  /** Les fiches libres, plus celle déjà rattachée à ce compte. */
  options: { id: string; first_name: string; last_name: string; job_title: string | null }[];
}) {
  const selectId = `fiche-${memberUserId}`;

  return (
    <form action={linkEmployeeAccount} className="mt-3 flex flex-wrap items-center gap-2">
      <input type="hidden" name="member_user_id" value={memberUserId} />
      <label htmlFor={selectId} className="eyebrow">
        Fiche salarié
      </label>
      <select
        id={selectId}
        name="employee_id"
        defaultValue={currentEmployeeId ?? ""}
        onChange={(event) => event.currentTarget.form?.requestSubmit()}
        className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-xs text-ink outline-none focus:border-accent"
      >
        <option value="">— Aucune fiche —</option>
        {options.map((employee) => (
          <option key={employee.id} value={employee.id}>
            {employeeName(employee)}
            {employee.job_title ? ` · ${employee.job_title}` : ""}
          </option>
        ))}
      </select>
      {/* Le repli sans JavaScript : la liste ne se soumet plus toute
          seule, donc il faut de quoi la soumettre. Masqué dès que le
          script tourne, ce qui est le cas de tout le monde ou presque —
          mais « ou presque » n'est pas « personne ». */}
      <noscript>
        <button
          type="submit"
          className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-xs"
        >
          Rattacher
        </button>
      </noscript>
    </form>
  );
}
