import {
  AGENTS,
  CLE_SQL_AGENT,
  LIBELLES_AGENT,
  MISSIONS_AGENT,
  NIVEAUX,
  NIVEAU_LIVRE,
  cleAgentDepuisSql,
  estNiveau,
  variableAgent,
  type CleAgent,
  type EtatRouteur,
  type Niveau,
} from "./modeles.ts";
import type { LigneSurcharge } from "./types.ts";

/**
 * ==================================================================
 * LA CARTE AGENT → MODÈLE, ET LE PIÈGE QU'ELLE SURVEILLE
 * ==================================================================
 *
 * Ce fichier est PUR : il prend l'état du routeur (les trois
 * identifiants en vigueur, la table des quatorze agents, les anomalies)
 * et les lignes d'`ai_model_overrides` d'une entreprise, et il rend ce
 * que l'écran affiche. Aucun appel réseau, aucune lecture de base. La
 * question la plus délicate de la page — « quel modèle gagne ? » —
 * s'éprouve donc sans base et sans jeton.
 *
 * ------------------------------------------------------------------
 * TROIS SOURCES, ET ELLES SE SUPERPOSENT DANS CET ORDRE
 * ------------------------------------------------------------------
 *   1. LE PRODUIT — la table livrée. C'est le cas normal, et le seul
 *      qui profite automatiquement d'un changement d'aiguillage.
 *   2. L'ENVIRONNEMENT — `OASIS_MODEL_AGENT_FINANCE=advanced` déplace
 *      un agent pour TOUT LE SERVEUR, donc pour toutes les entreprises.
 *   3. L'ENTREPRISE — une ligne d'`ai_model_overrides` fixe un
 *      IDENTIFIANT pour un agent, chez elle seulement. La plus forte
 *      des trois, et depuis 0080 la seule que le Control Center écrit.
 *
 * ------------------------------------------------------------------
 * LA SURCHARGE QUI DÉCROCHE
 * ------------------------------------------------------------------
 * `ai_model_overrides.model` est du texte libre — la migration 0076
 * l'assume : SQL ne doit connaître aucun nom de modèle. Une surcharge
 * fige donc un identifiant LITTÉRAL. Le jour où `OASIS_MODEL_ADVANCED`
 * corrige un nom faux, ou bien où la famille de modèles change de
 * génération, l'entreprise surchargée reste accrochée à l'ancien
 * identifiant et son IA tombe en 404 pendant que celle du voisin
 * tourne.
 *
 * Personne ne s'en apercevrait : la table est correcte, le routeur est
 * correct, chacun fait ce qu'on lui demande. D'où `niveauEffectif` à
 * `null` dès que l'identifiant surchargé ne correspond à AUCUN des
 * trois identifiants en vigueur, et d'où `decrochee`. Ranger d'office
 * une surcharge inconnue sur « standard » serait exactement l'erreur
 * que ce projet a corrigée quatre fois ailleurs sous la forme
 * `?? 0` : faire disparaître l'anomalie qu'on cherche à voir.
 */

/** D'où vient le modèle finalement retenu pour un agent. */
export type SourceModele = "produit" | "environnement" | "entreprise";

export type LigneCarte = {
  cle: CleAgent;
  libelle: string;
  mission: string;

  /** Le niveau que le produit livre pour cet agent. */
  niveauLivre: Niveau;
  /** Le niveau après variable d'environnement. Souvent identique. */
  niveauConfigure: Niveau;
  /** Vrai quand une variable a déplacé cet agent sur ce serveur. */
  deplaceParEnvironnement: boolean;
  /** La variable qui déplacerait cet agent d'un niveau. */
  variableEnvironnement: string;
  /** L'identifiant que `niveauConfigure` désigne aujourd'hui. */
  modeleConfigure: string;

  /** La surcharge d'entreprise, ou `null`. */
  surcharge: LigneSurcharge | null;
  /** Vrai si la base accepte une surcharge sur cet agent (4 sur 14). */
  surchargeable: boolean;
  /** La graphie que la base attend, ou `null` si l'agent n'est pas surchargeable. */
  cleSql: string | null;

  /** L'identifiant réellement retenu, toutes sources confondues. */
  modeleEffectif: string;
  /** Le niveau de cet identifiant, ou `null` s'il n'en désigne aucun. */
  niveauEffectif: Niveau | null;
  /** Vrai quand `niveauEffectif` est nul À CAUSE d'une surcharge. */
  decrochee: boolean;

  source: SourceModele;
};

export type Carte = {
  /** Les quatre agents que la base sait surcharger, en tête. */
  surchargeables: LigneCarte[];
  /** Les dix autres : calibrés, pas encore écrits, non surchargeables. */
  autres: LigneCarte[];
  /** Le nombre de surcharges en vigueur chez cette entreprise. */
  nombreSurcharges: number;
  /** Celles qui pointent un identifiant que plus personne ne sert. */
  decrochees: LigneCarte[];
};

/**
 * L'index inverse identifiant → niveau, pour dire si une surcharge est
 * encore alignée sur la configuration du jour.
 *
 * Deux niveaux configurés sur le MÊME identifiant est une configuration
 * absurde mais possible (deux variables recopiées l'une sur l'autre) :
 * le premier des trois gagne, dans l'ordre economy → advanced, et
 * l'écran ne prétend rien de plus.
 */
