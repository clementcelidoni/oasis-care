import { formatHeuresMinutes, type Confiance, type ResultatTravelCost } from "./types.ts";

/**
 * §11V — LE PANNEAU D'ANALYSE D'UN DEVIS : ce qu'il affirme, et sur
 * quoi il s'appuie.
 *
 * Critère de validation, spec p. 50 : « Je dois pouvoir ouvrir un devis
 * et obtenir : Analyse du prix · Marge · Déplacement · Historique
 * comparable · Risques · Recommandation », et « Je dois pouvoir voir
 * "Pourquoi ?" pour chaque recommandation. »
 *
 * TOUT CE QUI EST ICI EST DÉTERMINISTE. Les chiffres viennent de
 * `ai_quote_price_analysis` (SQL, migration 0073) et du
 * `TravelCostService` (arithmétique, `cost.ts`). Aucun modèle de
 * langage n'intervient dans ce fichier : les risques et les
 * recommandations sont des règles écrites, relisables et testables. La
 * spec est explicite — « déterministe avant LLM ». Un modèle pourrait
 * un jour reformuler ces phrases ; il ne doit pas décider de leur
 * contenu.
 *
 * ET RIEN N'EST INVENTÉ. Là où la donnée manque, la règle produit un
 * risque « on ne peut pas se prononcer », jamais un chiffre par défaut.
 */

export type NiveauRisque = "eleve" | "moyen" | "faible" | "information";

export type Risque = {
  cle: string;
  niveau: NiveauRisque;
  titre: string;
  explication: string;
  source: string;
  confiance: Confiance;
};

export type Recommandation = {
  cle: string;
  titre: string;
  /** Le « Pourquoi ? » de la page 50 : une ligne par raison, chacune sourcée. */
  pourquoi: string[];
  source: string;
  confiance: Confiance;
};

export type Fourchette = {
  minHtCents: number | null;
  q1HtCents: number | null;
  medianeHtCents: number | null;
  q3HtCents: number | null;
  maxHtCents: number | null;
  tauxMarqueReelMedianPct: number | null;
  comparablesAvecCoutsReels: number | null;
};

export type Comparable = {
  projetId: string | null;
  numero: string | null;
  nom: string | null;
  termineLe: string | null;
  venduHtCents: number | null;
  heuresDevisees: number | null;
  tauxMarqueReelPct: number | null;
};

export type AnalyseComparables = {
  nombreComparables: number | null;
  seuilComparables: number | null;
  confiance: string | null;
  motifInsuffisance: string | null;
  explicationInsuffisance: string | null;
  heuresMainDoeuvreDevisees: number | null;
  familleDominante: string | null;
  bandeHeuresPct: number | null;
  ancienneteMaximaleMois: number | null;
  fourchette: Fourchette | null;
  echantillon: Comparable[];
};

export type AnalysePrix = {
  prixProposeHtCents: number | null;
  coutEstimeCents: number | null;
  margeCents: number | null;
  tauxMarquePct: number | null;
  margeCiblePct: number | null;
  ecartALaCiblePoints: number | null;
  manqueAGagnerCents: number | null;
  lignesTotal: number | null;
  lignesSansCoutSaisi: number | null;
  coutPartiel: boolean;
  verdictMarge: string | null;
  verdictComparables: string | null;
  verdict: string | null;
  confiance: Confiance;
  comparables: AnalyseComparables;
  explicationHypotheses: string[];
  explicationComparaison: string | null;
  explicationConclusion: string | null;
};

// ============================================================
// Lecture défensive du jsonb rendu par la fonction SQL
// ============================================================

/**
 * Le retour de `ai_quote_price_analysis` est un `jsonb` : PostgREST le
 * rend tel quel, sans type. On le LIT champ par champ plutôt que de le
 * caster — un cast qui ment ne se voit qu'à l'affichage, sous la forme
 * d'un « NaN % » que personne ne sait expliquer.
 */
