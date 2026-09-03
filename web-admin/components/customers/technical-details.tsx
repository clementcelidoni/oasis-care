import type { ReactNode } from "react";

import { TechnicalId } from "@/components/ui";

/**
 * ==================================================================
 * « AFFICHER DÉTAILS TECHNIQUES » — spec p.35
 * ==================================================================
 *
 * « Les IDs techniques ne doivent apparaître que dans Technical details
 * ou via : Afficher détails techniques. »
 *
 * La raison est de lisibilité, et elle se vérifie à l'œil : un uuid fait
 * trente-six caractères sans forme reconnaissable. Trois d'entre eux
 * dans une fiche, et l'œil ne trouve plus le nom du client.
 *
 * ------------------------------------------------------------------
 * `<details>` NATIF, PAS UN `useState`
 * ------------------------------------------------------------------
 * Ce composant reste un composant SERVEUR. Un accordéon en React
 * exigerait `"use client"`, donc du JavaScript envoyé au navigateur
 * pour ouvrir un bloc de texte — et surtout, dans cette application, il
 * ferait passer les identifiants par le bundle client. `<details>` fait
 * exactement le même travail, sans une ligne de script, avec le clavier
 * et les lecteurs d'écran gérés par le navigateur.
 *
 * Il y a un bénéfice qu'on n'attendait pas : Ctrl+F du navigateur
 * trouve le contenu d'un `<details>` fermé sur les moteurs modernes, et
 * l'ouvre. Un administrateur qui cherche un uuid dans la page le trouve
 * donc sans avoir à déplier quoi que ce soit.
 */
export function TechnicalDetails({
  entries,
  children,
}: {
  /** Les identifiants, dans l'ordre où ils sont utiles. */
  entries: { label: string; value: string }[];
  /** De quoi ajouter une note sous les identifiants. */
  children?: ReactNode;
}) {
  return (
    <details className="rounded-[var(--radius-card)] border border-line bg-surface">
      {/* `list-none` retire la puce sur les navigateurs modernes ; la
          variante `::-webkit-details-marker` s'occupe de Safari, qui
          garde son triangle malgré `list-style`. Sans les deux, on voit
          deux flèches côte à côte. */}
      <summary className="cursor-pointer list-none px-4 py-2.5 text-[var(--text-secondary)] text-ink-soft transition-colors hover:text-ink [&::-webkit-details-marker]:hidden">
        <span aria-hidden className="mr-1.5 inline-block">
          ▸
        </span>
        Afficher détails techniques
      </summary>

      <div className="border-t border-line px-4 py-3">
        <dl className="flex flex-col gap-2">
          {entries.map((entry) => (
            <div key={entry.label} className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <dt className="eyebrow min-w-40">{entry.label}</dt>
              <dd className="min-w-0 break-all">
                <TechnicalId id={entry.value} />
              </dd>
            </div>
          ))}
        </dl>
        {children && (
          <div className="mt-3 text-[var(--text-secondary)] leading-relaxed text-ink-faint">
            {children}
          </div>
        )}
      </div>
    </details>
  );
}
