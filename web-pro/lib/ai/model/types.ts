/**
 * §11V — LE VOCABULAIRE DU ROUTAGE DE MODÈLES (spec « Architecture IA
 * des Agents », p. 3 à 6).
 *
 * Ce fichier ne contient AUCUN identifiant de modèle. Les trois noms
 * réels vivent dans un seul endroit du dépôt web — `router.ts` — et un
 * test relit l'arborescence pour s'en assurer. Ici on ne parle que de
 * NIVEAUX — economy,
 * standard, advanced — parce que c'est le seul vocabulaire que le code
 * métier a le droit de connaître. Le jour où la famille de modèles
 * change de nom, rien de ce fichier ne bouge.
 *
 * ─── POURQUOI QUATORZE AGENTS ALORS QUE LA BASE N'EN CONNAÎT QUE QUATRE ───
 *
 * La migration 0072 (`ai_is_supported_agent`) et `lib/ai/types.ts`
 * n'admettent aujourd'hui que `executive`, `finance`, `billing` et
 * `quote_pricing` : c'est la première itération, et elle a raison de
 * refuser les autres. La table de correspondance de la spec p. 5, elle,
 * en nomme quatorze. Les dix qui manquent ne sont pas une invention :
 * ce sont les agents que la spec demande de préparer, et leur niveau
 * doit être décidé AVANT qu'ils existent, sans quoi chaque nouvel agent
 * arriverait avec un modèle codé en dur dans son propre fichier — très
 * exactement ce que la spec interdit p. 4.
 *
 * Le catalogue ci-dessous est donc plus large que la base. C'est
 * volontaire, et sans risque : un niveau configuré pour un agent qui
 * n'existe pas ne fait rien du tout.
 *
 * ─── POURQUOI UNE NORMALISATION DES NOMS ───
 *
 * La spec écrit `quotePricing`. La base écrit `quote_pricing`. Les deux
 * désignent le même agent, et un routeur qui répondrait « agent inconnu »
 * au nom que la base lui donne serait inutilisable. `normaliserCleAgent`
 * réconcilie les deux graphies plutôt que de forcer un camp.
 */

// ------------------------------------------------------------------
// Les trois niveaux, et leur ordre
// ------------------------------------------------------------------

/** Les trois niveaux de la spec p. 3. Pas un de plus. */
export const NIVEAUX_MODELE = ["economy", "standard", "advanced"] as const;

export type NiveauModele = (typeof NIVEAUX_MODELE)[number];

export function estNiveauModele(valeur: unknown): valeur is NiveauModele {
  return typeof valeur === "string" && (NIVEAUX_MODELE as readonly string[]).includes(valeur);
}

/**
 * Le nom d'un niveau, en français, POUR L'UTILISATEUR FINAL.
 *
 * On dit « Économique » et pas « Luna » : le niveau est une notion du
 * produit, l'identifiant est une notion du fournisseur. Confondre les
 * deux, c'est se retrouver avec « passez Finance en Terra » dans un
 * message d'erreur le jour où Terra n'existe plus.
 *
 * Cette table vit ICI, à côté de `NIVEAUX_MODELE`, et non dans
 * l'administration : elle sert aussi au runtime — l'avertissement de
 * repli est lu par un paysagiste, pas par un développeur —, et un
 * module d'exécution qui importerait `lib/ai/admin` pour une chaîne de
 * caractères tirerait tout un écran avec lui.
 */
export const LIBELLES_NIVEAU: Readonly<Record<NiveauModele, string>> = Object.freeze({
  economy: "Économique",
  standard: "Standard",
  advanced: "Avancé",
});

/**
 * Le rang d'un niveau, pour pouvoir dire « au moins » et « au plus ».
 *
 * Tout le routage se ramène à des comparaisons de rangs : un plancher
 * relève, un plafond rabaisse. Passer par un entier plutôt que par une
 * cascade de `if` rend la logique lisible et, surtout, TESTABLE — on
 * peut vérifier qu'un plafond gagne toujours contre un plancher.
 */
export function rangNiveau(niveau: NiveauModele): number {
  return NIVEAUX_MODELE.indexOf(niveau);
}

/** Le plus élevé des deux niveaux. */
export function niveauMax(a: NiveauModele, b: NiveauModele): NiveauModele {
  return rangNiveau(a) >= rangNiveau(b) ? a : b;
}

/** Le moins élevé des deux niveaux. */
export function niveauMin(a: NiveauModele, b: NiveauModele): NiveauModele {
  return rangNiveau(a) <= rangNiveau(b) ? a : b;
}

/**
 * Décale un niveau de `pas` crans, sans jamais sortir de l'échelle.
 *
 * Sert au seul endroit où la complexité d'une tâche joue : voir le
 * commentaire de `router.ts` sur le décalage relatif.
 */
export function decalerNiveau(niveau: NiveauModele, pas: number): NiveauModele {
  const cible = Math.min(NIVEAUX_MODELE.length - 1, Math.max(0, rangNiveau(niveau) + pas));
  return NIVEAUX_MODELE[cible];
}

// ------------------------------------------------------------------
// Le catalogue des agents
// ------------------------------------------------------------------

/**
 * Les quatorze agents nommés par la table de configuration de la spec
 * p. 5, dans son ordre à elle. Les clés sont les siennes (camelCase) ;
 * `normaliserCleAgent` accepte aussi la graphie de la base.
 */
