/**
 * §7 « protocoles » — QUEL PROTOCOLE MARCHE, ET SUR COMBIEN DE LOTS.
 *
 * ══════════════════════════════════════════════════════════════════
 * CE QU'EST UN « PROTOCOLE » DANS CE PRODUIT — LA MESURE D'ABORD
 * ══════════════════════════════════════════════════════════════════
 *
 * Il n'existe AUCUNE table `protocols` en base, et aucune table de SOP.
 * Balayage fait : les vingt et une tables BioLab n'en portent pas la
 * trace. Construire un écran « Protocoles » adossé à une table neuve
 * serait exactement le second système BioLab que le §6 interdit.
 *
 * Le protocole du produit, c'est la VERSION DE RECETTE. Le modèle
 * mobile le dit lui-même — `MediumRecipe` se documente comme « the
 * named recipe/protocol » — et tout le module raisonne ainsi :
 * `ProtocolComparisonService` compare des `MediumRecipeVersion`, et
 * `BioLabKnowledgeEngine` en mesure la performance. Cet écran est donc
 * la vue de comparaison des protocoles réellement employés, adossée aux
 * lots qui les ont reçus.
 *
 * IL RESTE UNE CHOSE QUE LE MOT « PROTOCOLE » DÉSIGNE AILLEURS DANS LE
 * MODULE, ET QUI N'EST PAS ICI : `ProtocolSource`, la citation
 * bibliographique attachée à une réponse de l'IA. Elle n'est persistée
 * dans aucune table — elle vit le temps d'une réponse. Il n'y a donc
 * rien à afficher, et un écran « Sources » serait une façade.
 *
 * ══════════════════════════════════════════════════════════════════
 * CE QUE CE FICHIER NE FAIT JAMAIS
 * ══════════════════════════════════════════════════════════════════
 *
 * Il ne conclut pas à une causalité (§29 du module : « ne pas conclure
 * automatiquement à une causalité »). Il dit ce qui diffère et ce qui a
 * été observé. Deux protocoles peuvent différer sur le pH ET avoir été
 * employés sur deux espèces différentes, deux saisons différentes, par
 * deux personnes différentes : rien ici ne permet d'attribuer l'écart
 * de résultat à l'écart de composition, et rien ici ne le prétend.
 */

import { SEUIL_TAUX, direTaux, type TauxObserve } from "./referentiel.ts";
import { formatFacteur, formatNombre, formatPourcentage } from "./cultures.ts";
import {
  indicateursDuGroupe,
  type IndicateursGroupe,
  type LigneAcclimatation,
  type LigneInspection,
  type LigneLot,
} from "./statistiques.ts";
import { lireComposants, resumerComposition, type LigneRecette, type LigneVersion } from "./recettes.ts";

// ==================================================================
// 1. La performance observée d'une version
// ==================================================================

export type PerformanceProtocole = {
  version: LigneVersion;
  recette: LigneRecette | null;
  /** Le libellé qu'un opérateur reconnaît : « MS Alocasia · V3 ». */
  intitule: string;
  indicateurs: IndicateursGroupe;
  /** Les espèces sur lesquelles ce protocole a réellement servi. */
  especes: string[];
  /**
   * false quand la performance repose sur moins de `SEUIL_TAUX` lots.
   * Le chiffre reste affiché — il est vrai — mais jamais présenté
   * comme une tendance.
   */
  solide: boolean;
};

/**
 * La performance de chaque version RÉELLEMENT EMPLOYÉE.
 *
 * Une version que personne n'a utilisée n'a pas d'entrée — elle n'a pas
 * une performance de zéro, elle n'a pas de performance. C'est la règle
 * de `BioLabKnowledgeEngine.performance`, reprise telle quelle : une
 * ligne à 0 % de contamination pour une recette jamais essayée serait
 * la plus séduisante du tableau, et la plus mensongère.
 */
