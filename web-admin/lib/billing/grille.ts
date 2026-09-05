import type {
  CycleFacturation,
  Disponibilite,
  LigneCase,
  LigneModule,
  LigneOffre,
} from "./types.ts";

/**
 * ==================================================================
 * LIRE LA GRILLE — des fonctions pures, éprouvables sans base
 * ==================================================================
 *
 * Rien ici ne touche à Supabase, à Next ni au DOM. C'est délibéré : ce
 * sont les décisions de lecture les plus faciles à se tromper, et les
 * seules qu'un test puisse épingler sans monter une base.
 *
 * LA RÈGLE QUI TRAVERSE LE FICHIER, ET C'EST CELLE DU PRODUIT ENTIER :
 * `null` veut dire INCONNU, jamais zéro. Un prix absent n'est pas un
 * prix nul ; un nombre de sièges compris absent n'est pas « aucun
 * siège » ; une case de matrice absente n'est pas « indisponible ».
 * Aucune fonction de ce fichier ne rend un nombre là où la base rend
 * `null` — elle rend `null` à son tour, et l'écran affiche l'inconnu.
 */

// ------------------------------------------------------------------
// La matrice offre × module
// ------------------------------------------------------------------

export const LIBELLES_DISPONIBILITE: Record<Disponibilite, string> = {
  included: "Compris",
  optional: "En option",
  unavailable: "Indisponible",
  undecided: "Non décidé",
};

/**
 * Le ton de chaque état.
 *
 * « Non décidé » est en `unknown` et non en `neutral` : c'est
 * exactement la même famille visuelle qu'un chiffre qu'on ne sait pas
 * calculer, et c'est le même genre d'aveu. Une case grise se lirait
 * « rien à signaler » alors qu'elle signale une décision qui manque.
 */
export const TONS_DISPONIBILITE: Record<
  Disponibilite,
  "positive" | "accent" | "neutral" | "unknown"
> = {
  included: "positive",
  optional: "accent",
  unavailable: "neutral",
  undecided: "unknown",
};

const SEPARATEUR = String.fromCharCode(0);

/** La clé d'une case, pour indexer la matrice sans jointure à la main. */
export function cleDeCase(planKey: string, moduleKey: string): string {
  // Le SÉPARATEUR est un caractère nul : aucune clé d’offre ni de module
  // ne peut en contenir (la contrainte SQL les borne aux lettres, aux
  // chiffres et au tiret). Un espace ou un tiret suffirait aujourd’hui,
  // et deviendrait ambigu le jour où une clé en porterait un.
  return [planKey, moduleKey].join(SEPARATEUR);
}

export function indexerMatrice(cases: readonly LigneCase[]): Map<string, LigneCase> {
  return new Map(cases.map((c) => [cleDeCase(c.plan_key, c.module_key), c]));
}

/**
 * L'état d'une case ABSENTE de la table.
 *
 * `undecided`, jamais `unavailable`. 0081 remplit exhaustivement la
 * matrice, donc le cas ne devrait pas se produire ; s'il se produit
 * — une offre ou un module ajouté après coup — le défaut sûr est celui
 * qui bloque et qui se signale, pas celui qui ferme en silence.
 */
export function disponibiliteDe(
  index: Map<string, LigneCase>,
  planKey: string,
  moduleKey: string,
): Disponibilite {
  return index.get(cleDeCase(planKey, moduleKey))?.availability ?? "undecided";
}

/**
 * Le prix d'un module DANS UNE OFFRE, pour un cycle donné.
 *
 * C'EST LA SEULE FAÇON DE TARIFER UN MODULE, et c'est tout l'intérêt de
 * la matrice : un module compris dans l'offre coûte zéro, et une
 * entreprise qui passe de Pro à Pro Business cesse d'être facturée pour
 * BioLab sans qu'on touche à sa ligne d'abonnement. Un prix lu ailleurs
 * — sur le module, ou recopié sur l'abonnement — serait un prix qui
 * survit au changement d'offre.
 *
 * Trois réponses, irréductibles :
 *   `{ etat: "compris" }`     rien à facturer
 *   `{ etat: "prix", cents }` un montant
 *   `{ etat: "inconnu", … }`  on ne sait pas, et l'écran doit le dire
 */
export type PrixDeCase =
  | { etat: "compris" }
  | { etat: "prix"; cents: number }
  | { etat: "inconnu"; raison: string };