export function niveauDeLIdentifiant(etat: EtatRouteur, modele: string): Niveau | null {
  for (const niveau of NIVEAUX) {
    if (etat.modeles[niveau] === modele) return niveau;
  }
  return null;
}

/**
 * Assemble la carte d'une entreprise.
 *
 * Une clé d'agent que le catalogue ne connaît pas est IGNORÉE plutôt
 * que de faire échouer la page : c'est une donnée venue d'une table,
 * pas une instruction, et une carte qui refuse de s'afficher parce
 * qu'une ligne parasite traîne serait un mauvais échange. Elle reste
 * visible ailleurs — `surchargesOrphelines()` la ramasse, pour qu'elle
 * ne disparaisse pas non plus en silence.
 */
export function construireCarte(
  etat: EtatRouteur,
  surcharges: readonly LigneSurcharge[] = [],
): Carte {
  const parAgentSql = new Map<string, LigneSurcharge>();
  for (const ligne of surcharges) parAgentSql.set(ligne.agent, ligne);

  const construire = (cle: CleAgent): LigneCarte => {
    const niveauLivre = NIVEAU_LIVRE[cle];
    const niveauConfigure = etat.agents[cle];
    const modeleConfigure = etat.modeles[niveauConfigure];
    const cleSql = CLE_SQL_AGENT[cle] ?? null;
    const surcharge = cleSql === null ? null : (parAgentSql.get(cleSql) ?? null);

    const modeleEffectif = surcharge?.model ?? modeleConfigure;
    const niveauEffectif = niveauDeLIdentifiant(etat, modeleEffectif);

    return {
      cle,
      libelle: LIBELLES_AGENT[cle],
      mission: MISSIONS_AGENT[cle],
      niveauLivre,
      niveauConfigure,
      deplaceParEnvironnement: niveauConfigure !== niveauLivre,
      variableEnvironnement: variableAgent(cle),
      modeleConfigure,
      surcharge,
      surchargeable: cleSql !== null,
      cleSql,
      modeleEffectif,
      niveauEffectif,
      decrochee: surcharge !== null && niveauEffectif === null,
      source:
        surcharge !== null
          ? "entreprise"
          : niveauConfigure !== niveauLivre
            ? "environnement"
            : "produit",
    };
  };

  // `AGENTS` et non `Object.keys(etat.agents)` : l'ordre des clés d'un
  // objet est un détail d'implémentation, l'ordre des agents est une
  // décision — celle de la spec p.5.
  const toutes = AGENTS.map(construire);

  return {
    surchargeables: toutes.filter((ligne) => ligne.surchargeable),
    autres: toutes.filter((ligne) => !ligne.surchargeable),
    nombreSurcharges: toutes.filter((ligne) => ligne.surcharge !== null).length,
    decrochees: toutes.filter((ligne) => ligne.decrochee),
  };
}

/**
 * Les surcharges dont l'agent n'est pas au catalogue.
 *
 * Elles ne peuvent pas apparaître dans la carte — il n'y a pas de ligne
 * où les mettre — et ce serait la pire façon de les traiter : une
 * surcharge invisible reste active. `ai_model_for_agent()` la lira sans
 * broncher. L'écran les liste donc à part, en nommant la clé brute.
 */
export function surchargesOrphelines(
  surcharges: readonly LigneSurcharge[],
): readonly LigneSurcharge[] {
  return surcharges.filter((ligne) => cleAgentDepuisSql(ligne.agent) === null);
}

// ------------------------------------------------------------------
// Le sélecteur
// ------------------------------------------------------------------

/**
 * QUATRE OPTIONS, PAS TROIS.
 *
 * « Suivre le produit » n'est pas la même chose que « le niveau que le
 * produit donne aujourd'hui » : la première suit les évolutions, la
 * seconde fige. Un sélecteur à trois entrées obligerait à choisir une
 * valeur figée pour dire « je ne veux rien changer » — c'est-à-dire à
 * créer, par la seule forme du formulaire, la surcharge décrochée
 * décrite en tête de fichier.
 */
export const CHOIX_PRODUIT = "produit";

export type Choix = typeof CHOIX_PRODUIT | Niveau;

export function estChoix(valeur: unknown): valeur is Choix {
  return valeur === CHOIX_PRODUIT || estNiveau(valeur);
}

/**
 * Ce que le sélecteur affiche comme valeur courante.
 *
 * `null` pour une surcharge décrochée : aucune des quatre options ne la
 * représente, et l'écran affiche l'identifiant orphelin en toutes
 * lettres plutôt que de prétendre qu'il correspond à un niveau.
 */
export function choixCourant(ligne: LigneCarte): Choix | null {
  if (ligne.surcharge === null) return CHOIX_PRODUIT;
  return ligne.niveauEffectif;
}

/**
 * L'identifiant à écrire en base pour un choix donné.
 *
 * `null` pour « suivre le produit » : il n'y a alors rien à écrire, la
 * ligne se SUPPRIME (`admin_clear_ai_model_override`). Rendre ici
 * l'identifiant du produit serait l'erreur exacte que `CHOIX_PRODUIT`
 * existe pour éviter.
 */
export function identifiantPourChoix(etat: EtatRouteur, choix: Choix): string | null {
  return choix === CHOIX_PRODUIT ? null : etat.modeles[choix];
}
