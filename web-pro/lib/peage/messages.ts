/**
 * §PÉAGE — DIRE NON EN FRANÇAIS.
 *
 * La base refuse par un code 42501 et une phrase en anglais qui nomme
 * une table et une politique. C'est exact, c'est utile dans un journal,
 * et c'est illisible pour un paysagiste. Ce fichier fait la traduction,
 * une fois, pour tout le monde.
 *
 * IL NE DÉCIDE RIEN. Il ne fait que reconnaître un refus déjà prononcé
 * par la base et lui donner des mots. La règle, elle, vit dans 0092 et
 * nulle part ailleurs.
 */

import type { EtatPeage, SituationPeage } from "./situation.ts";

/**
 * Le message d'un refus, selon l'état du contrat.
 *
 * TROIS PHRASES, ET CHACUNE DIT LA MÊME CHOSE EN PREMIER : vos données
 * sont là. C'est ce qu'un dirigeant a besoin d'entendre avant tout le
 * reste, parce que c'est ce qu'il craint.
 */
export function messagePeage(etat: EtatPeage, geste: "exploiter" | "grandir" = "exploiter"): string {
  if (etat === "transit") {
    return geste === "grandir"
      ? "Votre abonnement n'est pas encore souscrit : l'équipe s'ajoute une fois le contrat en place."
      : "Votre abonnement n'est pas encore souscrit. Tout ce que vous avez saisi est intact et vous le "
        + "gardez — il ne manque que le contrat pour reprendre le travail.";
  }

  if (etat === "sursis") {
    return "Votre dernier prélèvement n'a pas abouti. Vous continuez à travailler normalement, mais "
      + "l'ajout d'un collaborateur attend la régularisation.";
  }

  if (etat === "restreint") {
    return "Votre abonnement est arrivé à échéance. Vous gardez l'accès à tout ce que vous avez saisi — "
      + "clients, devis, factures — et vous pouvez l'exporter à tout moment. Reprenez votre abonnement "
      + "pour recommencer à créer.";
  }

  // « ouvert » : on ne devrait pas passer par ici. Si l'on y passe, le
  // refus vient d'ailleurs et il ne faut surtout pas l'attribuer à
  // l'abonnement — envoyer quelqu'un payer pour un droit qu'il a déjà
  // serait la pire des méprises.
  return "Cette action a été refusée. Votre abonnement, lui, est bien en cours.";
}

/**
 * CE REFUS EST-IL CELUI DU PÉAGE ?
 *
 * On reconnaît la politique par SON NOM, posé par 0092 et par personne
 * d'autre. Se fier au seul code 42501 attribuerait au péage tous les
 * refus de droits de la base — un ouvrier à qui l'on refuse une facture
 * s'entendrait dire d'aller payer un abonnement qui, lui, est en règle.
 */
export function estUnRefusDuPeage(erreur: unknown): boolean {
  const texte = messageBrut(erreur);
  return texte !== null && texte.includes("Péage — ");
}

function messageBrut(erreur: unknown): string | null {
  if (typeof erreur === "string") return erreur;
  if (erreur !== null && typeof erreur === "object" && "message" in erreur) {
    const message = (erreur as { message: unknown }).message;
    if (typeof message === "string") return message;
  }
  return null;
}

/**
 * LE POINT UNIQUE OÙ UN REFUS DE LA BASE DEVIENT UNE PHRASE.
 *
 * À appeler dans une action serveur avant de relever une erreur : si
 * c'est le péage, on rend la phrase française ; sinon on rend le
 * message d'origine, intact. On ne masque JAMAIS une vraie panne
 * derrière un message d'abonnement — ce serait envoyer le client
 * payer pour un bogue.
 *
 * `situation` est facultative : quand l'écran la connaît déjà, le
 * message peut nommer la facture. Sinon on retombe sur la formulation
 * générale, qui reste vraie.
 */
export function traduireRefus(erreur: unknown, situation?: SituationPeage | null): string {
  const brut = messageBrut(erreur) ?? "Une erreur est survenue.";
  if (!estUnRefusDuPeage(erreur)) return brut;

  const geste = brut.includes("organization_invitations")
      || brut.includes("organization_members")
      || brut.includes("workspace_members")
    ? "grandir" as const
    : "exploiter" as const;

  // SANS SITUATION CONNUE, ON NE DEVINE PAS L'ÉTAT. La plupart des
  // actions serveur n'ont pas lu `peage_situation` — ce serait un
  // aller-retour de plus sur chaque écriture du produit. On dit alors
  // une phrase qui est vraie dans les trois cas fermés, plutôt que d'en
  // choisir un au hasard : annoncer « votre abonnement est arrivé à
  // échéance » à quelqu'un qui n'en a jamais eu serait faux, et lui
  // ferait chercher une résiliation qui n'existe pas.
  if (!situation) return MESSAGE_NEUTRE[geste];

  const base = messagePeage(situation.etat, geste);
  const precision = precisionCreance(situation);
  return precision === null ? base : `${base} ${precision}`;
}

const MESSAGE_NEUTRE = {
  exploiter:
    "Cette action demande un abonnement en cours. Tout ce que vous avez saisi est intact et vous le "
    + "gardez : ouvrez Entreprise › Abonnement pour voir où vous en êtes et reprendre.",
  grandir:
    "L'ajout d'un collaborateur demande un abonnement à jour. Ouvrez Entreprise › Abonnement pour voir "
    + "où vous en êtes ; rien d'autre n'est bloqué.",
} as const;

/**
 * « Votre facture du 3 mars, 167,88 €, n'a pas encore été réglée. »
 *
 * Nommer le document change tout : c'est vérifiable, ça se retrouve
 * dans une boîte aux lettres, et ça ne ressemble pas à une décision
 * arbitraire de notre part.
 */
export function precisionCreance(situation: SituationPeage | null | undefined): string | null {
  if (!situation || situation.impayeDepuis === null || situation.facturesEchues === 0) return null;

  const combien = situation.facturesEchues === 1
    ? "Une facture"
    : `${situation.facturesEchues} factures`;

  const montant = situation.montantDuCents > 0
    ? ` (${enEuros(situation.montantDuCents)})`
    : "";

  return `${combien}${montant} attend son règlement depuis le ${enDateFrancaise(situation.impayeDepuis)}.`;
}

export function enEuros(centimes: number): string {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" })
    .format(centimes / 100);
}

export function enDateFrancaise(iso: string): string {
  // On découpe plutôt que de construire une Date : « 2026-03-03 » sans
  // heure est interprété en UTC, et un serveur à Paris afficherait
  // parfois la veille. Une date d'échéance qui recule d'un jour dans un
  // message de relance est exactement ce qu'on ne veut pas.
  const [annee, mois, jour] = iso.slice(0, 10).split("-");
  const MOIS = [
    "janvier", "février", "mars", "avril", "mai", "juin",
    "juillet", "août", "septembre", "octobre", "novembre", "décembre",
  ];
  const nom = MOIS[Number(mois) - 1];
  if (nom === undefined || jour === undefined) return iso.slice(0, 10);
  return `${Number(jour)} ${nom} ${annee}`;
}
