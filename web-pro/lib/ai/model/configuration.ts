import {
  AGENTS_MODELE,
  estNiveauModele,
  normaliserCleAgent,
  type CleAgentModele,
  type NiveauModele,
} from "./types.ts";

/**
 * §11V — AIModelConfiguration (spec p. 5).
 *
 * ─── CE FICHIER EST LE SEUL ENDROIT OÙ « QUEL AGENT MÉRITE QUEL NIVEAU » S'ÉCRIT ───
 *
 * La spec p. 4 interdit qu'un agent porte un identifiant de modèle en
 * dur dans son propre code, et la page 34 en fait le critère de
 * validation : « je dois
 * pouvoir remplacer demain Finance Terra → Sol depuis une configuration
 * centrale ». Cette phrase se traduit par une exigence très concrète —
 * changer UNE ligne de la table ci-dessous doit suffire, et le test
 * `router.test.ts` la vérifie avant tout le reste.
 *
 * Conséquence directe : aucun agent n'importe ce fichier pour y lire SA
 * ligne. Un agent demande son modèle au routeur, le routeur consulte
 * cette table. Si un agent lisait la table lui-même, on aurait deux
 * chemins et l'un des deux finirait par diverger.
 *
 * ─── DEUX FAÇONS DE CHANGER UN NIVEAU, ET ELLES NE SE VALENT PAS ───
 *
 *   1. MODIFIER LA TABLE ci-dessous. C'est la décision durable : elle
 *      passe par une revue, un commit, un déploiement.
 *
 *   2. POSER UNE VARIABLE D'ENVIRONNEMENT `OASIS_MODEL_AGENT_FINANCE=advanced`.
 *      C'est le « modelOverride pour tests administrateur » de la spec
 *      p. 5-6 : réversible en une minute, sans redéploiement de code.
 *      Elle ne survit pas à un changement d'hébergement, et c'est très
 *      bien — un réglage d'urgence ne doit pas devenir permanent par
 *      distraction.
 *
 * Une valeur d'environnement illisible (`OASIS_MODEL_AGENT_FINANCE=turbo`)
 * n'est PAS silencieusement ignorée : elle est signalée dans
 * `anomalies`, que l'écran d'administration affiche. Un réglage d'urgence
 * qui n'a pas pris et que personne ne voit, c'est la panne à sept heures
 * du matin avec, en prime, la conviction fausse d'avoir agi.
 */

/** Le préfixe des variables d'environnement de surcharge par agent. */
const PREFIXE_ENV_AGENT = "OASIS_MODEL_AGENT_";

/**
 * LA TABLE. Recopiée telle quelle de la spec p. 5.
 *
 * Elle n'est pas une opinion de ce fichier : c'est la décision produite,
 * écrite là où on peut la relire. Trois agents seulement sont au niveau
 * le plus cher — direction, chiffrage de devis, intelligence de marché —
 * parce que la spec p. 17 vise « ~5 % Sol ». Un quatrième passerait ce
 * ratio du simple au double.
 */
export const NIVEAUX_PAR_AGENT_PAR_DEFAUT: Readonly<Record<CleAgentModele, NiveauModele>> =
  Object.freeze({
    executive: "advanced",
    finance: "standard",
    billing: "standard",
    quotePricing: "advanced",
    sales: "standard",
    operations: "standard",
    planning: "standard",
    procurement: "standard",
    nursery: "standard",
    fleet: "standard",
    customer: "standard",
    market: "advanced",
    risk: "standard",
    classification: "economy",
  });

/**
 * Le niveau retenu quand l'agent n'est pas au catalogue.
 *
 * `standard`, et pas `economy` : un agent inconnu est un agent qu'on n'a
 * pas calibré. Lui donner d'office le modèle le moins capable, c'est
 * choisir de mal répondre pour économiser sur une situation qu'on n'a
 * pas comprise. Et pas `advanced` non plus : un nom mal orthographié
 * dans une boucle ne doit pas coûter le prix fort.
 */
export const NIVEAU_AGENT_INCONNU: NiveauModele = "standard";

/** Ce qu'une surcharge d'environnement refusée a à dire. */
export type AnomalieConfiguration = {
  /** La variable en cause, nom complet. */
  variable: string;
  /** La valeur reçue, telle quelle. */
  valeur: string;
  /** Pourquoi elle n'a pas été retenue, en français. */
  raison: string;
};