export function lireAnalysePrix(brut: unknown): AnalysePrix | null {
  if (typeof brut !== "object" || brut === null) return null;
  const o = brut as Record<string, unknown>;

  const comparablesBrut = objet(o.comparables);
  const perimetre = objet(comparablesBrut?.perimetre);
  const fourchetteBrut = objet(comparablesBrut?.fourchette);
  const lignes = objet(o.lignes);
  const explication = objet(o.explication);

  return {
    prixProposeHtCents: nombre(o.prixProposeHtCents),
    coutEstimeCents: nombre(o.coutEstimeCents),
    margeCents: nombre(o.margeCents),
    tauxMarquePct: nombre(o.tauxMarquePct),
    margeCiblePct: nombre(o.margeCiblePct),
    ecartALaCiblePoints: nombre(o.ecartALaCiblePoints),
    manqueAGagnerCents: nombre(o.manqueAGagnerCents),
    lignesTotal: nombre(lignes?.total),
    lignesSansCoutSaisi: nombre(lignes?.sansCoutSaisi),
    coutPartiel: lignes?.coutPartiel === true,
    verdictMarge: texte(o.verdictMarge),
    verdictComparables: texte(o.verdictComparables),
    verdict: texte(o.verdict),
    confiance: confiance(o.confiance),
    comparables: {
      nombreComparables: nombre(comparablesBrut?.nombreComparables),
      seuilComparables: nombre(comparablesBrut?.seuilComparables),
      confiance: texte(comparablesBrut?.confiance),
      motifInsuffisance: texte(comparablesBrut?.motifInsuffisance),
      explicationInsuffisance: texte(comparablesBrut?.explicationInsuffisance),
      heuresMainDoeuvreDevisees: nombre(perimetre?.heuresMainDoeuvreDevisees),
      familleDominante: texte(perimetre?.familleDominante),
      bandeHeuresPct: nombre(perimetre?.bandeHeuresPct),
      ancienneteMaximaleMois: nombre(perimetre?.ancienneteMaximaleMois),
      fourchette: fourchetteBrut
        ? {
            minHtCents: nombre(fourchetteBrut.minHtCents),
            q1HtCents: nombre(fourchetteBrut.q1HtCents),
            medianeHtCents: nombre(fourchetteBrut.medianeHtCents),
            q3HtCents: nombre(fourchetteBrut.q3HtCents),
            maxHtCents: nombre(fourchetteBrut.maxHtCents),
            tauxMarqueReelMedianPct: nombre(fourchetteBrut.tauxMarqueReelMedianPct),
            comparablesAvecCoutsReels: nombre(fourchetteBrut.comparablesAvecCoutsReels),
          }
        : null,
      echantillon: liste(comparablesBrut?.echantillon).map((entree) => {
        const e = objet(entree);
        return {
          projetId: texte(e?.projetId),
          numero: texte(e?.numero),
          nom: texte(e?.nom),
          termineLe: texte(e?.termineLe),
          venduHtCents: nombre(e?.venduHtCents),
          heuresDevisees: nombre(e?.heuresDevisees),
          tauxMarqueReelPct: nombre(e?.tauxMarqueReelPct),
        };
      }),
    },
    explicationHypotheses: liste(explication?.hypotheses)
      .map((h) => texte(h))
      .filter((h): h is string => h !== null),
    explicationComparaison: texte(explication?.comparaison),
    explicationConclusion: texte(explication?.conclusion),
  };
}

function objet(valeur: unknown): Record<string, unknown> | null {
  return typeof valeur === "object" && valeur !== null && !Array.isArray(valeur)
    ? (valeur as Record<string, unknown>)
    : null;
}

function liste(valeur: unknown): unknown[] {
  return Array.isArray(valeur) ? valeur : [];
}

function texte(valeur: unknown): string | null {
  return typeof valeur === "string" && valeur.trim() !== "" ? valeur : null;
}

/**
 * Un nombre, ou `null`. PostgREST rend les `numeric` en chaîne dans
 * certains contextes : on accepte les deux, et on refuse tout le reste
 * — surtout pas de conversion silencieuse d'une absence en zéro.
 */
