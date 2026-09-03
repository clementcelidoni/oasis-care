import { decalerNiveau, niveauMin, rangNiveau } from "../model/types.ts";
import type {
  Confiance,
  DeclencheurEscalade,
  EtapeEscalade,
  NiveauModele,
  NiveauRisque,
  SortieModele,
} from "./types.ts";

/**
 * §11V — ÉTAPE 14 : `ModelEscalationService` (spec p. 7).
 *
 * ══════════════════════════════════════════════════════════════════
 * CE QUE LA PAGE 7 DEMANDE, ET CE QU'ELLE INTERDIT
 * ══════════════════════════════════════════════════════════════════
 *
 *     Luna ↓ confidence insufficient ↓ Terra ↓ still ambiguous /
 *     high impact ↓ Sol
 *
 *     « L'escalade doit être explicite et limitée. »
 *     « Éviter : Luna → Terra → Sol sur chaque demande. »
 *
 * Ces deux phrases sont l'essentiel. Une escalade qui se déclenche
 * souvent ne coûte pas un peu plus cher : elle coûte DEUX MODÈLES DE
 * PLUS pour un résultat, et elle le fait exactement sur les demandes
 * les plus fréquentes, celles où l'agent hésite un peu. Le produit
 * paierait alors trois fois le prix pour une amélioration marginale,
 * sans que personne ne le voie autrement que sur la facture.
 *
 * ══════════════════════════════════════════════════════════════════
 * LES DEUX BARREAUX N'ONT PAS LES MÊMES DÉCLENCHEURS. C'EST LE FOND.
 * ══════════════════════════════════════════════════════════════════
 *
 * ─── economy → standard : la confiance suffit ───
 *
 * Luna travaille sur des tâches à fort volume et faible complexité
 * (p. 3) : classer, extraire, pré-trier. Quand elle rend une confiance
 * faible, c'est qu'elle est au bout de ce qu'elle sait faire, et Terra
 * est de toute façon le moteur ordinaire des agents. Le pas est petit,
 * et il est celui que la page 7 décrit textuellement.
 *
 * ─── standard → advanced : la confiance NE SUFFIT PAS ───
 *
 * La page 7 est précise : « still ambiguous / high impact ». Pas
 * « confiance faible ». La nuance vaut de l'argent : Terra est le
 * moteur de tous les agents métier, et une confiance faible y est
 * fréquente — beaucoup de questions n'ont pas de bonne réponse dans
 * les données. Escalader dessus enverrait sur Sol la moitié des
 * demandes ordinaires.
 *
 * Trois déclencheurs, donc, et il en faut UN :
 *
 *   • l'agent DÉCLARE que la situation reste ambiguë (`ambigu`) ;
 *   • le risque de l'action proposée est élevé ou critique ;
 *   • l'argent en jeu dépasse le seuil.
 *
 * ══════════════════════════════════════════════════════════════════
 * « DONNÉES INSUFFISANTES » N'ESCALADE JAMAIS. LA RAISON COMPTE.
 * ══════════════════════════════════════════════════════════════════
 *
 * `lib/ai/types.ts` pose déjà la distinction pour les écrans :
 * « je n'ai pas assez de données » et « j'ai des données qui disent
 * peu » sont deux messages différents. Ici, elle a une conséquence
 * financière directe.
 *
 * Un agent qui rend `insufficient_data` dit que la DONNÉE manque : pas
 * de coût saisi sur les lignes du devis, moins de cinq comparables, un
 * droit refusé. Payer Sol pour relire exactement les mêmes données
 * absentes rendra exactement la même réponse, en dix fois plus cher.
 * La bonne suite n'est pas un meilleur modèle, c'est de dire à
 * l'utilisateur ce qui manque — et c'est ce que l'agent a déjà fait.
 *
 * C'est le seul endroit du système où « faible » et « insuffisant »
 * mènent à des dépenses différentes, et c'est celui où ça se voit.
 */

// ==================================================================
// Les seuils
// ==================================================================

/**
 * Deux montées au maximum, soit exactement le chemin de la page 7 :
 * economy → standard → advanced. Au-delà, il n'y a plus de niveau.
 * La constante existe pour que le compteur soit lisible, et pour
 * qu'un futur quatrième niveau ne fasse pas exploser la dépense par
 * inadvertance.
 */
export const MAX_ESCALADES = 2;

/**
 * « High impact » de la page 7, en centimes entiers.
 *
 * Aligné sur `SEUIL_IMPACT_AVANCE_CENTIMES` du routeur (5 000 €) : le
 * routeur pose le même seuil pour choisir `advanced` d'emblée. Deux
 * valeurs différentes produiraient un comportement incohérent — une
 * décision à 4 900 € refusée au départ puis acceptée à l'escalade.
 */
