/**
 * §CYCLE DE VIE — L'ESSAI, LA DATE DU PREMIER PRÉLÈVEMENT, ET
 * L'ENGAGEMENT QUI NE COMMENCE PAS AVANT.
 *
 * ══════════════════════════════════════════════════════════════════
 * LA DÉCISION DU DIRIGEANT, ET L'AMBIGUÏTÉ QU'ELLE PORTE
 * ══════════════════════════════════════════════════════════════════
 *
 * « Prélevé tous les mois, s'il s'abonne il paie le premier mois direct.
 * Essai gratuit un mois avec carte obligatoirement. »
 *
 * CES DEUX PHRASES NE PEUVENT PAS ÊTRE VRAIES POUR LE MÊME CLIENT, et
 * il faut le dire plutôt que de choisir en silence : « il paie le
 * premier mois direct » et « un mois gratuit » se contredisent.
 *
 * LA LECTURE RETENUE, la même que celle écrite dans la migration 0089 :
 *
 *   • un NOUVEAU client entre PAR L'ESSAI — un mois, carte enregistrée,
 *     rien de débité ;
 *   • au terme de l'essai, PREMIER PRÉLÈVEMENT, puis tous les mois à
 *     date anniversaire ;
 *   • celui qui RENONCE à l'essai paie le jour même.
 *
 * Aucun client ne paie donc à la fois « le premier mois direct » et
 * « un mois gratuit ». La lecture inverse — pas d'essai du tout — se
 * règle en n'offrant plus le choix à l'écran ; elle ne demande pas une
 * ligne de code de plus.
 *
 * ══════════════════════════════════════════════════════════════════
 * POURQUOI CE FICHIER EST PUR, ET POURQUOI IL REFAIT UN CALCUL DE LA
 * BASE
 * ══════════════════════════════════════════════════════════════════
 *
 * Il ne touche ni la base ni le réseau : il se teste sans les deux, et
 * c'est ce qui permet de PROUVER que le 31 janvier ne devient pas le
 * 3 mars.
 *
 * Il refait, en TypeScript, le calcul de `saas_date_anniversaire()`
 * (migration 0089 § 1). Une duplication est un risque de divergence, et
 * il faut donc dire pourquoi elle est ici assumée : L'ÉCRAN DOIT
 * ANNONCER LA DATE AVANT QUE QUOI QUE CE SOIT N'EXISTE EN BASE. Il n'y
 * a pas encore d'abonnement, pas encore de ligne, rien à interroger —
 * et interroger la base pour afficher une date que le client n'a pas
 * encore acceptée demanderait d'écrire avant de savoir.
 *
 * La règle est donc écrite deux fois, MOT POUR MOT, et le test la
 * vérifie sur les mêmes cas que le test SQL : 31 janvier → 28 février,
 * puis 31 mars ; l'ancre ne dérive pas.
 *
 * ══════════════════════════════════════════════════════════════════
 * AUCUN MONTANT N'EST CALCULÉ ICI
 * ══════════════════════════════════════════════════════════════════
 *
 * Les phrases d'annonce reçoivent des CENTIMES ENTIERS déjà calculés
 * par `composerSouscription()` et se contentent de les mettre en forme
 * avec `formaterHt` — la fonction qui garantit que la mention « HT »
 * voyage avec le montant. Pas une addition, pas une multiplication, pas
 * un taux appliqué.
 */

/**
 * DEUX IMPORTS, ET UN CHEMIN RELATIF AVEC SON EXTENSION.
 *
 * L'alias `@/…` est résolu par le compilateur de Next, PAS par Node :
 * l'employer ici rendrait ce fichier inchargeable par `node --test`,
 * c'est-à-dire non testé, exactement là où l'argent passe. C'est le
 * même choix — et la même justification — que celui de `stripe.ts` pour
 * `identite.ts`.
 *
 * ET ON IMPORTE PLUTÔT QUE DE RECOPIER : `formaterHt` est la seule
 * fonction du dépôt qui garantisse la mention « HT » collée au montant.
 * En réécrire une ici donnerait, au premier écart, un prix hors taxes
 * affiché nu à un professionnel — c'est une pratique commerciale
 * trompeuse, pas un détail de style.
 */
