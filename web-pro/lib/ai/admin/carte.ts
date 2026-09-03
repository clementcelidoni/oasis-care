// Imports fichier par fichier, jamais `../model/index.ts` : la barrière
// d'export du routeur réexporte `provider.ts`, donc `@openai/agents` et
// ses 66 Mo. Cette carte est pure et doit le rester jusque dans ses
// dépendances, sans quoi son test chargerait le SDK.
import {
  AGENTS_MODELE,
  NIVEAUX_MODELE,
  type CleAgentModele,
  type NiveauModele,
} from "../model/types.ts";
import {
  variableEnvironnementAgent,
  type AnomalieConfiguration,
} from "../model/configuration.ts";
import type { EtatRouteur } from "../model/router.ts";
import {
  AGENTS_PAGE_26,
  LIBELLES_AGENT,
  MISSIONS_AGENT,
  NIVEAU_LIVRE,
  agentsHorsPage26,
  cleSqlDeLAgent,
  type CleAgentSql,
} from "./types.ts";

/**
 * §11V — LA CARTE AGENT → MODÈLE (spec p. 26).
 *
 * ══════════════════════════════════════════════════════════════════
 * CE FICHIER EST PUR, ET C'EST TOUT L'INTÉRÊT
 * ══════════════════════════════════════════════════════════════════
 *
 * Il prend l'état du routeur — les trois identifiants en vigueur, la
 * table des quatorze agents, les surcharges d'environnement retenues ou
 * refusées — et les lignes d'`ai_model_overrides` de l'entreprise. Il
 * rend ce que l'écran affiche. Aucun appel réseau, aucune lecture de
 * base : la logique la plus délicate de la page — « quel modèle
 * gagne ? » — s'éprouve donc sans base et sans jeton.
 *
 * ══════════════════════════════════════════════════════════════════
 * TROIS SOURCES POSSIBLES POUR UN MODÈLE, ET ELLES SE SUPERPOSENT
 * ══════════════════════════════════════════════════════════════════
 *
 *   1. LE PRODUIT. La table de `configuration.ts`, recopiée de la
 *      page 5. C'est le cas de figure normal, et le seul qui bénéficie
 *      automatiquement d'un changement d'aiguillage : une entreprise
 *      sans surcharge suit le produit.
 *
 *   2. L'ENVIRONNEMENT. `OASIS_MODEL_AGENT_FINANCE=advanced` déplace un
 *      agent d'un niveau POUR TOUT LE SERVEUR, donc pour toutes les
 *      entreprises. C'est le « modelOverride pour tests
 *      administrateur » de la page 5-6 : réversible en une minute,
 *      sans redéploiement.
 *
 *   3. L'ENTREPRISE. Une ligne d'`ai_model_overrides` (0076) fixe un
 *      IDENTIFIANT DE MODÈLE pour un agent, dans cette entreprise
 *      seulement. C'est la plus forte des trois, et la seule qui
 *      s'écrit depuis l'écran.
 *
 * ══════════════════════════════════════════════════════════════════
 * LE PIÈGE QUE CETTE CARTE SURVEILLE : LA SURCHARGE QUI DÉCROCHE
 * ══════════════════════════════════════════════════════════════════
 *
 * `ai_model_overrides.model` est du TEXTE LIBRE — la migration 0076
 * l'assume et explique pourquoi : SQL ne doit connaître aucun nom de
 * modèle. Conséquence directe, et elle est sérieuse : une surcharge fige
 * un identifiant LITTÉRAL. Le jour où `OASIS_MODEL_ADVANCED` corrige un
 * nom faux, ou bien où la famille de modèles change de génération,
 * l'entreprise qui a posé une surcharge reste accrochée à l'ancien
 * identifiant — et son IA tombe en 404 pendant que celle du voisin
 * tourne.
 *
 * Personne ne s'en apercevrait : la table est correcte, le routeur est
 * correct, chacun fait ce qu'on lui a demandé. C'est pourquoi
 * `niveauEffectif` vaut `null` dès que l'identifiant surchargé ne
 * correspond à AUCUN des trois niveaux configurés, et pourquoi
 * `desalignee` existe. L'écran affiche alors un avertissement nommant
 * l'identifiant orphelin, et propose de revenir au réglage du produit.
 *
 * Ranger d'office une surcharge inconnue sur « standard » aurait été
 * l'erreur symétrique de celle que `repartirParNiveau` refuse déjà
 * (`cost.ts`) : cela ferait disparaître exactement l'anomalie qu'on
 * cherche à voir.
 */

