// Imports RELATIFS et non `@/lib/ai/model` : la barrière d'export du
// routeur réexporte `provider.ts`, donc `@openai/agents` et ses 66 Mo.
// Un test de `node --test` qui ne veut que la table des niveaux n'a pas
// à charger le SDK — et ne résout pas l'alias `@/` de toute façon.
import { NIVEAUX_PAR_AGENT_PAR_DEFAUT } from "../model/configuration.ts";
import { normaliserCleAgent, type CleAgentModele, type NiveauModele } from "../model/types.ts";

/**
 * §11V — LE VOCABULAIRE DE L'ADMINISTRATION IA (spec p. 18-19, 25, 26).
 *
 * ══════════════════════════════════════════════════════════════════
 * CE DOSSIER EST LE SEUL ENDROIT DU PRODUIT OÙ UN NOM DE MODÈLE
 * S'AFFICHE
 * ══════════════════════════════════════════════════════════════════
 *
 * Page 27, sans ambiguïté : « L'utilisateur final ne voit PAS
 * "GPT-5.6 Terra" partout. Il voit simplement : Oasis AI. Le choix du
 * modèle est interne. »
 *
 * Page 26, tout aussi clairement, demande une page d'administration
 * TECHNIQUE qui, elle, affiche la correspondance agent → modèle. Les
 * deux exigences ne se contredisent pas : elles délimitent une
 * frontière, et cette frontière est le dossier `app/(app)/parametres/ia`.
 *
 * Trois conséquences pratiques, et elles sont toutes vérifiées :
 *
 *   1. `lib/ai/admin` ne CONTIENT aucun identifiant de modèle. Il les
 *      reçoit du routeur (`routeurModeles().etat()`), qui reste le seul
 *      fichier du dépôt web à les porter. Un test relit l'arborescence.
 *
 *   2. Les écrans de `/parametres/ia` sont réservés à un administrateur
 *      technique. Ce n'est pas de la coquetterie de droits : un membre
 *      ordinaire qui atterrirait là verrait exactement ce que la page 27
 *      lui interdit de voir.
 *
 *   3. Partout ailleurs — le briefing du matin, le centre de décision,
 *      la conversation — l'agent porte son nom métier (« Facturation »)
 *      et jamais son moteur.
 *
 * ══════════════════════════════════════════════════════════════════
 * POURQUOI SEPT AGENTS SONT MODIFIABLES, ET SEULEMENT QUATRE EN BASE
 * ══════════════════════════════════════════════════════════════════
 *
 * La page 26 affiche sept lignes. La configuration TypeScript en porte
 * quatorze (spec p. 5). La table `ai_model_overrides` (0076) n'en
 * accepte que quatre : sa contrainte `ai_is_supported_agent` (0072) est
 * limitée à `executive`, `finance`, `billing`, `quote_pricing`, et elle
 * a raison — surcharger le modèle d'un agent qui n'existe pas encore
 * serait une ligne morte donnant l'illusion d'un réglage actif.
 *
 * L'écran ne cache pas cet écart, il l'écrit. Chaque ligne dit par quel
 * moyen elle se change : un sélecteur pour les quatre, le nom exact de
 * la variable d'environnement pour les dix autres. Proposer un
 * sélecteur qui se ferait refuser par une contrainte `check` au moment
 * d'enregistrer aurait été la pire des trois solutions.
 */

// ------------------------------------------------------------------
// Les quatre agents que la base accepte de surcharger
// ------------------------------------------------------------------

/**
 * Les agents de `ai_is_supported_agent` (0072), dans la graphie SQL.
 *
 * Recopiés ici parce que le TypeScript ne peut pas lire une contrainte
 * `check` ; un test relit la migration et échoue si les deux listes
 * divergent, ce qui est la seule façon de ne pas découvrir l'écart au
 * moment d'un `insert` refusé.
 */
export const AGENTS_SQL = ["executive", "finance", "billing", "quote_pricing"] as const;

export type CleAgentSql = (typeof AGENTS_SQL)[number];

/**
 * La clé SQL d'un agent du catalogue, ou `null` s'il n'en a pas.
 *
 * `null` n'est pas un cas d'erreur : c'est le cas ordinaire de dix
 * agents sur quatorze. Il veut dire « celui-ci ne se surcharge pas en
 * base », et l'écran en tire une phrase, pas un message d'erreur.
 */
