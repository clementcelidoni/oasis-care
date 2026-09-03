import type { ReactNode } from "react";

import { Badge, UnknownValue } from "@/components/ui";
import { gapTone, type Gap } from "@/lib/customers/gaps";

/**
 * Les deux façons de poser une information sur une fiche.
 *
 * `FactList` pour ce qu'on sait, `GapList` pour ce qu'on ne sait pas.
 * Ce sont deux composants distincts, et non un seul avec un drapeau,
 * parce qu'ils ne répondent pas à la même question : l'un décrit un
 * compte, l'autre décrit l'état de la PLATEFORME qui l'observe.
 */

export type Fact = {
  label: string;
  /** `null` déclenche l'INCONNU. Ne jamais y mettre 0, « — » ni chaîne vide. */
  value: ReactNode | null;
  /** Pourquoi c'est inconnu. Sans motif, l'inconnu n'est qu'une excuse. */
  unknownReason?: string;
  /** Une précision sous la valeur : l'unité, la borne, la réserve. */
  hint?: string;
};

/**
 * Une liste de faits, en `<dl>`.
 *
 * Le `<dl>` n'est pas un choix esthétique : un lecteur d'écran annonce
 * « Date de création, 16 août 2026 » comme une paire, là où deux `<div>`
 * lui donneraient deux fragments sans lien. Une console
 * d'administration se lit aussi à l'oreille.
 */
export function FactList({ facts }: { facts: Fact[] }) {
  return (
    <dl className="divide-y divide-line">
      {facts.map((fact) => (
        <div
          key={fact.label}
          className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-4 py-2.5"
        >
          <dt className="eyebrow min-w-48 shrink-0">{fact.label}</dt>
          <dd className="min-w-0 flex-1">
            {fact.value === null ? (
              <UnknownValue reason={fact.unknownReason} />
            ) : (
              <span className="text-[var(--text-body)] text-ink">{fact.value}</span>
            )}
            {fact.hint && (
              <p className="mt-0.5 text-[var(--text-secondary)] leading-snug text-ink-faint">
                {fact.hint}
              </p>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Ce que la spec demande et que la plateforme ne sait pas dire.
 *
 * La cause est affichée en toutes lettres à côté de chaque ligne. Elle
 * porte l'information la plus utile de ce bloc : « absente » veut dire
 * qu'il faut modifier le produit et attendre que les données
 * s'accumulent, sans rien de rétroactif ; « non exposée » veut dire
 * qu'une migration suffit et que tout l'historique arrive avec elle.
 * Ce sont deux devis très différents, et les mélanger ferait chiffrer
 * ce chapitre de travers.
 */
export function GapList({ gaps }: { gaps: Gap[] }) {
  return (
    <ul className="divide-y divide-line">
      {gaps.map((gap) => (
        <li key={gap.label} className="px-4 py-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[var(--text-body)] font-medium text-ink-soft">{gap.label}</span>
            <Badge tone={gapTone(gap.cause)}>{gap.cause}</Badge>
          </div>
          <p className="mt-1 max-w-prose text-[var(--text-secondary)] leading-relaxed text-ink-faint">
            {gap.reason}
          </p>
        </li>
      ))}
    </ul>
  );
}
