import { ButtonLink, EmptyState, PageHeader } from "@/components/ui";

import { explicationSocle, type EtatSocleAssistance } from "./socle.ts";

/**
 * L'écran qu'on voit quand la migration 0081 manque, ou quand le rôle
 * ne couvre pas la page.
 *
 * ÉCRIT UNE FOIS ET PARTAGÉ PAR LES QUATRE ÉCRANS DE L'ASSISTANCE.
 * Quatre pages qui expliqueraient la même chose avec quatre
 * formulations différentes feraient croire à quatre problèmes — et la
 * moitié d'entre elles finirait par afficher « une erreur est
 * survenue », qui n'apprend rien.
 *
 * Le ton est `unknown` et non `critical` : ce n'est pas une panne,
 * c'est un état connu et nommé. Le rouge est réservé à ce qui casse.
 */
export function EcranAssistanceFerme({
  etat,
  requise,
  eyebrow = "Assistance",
  titre,
  sousTitre,
}: {
  etat: Exclude<EtatSocleAssistance["etat"], "ok">;
  requise: string;
  eyebrow?: string;
  titre: string;
  sousTitre?: string;
}) {
  const { titre: entete, texte } = explicationSocle(etat, requise);

  return (
    <>
      <PageHeader eyebrow={eyebrow} title={titre} subtitle={sousTitre} />
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