export const SEUIL_IMPACT_ESCALADE_CENTIMES = 500_000;

/** Les risques qui justifient à eux seuls de monter d'un cran. */
const RISQUES_ELEVES: readonly NiveauRisque[] = ["high", "critical"];

// ==================================================================
// Ce qu'on demande au service
// ==================================================================

export type DemandeEscalade = {
  /** Le niveau qui vient de répondre. */
  niveauActuel: NiveauModele;
  /** Ce que la tentative a produit. */
  sortie: SortieModele;
  /**
   * Le plafond en vigueur — plan de l'organisation, budget tendu.
   * L'escalade ne le franchit JAMAIS : le contrôle de coût a le droit
   * de dire non, et il l'a déjà dit.
   */
  plafond?: NiveauModele;
  /** Le risque de l'action que la réponse va proposer. */
  risque?: NiveauRisque;
  /** L'argent en jeu, EN CENTIMES ENTIERS. `null` = inconnu, pas zéro. */
  impactFinancierCents?: number | null;
  /** Combien de montées ont déjà eu lieu dans cet appel. */
  escaladesDejaFaites?: number;
  /** Les niveaux déjà essayés. On ne repaie pas le même. */
  niveauxDejaEssayes?: readonly NiveauModele[];
};

export type DecisionEscalade =
  | { escalader: false; raison: string }
  | { escalader: true; versNiveau: NiveauModele; etape: EtapeEscalade };

// ==================================================================
// Le service
// ==================================================================

export class ModelEscalationService {
  readonly #seuilImpactCents: number;
  readonly #maxEscalades: number;

  constructor(
    options: { seuilImpactCents?: number; maxEscalades?: number } = {},
  ) {
    this.#seuilImpactCents = options.seuilImpactCents ?? SEUIL_IMPACT_ESCALADE_CENTIMES;
    this.#maxEscalades = options.maxEscalades ?? MAX_ESCALADES;
  }

  /**
   * Faut-il monter d'un cran ?
   *
   * Fonction PURE. Elle lève sur un impact financier illisible plutôt
   * que de le prendre pour zéro : `NaN` traité comme 0 ferait rater
   * l'escalade sur la décision la plus chère de l'année, en silence.
   */
  decider(demande: DemandeEscalade): DecisionEscalade {
    const impact = lireImpact(demande.impactFinancierCents);
    const faites = demande.escaladesDejaFaites ?? 0;
    const confiance = demande.sortie.confiance;

    // ---- 1. Les portes fermées d'avance -----------------------------

    if (faites >= this.#maxEscalades) {
      return {
        escalader: false,
        raison: `Déjà ${faites} escalade(s) : le plafond de ${this.#maxEscalades} est atteint.`,
      };
    }

    const suivant = decalerNiveau(demande.niveauActuel, 1);
    if (suivant === demande.niveauActuel) {
      return { escalader: false, raison: "Aucun niveau au-dessus de « advanced »." };
    }

    if (demande.niveauxDejaEssayes?.includes(suivant) === true) {
      // Ce cas arrive après un repli : on est redescendu d'un cran
      // faute de disponibilité, et remonter reviendrait à rappeler le
      // modèle qui vient d'échouer.
      return {
        escalader: false,
        raison: `Le niveau « ${suivant} » a déjà été essayé dans cet appel.`,
      };
    }

    const plafond = demande.plafond;
    if (plafond !== undefined && rangNiveau(suivant) > rangNiveau(plafond)) {
      return {
        escalader: false,
        raison: `Plafond « ${plafond} » : monter à « ${suivant} » n'est pas autorisé pour cette organisation.`,
      };
    }

    // ---- 2. La réponse est-elle suffisante ? ------------------------

    if (confiance === "high") {
      return { escalader: false, raison: "Confiance élevée : rien à gagner à payer plus cher." };
    }

    if (confiance === "insufficient_data") {
      // LE CAS QUI JUSTIFIE TOUT L'EN-TÊTE.
      return {
        escalader: false,
        raison:
          "Données insuffisantes : ce n'est pas le modèle qui manque, c'est la donnée. " +
          "Un modèle plus cher relirait la même absence.",
      };
    }

    // ---- 3. Le déclencheur, différent selon le barreau --------------

    const declencheur = this.#declencheur(demande.niveauActuel, confiance, demande, impact);
    if (declencheur === null) {
      return {
        escalader: false,
        raison:
          demande.niveauActuel === "standard"
            ? "Confiance moyenne ou faible seule : la page 7 exige une ambiguïté déclarée, " +
              "un risque élevé ou un fort impact pour atteindre « advanced »."
            : "Aucun déclencheur d'escalade.",
      };
    }

    return {
      escalader: true,
      versNiveau: suivant,
      etape: {
        deNiveau: demande.niveauActuel,
        versNiveau: suivant,
        declencheur,
        explication: explication(declencheur, confiance, impact),
      },
    };
  }

