"use client";

import { useState } from "react";
import { updateOrganizationProfile } from "@/lib/auth/organizationActions";
import {
  BUSINESS_TYPES, BUSINESS_TYPE_LABELS, type BusinessType,
} from "@/lib/auth/permissions";

/**
 * Le nom et l'activité de l'entreprise.
 *
 * L'activité gouverne le menu : la changer fait apparaître ou
 * disparaître des modules entiers. On le dit avant, et on n'enregistre
 * que sur un clic — un `onChange` qui reconfigurerait l'application
 * pendant qu'on fait défiler une liste serait déroutant.
 */
export function OrganizationForm({
  name, businessType, canEdit,
}: {
  name: string;
  businessType: BusinessType;
  canEdit: boolean;
}) {
  const [selected, setSelected] = useState<BusinessType>(businessType);
  const changed = selected !== businessType;

  if (!canEdit) {
    return (
      <p className="mt-4 text-xs text-ink-faint">
        L&apos;activité détermine les modules affichés dans le menu — une entreprise sans
        pépinière ne voit pas les écrans de pépinière. Seul un administrateur peut la
        modifier.
      </p>
    );
  }

  return (
    <form action={updateOrganizationProfile} className="mt-4 border-t border-line pt-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-48 flex-1 flex-col gap-1">
          <span className="text-[11px] text-ink-faint">Nom de l&apos;entreprise</span>
          <input
            name="name"
            defaultValue={name}
            className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-ink-faint">Activité</span>
          <select
            name="business_type"
            value={selected}
            onChange={(e) => setSelected(e.target.value as BusinessType)}
            className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent"
          >
            {BUSINESS_TYPES.map((t) => (
              <option key={t} value={t}>{BUSINESS_TYPE_LABELS[t]}</option>
            ))}
          </select>
        </label>

        <button
          type="submit"
          className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink"
        >
          Enregistrer
        </button>
      </div>

      <p className="mt-3 text-xs text-ink-faint">
        L&apos;activité détermine les modules affichés dans le menu — une entreprise sans
        pépinière ne voit pas les écrans de pépinière.
        {changed && (
          <>
            {" "}
            <strong className="text-ink">
              Passer à « {BUSINESS_TYPE_LABELS[selected]} » va changer le menu.
            </strong>{" "}
            Aucune donnée n&apos;est perdue : les modules masqués gardent tout ce qu&apos;ils
            contiennent, et réapparaissent si vous revenez en arrière.
          </>
        )}
      </p>
    </form>
  );
}
