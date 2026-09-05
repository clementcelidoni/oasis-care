/**
 * §INSCRIPTION — LA GRILLE : MISE EN FORME ET RECOMMANDATION.
 *
 * ══════════════════════════════════════════════════════════════════
 * POURQUOI CES FONCTIONS SONT PURES, ET AU SERVEUR
 * ══════════════════════════════════════════════════════════════════
 *
 * AUCUN PRIX N'EST CALCULÉ DANS LE NAVIGATEUR. Deux arrondis valent
 * deux montants, et l'écart ne se voit qu'au relevé bancaire. Tout ce
 * qui ressemble à un calcul — l'économie de l'annuel, le total d'une
 * option, la conversion des centimes en euros — se fait ICI, au
 * serveur, et le navigateur ne reçoit que des CHAÎNES DÉJÀ FORMÉES
 * qu'il se contente de choisir et d'afficher.
 *
 * Ce fichier ne touche ni la base ni le réseau : c'est ce qui le rend
 * testable sans base de données, et c'est ce qui permet de PROUVER que
 * la mention « HT » ne peut pas manquer.
 *
 * ══════════════════════════════════════════════════════════════════
 * LA MENTION « HT » N'EST PAS UNE DÉCORATION
 * ══════════════════════════════════════════════════════════════════
 *
 * Les prix de la grille sont HORS TAXES — décision du dirigeant, et
 * règle de calcul de toute la chaîne. Un prix hors taxes montré sans sa
 * mention à un professionnel est une pratique commerciale trompeuse.
 *
 * D'où `formaterHt()`, qui rend TOUJOURS « 79,90 € HT » et jamais
 * « 79,90 € » : la mention voyage AVEC le montant, dans la même chaîne,
 * et il n'existe aucun chemin par lequel un gabarit d'affichage
 * pourrait l'oublier. Une mention laissée au gabarit finit par manquer
 * au deuxième écran.
 */

/**
 * DEUX IMPORTS, ET TOUS LES DEUX DE TYPE SEUL.
 *
 * Ce fichier n'importe AUCUNE valeur — pas une constante, pas une
 * fonction. C'est délibéré et c'est ce qui le rend exécutable par le
 * lanceur de tests de Node sans configuration : les imports de type
 * s'effacent à la compilation, un import de valeur aurait exigé de
 * résoudre l'alias `@/`. Les libellés dont ce fichier a besoin lui sont
 * donc PASSÉS par l'appelant, jamais lus ici.
 */
import type { BusinessType } from "@/lib/auth/permissions";
import type { CycleFacturation } from "@/lib/billing/provider";

// ------------------------------------------------------------------
// L'ARGENT
// ------------------------------------------------------------------

/**
 * Des CENTIMES ENTIERS vers une chaîne affichable, mention comprise.
 *
 * La division par 100 se fait à la toute dernière seconde, pour
 * l'affichage seul. Aucun montant ne circule jamais en euros flottants
 * dans ce code : 0,1 + 0,2 ne vaut pas 0,3 en virgule flottante, et une
 * grille tarifaire n'a pas le droit à cette approximation.
 */