  #declencheur(
    niveau: NiveauModele,
    confiance: Confiance,
    demande: DemandeEscalade,
    impact: number | null,
  ): DeclencheurEscalade | null {
    const ambigu = demande.sortie.ambigu === true;
    const risqueEleve =
      demande.risque !== undefined && RISQUES_ELEVES.includes(demande.risque);
    const fortImpact = impact !== null && impact >= this.#seuilImpactCents;

    // economy → standard : « confidence insufficient » suffit (p. 7).
    if (niveau === "economy") {
      if (confiance === "low") return "confiance_insuffisante";
      if (ambigu) return "ambiguite_declaree";
      if (risqueEleve) return "risque_eleve";
      if (fortImpact) return "impact_financier";
      return null;
    }

    // standard → advanced : « still ambiguous / high impact » (p. 7).
    // La confiance faible seule ne suffit PAS — voir l'en-tête.
    if (ambigu) return "ambiguite_declaree";
    if (risqueEleve) return "risque_eleve";
    if (fortImpact) return "impact_financier";
    return null;
  }

  /**
   * Le niveau de départ d'une chaîne d'escalade.
   *
   * Un agent configuré `standard` NE DÉMARRE PAS sur `economy` sous
   * prétexte que l'escalade existe. Ce serait le piège de la page 7 :
   * on paierait Luna en pure perte sur toutes les demandes ordinaires,
   * puis Terra ensuite. L'escalade rattrape une erreur d'appréciation,
   * elle ne remplace pas le routage.
   *
   * Le seul cas où l'on commence délibérément plus bas est le
   * pré-traitement (étape 13) : classer mille activités CRM part sur
   * `economy` parce que la CLASSIFICATION est configurée `economy`,
   * pas parce qu'on espère escalader.
   */
  niveauDeDepart(niveauRoute: NiveauModele, plafond?: NiveauModele): NiveauModele {
    return plafond === undefined ? niveauRoute : niveauMin(niveauRoute, plafond);
  }
}

let serviceMemorise: ModelEscalationService | null = null;

export function serviceEscalade(): ModelEscalationService {
  serviceMemorise ??= new ModelEscalationService();
  return serviceMemorise;
}

export function reinitialiserServiceEscalade(): void {
  serviceMemorise = null;
}

// ==================================================================
// La mesure — sans elle, on ne saurait pas que l'escalade s'emballe
// ==================================================================

/**
 * La part des appels qui ont escaladé.
 *
 * La page 7 interdit « Luna → Terra → Sol sur chaque demande » ; sans
 * compteur, on ne peut pas savoir si l'interdit est respecté. Ce taux
 * se lit sur `ai_usage_events` : un appel escaladé y laisse deux
 * lignes (ou trois), avec le même `decision_id`.
 *
 * `null` quand il n'y a rien à mesurer — surtout pas 0 %, qui se
 * lirait « tout va bien ».
 */
export function tauxEscalade(appels: number, escalades: number): number | null {
  if (!Number.isFinite(appels) || appels <= 0) return null;
  return Math.round((escalades / appels) * 1000) / 10;
}

// ==================================================================
// Lectures
// ==================================================================

function lireImpact(valeur: number | null | undefined): number | null {
  if (valeur === null || valeur === undefined) return null;
  if (!Number.isInteger(valeur)) {
    // Même refus que `AIModelRouter.resolve` : un montant illisible ne
    // devient pas zéro. Un `|| 0` ici ferait rater l'escalade « fort
    // impact » sur un devis à 38 450 €.
    throw new TypeError(
      `Impact financier illisible (${String(valeur)}) : attendu un entier de centimes, ou null.`,
    );
  }
  if (valeur < 0) {
    throw new TypeError(`Impact financier négatif (${valeur}) : un impact se mesure en valeur absolue.`);
  }
  return valeur;
}

function explication(
  declencheur: DeclencheurEscalade,
  confiance: Confiance,
  impact: number | null,
): string {
  switch (declencheur) {
    case "confiance_insuffisante":
      return `Confiance « ${confiance} » au niveau économique : la tâche dépasse ce qu'il sait faire.`;
    case "ambiguite_declaree":
      return "L'agent déclare la situation encore ambiguë après analyse.";
    case "risque_eleve":
      return "L'action envisagée porte un risque élevé : la réponse mérite le modèle le plus capable.";
    case "impact_financier":
      return impact === null
        ? "Fort impact financier."
        : `Impact financier de ${(impact / 100).toLocaleString("fr-FR", {
            style: "currency",
            currency: "EUR",
          })} : au-dessus du seuil d'escalade.`;
  }
}