export function performanceDesProtocoles(
  versions: readonly LigneVersion[],
  recettes: readonly LigneRecette[],
  lots: readonly LigneLot[],
  inspections: readonly LigneInspection[],
  acclimatations: readonly LigneAcclimatation[],
): PerformanceProtocole[] {
  const parRecette = new Map(recettes.map((r) => [r.id, r]));

  const resultat: PerformanceProtocole[] = [];
  for (const version of versions) {
    const lotsDeLaVersion = lots.filter((l) => l.medium_recipe_version_id === version.id);
    if (lotsDeLaVersion.length === 0) continue;

    const recette = parRecette.get(version.recipe_id) ?? null;
    const indicateurs = indicateursDuGroupe(lotsDeLaVersion, inspections, acclimatations);
    const especes = [...new Set(lotsDeLaVersion.map((l) => l.species_name).filter((n) => n.length > 0))].sort(
      (a, b) => a.localeCompare(b, "fr"),
    );

    resultat.push({
      version,
      recette,
      intitule: `${recette?.name ?? "Recette inconnue"} · V${version.version_number}`,
      indicateurs,
      especes,
      solide: lotsDeLaVersion.length >= SEUIL_TAUX,
    });
  }

  return resultat.sort((a, b) => b.indicateurs.lots - a.indicateurs.lots || a.intitule.localeCompare(b.intitule, "fr"));
}

// ==================================================================
// 2. Le score relatif
// ==================================================================

/**
 * La pondération. Un profil d'usage, PAS une vérité scientifique.
 *
 * Reprise à l'identique de `ProtocolPerformanceScore.Weights.default`
 * du module mobile, pour que les deux faces du produit classent les
 * protocoles dans le même ordre. §27 du module : « Ne pas hardcoder un
 * score scientifique universel » — d'où le fait que ce soit un
 * paramètre et que l'écran dise sur quoi il repose.
 */
export type Ponderation = {
  multiplication: number;
  enracinement: number;
  hyperhydricite: number;
  contamination: number;
  survie: number;
};

export const PONDERATION_PAR_DEFAUT: Ponderation = {
  multiplication: 0.4,
  enracinement: 0.2,
  hyperhydricite: 0.15,
  contamination: 0.15,
  survie: 0.1,
};

export type ScoreProtocole = {
  versionId: string;
  /** 0 à 100, RELATIF aux protocoles comparés ensemble. null si un seul. */
  score: number | null;
  lots: number;
  solide: boolean;
};

/**
 * Normalise les valeurs connues sur 0…1, en retournant le sens quand
 * « moins » vaut « mieux » (contamination, hyperhydricité).
 *
 * Toutes égales, ou une seule : 0,5 — un milieu neutre. Les mettre à 0
 * ou à 1 inventerait une hiérarchie entre des valeurs identiques.
 */
function normaliser(
  paires: readonly (readonly [string, number | null])[],
  plusEstMieux: boolean,
): Map<string, number> {
  const reelles = paires.filter((p): p is readonly [string, number] => p[1] !== null && Number.isFinite(p[1]));
  if (reelles.length === 0) return new Map();
  const valeurs = reelles.map((p) => p[1]);
  const min = Math.min(...valeurs);
  const max = Math.max(...valeurs);
  if (max <= min) return new Map(reelles.map(([id]) => [id, 0.5]));
  return new Map(
    reelles.map(([id, valeur]) => {
      const echelle = (valeur - min) / (max - min);
      return [id, plusEstMieux ? echelle : 1 - echelle];
    }),
  );
}

/**
 * Le score interne, RELATIF et jamais absolu.
 *
 * §26 du module : « une recette basée sur un seul lot ne doit pas être
 * présentée comme meilleure de manière certaine ». Deux garde-fous, et
 * ils ne se remplacent pas :
 *
 *   1. Un protocole seul n'a pas de score — il n'y a rien contre quoi
 *      le comparer, et lui donner 100 sur 100 le sacrerait meilleur du
 *      laboratoire par le seul fait d'être unique.
 *   2. Un indicateur manquant ne compte pas comme zéro : il sort du
 *      calcul, et son poids avec lui. Un protocole sans acclimatation
 *      enregistrée n'est pas un protocole dont les plantules meurent.
 */