export function formaterHt(cents: number | null): string | null {
  if (cents === null) return null;
  const euros = (cents / 100).toLocaleString("fr-FR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${euros} € HT`;
}

/** « 79,90 € HT / mois » — le montant, sa mention, sa période. */
export function formaterHtParPeriode(
  cents: number | null,
  cycle: CycleFacturation,
): string | null {
  const montant = formaterHt(cents);
  if (montant === null) return null;
  return `${montant} / ${cycle === "yearly" ? "an" : "mois"}`;
}

/**
 * CE QUE L'ANNUEL FAIT ÉCONOMISER, calculé ici et jamais à l'écran.
 *
 * La grille pose l'annuel à dix fois le mensuel (79,90 → 799), soit
 * deux mois offerts. Mais ce n'est PAS une règle du code : c'est ce que
 * disent deux colonnes de la base, et elles peuvent dire autre chose
 * demain. On compare donc les deux montants enregistrés au lieu de
 * multiplier par dix — un « × 10 » codé en dur afficherait une économie
 * fausse au premier changement de tarif.
 *
 * Rend `null` quand il n'y a rien à annoncer : pas d'annuel, pas de
 * mensuel, ou un annuel qui ne fait rien économiser.
 */
export function economieAnnuelle(
  mensuelCents: number | null,
  annuelCents: number | null,
): { montant: string; phrase: string } | null {
  if (mensuelCents === null || annuelCents === null) return null;
  const douzeMois = mensuelCents * 12;
  const economie = douzeMois - annuelCents;
  if (economie <= 0) return null;

  const moisOfferts = mensuelCents > 0 ? economie / mensuelCents : 0;
  // « Deux mois offerts » ne se dit que si c'en est vraiment un nombre
  // rond : annoncer « 1,7 mois offert » serait pire que de se taire.
  const phraseMois =
    Number.isInteger(moisOfferts) && moisOfferts >= 1
      ? moisOfferts === 1
        ? "soit un mois offert"
        : `soit ${moisOfferts} mois offerts`
      : `soit ${Math.round((economie / douzeMois) * 100)} % d'économie`;

  return {
    montant: formaterHt(economie) ?? "",
    phrase: `Économisez ${formaterHt(economie)} par an, ${phraseMois}.`,
  };
}

// ------------------------------------------------------------------
// LA MATRICE OFFRE × MODULE, VUE DE L'ÉCRAN
// ------------------------------------------------------------------

export type DisponibiliteModule = "included" | "optional" | "unavailable" | "undecided";

export type ModuleDansOffre = {
  key: string;
  name: string;
  tagline: string | null;
  disponibilite: DisponibiliteModule;
  /** Le module est-il CONSTRUIT ? Plusieurs sont annoncés et non livrés. */
  livre: boolean;
  modeleTarifaire: "flat" | "metered" | "commission";
  uniteComptee: string | null;
  prixMensuelHtCents: number | null;
  prixAnnuelHtCents: number | null;
};

/**
 * Ce que l'écran a le droit de proposer à la souscription, et la phrase
 * à afficher quand il ne le peut pas.
 *
 * LE POINT DE CETTE FONCTION : chaque refus a une CAUSE DIFFÉRENTE et
 * chacune appelle un geste différent. « Compris dans votre offre »
 * n'appelle rien. « Annoncé, pas encore livré » appelle de la patience.
 * « Pas de prix annuel » appelle un changement de rythme. Une seule
 * phrase générique — « indisponible » — enverrait tout le monde écrire
 * au support.
 */
export type OptionAffichable = {
  module: ModuleDansOffre;
  /** Peut-on cocher cette case ? */
  cochable: boolean;
  /** Le prix formaté pour le cycle demandé, mention HT comprise. */
  prix: string | null;
  /** Pourquoi ce n'est pas cochable. `null` quand ça l'est. */
  motif: string | null;
  /** Ce module est déjà compris sans frais dans l'offre. */
  compris: boolean;
};

export function optionAffichable(
  module: ModuleDansOffre,
  cycle: CycleFacturation,
): OptionAffichable {
  const base = { module, compris: module.disponibilite === "included" };

  if (module.disponibilite === "included") {
    return {
      ...base,
      cochable: false,
      prix: null,
      motif: "Compris dans cette offre, sans supplément.",
    };
  }

  if (module.disponibilite === "unavailable") {
    return { ...base, cochable: false, prix: null, motif: "Non disponible sur cette offre." };
  }

  if (module.disponibilite === "undecided") {
    // « Non décidé » n'est pas un défaut de saisie : c'est la réponse
    // honnête quand rien n'a été arrêté, et elle bloque.
    return {
      ...base,
      cochable: false,
      prix: null,
      motif: "Les conditions de ce module ne sont pas encore arrêtées sur cette offre.",
    };
  }

  // En option, donc à vendre — sauf si le module n'existe pas encore.
  if (!module.livre) {
    return {
      ...base,
      cochable: false,
      prix: null,
      motif: "Annoncé, pas encore livré. Il ne peut donc pas être souscrit aujourd'hui.",
    };
  }

  if (module.modeleTarifaire !== "flat") {
    const unite = module.uniteComptee ?? "unité";
    return {
      ...base,
      cochable: false,
      prix: null,
      motif: `Ce module se facture à l'usage (${unite}) et non au forfait : son prix unitaire n'est pas arrêté.`,
    };
  }

  const cents = cycle === "yearly" ? module.prixAnnuelHtCents : module.prixMensuelHtCents;
  if (cents === null) {
    return {
      ...base,
      cochable: false,
      prix: null,
      motif:
        cycle === "yearly"
          ? "Ce module n'a pas de tarif annuel arrêté. Il se souscrit au mois."
          : "Ce module n'a pas de tarif mensuel arrêté.",
    };
  }

  return {
    ...base,
    cochable: true,
    prix: formaterHtParPeriode(cents, cycle),
    motif: null,
  };
}

// ------------------------------------------------------------------
// LE MÉTIER, ET L'OFFRE QU'IL APPELLE
// ------------------------------------------------------------------

/**
 * §« il choisira le plan qu'il veut EN FONCTION DE SON MÉTIER ».
 *
 * ══════════════════════════════════════════════════════════════════
 * LA RECOMMANDATION SE DÉDUIT DE LA MATRICE, ELLE NE S'INVENTE PAS
 * ══════════════════════════════════════════════════════════════════
 *
 * Écrire « un pépiniériste prend Pro Business » en dur serait une règle
 * commerciale cachée dans du code, qui contredirait la base au premier
 * changement de grille. Le raisonnement tenu ici est l'inverse :
 *
 *   1. Le métier dit de quels MODULES l'entreprise a besoin — et cela,
 *      c'est un fait produit, pas un prix : un pépiniériste a besoin du
 *      module Pépinière, quel qu'en soit le tarif.
 *   2. La MATRICE, lue en base, dit dans quelle offre ces modules sont
 *      COMPRIS.
 *   3. L'offre recommandée est la moins chère qui les comprend tous. Si
 *      la grille change demain, la recommandation change avec elle,
 *      sans qu'on touche à ce fichier.
 *
 * Et si le métier n'appelle aucun module, on retombe sur l'offre qui
 * porte le badge `bestSeller` en base — encore une donnée, pas un choix
 * écrit ici.
 *
 * RECOMMANDER N'EST PAS IMPOSER : la grille complète reste affichée, et
 * toutes les offres restent souscriptibles. C'est un repère pour qui ne
 * sait pas choisir, pas un aiguillage.
 */
const MODULES_ATTENDUS_PAR_METIER: Record<BusinessType, string[]> = {
  // Un paysagiste pur travaille en chantier : ni lots ni production.
  landscaper: [],
  gardenMaintenance: [],
  // Ces trois-là gèrent des végétaux en stock et en production.
  nursery: ["nursery"],
  landscaperAndNursery: ["nursery"],
  horticulturalProducer: ["nursery"],
  // « Autre » ne se devine pas : on ne recommande rien de particulier.
  other: [],
};

export type OffrePourRecommandation = {
  key: string;
  name: string;
  monthlyPriceCents: number | null;
  isQuoteOnly: boolean;
  badge: "bestSeller" | "new" | null;
  /** Les clés des modules COMPRIS dans cette offre. */
  modulesCompris: string[];
};

export type Recommandation = {
  planKey: string;
  /** La phrase montrée sur la carte. Elle dit POURQUOI. */
  raison: string;
};

export function modulesAttendusPour(metier: BusinessType): string[] {
  return MODULES_ATTENDUS_PAR_METIER[metier] ?? [];
}

export function recommanderOffre(
  metier: BusinessType,
  /** Le libellé humain du métier (« Pépiniériste »), fourni par l'appelant. */
  libelleMetier: string,
  offres: OffrePourRecommandation[],
  /** Les noms des modules, pour écrire une phrase lisible. */
  nomsDesModules: Record<string, string> = {},
): Recommandation | null {
  // Une offre sur devis ne se recommande pas en libre-service : on ne
  // peut pas la souscrire, et la mettre en avant enverrait le visiteur
  // dans un cul-de-sac.
  const souscriptibles = offres.filter((offre) => !offre.isQuoteOnly);
  if (souscriptibles.length === 0) return null;

  const attendus = modulesAttendusPour(metier);

  if (attendus.length > 0) {
    const couvrantes = souscriptibles
      .filter((offre) => attendus.every((cle) => offre.modulesCompris.includes(cle)))
      // La MOINS CHÈRE qui couvre le besoin. Une offre sans prix public
      // ne peut pas être comparée : on l'écarte du classement plutôt
      // que de la traiter comme gratuite.
      .filter((offre) => offre.monthlyPriceCents !== null)
      .sort((a, b) => (a.monthlyPriceCents ?? 0) - (b.monthlyPriceCents ?? 0));

    if (couvrantes.length > 0) {
      const retenue = couvrantes[0];
      const libelles = attendus.map((cle) => nomsDesModules[cle] ?? cle);
      const liste =
        libelles.length === 1 ? libelles[0] : `${libelles.slice(0, -1).join(", ")} et ${libelles.at(-1)}`;
      return {
        planKey: retenue.key,
        raison: `Recommandé pour votre activité (${libelleMetier}) : ${liste} y ${
          libelles.length === 1 ? "est compris" : "sont compris"
        }, sans supplément.`,
      };
    }
    // Aucune offre ne comprend le module : il se prend en option, et il
    // n'y a alors pas de raison objective d'en recommander une plutôt
    // qu'une autre. On retombe sur le badge.
  }

  const phare = souscriptibles.find((offre) => offre.badge === "bestSeller");
  if (phare) {
    return {
      planKey: phare.key,
      raison: "L'offre la plus choisie par les entreprises comme la vôtre.",
    };
  }

  return null;
}