export const AGENTS_MODELE = [
  "executive",
  "finance",
  "billing",
  "quotePricing",
  "sales",
  "operations",
  "planning",
  "procurement",
  "nursery",
  "fleet",
  "customer",
  "market",
  "risk",
  "classification",
] as const;

export type CleAgentModele = (typeof AGENTS_MODELE)[number];

/**
 * Les graphies alternatives acceptées, et à quoi elles renvoient.
 *
 * Une seule règle générale ne suffisait pas : `quote_pricing` se déduit
 * mécaniquement de `quotePricing`, mais `market_intelligence` (le nom
 * de la classe dans la spec p. 8, « MarketIntelligenceAgent ») ne se
 * déduit de rien. Les cas irréguliers sont donc écrits à la main.
 */
const ALIAS_AGENTS: Record<string, CleAgentModele> = {
  market_intelligence: "market",
  marketintelligence: "market",
  quote: "quotePricing",
  pricing: "quotePricing",
  direction: "executive",
};

/**
 * Ramène un nom d'agent — quelle qu'en soit la graphie — à une clé du
 * catalogue, ou `null` si personne ne le connaît.
 *
 * Rendre `null` plutôt que lever : ce nom vient parfois de la base, et
 * une décision ne doit pas tomber parce qu'un agent a été renommé en
 * SQL. Le routeur, lui, dira ce qu'il fait d'un agent inconnu, et il le
 * dira dans ses raisons.
 */
export function normaliserCleAgent(valeur: unknown): CleAgentModele | null {
  if (typeof valeur !== "string") return null;

  const nettoye = valeur.trim();
  if (nettoye.length === 0) return null;

  // « quote_pricing », « quote-pricing », « Quote Pricing » → « quotepricing »
  const aplati = nettoye.toLowerCase().replace(/[\s_-]+/g, "");

  for (const cle of AGENTS_MODELE) {
    if (cle.toLowerCase() === aplati) return cle;
  }

  const parAlias = ALIAS_AGENTS[nettoye.toLowerCase()] ?? ALIAS_AGENTS[aplati];
  return parAlias ?? null;
}

// ------------------------------------------------------------------
// Les signaux du routage dynamique (spec p. 6)
// ------------------------------------------------------------------

/**
 * Combien la tâche demande, RELATIVEMENT au travail ordinaire de
 * l'agent. Voir `router.ts` : ce signal décale, il n'impose pas.
 */
export type ComplexiteTache = "simple" | "standard" | "complex";

/** Le risque de la décision. Celui-là, lui, impose un plancher. */
export type NiveauRisque = "low" | "medium" | "high" | "critical";

/**
 * L'état du budget IA de l'organisation, tel que le contrôle de coût
 * (spec p. 17, étape 15) le rendra un jour. Ici c'est un PLAFOND : un
 * budget tendu interdit le modèle le plus cher, un budget épuisé
 * n'autorise plus que le moins cher.
 *
 * Ce n'est pas au routeur de décider de couper le service : refuser
 * relève du contrôle de coût, qui a le droit de dire non. Le routeur,
 * lui, se contente de choisir le moins cher qui reste.
 */
export type EtatBudget = "normal" | "tendu" | "epuise";

/**
 * Tout ce que le routeur accepte d'entendre (spec p. 6).
 *
 * Les champs numériques sont des ENTIERS et sont vérifiés : un impact
 * financier illisible ne devient pas zéro en silence — le routeur
 * refuse. Un `|| 0` ici transformerait un devis à 45 000 € en tâche
 * sans enjeu, et le choix du modèle s'en irait vers le moins cher sans
 * que personne ne le voie.
 */
export type ContexteRoutage = {
  /** L'agent qui va travailler. Sa clé, dans n'importe quelle graphie. */
  agent?: string | null;
  /** Combien la tâche demande, par rapport à l'ordinaire de cet agent. */
  complexity?: ComplexiteTache;
  /** Ce que coûte une erreur. */
  risk?: NiveauRisque;
  /** L'argent en jeu, EN CENTIMES ENTIERS. Jamais un flottant d'euros. */
  financialImpact?: number;
  /** La taille du contexte assemblé, en caractères. */
  contextSize?: number;
  /** Le nombre d'outils mis à disposition du modèle pour ce tour. */
  requiredTools?: number;
  /** Vrai quand la tâche exige un raisonnement en plusieurs étapes. */
  requiredReasoning?: boolean;
  /** Le niveau maximum que le plan de l'organisation autorise. */
  userPlan?: NiveauModele;
  /** L'état du budget IA. */
  budget?: EtatBudget;
};

/**
 * Ce que le routeur rend. Il rend un identifiant de modèle ET les
 * raisons de l'avoir choisi : sans les raisons, le jour où une décision
 * part sur le mauvais modèle, personne ne peut dire pourquoi.
 */
export type DecisionRoutage = {
  /** L'agent reconnu, ou `null` s'il n'est pas au catalogue. */
  agent: CleAgentModele | null;
  /** Le niveau retenu. */
  niveau: NiveauModele;
  /** L'identifiant à passer au SDK. */
  modele: string;
  /** Ce que la configuration dit de cet agent, avant tout signal. */
  niveauConfigure: NiveauModele;
  /** Vrai si un plafond (plan ou budget) a rabaissé le niveau demandé. */
  plafonne: boolean;
  /** Le niveau demandé avant plafonnement. Égal à `niveau` sinon. */
  niveauDemande: NiveauModele;
  /** En français, dans l'ordre où elles ont joué. Pour la trace et l'écran. */
  raisons: string[];
};