import { formaterHt, formaterHtParPeriode } from "../../app/inscription/grille.ts";
import type { CycleFacturation } from "./composition.ts";

/**
 * LA DURÉE DE L'ESSAI, EN MOIS ET NON EN JOURS.
 *
 * « Un mois » n'est pas « trente jours » : un essai ouvert le 31 janvier
 * finit le 28 février (vingt-huit jours) et un essai ouvert le 1er
 * juillet finit le 1er août (trente et un jours). Compter en jours
 * ferait dire à l'écran une date et au calendrier une autre, et c'est la
 * date affichée que le client retiendra.
 */
export const ESSAI_MOIS = 1;

// ══════════════════════════════════════════════════════════════════
// LE CALENDRIER — LE 31 JANVIER EXISTE, LE 31 FÉVRIER NON
// ══════════════════════════════════════════════════════════════════

const FORME_JOUR = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Les trois nombres d'un jour ISO, sans passer par `Date`.
 *
 * `new Date("2026-01-31")` est minuit UTC ; en tirer le jour du mois
 * dans un fuseau négatif rendrait 30. Une date de calendrier n'a pas
 * d'heure, et lui en inventer une est le seul moyen de se tromper.
 */
function decomposer(jourIso: string): { annee: number; mois: number; jour: number } {
  if (!FORME_JOUR.test(jourIso)) {
    // ON LÈVE PLUTÔT QUE DE RETOMBER SUR AUJOURD'HUI. Une date de
    // prélèvement fabriquée à partir d'une entrée illisible serait
    // affichée au client avec le même aplomb qu'une date juste.
    throw new Error(`Jour illisible : « ${jourIso} ». Le format attendu est AAAA-MM-JJ.`);
  }
  return {
    annee: Number.parseInt(jourIso.slice(0, 4), 10),
    mois: Number.parseInt(jourIso.slice(5, 7), 10),
    jour: Number.parseInt(jourIso.slice(8, 10), 10),
  };
}

function deuxChiffres(valeur: number): string {
  return valeur < 10 ? `0${valeur}` : String(valeur);
}

/** Le dernier jour d'un mois donné (`mois` de 1 à 12). */
export function dernierJourDuMois(annee: number, mois: number): number {
  // Le « jour 0 » du mois suivant est le dernier du mois demandé, et
  // `Date.UTC` connaît les années bissextiles mieux qu'une table.
  return new Date(Date.UTC(annee, mois, 0)).getUTCDate();
}

/** Le jour du mois d'un jour ISO (1 à 31). */
export function jourDuMois(jourIso: string): number {
  return decomposer(jourIso).jour;
}

/**
 * LA DATE ANNIVERSAIRE — la règle de 0089 § 1, réécrite mot pour mot.
 *
 * On retient le JOUR D'ANCRAGE quand il existe dans le mois visé, et le
 * DERNIER JOUR DU MOIS sinon.
 *
 * ET LE POINT QUI COMPTE VRAIMENT : L'ANCRE NE DÉRIVE PAS. C'est
 * pourquoi cette fonction prend le jour d'ancrage et pas seulement la
 * date de départ. Un calcul naïf « le mois suivant, un mois après le
 * précédent » ferait passer le 31 janvier au 28 février, puis au
 * 28 mars, puis au 28 avril : l'abonné souscrit le 31 et se retrouve
 * prélevé le 28 pour le restant de sa vie. Avec l'ancre conservée, il
 * repasse au 31 dès que le mois le permet.
 */
export function dateAnniversaire(depart: string, mois: number, jourAncre: number): string {
  const debut = decomposer(depart);
  if (!Number.isInteger(mois) || mois < 0) {
    throw new Error(`Nombre de mois invalide : ${mois}.`);
  }
  if (!Number.isInteger(jourAncre) || jourAncre < 1 || jourAncre > 31) {
    throw new Error(`Jour d'ancrage invalide : ${jourAncre}. Il vaut de 1 à 31.`);
  }

  const total = debut.mois - 1 + mois;
  const annee = debut.annee + Math.floor(total / 12);
  const moisCible = (total % 12) + 1;
  const jour = Math.min(jourAncre, dernierJourDuMois(annee, moisCible));

  return `${annee}-${deuxChiffres(moisCible)}-${deuxChiffres(jour)}`;
}

