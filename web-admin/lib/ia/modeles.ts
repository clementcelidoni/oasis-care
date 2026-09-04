/**
 * ==================================================================
 * LE VOCABULAIRE DU ROUTAGE — trois niveaux, quatorze agents
 * ==================================================================
 *
 * Spec p.16 : « MODEL ROUTER — depuis l'administration technique […]
 * Ne pas exposer cette configuration aux clients ordinaires. » C'est la
 * phrase qui a fait déménager cet écran d'Oasis Care Pro vers ici.
 *
 * ------------------------------------------------------------------
 * CE FICHIER EST UNE COPIE, ET IL FAUT LE SAVOIR
 * ------------------------------------------------------------------
 * La table `NIVEAU_LIVRE` ci-dessous recopie
 * `web-pro/lib/ai/model/configuration.ts` (`NIVEAUX_PAR_AGENT_PAR_DEFAUT`),
 * et `MODELES_PAR_DEFAUT` recopie `web-pro/lib/ai/model/router.ts`.
 *
 * Ce n'est PAS un choix de confort. Le Control Center et Oasis Care Pro
 * sont deux applications Next distinctes, sans monorepo à ce dépôt :
 * il n'existe aucun chemin d'import de l'une vers l'autre, et en
 * fabriquer un ferait dépendre le déploiement de l'une du code de
 * l'autre. La duplication est donc la conséquence de l'architecture,
 * pas une négligence.
 *
 * MAIS ELLE A UN COÛT, ET IL EST NOMMÉ ICI PLUTÔT QUE DÉCOUVERT PLUS
 * TARD : le jour où quelqu'un déplace un agent dans `web-pro` sans
 * toucher à ce fichier, le Control Center affichera un niveau qui n'est
 * plus celui qui tourne, et rien ne le signalera. Trois défenses :
 *
 *   1. `modeles.test.ts` fige la table. La changer devient un geste
 *      délibéré, visible dans un diff.
 *   2. L'écran ne présente JAMAIS cette table comme « ce qui tourne » :
 *      il écrit « ce que le produit livre », et dit d'où il le tient.
 *   3. Ce qui fait autorité — les surcharges par entreprise — vient de
 *      la BASE, qui est partagée par les deux applications. La seule
 *      chose recopiée est le défaut, c'est-à-dire ce qui s'applique
 *      quand personne n'a rien décidé.
 *
 * ------------------------------------------------------------------
 * ET LES VARIABLES D'ENVIRONNEMENT ?
 * ------------------------------------------------------------------
 * `OASIS_MODEL_ECONOMY|STANDARD|ADVANCED` et `OASIS_MODEL_AGENT_*` sont
 * lues dans l'environnement DE CE SERVEUR-CI. Si le Control Center et
 * Oasis Care Pro ne sont pas déployés avec la même configuration, ce
 * que cet écran affiche n'est pas ce que le moteur applique — et aucune
 * requête ne peut le détecter d'ici. L'écran le dit en toutes lettres.
 * C'est aussi l'argument le plus fort pour que ces trois identifiants
 * finissent en base plutôt qu'en variables : ce jour-là, cette réserve
 * disparaîtra.
 */

// ------------------------------------------------------------------
// Les trois niveaux
// ------------------------------------------------------------------

/** Les trois niveaux de la spec « Architecture IA » p.3. Pas un de plus. */
export const NIVEAUX = ["economy", "standard", "advanced"] as const;

export type Niveau = (typeof NIVEAUX)[number];

export function estNiveau(valeur: unknown): valeur is Niveau {
  return typeof valeur === "string" && (NIVEAUX as readonly string[]).includes(valeur);
}

/**
 * Le nom d'un niveau, en français.
 *
 * On dit « Économique », pas « Luna ». Le niveau est une notion de
 * produit ; l'identifiant est une notion de fournisseur. Les confondre,
 * c'est se retrouver avec « passez Finance en Terra » dans une consigne
 * d'exploitation le jour où Terra n'existe plus.
 */
export const LIBELLES_NIVEAU: Readonly<Record<Niveau, string>> = Object.freeze({
  economy: "Économique",
  standard: "Standard",
  advanced: "Avancé",
});

/**
 * La cible de répartition de la spec p.17 : ~15 % économique,
 * ~80 % standard, ~5 % avancé.
 *
 * C'est un arbitrage de COÛT de l'éditeur, et c'est pour cela qu'il vit
 * ici et non chez le client : l'écart à cette cible se lit en euros sur
 * la facture du fournisseur, pas sur la qualité perçue d'un devis.
 */