// ------------------------------------------------------------------
// Ce que la base rend
// ------------------------------------------------------------------

/** Une ligne d'`ai_model_overrides`, telle que l'écran la reçoit. */
export type SurchargeOrganisation = {
  agent: CleAgentSql;
  /** L'identifiant littéral enregistré. Jamais un niveau. */
  modele: string;
  /** Pourquoi cette entreprise déroge. Facultatif en base. */
  motif: string | null;
  posLe: string | null;
};

/** D'où vient le modèle finalement retenu pour un agent. */
export type SourceModele = "produit" | "environnement" | "entreprise";

export type LigneCarte = {
  cle: CleAgentModele;
  libelle: string;
  mission: string;

  /** Le niveau que le produit livre pour cet agent (table de la p. 5). */
  niveauLivre: NiveauModele;
  /** Le niveau après surcharge d'environnement. Souvent identique. */
  niveauConfigure: NiveauModele;
  /** Vrai quand une variable d'environnement a déplacé cet agent. */
  deplaceParEnvironnement: boolean;
  /** La variable qui déplacerait cet agent d'un niveau. */
  variableEnvironnement: string;

  /** L'identifiant que `niveauConfigure` désigne aujourd'hui. */
  modeleConfigure: string;

  /** La surcharge de l'entreprise, ou `null`. */
  surcharge: SurchargeOrganisation | null;
  /** Vrai si cet agent peut recevoir une surcharge en base (4 sur 14). */
  surchargeable: boolean;
  cleSql: CleAgentSql | null;

  /** L'identifiant réellement retenu, toutes sources confondues. */
  modeleEffectif: string;
  /**
   * Le niveau du modèle effectif, ou `null` si cet identifiant ne
   * correspond à aucun des trois niveaux configurés.
   */
  niveauEffectif: NiveauModele | null;
  /** Vrai quand `niveauEffectif` est `null` à cause d'une surcharge. */
  desalignee: boolean;

  source: SourceModele;
};

export type CarteAgents = {
  /** Les sept lignes de la page 26, dans son ordre. */
  page26: LigneCarte[];
  /** Les sept autres agents du catalogue, calibrés mais pas encore écrits. */
  reste: LigneCarte[];
  /** Les trois identifiants en vigueur, par niveau. */
  modeles: Readonly<Record<NiveauModele, string>>;
  /** Les surcharges d'environnement REFUSÉES. L'écran doit les montrer. */
  anomalies: readonly AnomalieConfiguration[];
  /** Les surcharges d'entreprise qui pointent un identifiant inconnu. */
  surchargesDesalignees: LigneCarte[];
  /** Le nombre de surcharges d'entreprise en vigueur. */
  nombreSurcharges: number;
};

/**
 * Assemble la carte.
 *
 * `surcharges` vient de la base ; une clé d'agent qu'on ne reconnaît pas
 * est simplement ignorée plutôt que de faire échouer la page — c'est
 * une donnée, pas une instruction, et une carte qui refuse de
 * s'afficher parce qu'une ligne parasite traîne serait un mauvais
 * échange.
 */