/**
 * Un jour ISO en français lisible, sans jamais glisser d'un jour.
 *
 * `new Date("2027-03-01")` est minuit UTC ; l'afficher dans un fuseau
 * négatif rendrait « 28 février ». On force donc l'affichage en UTC.
 */
export function formaterJourFr(jourIso: string): string {
  decomposer(jourIso);
  return new Date(`${jourIso}T00:00:00Z`).toLocaleDateString("fr-FR", {
    timeZone: "UTC",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

// ══════════════════════════════════════════════════════════════════
// QUI A DROIT À L'ESSAI
// ══════════════════════════════════════════════════════════════════

/**
 * L'ESSAI EST RÉSERVÉ AU PREMIER ABONNEMENT DE L'ENTREPRISE.
 *
 * La règle est celle de la base, et elle n'est pas négociable ici :
 * `saas_start_subscription()` refuse toute entreprise qui porte DÉJÀ
 * une ligne dans `organization_subscriptions` — y compris résiliée.
 * Offrir un second mois gratuit à quelqu'un qui a résilié et revient
 * serait, en plus, un mois offert par résiliation.
 *
 * On prend donc la ligne d'abonnement telle qu'elle est lue, et
 * l'ABSENCE de ligne — et elle seule — ouvre l'essai. Un statut
 * « cancelled » ne le rouvre pas.
 */
export function essaiDisponible(abonnementExistant: unknown | null): boolean {
  return abonnementExistant === null || abonnementExistant === undefined;
}

// ══════════════════════════════════════════════════════════════════
// LE PLAN — LES DATES, ET RIEN QUE LES DATES
// ══════════════════════════════════════════════════════════════════

export type PlanEssai = {
  /** L'entreprise entre-t-elle par l'essai ? */
  avecEssai: boolean;
  /** Le jour de la souscription (Europe/Paris), en ISO. */
  souscritLe: string;
  /**
   * LE JOUR DU MOIS QUI ANCRE TOUTES LES ÉCHÉANCES. Il est conservé à
   * part et ne dérive pas : le 31 janvier passe au 28 février puis
   * REVIENT au 31 mars.
   */
  jourAnniversaire: number;
  /** La fin de l'essai, ou `null` quand il n'y en a pas. */
  finEssaiLe: string | null;
  /**
   * LE PREMIER PRÉLÈVEMENT. Jamais nul : sans essai c'est aujourd'hui,
   * avec essai c'est la fin de l'essai. C'est CETTE date que l'écran
   * doit annoncer, et c'est celle qui part au prestataire.
   */
  premierPrelevementLe: string;
  /** L'échéance d'après — « et ainsi de suite » a une date, elle aussi. */
  echeanceSuivanteLe: string;
  cycle: CycleFacturation;
};

/**
 * LES DATES DU CYCLE, CALCULÉES UNE FOIS.
 *
 * `souscritLe` est le jour de référence de Paris (`jourDeReference()`),
 * pas celui d'UTC : à 23 h 30 en France l'UTC est déjà le lendemain
 * l'été, et l'écran annoncerait un prélèvement le 7 quand le client
 * souscrit le 6.
 */
export function planifierEssai(demande: {
  souscritLe: string;
  avecEssai: boolean;
  cycle: CycleFacturation;
}): PlanEssai {
  const jourAnniversaire = jourDuMois(demande.souscritLe);
  const moisParPeriode = demande.cycle === "yearly" ? 12 : 1;

  const finEssaiLe = demande.avecEssai
    ? dateAnniversaire(demande.souscritLe, ESSAI_MOIS, jourAnniversaire)
    : null;

  const premierPrelevementLe = finEssaiLe ?? demande.souscritLe;

  return {
    avecEssai: demande.avecEssai,
    souscritLe: demande.souscritLe,
    jourAnniversaire,
    finEssaiLe,
    premierPrelevementLe,
    // L'ANCRE SERT ICI AUSSI. La deuxième échéance se compte depuis la
    // première AVEC LE MÊME JOUR D'ANCRAGE : un essai ouvert le
    // 31 janvier est prélevé le 28 février, puis le 31 mars — et non le
    // 28 mars.
    echeanceSuivanteLe: dateAnniversaire(premierPrelevementLe, moisParPeriode, jourAnniversaire),
    cycle: demande.cycle,
  };
}

/**
 * LE DÉBUT DE L'ENGAGEMENT, QUAND L'OFFRE ENGAGE.
 *
 * ══════════════════════════════════════════════════════════════════
 * L'ESSAI NE COMPTE PAS DANS L'ENGAGEMENT
 * ══════════════════════════════════════════════════════════════════
 *
 * C'est la règle du socle, et la base la rend non contournable :
 * `saas_engagement_start_on()` rend la fin de l'essai, et le
 * déclencheur `subscription_discounts_trial_guard` REFUSE toute remise
 * engageante qui démarrerait un autre jour.
 *
 * La raison est chiffrée : poser la remise le jour de la souscription
 * ferait payer ONZE mois à 49,90 € au lieu de douze, et le douzième
 * basculerait au tarif public sans que personne l'ait annoncé.
 *
 * L'effet de bord, à afficher plutôt qu'à cacher : l'abonné reste treize
 * mois au total (un gratuit, douze payés), et le mois d'essai est
 * résiliable à tout moment sans pénalité — l'engagement n'a pas commencé.
 */
export function debutEngagement(plan: PlanEssai): string {
  return plan.premierPrelevementLe;
}

/**
 * LA FIN DE L'ENGAGEMENT, calculée comme la base la calculera.
 *
 * 0081 pose `commitment_ends_on := starts_on + interval 'N months'`,
 * c'est-à-dire l'arithmétique de mois de Postgres — qui retombe sur le
 * dernier jour du mois quand le jour d'origine n'y existe pas. C'est
 * exactement `dateAnniversaire` ancrée sur le jour de départ.
 */
export function finEngagement(debutLe: string, dureeMois: number): string {
  return dateAnniversaire(debutLe, dureeMois, jourDuMois(debutLe));
}

// ══════════════════════════════════════════════════════════════════
// L'ANNONCE — CE QUE L'ÉCRAN DOIT DIRE AVANT, PAS APRÈS
// ══════════════════════════════════════════════════════════════════

export type AnnonceEssai = {
  plan: PlanEssai;
  /** « Un mois gratuit, puis 79,90 € HT / mois. » */
  titre: string;
  /** « Votre carte est enregistrée aujourd'hui et débitée le 6 octobre 2026. » */
  carte: string;
  /** « 95,88 € TTC le 6 octobre 2026, puis le 6 de chaque mois. » */
  prelevement: string;
  /**
   * Ce qu'on peut encore faire, et jusqu'à quand. Vide (`null`) quand
   * il n'y a pas d'essai : il n'y a alors rien à arrêter avant.
   */
  sortie: string | null;
  /** La phrase entière, prête à afficher d'un bloc. */
  phrase: string;
};

/**
 * LE MÊME MONTANT, AVEC L'AUTRE MENTION.
 *
 * On dérive de `formaterHt` plutôt que d'écrire un second formateur :
 * deux formateurs dérivent — sur le nombre de décimales, sur l'espace
 * insécable avant l'euro — et l'écart se verrait entre deux lignes de
 * la même phrase. La mention « HT » est toujours en fin de chaîne : on
 * la remplace, on ne la devine pas.
 */
function formaterTtc(cents: number): string {
  const ht = formaterHt(cents);
  if (ht === null) return "";
  return ht.replace(/\sHT$/, " TTC");
}

/** Le jour du mois, dit en français, avec la vérité sur les mois courts. */
function cadence(plan: PlanEssai): string {
  if (plan.cycle === "yearly") {
    return `puis chaque année à la même date`;
  }
  // LE 31 DE CHAQUE MOIS N'EXISTE PAS, et le taire serait promettre une
  // date qui manquera quatre fois par an. On le dit une fois, ici.
  const precision =
    plan.jourAnniversaire > 28
      ? ` (ou le dernier jour du mois quand le ${plan.jourAnniversaire} n'existe pas)`
      : "";
  return `puis le ${plan.jourAnniversaire} de chaque mois${precision}`;
}

/**
 * LA PHRASE QUI DOIT ÊTRE LUE AVANT LE CLIC.
 *
 * « Un mois gratuit, puis 79,90 € HT par mois. Votre carte est
 * enregistrée aujourd'hui et débitée le 6 octobre 2026. »
 *
 * LA DATE EST CALCULÉE, PAS « DANS UN MOIS ». Un client surpris par un
 * premier prélèvement fait une réclamation, et il a raison : « dans un
 * mois » ne se retrouve nulle part sur un relevé bancaire, une date si.
 *
 * LES DEUX MONTANTS SONT DITS, et ils ne disent pas la même chose : le
 * hors taxes est ce qui sera FACTURÉ, le toutes taxes ce qui apparaîtra
 * sur le relevé. Découvrir que 79,90 annoncés sont devenus 95,88 est la
 * première cause de contestation.
 */
export function annoncerEssai(
  plan: PlanEssai,
  montants: { totalHtCents: number; totalTtcCents: number },
): AnnonceEssai {
  const parPeriode = formaterHtParPeriode(montants.totalHtCents, plan.cycle) ?? "";
  const ttc = formaterTtc(montants.totalTtcCents);
  const jourPremier = formaterJourFr(plan.premierPrelevementLe);

  if (!plan.avecEssai) {
    const titre = `${parPeriode}, à partir d'aujourd'hui.`;
    const carte = `Votre carte est enregistrée et débitée aujourd'hui, ${jourPremier}.`;
    const prelevement = `${ttc} aujourd'hui, ${cadence(plan)}.`;
    return {
      plan,
      titre,
      carte,
      prelevement,
      sortie: null,
      phrase: `${titre} ${carte} ${prelevement}`,
    };
  }

  const titre = `Un mois gratuit, puis ${parPeriode}.`;
  const carte = `Votre carte est enregistrée aujourd'hui et débitée le ${jourPremier}.`;
  const prelevement = `${ttc} le ${jourPremier}, ${cadence(plan)}.`;
  const sortie =
    `Rien n'est prélevé avant le ${jourPremier} : vous pouvez arrêter à tout moment d'ici là, `
    + `et vous ne serez pas débité.`;

  return {
    plan,
    titre,
    carte,
    prelevement,
    sortie,
    phrase: `${titre} ${carte} ${prelevement} ${sortie}`,
  };
}

// ══════════════════════════════════════════════════════════════════
// CE QUI PART AU PRESTATAIRE
// ══════════════════════════════════════════════════════════════════

/**
 * L'INSTANT DE FIN D'ESSAI, EN SECONDES, TEL QUE LE PRESTATAIRE
 * L'ATTEND.
 *
 * ══════════════════════════════════════════════════════════════════
 * SIX HEURES UTC, ET CE N'EST PAS ARBITRAIRE
 * ══════════════════════════════════════════════════════════════════
 *
 * Le prestataire veut un horodatage, pas un jour. Il faut donc choisir
 * une heure — et le choix décide de la DATE affichée sur le relevé.
 *
 * 06:00 UTC tombe le MÊME JOUR CIVIL à Paris (08 h l'été, 07 h l'hiver)
 * ET en UTC. C'est le seul créneau qui satisfasse les trois lecteurs à
 * la fois : l'écran, qui compte en heure de Paris ; la base, dont
 * `current_date` compte en UTC ; et le relevé bancaire du client.
 * Minuit, lui, tomberait la veille à Paris en hiver ; 23 h tomberait le
 * lendemain en UTC l'été.
 *
 * Et c'est une heure ouvrable en France : un prélèvement refusé à 8 h du
 * matin laisse la journée pour être relancé.
 */
export function horodatageFinEssai(finEssaiLe: string): number {
  decomposer(finEssaiLe);
  return Math.floor(Date.parse(`${finEssaiLe}T06:00:00Z`) / 1000);
}