export const CIBLE_RATIO: Readonly<Record<Niveau, number>> = Object.freeze({
  economy: 15,
  standard: 80,
  advanced: 5,
});

// ------------------------------------------------------------------
// Les identifiants de modèle
// ------------------------------------------------------------------

/** Recopié de `web-pro/lib/ai/model/router.ts`. */
export const MODELES_PAR_DEFAUT: Readonly<Record<Niveau, string>> = Object.freeze({
  economy: "gpt-5.6-luna",
  standard: "gpt-5.6-terra",
  advanced: "gpt-5.6-sol",
});

/** Quelle variable d'environnement corrige quel identifiant. */
export const VARIABLES_MODELE: Readonly<Record<Niveau, string>> = Object.freeze({
  economy: "OASIS_MODEL_ECONOMY",
  standard: "OASIS_MODEL_STANDARD",
  advanced: "OASIS_MODEL_ADVANCED",
});

/** Le préfixe des variables qui déplacent un agent d'un niveau. */
export const PREFIXE_VARIABLE_AGENT = "OASIS_MODEL_AGENT_";

// ------------------------------------------------------------------
// Les quatorze agents
// ------------------------------------------------------------------

/**
 * Le catalogue de la spec « Architecture IA » p.5, dans son ordre.
 *
 * Quatorze, alors que la base n'en accepte que quatre
 * (`ai_is_supported_agent`, 0072) : les dix autres sont calibrés
 * d'avance, pour qu'un nouvel agent n'arrive jamais avec un modèle
 * codé en dur dans son propre fichier.
 */