export function scorerProtocoles(
  performances: readonly PerformanceProtocole[],
  ponderation: Ponderation = PONDERATION_PAR_DEFAUT,
): ScoreProtocole[] {
  const base = performances.map((p) => ({
    versionId: p.version.id,
    lots: p.indicateurs.lots,
    solide: p.solide,
  }));

  if (performances.length < 2) return base.map((b) => ({ ...b, score: null }));

  const cle = (p: PerformanceProtocole) => p.version.id;
  const multiplication = normaliser(
    performances.map((p) => [cle(p), p.indicateurs.multiplication] as const),
    true,
  );
  const enracinement = normaliser(
    performances.map((p) => [cle(p), p.indicateurs.enracinement.taux] as const),
    true,
  );
  const survie = normaliser(performances.map((p) => [cle(p), p.indicateurs.survie] as const), true);
  const hyperhydricite = normaliser(
    performances.map((p) => [cle(p), p.indicateurs.hyperhydricite.taux] as const),
    false,
  );
  const contamination = normaliser(
    performances.map((p) => [cle(p), p.indicateurs.contamination.taux] as const),
    false,
  );

  return performances.map((performance, index) => {
    const contributions: [Map<string, number>, number][] = [
      [multiplication, ponderation.multiplication],
      [enracinement, ponderation.enracinement],
      [survie, ponderation.survie],
      [hyperhydricite, ponderation.hyperhydricite],
      [contamination, ponderation.contamination],
    ];

    let somme = 0;
    let poidsTotal = 0;
    for (const [valeurs, poids] of contributions) {
      const valeur = valeurs.get(performance.version.id);
      if (valeur === undefined) continue;
      somme += valeur * poids;
      poidsTotal += poids;
    }

    return { ...base[index], score: poidsTotal > 0 ? (somme / poidsTotal) * 100 : null };
  });
}

// ==================================================================
// 2 bis. LE GROUPE — CE QUI EST COMPARABLE À QUOI
// ==================================================================

/**
 * ON NE CLASSE QUE CE QUI EST COMPARABLE, ET LE TÉLÉPHONE LE DIT
 * LUI-MÊME.
 *
 * `BioLabKnowledgeEngine` documente son score en toutes lettres :
 * « 0-100, relative to the other versions actually being scored
 * together in this same call. Never an absolute, portable, or
 * comparable-across-species number. » Ses deux seuls appelants
 * respectent ce cadre — le tableau de bord regroupe par recette avant
 * de scorer (`Dictionary(grouping:) { $0.recipe?.id }`), et la feuille
 * de comparaison ne compare que les versions d'UNE recette.
 *
 * Le web, lui, scorait TOUT le laboratoire d'un seul appel. La
 * pondération était bien la même que celle du mobile, mais le score
 * est une normalisation min-max sur l'ensemble comparé : normaliser sur
 * un autre ensemble donne d'autres nombres, et parfois un autre ordre.
 * L'écran affirmait pourtant que « les deux classent dans le même
 * ordre ». Pire, la colonne « Espèces » du même tableau montrait que
 * les lignes ne portaient pas la même espèce : on classait une recette
 * d'Alocasia contre une recette de Monstera, ce qui ne veut rien dire —
 * un milieu qui contamine peu sur une espèce facile n'est pas meilleur
 * qu'un milieu qui contamine sur une espèce difficile.
 *
 * On regroupe donc AVANT de scorer, par recette, comme le téléphone.
 */
export type GroupeProtocoles = {
  clef: string;
  intitule: string;
  /** Les espèces réellement rencontrées dans ce groupe, toutes versions confondues. */
  especes: string[];
  performances: PerformanceProtocole[];
  scores: Map<string, ScoreProtocole>;
  /** `null` quand le groupe n'a qu'une version : il n'y a rien à comparer. */
  comparaison: Comparaison | null;
};