export function prixDeCase(
  ligne: LigneCase | undefined,
  module: LigneModule | undefined,
  cycle: CycleFacturation,
): PrixDeCase {
  const disponibilite = ligne?.availability ?? "undecided";

  if (disponibilite === "included") return { etat: "compris" };
  if (disponibilite === "unavailable") {
    return { etat: "inconnu", raison: "Ce module n'est pas proposé sur cette offre." };
  }
  if (disponibilite === "undecided") {
    return {
      etat: "inconnu",
      raison:
        "Case non décidée : le dirigeant n'a pas dit si ce module est compris, en option ou indisponible sur cette offre.",
    };
  }

  // En option, et au compteur : le montant dépend d'une consommation
  // qu'aucune table n'enregistre. On ne l'invente pas.
  if (module?.pricing_model === "metered") {
    return {
      etat: "inconnu",
      raison: `Facturé au compteur (${module.metered_unit ?? "unité"}) : aucune table n'enregistre la consommation.`,
    };
  }
  if (module?.pricing_model === "commission") {
    return {
      etat: "inconnu",
      raison: "Rémunéré à la commission : le taux n'est pas arrêté.",
    };
  }

  const cents =
    cycle === "yearly" ? (ligne?.yearly_price_cents ?? null) : (ligne?.monthly_price_cents ?? null);

  if (cents === null) {
    return {
      etat: "inconnu",
      raison: `En option, mais sans prix ${cycle === "yearly" ? "annuel" : "mensuel"} sur cette offre.`,
    };
  }
  return { etat: "prix", cents };
}

// ------------------------------------------------------------------
// Les prix d'une offre
// ------------------------------------------------------------------

/**
 * Le prix public d'une offre pour un cycle.
 *
 * Une offre SUR DEVIS n'en a pas, et ce n'est pas un manque : son prix
 * sort d'une négociation et vit sur l'abonnement. Le plancher
 * commercial (« à partir de 249 € ») n'est PAS ce prix — le confondre
 * ferait facturer 249 € une offre dont le vrai montant est autre.
 */
export type PrixDOffre =
  | { etat: "public"; cents: number }
  | { etat: "surDevis"; plancherCents: number | null }
  | { etat: "absent" };

export function prixDOffre(offre: LigneOffre, cycle: CycleFacturation): PrixDOffre {
  if (offre.is_quote_only) {
    return { etat: "surDevis", plancherCents: offre.price_floor_cents };
  }
  const cents = cycle === "yearly" ? offre.yearly_price_cents : offre.monthly_price_cents;
  return cents === null ? { etat: "absent" } : { etat: "public", cents };
}

/**
 * Ce que l'engagement annuel fait gagner.
 *
 * CALCULÉ, JAMAIS ÉCRIT À LA MAIN. « Deux mois offerts » recopié dans
 * un libellé deviendrait faux à la première retouche de prix, et
 * personne ne penserait à le corriger : c'est une phrase, pas un
 * chiffre, et les phrases ne se relisent pas.
 *
 * `moisEquivalents` : combien de mensualités l'année représente.
 * `economieCents` : douze mensualités moins l'année.
 */
export type EconomieAnnuelle = {
  moisEquivalents: number;
  moisOfferts: number;
  economieCents: number;
  economiePourcent: number;
};

export function economieAnnuelle(offre: LigneOffre): EconomieAnnuelle | null {
  const mensuel = offre.monthly_price_cents;
  const annuel = offre.yearly_price_cents;
  if (mensuel === null || annuel === null || mensuel <= 0) return null;

  const douzeMois = mensuel * 12;
  const economieCents = douzeMois - annuel;
  if (economieCents <= 0) return null;

  return {
    moisEquivalents: annuel / mensuel,
    moisOfferts: (douzeMois - annuel) / mensuel,
    economieCents,
    economiePourcent: (economieCents / douzeMois) * 100,
  };
}

/**
 * Les fonctionnalités d'une offre, lues d'un `jsonb` qui n'est pas typé.
 *
 * La colonne accepte n'importe quel JSON. Le semis y met un tableau de
 * chaînes, mais rien ne l'impose et une main dans l'éditeur SQL peut y
 * mettre autre chose. On rend un tableau vide plutôt que de laisser une
 * page de tarifs planter sur un `.map` — et on écarte les entrées qui
 * ne sont pas des chaînes plutôt que d'afficher « [object Object] ».
 */