export function cleSqlDeLAgent(cle: CleAgentModele): CleAgentSql | null {
  switch (cle) {
    case "executive":
      return "executive";
    case "finance":
      return "finance";
    case "billing":
      return "billing";
    case "quotePricing":
      return "quote_pricing";
    default:
      return null;
  }
}

/** L'inverse : la clé du catalogue derrière une clé SQL. */
export function cleCatalogueDeLaCleSql(agent: CleAgentSql): CleAgentModele {
  return agent === "quote_pricing" ? "quotePricing" : agent;
}

export function estCleAgentSql(valeur: unknown): valeur is CleAgentSql {
  return typeof valeur === "string" && (AGENTS_SQL as readonly string[]).includes(valeur);
}

// ------------------------------------------------------------------
// Les sept lignes de la page 26
// ------------------------------------------------------------------

/**
 * Les sept agents que la spec p. 26 demande d'afficher, DANS SON ORDRE.
 *
 *     Executive Sol · Finance Terra · Billing Terra · Quote Pricing Sol
 *     Sales Terra · Nursery Terra · Classification Luna
 *
 * L'ordre n'est pas alphabétique et ne doit pas le devenir : il va du
 * plus stratégique au plus mécanique, ce qui est aussi l'ordre décroissant
 * du coût. Trié par nom, la page perdrait cette lecture.
 */
export const AGENTS_PAGE_26: readonly CleAgentModele[] = Object.freeze([
  "executive",
  "finance",
  "billing",
  "quotePricing",
  "sales",
  "nursery",
  "classification",
]);

/**
 * Ce que la page 26 attend en face de chaque agent, en NIVEAUX.
 *
 * Ce n'est pas une deuxième configuration : c'est la recopie de la
 * page 26, gardée à côté de la vraie table pour qu'un test puisse
 * confronter les deux. Le jour où quelqu'un déplace `finance` dans
 * `NIVEAUX_PAR_AGENT_PAR_DEFAUT` — ce que le critère p. 34 l'autorise
 * expressément à faire — le test échoue et lui demande de mettre à jour
 * cette constante EN CONNAISSANCE DE CAUSE, plutôt que de laisser
 * l'écran d'administration et la spécification diverger en silence.
 */
export const NIVEAUX_ATTENDUS_PAGE_26: Readonly<Record<string, NiveauModele>> = Object.freeze({
  executive: "advanced",
  finance: "standard",
  billing: "standard",
  quotePricing: "advanced",
  sales: "standard",
  nursery: "standard",
  classification: "economy",
});

/** Les agents du catalogue qui ne figurent pas sur la page 26. */
export function agentsHorsPage26(
  tous: readonly CleAgentModele[],
): readonly CleAgentModele[] {
  return tous.filter((cle) => !AGENTS_PAGE_26.includes(cle));
}

// ------------------------------------------------------------------
// Les mots français
// ------------------------------------------------------------------

/**
 * Le nom métier d'un agent.
 *
 * `lib/ai/types.ts` en porte déjà quatre (`AGENT_LABELS`) ; les dix
 * autres n'existent nulle part puisque ces agents ne sont pas encore
 * écrits. On ne modifie pas `AGENT_LABELS` — il sert les écrans métier
 * et ne doit annoncer que ce qui existe — et un test vérifie que les
 * quatre communs disent bien la même chose des deux côtés.
 */
export const LIBELLES_AGENT: Readonly<Record<CleAgentModele, string>> = Object.freeze({
  executive: "Direction",
  finance: "Finance",
  billing: "Facturation",
  quotePricing: "Devis & prix",
  sales: "Commerce",
  operations: "Chantiers",
  planning: "Planning",
  procurement: "Achats",
  nursery: "Pépinière",
  fleet: "Matériel",
  customer: "Clients",
  market: "Marché",
  risk: "Risques",
  classification: "Classement",
});

/**
 * LES CONSOMMATEURS QUI NE SONT PAS DES AGENTS DU CATALOGUE.
 *
 * `ai_usage_events.agent` est la seule colonne d'agent libre de la
 * Phase 11V (0076), et c'est délibéré : une dépense doit pouvoir être
 * imputée même quand celui qui l'engage n'est pas l'un des quatorze.
 * Deux cas existent aujourd'hui, et ils sont l'essentiel du grand livre
 * en pratique :
 *
 *   • `edge-assistant` — la fonction Edge `oasis-pro-ai`, celle que
 *     l'écran de conversation appelle ;
 *   • `classification` — le pré-traitement en volume (p. 29), qui a une
 *     clé de modèle mais aucune existence dans `ai_action_catalog`.
 *
 * Sans cette table, la ventilation « par agent » afficherait la clé
 * technique brute à un dirigeant.
 */