export function construireCarte(
  etat: EtatRouteur,
  surcharges: readonly SurchargeOrganisation[] = [],
): CarteAgents {
  const parAgentSql = new Map<CleAgentSql, SurchargeOrganisation>();
  for (const surcharge of surcharges) parAgentSql.set(surcharge.agent, surcharge);

  // L'index inverse identifiant → niveau. Il sert à dire si une
  // surcharge est encore alignée sur la configuration du jour.
  const niveauDuModele = new Map<string, NiveauModele>();
  for (const niveau of NIVEAUX_MODELE) niveauDuModele.set(etat.modeles[niveau], niveau);

  const construire = (cle: CleAgentModele): LigneCarte => {
    const niveauLivre = NIVEAU_LIVRE[cle];
    const niveauConfigure = etat.agents[cle];
    const modeleConfigure = etat.modeles[niveauConfigure];
    const cleSql = cleSqlDeLAgent(cle);
    const surcharge = cleSql === null ? null : (parAgentSql.get(cleSql) ?? null);

    const modeleEffectif = surcharge?.modele ?? modeleConfigure;
    const niveauEffectif = niveauDuModele.get(modeleEffectif) ?? null;

    return {
      cle,
      libelle: LIBELLES_AGENT[cle],
      mission: MISSIONS_AGENT[cle],
      niveauLivre,
      niveauConfigure,
      deplaceParEnvironnement: niveauConfigure !== niveauLivre,
      variableEnvironnement: variableEnvironnementAgent(cle),
      modeleConfigure,
      surcharge,
      surchargeable: cleSql !== null,
      cleSql,
      modeleEffectif,
      niveauEffectif,
      desalignee: surcharge !== null && niveauEffectif === null,
      source:
        surcharge !== null
          ? "entreprise"
          : niveauConfigure !== niveauLivre
            ? "environnement"
            : "produit",
    };
  };

  const page26 = AGENTS_PAGE_26.map(construire);
  // `AGENTS_MODELE` et non `Object.keys(etat.agents)` : l'ordre des clés
  // d'un objet est un détail d'implémentation, alors que l'ordre des
  // agents est une décision — celle de la page 5.
  const reste = agentsHorsPage26(AGENTS_MODELE).map(construire);

  const toutes = [...page26, ...reste];

  return {
    page26,
    reste,
    modeles: etat.modeles,
    anomalies: etat.anomalies,
    surchargesDesalignees: toutes.filter((ligne) => ligne.desalignee),
    nombreSurcharges: toutes.filter((ligne) => ligne.surcharge !== null).length,
  };
}

/**
 * Le choix qu'un sélecteur peut porter, pour un agent surchargeable.
 *
 * QUATRE OPTIONS ET PAS TROIS. « Réglage du produit » n'est pas la même
 * chose que « le niveau que le produit donne aujourd'hui » : la
 * première suit les évolutions, la seconde fige. Un sélecteur à trois
 * entrées obligerait à choisir une valeur figée pour dire « je ne veux
 * rien changer », ce qui est exactement le piège décrit en tête de
 * fichier.
 */
export const CHOIX_PRODUIT = "produit";

export type ChoixSurcharge = typeof CHOIX_PRODUIT | NiveauModele;

export function estChoixSurcharge(valeur: unknown): valeur is ChoixSurcharge {
  return (
    valeur === CHOIX_PRODUIT ||
    (typeof valeur === "string" && (NIVEAUX_MODELE as readonly string[]).includes(valeur))
  );
}

/**
 * Ce que le sélecteur doit afficher comme valeur courante.
 *
 * Une surcharge désalignée ne se laisse représenter par aucune des
 * quatre options : elle rend `null`, et l'écran affiche l'identifiant
 * orphelin en toutes lettres au lieu de prétendre qu'il correspond à un
 * niveau.
 */
export function choixCourant(ligne: LigneCarte): ChoixSurcharge | null {
  if (ligne.surcharge === null) return CHOIX_PRODUIT;
  return ligne.niveauEffectif;
}