export function fonctionnalites(features: unknown): string[] {
  if (!Array.isArray(features)) return [];
  return features.filter((valeur): valeur is string => typeof valeur === "string");
}

// ------------------------------------------------------------------
// Ce qui reste à décider
// ------------------------------------------------------------------

/**
 * Une décision que la base ATTEND et refuse d'inventer.
 *
 * 0081 § 11 les énumère en commentaire ; cet écran les rend visibles,
 * comptées et nommées. Une décision écrite dans un commentaire de
 * migration est une décision perdue.
 */
export type DecisionEnAttente = {
  /** Ce qui la distingue, pour une clé React stable. */
  id: string;
  categorie: "case" | "sieges" | "prix";
  titre: string;
  explication: string;
};

export function decisionsEnAttente(
  offres: readonly LigneOffre[],
  modules: readonly LigneModule[],
  cases: readonly LigneCase[],
): DecisionEnAttente[] {
  const index = indexerMatrice(cases);
  const nomsOffres = new Map(offres.map((o) => [o.key, o.name]));
  const nomsModules = new Map(modules.map((m) => [m.key, m.name]));
  const decisions: DecisionEnAttente[] = [];

  // 1. Les cases non décidées, mais SEULEMENT sur les offres actives et
  //    les modules LIVRÉS. Les autres croisements sont indécis eux
  //    aussi, et par centaines : les lister tous noierait les quatre
  //    qui comptent, et une liste qu'on ne peut pas finir ne se lit
  //    plus. Le SQL du § 11 les rend tous ; cet écran priorise.
  for (const offre of offres) {
    if (!offre.is_active) continue;
    for (const brique of modules) {
      if (!brique.is_delivered) continue;
      if (disponibiliteDe(index, offre.key, brique.key) !== "undecided") continue;
      decisions.push({
        id: `case:${offre.key}:${brique.key}`,
        categorie: "case",
        titre: `${nomsOffres.get(offre.key) ?? offre.key} × ${nomsModules.get(brique.key) ?? brique.key}`,
        explication:
          "Compris dans l'offre, en option à quel prix, ou indisponible ? " +
          "Tant que la case n'est pas décidée, ce module ne peut pas être souscrit sur cette offre, " +
          "et une facture qui le porterait serait refusée.",
      });
    }
  }

  // 2. Les sièges compris. Le prix du siège supplémentaire est fixé ;
  //    le nombre compris ne l'est pas partout. Tant qu'il est nul,
  //    aucune ligne de siège n'est facturée automatiquement — ce qui
  //    est le comportement sûr, mais pas le comportement voulu.
  for (const offre of offres) {
    if (!offre.is_active || offre.included_seats !== null) continue;
    decisions.push({
      id: `sieges:${offre.key}`,
      categorie: "sieges",
      titre: `Sièges compris dans « ${offre.name} »`,
      explication:
        "`included_seats` est nul, ce qui veut dire NON DÉCIDÉ et non « illimité ». " +
        "Aucun siège supplémentaire n'est facturé automatiquement tant que ce nombre manque : " +
        "les sièges facturés se saisissent à la main sur chaque abonnement.",
    });
  }

  // 3. Une offre active, à prix public, sans prix.
  for (const offre of offres) {
    if (!offre.is_active || offre.is_quote_only) continue;
    if (offre.monthly_price_cents !== null && offre.yearly_price_cents !== null) continue;
    const manque =
      offre.monthly_price_cents === null && offre.yearly_price_cents === null
        ? "n'a aucun prix"
        : offre.monthly_price_cents === null
          ? "n'a pas de prix mensuel"
          : "n'a pas de prix annuel";
    decisions.push({
      id: `prix:${offre.key}`,
      categorie: "prix",
      titre: `Prix de « ${offre.name} »`,
      explication:
        `Cette offre est active et ${manque}. Une entreprise qui y est abonnée ne peut pas être facturée, ` +
        "et le MRR du tableau de bord reste inconnu tant qu'un forfait actif n'a pas de prix.",
    });
  }

  return decisions;
}

/**
 * Le compte des cases indécises, TOUTES offres et TOUS modules.
 *
 * Distinct de `decisionsEnAttente`, qui priorise : ce nombre-ci est
 * celui que rend la requête du § 11 de la migration, et il doit
 * correspondre au chiffre près — sinon deux comptes circulent.
 */
export function compterCasesIndecises(cases: readonly LigneCase[]): number {
  return cases.filter((c) => c.availability === "undecided").length;
}
