"use client";

import { useState } from "react";

import { PLATFORM_ROLES, ROLE_LABELS, ROLE_SCOPE } from "@/lib/auth/roles";

/**
 * Les trois briques que les deux formulaires de cette page partagent.
 *
 * Elles vivent dans leur propre fichier plutôt que dans l'un des deux :
 * un composant client qui importerait l'autre pour une constante ferait
 * dépendre le formulaire d'invitation du tableau de l'équipe, deux
 * choses qui n'ont aucune raison de bouger ensemble.
 */

export const CHAMP =
  "w-full rounded-[var(--radius-control)] border border-line-strong bg-surface-sunken px-3 py-1.5 text-[var(--text-body)] text-ink outline-none placeholder:text-ink-faint focus:border-accent disabled:opacity-60";

export function Message({ etat }: { etat: { statut: string; message: string | null } }) {
  if (etat.statut === "vierge" || etat.message === null) return null;
  return (
    <p
      role="status"
      className={`max-w-2xl text-[var(--text-secondary)] leading-snug ${
        etat.statut === "erreur" ? "text-critical" : "text-positive"
      }`}
    >
      {etat.message}
    </p>
  );
}

/**
 * Le choix d'un rôle, AVEC CE QU'IL OUVRE ÉCRIT DESSOUS, et mis à jour à
 * chaque changement de sélection.
 *
 * C'est la demande explicite du cadrage : « Quelqu'un qui nomme un
 * billing_admin doit savoir ce qu'il ouvre. » Une infobulle ne suffirait
 * pas — une explication qu'il faut survoler pour lire n'est pas lue, et
 * celle-ci est la moitié de la décision.
 */
export function ChoixRole({
  nom = "role",
  defaut,
  exclure,
}: {
  nom?: string;
  defaut: string;
  /** Le rôle actuel : on ne propose pas de « changer » vers lui-même. */
  exclure?: string;
}) {
  const [choisi, setChoisi] = useState(defaut);
  const options = PLATFORM_ROLES.filter((role) => role !== exclure);

  return (
    <div className="flex flex-col gap-1.5">
      <label className="flex flex-col gap-1.5">
        <span className="text-[var(--text-secondary)] font-medium text-ink-soft">
          Rôle <span className="text-critical">*</span>
        </span>
        <select
          name={nom}
          value={choisi}
          onChange={(evenement) => setChoisi(evenement.target.value)}
          className={CHAMP}
        >
          {options.map((role) => (
            <option key={role} value={role}>
              {ROLE_LABELS[role]}
            </option>
          ))}
        </select>
      </label>
      <p className="max-w-2xl text-[var(--text-secondary)] leading-relaxed text-ink-faint">
        {ROLE_SCOPE[choisi as keyof typeof ROLE_SCOPE] ?? "Rôle inconnu de cette interface."}
      </p>
    </div>
  );
}