export const AGENTS = [
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

export type CleAgent = (typeof AGENTS)[number];

/** La table agent → niveau que le produit livre. Copie de `web-pro`. */
export const NIVEAU_LIVRE: Readonly<Record<CleAgent, Niveau>> = Object.freeze({
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

export const LIBELLES_AGENT: Readonly<Record<CleAgent, string>> = Object.freeze({
  executive: "Direction",
  finance: "Finance",
  billing: "Facturation",
  quotePricing: "Chiffrage de devis",
  sales: "Commerce",
  operations: "Exploitation",
  planning: "Planification",
  procurement: "Achats",
  nursery: "Pépinière",
  fleet: "Flotte",
  customer: "Clients",
  market: "Intelligence de marché",
  risk: "Risques",
  classification: "Classification",
});

export const MISSIONS_AGENT: Readonly<Record<CleAgent, string>> = Object.freeze({
  executive: "Lit toute l'entreprise et arbitre. Le plus cher, et le plus rare.",
  finance: "Marges, encaissements, écarts de coûts.",
  billing: "Ce qui est fait et pas encore facturé.",
  quotePricing: "Le prix d'un devis — la décision qui engage le plus d'argent d'un coup.",
  sales: "Opportunités, relances, pipeline.",
  operations: "Chantiers, avancement, aléas.",
  planning: "Qui va où, quand, avec quoi.",
  procurement: "Réapprovisionnement et fournisseurs.",
  nursery: "Lots, pertes, disponibilité.",
  fleet: "Véhicules et matériel.",
  customer: "Historique et contexte d'un client.",
  market: "Prix pratiqués, tendances, concurrence.",
  risk: "Ce qui peut mal tourner, et à quel prix.",
  classification: "Trier, étiqueter, ranger. Volume élevé, enjeu faible.",
});

/**
 * Les QUATRE agents que la base accepte de surcharger, avec la graphie
 * qu'elle emploie (`ai_is_supported_agent`, migration 0072).
 *
 * La spec écrit `quotePricing`, la base écrit `quote_pricing` : les deux
 * désignent le même agent. Cette table est le seul endroit où la
 * traduction se fait, et c'est elle qui décide quels sélecteurs l'écran
 * affiche. Poser une surcharge sur un agent absent de cette liste
 * échouerait en base avec un 23514 — autant ne pas la proposer.
 */
export const CLE_SQL_AGENT: Readonly<Partial<Record<CleAgent, string>>> = Object.freeze({
  executive: "executive",
  finance: "finance",
  billing: "billing",
  quotePricing: "quote_pricing",
});

/** Les agents surchargeables, dans l'ordre du catalogue. */
export const AGENTS_SURCHARGEABLES: readonly CleAgent[] = Object.freeze(
  AGENTS.filter((agent) => CLE_SQL_AGENT[agent] !== undefined),
);

/**
 * Ramène la graphie de la base à une clé du catalogue.
 *
 * Rend `null` plutôt que de lever : ce nom vient d'une ligne de table,
 * donc d'une donnée, et un écran ne doit pas refuser de s'afficher
 * parce qu'une ligne parasite traîne.
 */
export function cleAgentDepuisSql(valeur: unknown): CleAgent | null {
  if (typeof valeur !== "string") return null;
  const aplati = valeur.trim().toLowerCase().replace(/[\s_-]+/g, "");
  if (aplati.length === 0) return null;
  for (const agent of AGENTS) {
    if (agent.toLowerCase() === aplati) return agent;
  }
  return null;
}

/**
 * Le nom de la variable qui déplace un agent d'un niveau.
 * `quotePricing` → `OASIS_MODEL_AGENT_QUOTE_PRICING`.
 */
export function variableAgent(agent: CleAgent): string {
  const snake = agent.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase();
  return `${PREFIXE_VARIABLE_AGENT}${snake}`;
}

// ------------------------------------------------------------------
// L'état du routeur tel que CE serveur le voit
// ------------------------------------------------------------------

export type SourceEnvironnement = Readonly<Record<string, string | undefined>>;

/** Une surcharge d'environnement qui n'a PAS été retenue. */
export type Anomalie = {
  variable: string;
  /** La valeur reçue, telle quelle. */
  valeur: string;
  /** Pourquoi elle n'a pas été retenue, en français. */
  raison: string;
};

export type EtatRouteur = {
  /** Les trois identifiants en vigueur sur CE serveur. */
  modeles: Readonly<Record<Niveau, string>>;
  /** Les niveaux dont l'identifiant vient d'une variable, pas du défaut. */
  identifiantsSurcharges: readonly Niveau[];
  /** La table agent → niveau en vigueur sur CE serveur. */
  agents: Readonly<Record<CleAgent, Niveau>>;
  /** Les agents déplacés par une variable d'environnement. */
  agentsDeplaces: readonly CleAgent[];
  /** Les surcharges refusées — identifiants et agents confondus. */
  anomalies: readonly Anomalie[];
};

/**
 * Lit l'environnement et rend l'état du routeur.
 *
 * Une variable illisible n'est jamais ignorée en silence : elle devient
 * une anomalie que l'écran affiche. Un réglage d'urgence qui n'a pas
 * pris et que personne ne voit, c'est la panne du lendemain matin avec,
 * en prime, la conviction fausse d'avoir agi.
 */
export function lireEtatRouteur(env: SourceEnvironnement = process.env): EtatRouteur {
  const modeles: Record<Niveau, string> = { ...MODELES_PAR_DEFAUT };
  const identifiantsSurcharges: Niveau[] = [];
  const agents: Record<CleAgent, Niveau> = { ...NIVEAU_LIVRE };
  const agentsDeplaces: CleAgent[] = [];
  const anomalies: Anomalie[] = [];

  for (const niveau of NIVEAUX) {
    const variable = VARIABLES_MODELE[niveau];
    const brut = env[variable];
    if (brut === undefined) continue;

    const valeur = brut.trim();
    if (valeur.length === 0) {
      // Une variable posée puis vidée n'est pas « aucun modèle » : ce
      // serait une chaîne vide envoyée au SDK, donc une erreur
      // incompréhensible bien plus loin. On garde le défaut, et on le
      // dit.
      anomalies.push({
        variable,
        valeur: brut,
        raison: "Valeur vide : l'identifiant par défaut reste en vigueur.",
      });
      continue;
    }

    modeles[niveau] = valeur;
    identifiantsSurcharges.push(niveau);
  }

  for (const agent of AGENTS) {
    const variable = variableAgent(agent);
    const brut = env[variable];
    if (brut === undefined) continue;

    const valeur = brut.trim();
    if (valeur.length === 0) {
      anomalies.push({
        variable,
        valeur: brut,
        raison: "Valeur vide : la table livrée par le produit reste en vigueur.",
      });
      continue;
    }

    if (!estNiveau(valeur)) {
      anomalies.push({
        variable,
        valeur: brut,
        raison: "Niveau inconnu : attendu « economy », « standard » ou « advanced ».",
      });
      continue;
    }

    if (valeur !== NIVEAU_LIVRE[agent]) agentsDeplaces.push(agent);
    agents[agent] = valeur;
  }

  return {
    modeles: Object.freeze(modeles),
    identifiantsSurcharges,
    agents: Object.freeze(agents),
    agentsDeplaces,
    anomalies,
  };
}
