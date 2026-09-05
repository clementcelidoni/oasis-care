import type {
  LigneCalculee,
  MoyenEncaissement,
  MoyenReglement,
  RegimeTva,
  StatutEffectifFacture,
} from "./types.ts";

/**
 * ==================================================================
 * LIRE UNE FACTURE — fonctions pures
 * ==================================================================
 *
 * CE QUE CE FICHIER NE FERA JAMAIS : additionner des lignes. Le total
 * d'une facture est calculé par la base — `saas_invoice_totals`, TVA
 * groupée PAR TAUX avant arrondi — et refait ici il produirait un
 * second arrondi, donc un second montant, sur un document comptable.
 * Le correctif 0064 chiffre l'écart : quarante lignes à 1,67 € font
 * 13,20 € de TVA arrondie ligne à ligne et 13,36 € par taux. Ce ne sont
 * pas seize centimes qui sont graves, c'est qu'une facture qui ne fait
 * pas son propre total n'est plus un document.
 *
 * Ce fichier NOMME, il ne calcule pas.
 */

export const LIBELLES_STATUT_FACTURE: Record<StatutEffectifFacture, string> = {
  draft: "Brouillon",
  issued: "Émise",
  paid: "Payée",
  partiallyPaid: "Partiellement payée",
  partiallyPaidOverdue: "Partiellement payée, en retard",
  overdue: "En retard",
  cancelled: "Annulée",
  credited: "Créditée par avoir",
};

export const TONS_STATUT_FACTURE: Record<
  StatutEffectifFacture,
  "neutral" | "info" | "positive" | "warning" | "critical"
> = {
  draft: "neutral",
  issued: "info",
  paid: "positive",
  partiallyPaid: "warning",
  partiallyPaidOverdue: "critical",
  overdue: "critical",
  cancelled: "neutral",
  credited: "neutral",
};

/**
 * Ce que chaque statut veut dire, en une phrase.
 *
 * « En retard » mérite la sienne : ce statut n'est PAS stocké. Il se
 * déduit de l'échéance et de ce qui a été encaissé, à chaque lecture.
 * Un administrateur qui chercherait la colonne « en retard » ne la
 * trouverait pas, et croirait à un bug.
 */
export const EXPLICATIONS_STATUT_FACTURE: Record<StatutEffectifFacture, string> = {
  draft: "Aucun numéro, aucune valeur légale. Elle se modifie et s'annule sans laisser de trou.",
  issued: "Numérotée et opposable. Elle ne se modifie plus : une correction passe par un avoir.",
  paid: "Le solde est nul. Le statut suit l'argent encaissé, il ne se saisit pas.",
  partiallyPaid: "Un encaissement partiel a été enregistré ; il reste un solde.",
  partiallyPaidOverdue: "Un solde reste dû et l'échéance est passée.",
  overdue:
    "DÉDUIT de l'échéance, jamais saisi : aucune colonne « en retard » n'existe en base, et c'est voulu — un statut stocké serait faux dès le lendemain.",
  cancelled: "Brouillon annulé. Une facture émise, elle, garde son numéro et se corrige par avoir.",
  credited: "Neutralisée par un avoir. Elle garde son numéro : la séquence reste sans trou.",
};

export const LIBELLES_REGIME_TVA: Record<RegimeTva, string> = {
  france: "France — taux normal",
  euReverseCharge: "Union européenne — autoliquidation",
  outsideEu: "Hors Union européenne",
  unknown: "Inconnu",
};

/**
 * La mention obligatoire qui accompagne chaque régime.
 *
 * Recopiée de la règle, pas inventée : l'autoliquidation doit être
 * mentionnée sur le document, et une prestation hors champ aussi. Le
 * régime « inconnu » n'a pas de mention parce qu'il n'a pas de
 * facture : il BLOQUE l'émission.
 */
export const MENTIONS_REGIME: Record<RegimeTva, string | null> = {
  france: null,
  euReverseCharge: "Autoliquidation — TVA due par le preneur (art. 283-2 du CGI).",
  outsideEu: "Prestation de services hors champ de la TVA française.",
  unknown: null,
};

export const LIBELLES_MOYEN: Record<MoyenReglement, string> = {
  transfer: "Virement SEPA",
  provider: "Prestataire de paiement",
};

export const LIBELLES_MOYEN_ENCAISSEMENT: Record<MoyenEncaissement, string> = {
  transfer: "Virement SEPA",
  provider: "Prestataire de paiement",
  other: "Autre",
};