function nombre(valeur: unknown): number | null {
  if (typeof valeur === "number") return Number.isFinite(valeur) ? valeur : null;
  if (typeof valeur === "string" && valeur.trim() !== "") {
    const n = Number(valeur);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

const CONFIANCES: Confiance[] = ["insufficient_data", "low", "medium", "high"];

function confiance(valeur: unknown): Confiance {
  return typeof valeur === "string" && (CONFIANCES as string[]).includes(valeur)
    ? (valeur as Confiance)
    : "insufficient_data";
}

// ============================================================
// Les risques
// ============================================================

/**
 * LES RISQUES D'UN DEVIS, dans l'ordre de ce qui coûte le plus cher.
 *
 * Chacun porte sa source et sa confiance : c'est ce qui permet de le
 * contester. Un risque sans source est une opinion, et une opinion
 * affichée dans un logiciel de gestion finit par être prise pour un
 * fait.
 */
export function construireRisques(
  analyse: AnalysePrix | null,
  deplacement: ResultatTravelCost,
): Risque[] {
  const risques: Risque[] = [];

  if (analyse === null) {
    risques.push({
      cle: "analyseIndisponible",
      niveau: "information",
      titre: "L'analyse de prix n'a pas pu être calculée",
      explication:
        "Prix, coût, marge et comparables viennent d'une fonction de la base de données qui n'a pas répondu. Le déplacement, lui, est calculé ici et reste affiché.",
      source: "ai_quote_price_analysis",
      confiance: "insufficient_data",
    });
  } else {
    // 1. Le coût, avant tout le reste : sans lui, la marge ne veut rien
    //    dire, et une marge qui ne veut rien dire est plus dangereuse
    //    qu'une marge absente.
    if (analyse.coutEstimeCents === null) {
      risques.push({
        cle: "coutAbsent",
        niveau: "eleve",
        titre: "Aucun coût n'est saisi sur ce devis",
        explication:
          "Sans coût, la marge affichée serait de 100 % — ce que le logiciel refuse d'écrire. " +
          "Renseignez les coûts d'achat des lignes pour que ce devis puisse être jugé.",
        source: "quote_lines.unit_cost_cents",
        confiance: "high",
      });
    } else if (analyse.coutPartiel) {
      risques.push({
        cle: "coutPartiel",
        niveau: "eleve",
        titre: `Devis chiffré à moitié : ${analyse.lignesSansCoutSaisi ?? "plusieurs"} ligne(s) sans coût`,
        explication:
          `La marge ci-dessus ne décrit que les ${(analyse.lignesTotal ?? 0) - (analyse.lignesSansCoutSaisi ?? 0)} ligne(s) chiffrée(s), ` +
          "pas le devis. Elle est optimiste par construction.",
        source: "quote_lines.unit_cost_cents",
        confiance: "high",
      });
    }

    if (analyse.verdictMarge === "insuffisant") {
      risques.push({
        cle: "margeSousLaCible",
        niveau: "eleve",
        titre: "Le prix ne couvre pas l'objectif de marge",
        explication:
          `Taux de marque de ${formatPourcentage(analyse.tauxMarquePct)} pour une cible de ` +
          `${formatPourcentage(analyse.margeCiblePct)}, soit ${formatPoints(analyse.ecartALaCiblePoints)} d'écart.`,
        source: "ai_quote_price_analysis (SQL)",
        confiance: analyse.confiance,
      });
    }

    if (analyse.verdictMarge === "cibleNonDefinie") {
      risques.push({
        cle: "cibleNonDefinie",
        niveau: "information",
        titre: "Aucun objectif de marge n'est fixé",
        explication:
          "Sans cible, ce prix ne peut être déclaré conforme à rien. Fixez un objectif de marge dans les objectifs de l'entreprise.",
        source: "objectifs de l'entreprise",
        confiance: "high",
      });
    }

    if (analyse.verdictComparables === "auDessus") {
      risques.push({
        cle: "auDessusDesComparables",
        niveau: "moyen",
        titre: "Ce devis dépasse tous vos chantiers comparables",
        explication:
          "Vérifiez le niveau de prestation, la complexité, l'accès et le niveau de finition. " +
          "Un prix au-dessus de l'habitude peut être parfaitement justifié — c'est la justification qu'il faut pouvoir donner.",
        source: `${analyse.comparables.nombreComparables ?? 0} chantiers internes terminés`,
        confiance: analyse.confiance,
      });
    }

    if (analyse.comparables.motifInsuffisance !== null) {
      risques.push({
        cle: "comparablesInsuffisants",
        niveau: "information",
        titre: "Pas assez de chantiers comparables pour situer ce prix",
        explication:
          analyse.comparables.explicationInsuffisance ??
          "Aucune fourchette n'est proposée : trop peu de points de comparaison.",
        source: "ai_quote_comparables (SQL)",
        confiance: "insufficient_data",
      });
    }
  }

  // 2. Le déplacement, qui n'a besoin d'aucune migration pour parler.
  const comparaison = deplacement.comparaisonAuDevis;
  if (comparaison.verdict === "sousChiffragePotentiel") {
    risques.push({
      cle: "deplacementSousChiffre",
      niveau: "eleve",
      titre: "Sous-chiffrage potentiel du déplacement",
      explication: comparaison.explication,
      source: `TravelCostService — ${sourceDe(deplacement)}`,
      confiance: deplacement.confiance,
    });
  } else if (comparaison.verdict === "devisSuperieurAuBesoin") {
    risques.push({
      cle: "deplacementSurChiffre",
      niveau: "faible",
      titre: "Le devis compte plus de déplacement que nécessaire",
      explication: comparaison.explication,
      source: `TravelCostService — ${sourceDe(deplacement)}`,
      confiance: deplacement.confiance,
    });
  } else if (comparaison.verdict === "insufficientData") {
    risques.push({
      cle: "deplacementNonEvaluable",
      niveau: "information",
      titre: "Le déplacement n'a pas pu être confronté au devis",
      explication: comparaison.explication,
      source: "TravelCostService",
      confiance: "insufficient_data",
    });
  }

  return risques;
}

// ============================================================
// Les recommandations
// ============================================================

/**
 * CE QU'IL FAUT FAIRE, ET POURQUOI.
 *
 * L'ordre est celui des dépendances, pas celui de la gravité : on ne
 * recommande pas de remonter un prix tant que le coût n'est pas saisi,
 * parce que la recommandation serait fondée sur une marge fausse.
 *
 * INTERDIT EXPLICITE DE LA SPEC (p. 14) : ne jamais dire « vous êtes
 * trop cher » sans données solides. Un devis au-dessus des comparables
 * produit donc une liste de VÉRIFICATIONS, pas un verdict commercial.
 */
export function construireRecommandations(
  analyse: AnalysePrix | null,
  deplacement: ResultatTravelCost,
): Recommandation[] {
  const recommandations: Recommandation[] = [];

  if (analyse !== null && analyse.coutEstimeCents === null) {
    recommandations.push({
      cle: "saisirLesCouts",
      titre: "Saisir les coûts d'achat avant d'envoyer ce devis",
      pourquoi: [
        "Aucune ligne ne porte de coût unitaire : la marge de ce devis est inconnue.",
        "Tant qu'elle l'est, ni le prix ni la rentabilité ne peuvent être jugés — et un devis parti sans marge connue est un devis dont on découvre le résultat à la fin du chantier.",
      ],
      source: "quote_lines.unit_cost_cents",
      confiance: "high",
    });
  }

  if (analyse !== null && analyse.verdictMarge === "insuffisant") {
    const pourquoi = [
      `Taux de marque de ${formatPourcentage(analyse.tauxMarquePct)} contre un objectif de ${formatPourcentage(analyse.margeCiblePct)}.`,
    ];
    if (analyse.manqueAGagnerCents !== null) {
      pourquoi.push(
        `Il manque environ ${formatEuros(analyse.manqueAGagnerCents)} HT pour atteindre la cible au périmètre actuel.`,
      );
    }
    if (analyse.coutPartiel) {
      pourquoi.push(
        "Attention : le coût est partiel, donc l'écart réel est probablement plus grand que celui-ci.",
      );
    }
    recommandations.push({
      cle: "remonterLePrix",
      titre: "Remonter le prix, ou retirer du périmètre",
      pourquoi,
      source: "ai_quote_price_analysis (SQL)",
      confiance: analyse.confiance,
    });
  }

  if (deplacement.comparaisonAuDevis.verdict === "sousChiffragePotentiel") {
    const ecart = deplacement.comparaisonAuDevis.ecartHeures;
    const pourquoi = [deplacement.comparaisonAuDevis.explication];
    if (deplacement.temps.connu && deplacement.temps.valeur.origine === "estimeDepuisLaDistance") {
      pourquoi.push(
        "Le temps de trajet est estimé à partir d'une distance elle-même estimée : saisissez le temps réel pour trancher.",
      );
    }
    recommandations.push({
      cle: "chiffrerLeDeplacement",
      titre:
        ecart !== null
          ? `Ajouter ${formatHeuresMinutes(ecart)} de déplacement au devis`
          : "Chiffrer le déplacement dans le devis",
      pourquoi,
      source: `TravelCostService — ${sourceDe(deplacement)}`,
      confiance: deplacement.confiance,
    });
  }

  if (analyse !== null && analyse.verdictComparables === "auDessus") {
    recommandations.push({
      cle: "verifierLEcartAuxComparables",
      titre: "Vérifier ce qui justifie l'écart à vos chantiers habituels",
      pourquoi: [
        `Ce devis se situe au-dessus des ${analyse.comparables.nombreComparables ?? 0} chantiers internes de périmètre équivalent.`,
        "Points à contrôler : niveau de prestation, complexité, accès, niveau de finition.",
        "Ce n'est pas un verdict : un prix plus élevé peut être le bon, il doit juste être explicable au client.",
      ],
      source: "ai_quote_comparables (SQL)",
      confiance: analyse.confiance,
    });
  }

  if (analyse !== null && analyse.verdictMarge === "cibleNonDefinie") {
    recommandations.push({
      cle: "fixerUneCible",
      titre: "Fixer un objectif de marge pour l'entreprise",
      pourquoi: [
        "Sans objectif, aucun devis ne peut être déclaré correct : il n'y a rien à quoi le comparer.",
        "C'est la seule recommandation qui vaut pour tous vos devis à la fois.",
      ],
      source: "objectifs de l'entreprise",
      confiance: "high",
    });
  }

  if (recommandations.length === 0) {
    const riens: string[] = [];
    if (analyse !== null && analyse.verdict === "correct") {
      riens.push("Le prix couvre l'objectif de marge de l'entreprise.");
      if (analyse.verdictComparables === "dansLaFourchette") {
        riens.push("Il reste dans la fourchette de vos chantiers comparables.");
      }
    }
    if (deplacement.comparaisonAuDevis.verdict === "coherent") {
      riens.push(deplacement.comparaisonAuDevis.explication);
    }
    recommandations.push({
      cle: "rienASignaler",
      titre:
        riens.length > 0
          ? "Rien à corriger sur ce devis"
          : "Aucune recommandation : les données manquent pour se prononcer",
      pourquoi:
        riens.length > 0
          ? riens
          : [
              "Les contrôles disponibles n'ont pas assez de données pour conclure. L'absence d'alerte ne vaut pas validation.",
            ],
      source: "règles déterministes du panneau",
      confiance: riens.length > 0 ? "medium" : "insufficient_data",
    });
  }

  return recommandations;
}

function sourceDe(deplacement: ResultatTravelCost): string {
  if (!deplacement.temps.connu) return "hypothèses incomplètes";
  return deplacement.temps.valeur.origine === "fourniParLUtilisateur"
    ? "temps de trajet saisi"
    : "distance et vitesse estimées";
}

export function formatPourcentage(valeur: number | null): string {
  if (valeur === null) return "—";
  return `${valeur.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %`;
}

function formatPoints(valeur: number | null): string {
  if (valeur === null) return "—";
  return `${valeur.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} point(s)`;
}

function formatEuros(cents: number | null): string {
  if (cents === null) return "—";
  return (cents / 100).toLocaleString("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  });
}
