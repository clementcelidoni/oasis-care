import type {
  CycleFacturation,
  FournisseurAbonnement,
  LigneAbonnement,
  LigneRemise,
  StatutAbonnement,
} from "./types.ts";

/**
 * ==================================================================
 * LIRE UN ABONNEMENT — fonctions pures
 * ==================================================================
 *
 * Le sujet de ce fichier tient en une distinction que l'écran doit
 * rendre visible et que la base rend déjà : ANNULER À L'ÉCHÉANCE n'est
 * pas ANNULER. Le premier laisse le client jouir de la période qu'il a
 * payée ; le second lui coupe le service. Les confondre fait rembourser
 * à tort, ou facturer un service retiré.
 *
 * `organization_subscriptions.status` ne dit PAS lequel des deux : il
 * vaut encore 'active' pendant qu'une annulation à l'échéance court.
 * C'est `cancel_at_period_end` qui porte l'information, et
 * `cancelled_at` date la DÉCISION, pas la fin du service. Un écran qui
 * lirait le seul `status` annoncerait « actif » à un client qui part.
 */

export const LIBELLES_STATUT: Record<StatutAbonnement, string> = {
  trialing: "En essai",
  active: "Actif",
  pastDue: "Impayé",
  cancelled: "Annulé",
};

export const TONS_STATUT: Record<
  StatutAbonnement,
  "positive" | "info" | "warning" | "critical" | "neutral"
> = {
  trialing: "info",
  active: "positive",
  pastDue: "critical",
  cancelled: "neutral",
};

export const LIBELLES_CYCLE: Record<CycleFacturation, string> = {
  monthly: "Mensuel",
  yearly: "Annuel",
};

/**
 * Ce que dit le champ `provider`, et il faut le dire en toutes lettres.
 *
 * 'manual' n'est pas un détail technique : c'est l'aveu qu'un
 * administrateur a saisi cette ligne à la main parce qu'aucun
 * encaissement n'est branché. L'afficher comme « Manuel » tout court
 * laisserait croire à un choix de configuration.
 */
export const LIBELLES_FOURNISSEUR: Record<FournisseurAbonnement, string> = {
  none: "Aucun",
  web: "Web (prestataire)",
  apple: "Apple",
  manual: "Saisi à la main",
};

/**
 * L'état RÉEL d'un abonnement, celui que le statut seul ne dit pas.
 *
 * Cinq états, et le troisième est celui qui n'existe nulle part en
 * base : « actif, mais il part à l'échéance ».
 */
export type EtatAbonnement =
  | { etat: "essai"; finLe: string | null; expire: boolean }
  | { etat: "actif" }
  | { etat: "partALEcheance"; finLe: string | null; decideLe: string | null }
  | { etat: "impaye" }
  | { etat: "annule"; le: string | null };

export function etatAbonnement(
  abonnement: LigneAbonnement,
  maintenant: Date = new Date(),
): EtatAbonnement {
  if (abonnement.status === "cancelled") {
    return { etat: "annule", le: abonnement.cancelled_at };
  }

  // L'annulation à l'échéance PRIME sur « actif » et sur « en essai » :
  // c'est l'information la plus décisive de la fiche, et celle qu'un
  // administrateur cherche quand il ouvre l'écran.
  if (abonnement.cancel_at_period_end) {
    return {
      etat: "partALEcheance",
      finLe: abonnement.current_period_end,
      decideLe: abonnement.cancelled_at,
    };
  }

  if (abonnement.status === "pastDue") return { etat: "impaye" };

  if (abonnement.status === "trialing") {
    const fin = abonnement.trial_ends_at;
    return {
      etat: "essai",
      finLe: fin,
      // Un essai dont la date est passée reste 'trialing' en base :
      // rien ne le fait basculer, aucun planificateur ne tourne. L'écran
      // doit donc le dire, sans quoi « en essai » se lit « tout va
      // bien » sur un compte qui n'est plus rien.
      expire: fin !== null && new Date(fin).getTime() < maintenant.getTime(),
    };
  }

  return { etat: "actif" };
}

/**
 * Le prix contractuel d'un abonnement, tel qu'il sera facturé.
 *
 * ATTENTION À CE QUE CETTE FONCTION N'EST PAS : ce n'est pas le montant
 * d'une facture. Elle ne connaît ni les modules souscrits, ni les
 * sièges, ni les crédits, et elle ne doit jamais servir à faire un
 * total. Le total d'une facture est calculé par la BASE
 * (`saas_subscription_billing_lines`, puis `saas_invoice_totals`), et
 * un second calcul dans le navigateur produirait un second arrondi,
 * donc un second montant, sur un document comptable.
 *
 * Elle sert à UNE chose : afficher « ce client paie tant par mois »
 * sur une fiche, avec la mention de la remise quand il y en a une.
 */
export type PrixContractuel =
  | { etat: "prix"; cents: number; remise: null }
  | { etat: "prix"; cents: number; remise: { label: string; finLe: string } }
  | { etat: "inconnu"; raison: string };

