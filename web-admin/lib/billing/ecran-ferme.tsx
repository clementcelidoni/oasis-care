import { ButtonLink, EmptyState, PageHeader } from "@/components/ui";

import { explicationSocle, type EtatSocleCommercial } from "./socle.ts";

/**
 * L'écran qu'on voit quand la migration 0081 manque, ou quand le rôle
 * ne couvre pas la page.
 *
 * ÉCRIT UNE FOIS ET PARTAGÉ PAR LES CINQ ÉCRANS DU LOT. Cinq pages qui
 * expliqueraient la même chose avec cinq formulations différentes
 * feraient croire à cinq problèmes — et la moitié d'entre elles
 * finirait par afficher « une erreur est survenue », qui n'apprend rien.
 *
 * Le ton est `unknown` et non `critical` : ce n'est pas une panne, c'est
 * un état connu et nommé. Le rouge est réservé à ce qui casse.
 */
export function EcranCommercialFerme({
  etat,
  requise,
  titre,
  sousTitre,
}: {
  etat: Exclude<EtatSocleCommercial["etat"], "ok">;
  requise: string;
  titre: string;
  sousTitre?: string;
}) {
  const { titre: entete, texte } = explicationSocle(etat, requise);

  return (
    <>
      <PageHeader eyebrow="Commercial" title={titre} subtitle={sousTitre} />
      <EmptyState
        tone="unknown"
        title={entete}
        description={texte}
        action={<ButtonLink href="/" variant="secondary">Retour au tableau de bord</ButtonLink>}
      />
    </>
  );
}
