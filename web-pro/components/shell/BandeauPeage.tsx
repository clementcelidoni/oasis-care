import Link from "next/link";

import { precisionCreance } from "@/lib/peage/messages";
import type { SituationPeage } from "@/lib/peage/situation";

/**
 * §PÉAGE — LE BANDEAU QUI ÉVITE QU'UN REFUS RESSEMBLE À UNE PANNE.
 *
 * ══════════════════════════════════════════════════════════════════
 * POURQUOI IL EXISTE
 * ══════════════════════════════════════════════════════════════════
 *
 * La barrière vit dans la base (migration 0092) et elle est muette :
 * elle refuse une insertion, point. Sans ce bandeau, la première chose
 * qu'un paysagiste apprend de son impayé, c'est un bouton
 * « Enregistrer » qui ne marche pas. Il croira à un bogue, il
 * réessaiera, il perdra sa saisie, et il appellera pour se plaindre du
 * logiciel — pas pour payer.
 *
 * Le bandeau dit la chose AVANT le clic, avec ce qui la rend
 * vérifiable : la date de la facture et son montant. « Une facture
 * (167,88 €) attend son règlement depuis le 3 mars » se vérifie dans
 * une boîte aux lettres ; « erreur 42501 » ne se vérifie nulle part.
 *
 * ══════════════════════════════════════════════════════════════════
 * CE QU'IL NE FAIT PAS
 * ══════════════════════════════════════════════════════════════════
 *
 * IL NE BLOQUE RIEN. Ce n'est pas un mur, c'est une ligne. La décision
 * appartient à la base et à elle seule ; un second juge à l'écran
 * finirait par diverger, et le pire des deux mondes serait un écran qui
 * ferme alors que la base laisse passer.
 *
 * IL NE S'AFFICHE PAS EN « ouvert ». Un bandeau permanent devient un
 * meuble : on cesse de le lire, et le jour où il dit quelque chose
 * d'important, personne ne le voit.
 */
export function BandeauPeage({ situation }: { situation: SituationPeage }) {
  if (situation.etat === "ouvert") return null;

  const precision = precisionCreance(situation);

  // LES JETONS DU PRODUIT, ET PAS UNE COULEUR INVENTÉE : « critical »
  // pour ce qui est arrêté, le lavis d'accent pour ce qui ne l'est pas
  // encore. Le plus grave n'est pas forcément le plus rouge — un
  // bandeau rouge sur un client neuf en transit le gronderait alors
  // qu'on l'accueille.
  const ton = situation.etat === "restreint"
    ? "border-b border-critical bg-critical-wash"
    : "border-b border-line bg-accent-wash";

  return (
    // `print:hidden` : un devis imprimé n'a pas à porter nos relances.
    <div className={`flex flex-wrap items-center justify-between gap-3 px-8 py-2.5 print:hidden ${ton}`}>
      <p className="min-w-56 flex-1 text-[var(--text-secondary)] text-ink-soft">
        <span className="font-medium text-ink">{titre(situation)}</span>{" "}
        {corps(situation)}
        {precision !== null && <> {precision}</>}
      </p>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <Link
          href={destination(situation)}
          className="inline-flex items-center rounded-[var(--radius-control)] bg-accent px-3 py-1.5 text-[var(--text-secondary)] font-medium text-accent-ink hover:bg-accent-hover"
        >
          {libelleBouton(situation)}
        </Link>
      </div>
    </div>
  );
}

function titre(situation: SituationPeage): string {
  if (situation.etat === "transit") return "Il vous manque un abonnement.";
  if (situation.etat === "sursis") return "Un règlement nous manque.";
  return "Votre abonnement est arrivé à échéance.";
}

function corps(situation: SituationPeage): string {
  if (situation.etat === "transit") {
    return "Vous pouvez tout consulter et tout exporter, mais la création de clients, de devis et de "
      + "factures attend le contrat.";
  }

  if (situation.etat === "sursis") {
    const jours = situation.joursDeSursisRestants;
    const delai = jours === null
      ? "Vous continuez à travailler normalement le temps de régulariser."
      : jours <= 1
        ? "Vous continuez à travailler aujourd'hui encore ; demain, la création s'arrêtera."
        : `Vous continuez à travailler normalement pendant ${jours} jours.`;
    return `${delai} L'ajout d'un collaborateur, lui, attend déjà la régularisation.`;
  }

  return "Vos données sont intactes : vous les consultez et les exportez comme avant. Seule la création "
    + "de nouveaux documents s'arrête, le temps de reprendre l'abonnement.";
}

function destination(situation: SituationPeage): string {
  // EN TRANSIT, ON VA À LA CAISSE, PAS À L'ÉCRAN D'ABONNEMENT : il n'y
  // a rien à y voir tant qu'aucun contrat n'existe. Dans les deux
  // autres cas c'est l'inverse — il faut d'abord VOIR la facture.
  return situation.etat === "transit" ? "/inscription?etape=offre" : "/entreprise/abonnement";
}

function libelleBouton(situation: SituationPeage): string {
  if (situation.etat === "transit") return "Choisir mon offre";
  if (situation.etat === "sursis") return "Voir ce que je dois";
  return "Reprendre mon abonnement";
}