export const LIBELLES_NATURE_LIGNE: Record<string, string> = {
  plan: "Offre",
  seats: "Sièges",
  module: "Module",
  discount: "Remise",
  credit: "Crédit",
  other: "Autre",
};

/**
 * Ce qui EMPÊCHE d'émettre, rassemblé et dédoublonné.
 *
 * `saas_subscription_billing_lines()` ne lève jamais : elle rend des
 * lignes dont certaines portent un `blocking_reason`. C'est ce qui
 * permet de MONTRER la facture qu'on ne peut pas émettre, avec la
 * raison à côté de la ligne fautive — au lieu d'une erreur opaque qui
 * n'apprend pas quoi corriger.
 *
 * Le dédoublonnage compte : un régime de TVA inconnu marque TOUTES les
 * lignes, et répéter huit fois la même phrase la rend illisible.
 */
export function motifsBloquants(lignes: readonly LigneCalculee[]): string[] {
  const vus = new Set<string>();
  for (const ligne of lignes) {
    if (ligne.blocking_reason) vus.add(ligne.blocking_reason);
  }
  return [...vus];
}

/**
 * Le total HORS TAXES d'un CALCUL — pas d'une facture.
 *
 * La nuance est capitale et vaut son commentaire : ce que rend
 * `saas_subscription_billing_lines()` est une PRÉVISION, affichée avant
 * qu'aucune facture n'existe. Rien de comptable n'en dépend, aucun
 * arrondi de TVA n'y est fait, et le montant qui sera facturé restera
 * celui que la base calculera.
 *
 * Elle rend `null` dès qu'un motif bloque : un sous-total affiché sous
 * une liste dont une ligne est inconnue serait un chiffre faux qui a
 * l'air d'un chiffre.
 */
export function totalPrevisionnelHtCents(lignes: readonly LigneCalculee[]): number | null {
  if (lignes.length === 0) return null;
  if (lignes.some((l) => l.blocking_reason !== null)) return null;
  // Une ligne sans prix rend le total INCONNU. `unit_price_cents` est
  // nullable depuis 0081 précisément pour que ce cas existe : le
  // coalescer à zéro ici referait, en TypeScript, la faute que la
  // migration vient de corriger en SQL.
  if (lignes.some((l) => l.unit_price_cents === null)) return null;
  return lignes.reduce((somme, l) => somme + Math.round(l.quantity * (l.unit_price_cents ?? 0)), 0);
}

/**
 * Les bornes d'un mois civil, en dates ISO, pour la génération.
 *
 * `period_end` est EXCLUSIVE côté base — la contrainte est
 * `period_end > period_start` et les libellés de ligne écrivent
 * « du 01/01 au 31/01 », soit `period_end - 1`. Se tromper d'un jour
 * ici ferait facturer treize mois par an.
 */
export function moisCivil(annee: number, mois: number): { debut: string; fin: string } {
  const debut = new Date(Date.UTC(annee, mois - 1, 1));
  const fin = new Date(Date.UTC(mois === 12 ? annee + 1 : annee, mois === 12 ? 0 : mois, 1));
  return { debut: debut.toISOString().slice(0, 10), fin: fin.toISOString().slice(0, 10) };
}

/** Le libellé français d'un mois civil, pour l'écran de génération. */
export function libelleMois(annee: number, mois: number): string {
  return new Intl.DateTimeFormat("fr-FR", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(annee, mois - 1, 1)));
}

/**
 * Les douze derniers mois civils, du plus récent au plus ancien.
 *
 * Le mois EN COURS est proposé en premier et non exclu : on facture un
 * abonnement d'avance, donc le mois courant est le cas normal. Mais
 * rien n'empêche de rattraper un mois oublié — la génération est
 * idempotente, un index unique partiel l'y oblige.
 */
export function moisProposables(
  aujourdhui: Date = new Date(),
): { annee: number; mois: number; libelle: string }[] {
  const liste: { annee: number; mois: number; libelle: string }[] = [];
  let annee = aujourdhui.getUTCFullYear();
  let mois = aujourdhui.getUTCMonth() + 1;
  for (let index = 0; index < 12; index += 1) {
    liste.push({ annee, mois, libelle: libelleMois(annee, mois) });
    mois -= 1;
    if (mois === 0) {
      mois = 12;
      annee -= 1;
    }
  }
  return liste;
}
