"use client";

import { signIntervention } from "@/lib/field/actions";
import { formatDate } from "@/lib/crm/types";
import { formatTime, type Intervention } from "@/lib/field/types";

/**
 * §signature — l'accusé de passage.
 *
 * Un nom et un horodatage. PAS de tracé manuscrit : une signature
 * dessinée au doigt dans un navigateur n'a aucune valeur probante
 * particulière, et l'afficher comme une signature laisserait croire le
 * contraire à celui qui s'en servirait en cas de litige. L'écran dit
 * donc ce que c'est — la trace que quelqu'un était là et a constaté le
 * travail — et rien de plus.
 */
export function Signature({ intervention }: { intervention: Intervention }) {
  if (intervention.signed_at) {
    return (
      <section className="mb-8 rounded-lg border border-line bg-surface px-4 py-3">
        <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-faint">
          Réception
        </h2>
        <p className="text-sm">
          Constaté par <strong>{intervention.signed_by_name}</strong> le{" "}
          {formatDate(intervention.signed_at)} à {formatTime(intervention.signed_at)}.
        </p>
      </section>
    );
  }

  return (
    <section className="mb-8">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
        Réception
      </h2>
      <form
        action={signIntervention}
        className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface px-4 py-3"
      >
        <input type="hidden" name="intervention_id" value={intervention.id} />
        <input
          name="signed_by_name"
          required
          placeholder="Nom de la personne présente"
          className="min-w-48 flex-1 rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm outline-none placeholder:text-ink-faint focus:border-accent"
        />
        <button
          type="submit"
          className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink"
        >
          Enregistrer le passage
        </button>
        <p className="w-full text-[11px] text-ink-faint">
          Un nom et une date, horodatés par Oasis. Ce n&apos;est pas une signature
          électronique au sens légal et cela n&apos;en a pas la valeur : c&apos;est la
          trace qu&apos;une personne était présente et a constaté le travail.
        </p>
      </form>
    </section>
  );
}
