"use client";

import { useState } from "react";
import { Modal, Field, SubmitButton } from "@/components/ui";
import { addDeadline } from "@/lib/equipment/actions";
import {
  DEADLINE_KINDS, DEADLINE_KIND_LABELS,
  DEADLINE_REMINDER_DEFAULT, DEADLINE_RECURRENCE_DEFAULT,
  type DeadlineKind,
} from "@/lib/equipment/types";

/**
 * Poser une échéance sur un matériel.
 *
 * POURQUOI CE FORMULAIRE EST CLIENT alors que le reste de l'écran est
 * serveur : le préavis et la périodicité n'ont pas la même valeur
 * raisonnable selon la nature de l'échéance. Trente jours pour un
 * contrôle technique — le temps de prendre rendez-vous ;
 * quatre-vingt-dix pour une fin de crédit-bail, qui se renégocie ; six
 * mois de périodicité pour la vérification d'un appareil de levage,
 * douze pour un contrôle technique d'utilitaire.
 *
 * Un formulaire figé sur « 30 jours, aucune périodicité » obligerait à
 * corriger deux champs à chaque saisie. Personne ne le ferait : les
 * échéances seraient toutes ponctuelles, et le parc se retrouverait
 * sans aucun contrôle à venir dès le premier honoré — c'est-à-dire un
 * parc qui a l'air en règle.
 *
 * Les deux champs sont remontés (`key`) quand la nature change, donc
 * repartent de la proposition correspondante. C'est voulu : passer de
 * « révision » à « fin de contrat » change ce qu'on décrit, pas
 * seulement son étiquette.
 */
export function DeadlineForm({ equipmentId }: { equipmentId: string }) {
  const [kind, setKind] = useState<DeadlineKind>("technicalInspection");
  const recurrence = DEADLINE_RECURRENCE_DEFAULT[kind];

  return (
    <Modal
      triggerLabel="Ajouter une échéance"
      triggerVariant="secondary"
      title="Nouvelle échéance"
      description="Contrôle technique, assurance, révision, vérification réglementaire, fin de contrat."
      width="32rem"
    >
      <form action={addDeadline} className="flex flex-col gap-4">
        <input type="hidden" name="equipment_id" value={equipmentId} />

        <div className="grid gap-4 sm:grid-cols-2">
          {/* Écrit à la main plutôt qu'avec `SelectField` : celui-ci
              n'expose pas d'`onChange`, et le lui ajouter modifierait un
              composant partagé par quatre-vingt-treize écrans pour le
              besoin d'un seul. */}
          <label className="flex flex-col gap-1.5">
            <span className="text-[var(--text-secondary)] font-medium text-ink-soft">Nature</span>
            <select
              name="kind"
              value={kind}
              onChange={(event) => setKind(event.target.value as DeadlineKind)}
              className="w-full rounded-[var(--radius-control)] border border-line-strong bg-surface px-3 py-2 text-[var(--text-body)] outline-none focus:border-accent"
            >
              {DEADLINE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {DEADLINE_KIND_LABELS[k]}
                </option>
              ))}
            </select>
            <span className="text-[var(--text-secondary)] text-ink-faint">
              Elle fixe le préavis et la périodicité proposés.
            </span>
          </label>

          <Field
            label="Échéance"
            name="due_on"
            type="date"
            required
            hint="La date à laquelle elle expire."
          />
          <Field
            label="Précision"
            name="label"
            placeholder="Contrôle technique poids lourd"
            hint="Facultative. Elle remplace la nature à l'écran."
          />
          <Field
            key={`preavis-${kind}`}
            label="Préavis (jours)"
            name="reminder_days"
            type="number"
            defaultValue={DEADLINE_REMINDER_DEFAULT[kind]}
            hint="Combien de jours avant elle doit remonter. 0 = le jour même, et c'est une consigne valable."
          />
          <Field
            key={`periode-${kind}`}
            label="Périodicité (mois)"
            name="recurrence_months"
            type="number"
            defaultValue={recurrence ?? ""}
            hint={
              recurrence
                ? "Une fois honorée, la suivante se pose toute seule."
                : "Vide = ponctuelle. Une fin de garantie ne se renouvelle pas."
            }
          />
        </div>

        <div className="flex justify-end">
          <SubmitButton>Poser l&apos;échéance</SubmitButton>
        </div>
      </form>
    </Modal>
  );
}