export function grouperProtocolesParRecette(
  performances: readonly PerformanceProtocole[],
  ponderation: Ponderation = PONDERATION_PAR_DEFAUT,
): GroupeProtocoles[] {
  const groupes = new Map<string, PerformanceProtocole[]>();
  for (const p of performances) {
    // Une version orpheline — sa recette a disparu ou vit dans un autre
    // espace — ne se mélange pas aux autres : on ne sait pas de quoi
    // elle est une variante.
    const clef = p.recette?.id ?? `sans-recette:${p.version.id}`;
    const liste = groupes.get(clef);
    if (liste) liste.push(p);
    else groupes.set(clef, [p]);
  }

  return [...groupes.entries()]
    .map(([clef, liste]) => {
      const trie = [...liste].sort(
        (a, b) => a.version.version_number - b.version.version_number,
      );
      return {
        clef,
        intitule: trie[0].recette?.name ?? "Recette inconnue",
        especes: [...new Set(trie.flatMap((p) => p.especes))].sort((a, b) =>
          a.localeCompare(b, "fr"),
        ),
        performances: trie,
        scores: new Map(scorerProtocoles(trie, ponderation).map((s) => [s.versionId, s])),
        // Comparer une version à elle-même n'apprend rien, et
        // « ils diffèrent sur : … » n'a de sens qu'entre variantes
        // d'une même recette.
        comparaison: trie.length >= 2 ? comparerProtocoles(trie) : null,
      };
    })
    .sort(
      (a, b) =>
        b.performances.length - a.performances.length ||
        a.intitule.localeCompare(b.intitule, "fr"),
    );
}

// ==================================================================
// 3. La comparaison, ligne à ligne
// ==================================================================

export type LigneComparaison = {
  champ: string;
  valeurs: string[];
  /** Vrai quand les protocoles comparés ne disent pas la même chose. */
  differe: boolean;
};

export type Comparaison = {
  intitules: string[];
  lignes: LigneComparaison[];
  /** Les champs sur lesquels ils diffèrent, pour l'annoncer en une phrase. */
  champsDifferents: string[];
};

function ligne(champ: string, valeurs: string[]): LigneComparaison {
  return { champ, valeurs, differe: new Set(valeurs).size > 1 };
}

function direMilieuDeBase(version: LigneVersion): string {
  const resume = resumerComposition(lireComposants(version.components).composants);
  return resume.milieuxDeBase.length === 0 ? "—" : resume.milieuxDeBase.join(", ");
}

function direRegulateurs(version: LigneVersion): string {
  const resume = resumerComposition(lireComposants(version.components).composants);
  return resume.regulateurs.length === 0 ? "Aucun" : resume.regulateurs.join(" · ");
}

function direTauxOuRien(taux: TauxObserve | undefined): string {
  return taux ? direTaux(taux) : "Non disponible";
}

/**
 * Le tableau de comparaison — transposition fidèle de
 * `ProtocolComparisonService.compare`.
 *
 * Une comparaison locale et déterministe, sans appel d'IA : tout ce qui
 * est comparé ici est déjà de la donnée structurée. Faire commenter des
 * nombres par un modèle coûterait de l'argent pour ajouter de
 * l'incertitude à un calcul qui n'en avait pas.
 */
export function comparerProtocoles(performances: readonly PerformanceProtocole[]): Comparaison {
  const intitules = performances.map((p) => p.intitule);

  const lignes: LigneComparaison[] = [
    ligne("pH cible", performances.map((p) => formatNombre(p.version.target_ph) ?? "—")),
    ligne("Milieu de base", performances.map((p) => direMilieuDeBase(p.version))),
    ligne("Régulateurs de croissance", performances.map((p) => direRegulateurs(p.version))),
    ligne(
      "Composants",
      performances.map((p) => `${lireComposants(p.version.components).composants.length}`),
    ),
    ligne("Espèces employées", performances.map((p) => (p.especes.length === 0 ? "—" : p.especes.join(", ")))),
    ligne("Basé sur", performances.map((p) => `${p.indicateurs.lots} lot${p.indicateurs.lots > 1 ? "s" : ""}`)),
    ligne("Multiplication moyenne", performances.map((p) => formatFacteur(p.indicateurs.multiplication) ?? "Non disponible")),
    ligne("Contamination confirmée", performances.map((p) => direTauxOuRien(p.indicateurs.contamination))),
    ligne("Hyperhydricité", performances.map((p) => direTauxOuRien(p.indicateurs.hyperhydricite))),
    ligne("Enracinement atteint", performances.map((p) => direTauxOuRien(p.indicateurs.enracinement))),
    ligne(
      "Survie en acclimatation",
      performances.map((p) =>
        formatPourcentage(p.indicateurs.survie) ?? "Non disponible",
      ),
    ),
  ];

  return { intitules, lignes, champsDifferents: lignes.filter((l) => l.differe).map((l) => l.champ) };
}