export const LIBELLES_AGENT_HORS_CATALOGUE: Readonly<Record<string, string>> = Object.freeze({
  "edge-assistant": "Assistant (conversation)",
});

/** Le nom lisible d'un consommateur du grand livre, quel qu'il soit. */
export function nomAgentDuJournal(cle: string): string {
  if (estCleAgentSql(cle)) return LIBELLES_AGENT[cleCatalogueDeLaCleSql(cle)];
  const normalisee = normaliserCleAgent(cle);
  if (normalisee !== null) return LIBELLES_AGENT[normalisee];
  return LIBELLES_AGENT_HORS_CATALOGUE[cle] ?? cle;
}

/** Ce que fait l'agent, en une ligne. Pour que la carte se lise seule. */
export const MISSIONS_AGENT: Readonly<Record<CleAgentModele, string>> = Object.freeze({
  executive: "Coordonne les autres agents et hiérarchise ce qui compte.",
  finance: "Chiffre d'affaires, marges, créances, trésorerie.",
  billing: "Ce qui reste à facturer, et ce qui reste à encaisser.",
  quotePricing: "Chiffrage et arbitrage de prix sur les devis.",
  sales: "Prospects, relances, opportunités.",
  operations: "Chantiers, interventions, aléas.",
  planning: "Ordonnancement des équipes et des semaines.",
  procurement: "Commandes fournisseurs et réapprovisionnement.",
  nursery: "Stock de pépinière, production, besoins projetés.",
  fleet: "Matériel, véhicules, coûts d'utilisation.",
  customer: "Relation client, réclamations, satisfaction.",
  market: "Données publiques, concurrence, marché local.",
  risk: "Ce qui peut mal tourner, et à quel prix.",
  classification: "Tri, étiquetage et pré-traitement en volume.",
});

/**
 * Le nom d'un niveau, en français.
 *
 * La table a DÉMÉNAGÉ vers `lib/ai/model/types.ts`, à côté de
 * `NIVEAUX_MODELE` : le runtime en a besoin lui aussi — l'avertissement
 * de repli est lu par un paysagiste — et il ne doit pas importer
 * l'administration pour une chaîne de caractères. Elle reste
 * réexportée ici pour que les écrans n'aient qu'un import à connaître.
 */
export { LIBELLES_NIVEAU } from "../model/types.ts";

/** À quoi sert chaque niveau (spec p. 2-3), en une phrase. */
export const USAGES_NIVEAU: Readonly<Record<NiveauModele, string>> = Object.freeze({
  economy: "Fort volume, faible complexité : classement, extraction, pré-tri.",
  standard: "Le moteur des agents métier : analyses courantes, brouillons, synthèses.",
  advanced: "Décisions complexes à forte valeur, situations ambiguës, arbitrages.",
});

/**
 * La teinte d'un niveau. Elle SUIT LE COÛT, pas la qualité.
 *
 * `advanced` est en teinte d'alerte douce parce que c'est le niveau
 * cher : sur une carte de quatorze agents, l'œil doit compter les
 * lignes coûteuses d'un coup. La page 17 vise ~5 % d'appels sur ce
 * niveau ; une carte où tout est de la même couleur ne dirait rien de
 * cet équilibre.
 */
export const TEINTES_NIVEAU = Object.freeze({
  economy: "positive",
  standard: "info",
  advanced: "warning",
} as const);

/**
 * La longueur minimale d'un motif de dérogation.
 *
 * Trois caractères, pas trente : le but n'est pas d'imposer une
 * rédaction, c'est d'empêcher le champ vide. « TVA » ou « test » suffit
 * à ce qu'un successeur sache qu'il y avait une intention. La constante
 * vit ici et non dans `actions.ts` : ce dernier porte la directive
 * `"use server"`, qui interdit d'exporter autre chose que des fonctions
 * asynchrones — l'écran, lui, en a besoin pour son `minLength`.
 */
export const MOTIF_MINIMUM = 3;

/**
 * Le niveau que le produit donne à un agent, tel qu'il est livré.
 *
 * Réexporté ici pour que les écrans n'aient pas à importer la
 * configuration du routeur : ils n'ont aucune raison de la connaître,
 * et un import de moins est une occasion de moins de lire la table au
 * lieu de demander au routeur.
 */
export const NIVEAU_LIVRE = NIVEAUX_PAR_AGENT_PAR_DEFAUT;