export type SourceEnvironnement = Readonly<Record<string, string | undefined>>;

/**
 * La table agent → niveau, telle qu'elle s'applique réellement.
 *
 * Immuable : `avec()` rend une NOUVELLE configuration plutôt que de
 * modifier celle-ci. Un objet de configuration qu'on peut muter à
 * distance, c'est un routeur dont le comportement dépend de l'ordre des
 * imports — impossible à tester, et impossible à expliquer le jour où
 * deux requêtes simultanées n'obtiennent pas le même modèle.
 */
export class AIModelConfiguration {
  readonly #niveaux: Readonly<Record<CleAgentModele, NiveauModele>>;
  readonly #anomalies: readonly AnomalieConfiguration[];

  constructor(
    niveaux: Readonly<Record<CleAgentModele, NiveauModele>> = NIVEAUX_PAR_AGENT_PAR_DEFAUT,
    anomalies: readonly AnomalieConfiguration[] = [],
  ) {
    this.#niveaux = Object.freeze({ ...niveaux });
    this.#anomalies = Object.freeze([...anomalies]);
  }

  /**
   * Le niveau d'un agent. Rend aussi le fait qu'il ait été reconnu :
   * l'appelant en a besoin pour l'écrire dans ses raisons.
   */
  niveauPour(agent: string | null | undefined): {
    niveau: NiveauModele;
    cle: CleAgentModele | null;
  } {
    const cle = normaliserCleAgent(agent);
    if (cle === null) return { niveau: NIVEAU_AGENT_INCONNU, cle: null };
    return { niveau: this.#niveaux[cle], cle };
  }

  /** La table entière, pour l'écran d'administration de la spec p. 26. */
  table(): Readonly<Record<CleAgentModele, NiveauModele>> {
    return this.#niveaux;
  }

  /** Les surcharges d'environnement qui n'ont PAS été retenues. */
  anomalies(): readonly AnomalieConfiguration[] {
    return this.#anomalies;
  }

  /**
   * Une copie de cette configuration, quelques agents déplacés.
   *
   * C'est la forme testable du critère p. 34 : `avec({ finance:
   * "advanced" })` doit suffire à changer le modèle rendu pour finance,
   * et ne rien changer pour les treize autres.
   */
  avec(deplacements: Partial<Record<CleAgentModele, NiveauModele>>): AIModelConfiguration {
    return new AIModelConfiguration({ ...this.#niveaux, ...deplacements }, this.#anomalies);
  }
}

/**
 * Le nom de la variable d'environnement qui surcharge un agent.
 *
 * `quotePricing` → `OASIS_MODEL_AGENT_QUOTE_PRICING`. Le camelCase
 * devient snake_case majuscule, comme partout ailleurs dans le dépôt.
 */
export function variableEnvironnementAgent(agent: CleAgentModele): string {
  const snake = agent.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase();
  return `${PREFIXE_ENV_AGENT}${snake}`;
}

/**
 * Construit la configuration effective : la table, puis les surcharges
 * d'environnement lisibles, et la liste de celles qui ne l'étaient pas.
 */
export function lireConfiguration(
  env: SourceEnvironnement = process.env,
  base: Readonly<Record<CleAgentModele, NiveauModele>> = NIVEAUX_PAR_AGENT_PAR_DEFAUT,
): AIModelConfiguration {
  const niveaux: Record<CleAgentModele, NiveauModele> = { ...base };
  const anomalies: AnomalieConfiguration[] = [];

  for (const agent of AGENTS_MODELE) {
    const variable = variableEnvironnementAgent(agent);
    const brut = env[variable];
    if (brut === undefined) continue;

    const valeur = brut.trim();
    if (valeur.length === 0) {
      // Une variable posée puis vidée est un geste ambigu ; on garde la
      // table et on le dit, plutôt que de deviner ce qui était voulu.
      anomalies.push({
        variable,
        valeur: brut,
        raison: "Valeur vide : la table de configuration reste en vigueur.",
      });
      continue;
    }

    if (!estNiveauModele(valeur)) {
      anomalies.push({
        variable,
        valeur: brut,
        raison: "Niveau inconnu : attendu « economy », « standard » ou « advanced ».",
      });
      continue;
    }

    niveaux[agent] = valeur;
  }

  return new AIModelConfiguration(niveaux, anomalies);
}