export function prixContractuel(
  abonnement: LigneAbonnement,
  prixDeLOffre: number | null,
  offreSurDevis: boolean,
  remiseEnCours: LigneRemise | null,
): PrixContractuel {
  const annuel = abonnement.billing_cycle === "yearly";

  const base = offreSurDevis
    ? annuel
      ? abonnement.negotiated_yearly_price_cents
      : abonnement.negotiated_monthly_price_cents
    : prixDeLOffre;

  if (base === null) {
    return {
      etat: "inconnu",
      raison: offreSurDevis
        ? `Offre sur devis sans prix ${annuel ? "annuel" : "mensuel"} négocié sur cet abonnement.`
        : `L'offre n'a pas de prix ${annuel ? "annuel" : "mensuel"} dans la grille.`,
    };
  }

  if (remiseEnCours === null) return { etat: "prix", cents: base, remise: null };

  const applique = appliquerRemise(base, remiseEnCours, annuel);
  if (applique === null) {
    return {
      etat: "inconnu",
      raison:
        `La remise « ${remiseEnCours.label} » est libellée en prix MENSUEL et cet abonnement est ANNUEL : ` +
        "son équivalent annuel n'a pas été décidé. La base refuse de le deviner, et cet écran aussi.",
    };
  }

  return {
    etat: "prix",
    cents: applique,
    remise: { label: remiseEnCours.label, finLe: remiseEnCours.ends_on },
  };
}

/**
 * Le prix après remise, ou `null` quand le cas n'est pas décidable.
 *
 * LE CAS INDÉCIDABLE EST RÉEL ET IL EST LE TARIF FONDATEUR : « 29,90 €
 * par mois pendant douze mois » posé sur un abonnement ANNUEL. Vaut-il
 * douze fois ce prix, ou dix comme les offres annuelles de la grille ?
 * Personne ne l'a dit. La base rend une ligne bloquante plutôt que de
 * choisir ; cette fonction rend `null` pour la même raison, et les deux
 * doivent rester d'accord.
 */
export function appliquerRemise(
  baseCents: number,
  remise: LigneRemise,
  cycleAnnuel: boolean,
): number | null {
  switch (remise.kind) {
    case "fixedMonthlyPrice":
      if (cycleAnnuel) return null;
      if (remise.value_cents === null) return null;
      // Un « prix imposé » ne peut pas AUGMENTER la facture : la base
      // calcule la remise comme `greatest(base - valeur, 0)`, ce qui
      // revient exactement à `min(base, valeur)` une fois soustraite.
      // Les deux formulations doivent rendre le même centime.
      return Math.min(remise.value_cents, baseCents);
    case "percentOff":
      if (remise.percent === null) return null;
      return baseCents - Math.round((baseCents * remise.percent) / 100);
    case "amountOff":
      if (remise.value_cents === null) return null;
      return Math.max(baseCents - remise.value_cents, 0);
  }
}

/**
 * La remise en vigueur AUJOURD'HUI, s'il y en a une.
 *
 * Ni celle qui s'est terminée hier, ni celle qui commence demain :
 * `[starts_on, ends_on)`, exactement comme le `daterange` de la base.
 * Une remise affichée un jour trop tôt fait annoncer un prix que le
 * client ne paiera pas encore.
 */
export function remiseEnCours(
  remises: readonly LigneRemise[],
  jour: Date = new Date(),
): LigneRemise | null {
  const aujourdhui = jour.toISOString().slice(0, 10);
  const candidates = remises.filter(
    (r) => r.cancelled_at === null && r.starts_on <= aujourdhui && r.ends_on > aujourdhui,
  );
  if (candidates.length === 0) return null;
  // La base interdit le chevauchement ; s'il y en avait un malgré tout,
  // on prend la plus récente plutôt que la première venue.
  return candidates.reduce((a, b) => (a.starts_on >= b.starts_on ? a : b));
}

/** Combien de jours reste-t-il à une remise ? `null` si aucune date lisible. */
export function joursRestants(dateIso: string | null, jour: Date = new Date()): number | null {
  if (!dateIso) return null;
  const fin = new Date(dateIso);
  if (Number.isNaN(fin.getTime())) return null;
  const jourMs = 24 * 60 * 60 * 1000;
  return Math.ceil((fin.getTime() - jour.getTime()) / jourMs);
}

/**
 * Les libellés des événements d'abonnement, tels que 0081 les écrit.
 *
 * Une valeur inconnue est rendue TELLE QUELLE et non « autre » : le
 * jour où une migration ajoute un événement, l'historique doit rester
 * lisible avant que ce fichier ne soit mis à jour.
 */
const LIBELLES_EVENEMENT: Record<string, string> = {
  created: "Abonnement créé",
  planChanged: "Changement d'offre",
  trialExtended: "Essai prolongé",
  creditGranted: "Crédit accordé",
  moduleActivated: "Module activé",
  moduleDeactivated: "Module retiré",
  cancelledAtPeriodEnd: "Annulation à l'échéance",
  reactivated: "Réactivé",
  discountApplied: "Remise appliquée",
};

export function libelleEvenement(evenement: string): string {
  return LIBELLES_EVENEMENT[evenement] ?? evenement;
}
