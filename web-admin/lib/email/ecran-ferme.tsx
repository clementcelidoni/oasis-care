import { ButtonLink, EmptyState, PageHeader } from "@/components/ui";

import { explicationSocle, type EtatSocleCourrier } from "./socle.ts";
import type { PermissionCourrier } from "./permissions.ts";

/**
 * L'écran qu'on voit quand la migration 0084 manque, ou quand le rôle
 * ne couvre pas la page.
 *
 * ÉCRIT UNE FOIS ET PARTAGÉ PAR LES CINQ ÉCRANS DU LOT. Le ton est
 * `unknown` et non `critical` : ce n'est pas une panne, c'est un état
 * connu et nommé. Le rouge est réservé à ce qui casse.
 */
export function EcranCourrierFerme({
  etat,
  requise,
  titre,
  sousTitre,
}: {
  etat: Exclude<EtatSocleCourrier["etat"], "ok">;
  requise: PermissionCourrier;
  titre: string;
  sousTitre?: string;
}) {
  const { titre: entete, texte } = explicationSocle(etat, requise);

  return (
    <>
      <PageHeader eyebrow="Courrier" title={titre} subtitle={sousTitre} />
      <EmptyState
        tone="unknown"
        title={entete}
        description={texte}
        action={
          <ButtonLink href="/" variant="secondary">
            Retour au tableau de bord
          </ButtonLink>
        }
      />
    </>
  );
}
