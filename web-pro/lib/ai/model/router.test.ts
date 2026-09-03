import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, sep } from "node:path";
import {
  AIModelConfiguration,
  NIVEAUX_PAR_AGENT_PAR_DEFAUT,
  lireConfiguration,
  variableEnvironnementAgent,
} from "./configuration.ts";
import {
  AIModelRouter,
  SEUIL_CONTEXTE_AVANCE_CARACTERES,
  SEUIL_CONTEXTE_STANDARD_CARACTERES,
  SEUIL_IMPACT_AVANCE_CENTIMES,
  SEUIL_IMPACT_STANDARD_CENTIMES,
  SEUIL_OUTILS_AVANCE,
  reinitialiserRouteurModeles,
  routeurModeles,
} from "./router.ts";
import { AGENTS_MODELE, normaliserCleAgent, type CleAgentModele } from "./types.ts";

/**
 * §11V — LE CRITÈRE DE VALIDATION DE LA SPEC, PAGE 34.
 *
 * ══════════════════════════════════════════════════════════════════
 * CE QUE CE FICHIER DÉFEND, ET DANS QUEL ORDRE
 * ══════════════════════════════════════════════════════════════════
 *
 * La page 34 pose trois exigences. La deuxième est la seule qui compte
 * vraiment, et c'est pour cela qu'elle est testée EN PREMIER :
 *
 *   « Je dois pouvoir remplacer demain Finance Terra → Sol depuis une
 *     configuration centrale. »
 *
 * Tout le reste de cette architecture — l'interface `AIProvider`, les
 * niveaux, les seuils — n'existe que pour rendre cette phrase vraie. Un
 * routeur qui choisirait bien mais qu'il faudrait rouvrir pour changer
 * d'avis aurait échoué. Le premier test de ce fichier déplace finance
 * dans la table et vérifie deux choses : que le modèle rendu change, et
 * que RIEN D'AUTRE ne bouge.
 *
 * Viennent ensuite les trois correspondances de la page 34 (simple →
 * Luna, analyse métier → Terra, décision complexe ou à fort impact →
 * Sol), puis la garde qui empêche un nom de modèle de réapparaître
 * ailleurs dans le dépôt.
 *
 * ══════════════════════════════════════════════════════════════════
 * POURQUOI CES TESTS N'APPELLENT AUCUNE API
 * ══════════════════════════════════════════════════════════════════
 *
 * `resolve()` est une fonction pure, et c'est une décision d'architecture
 * défendue dans `router.ts` : l'aiguillage ne consulte rien. La
 * conséquence heureuse est qu'il est entièrement testable hors ligne,
 * sans clé, sans réseau, sans base. Le jour où quelqu'un ajoutera une
 * lecture réseau dans le routeur, ces tests se mettront à dépendre du
 * réseau — et ce sera le signal que le routeur a changé de nature.
 */

// ------------------------------------------------------------------
// Les trois identifiants attendus.
// ------------------------------------------------------------------
// Ce fichier est, avec `router.ts`, le SEUL du dépôt web autorisé à les
// écrire — et le test « aucun nom de modèle ailleurs » plus bas le
// vérifie en s'excluant lui-même, explicitement. La raison de cette
// exception : sans une valeur écrite à la main quelque part, une faute
// de frappe dans `router.ts` passerait tous les tests, puisque chacun
// comparerait le routeur à lui-même.

const LUNA = "gpt-5.6-luna";
const TERRA = "gpt-5.6-terra";
const SOL = "gpt-5.6-sol";

/** Un routeur sans aucune variable d'environnement : la table nue. */
function routeurNu(configuration?: AIModelConfiguration): AIModelRouter {
  return new AIModelRouter({ env: {}, configuration });
}

// ==================================================================
// 1. LE CŒUR : déplacer finance dans la configuration suffit
// ==================================================================

test("p.34 — déplacer finance de standard à advanced DANS LA CONFIGURATION change le modèle rendu", () => {
  const avant = routeurNu();
  assert.equal(avant.getModelForAgent("finance"), TERRA, "au départ, finance travaille sur Terra");

  // Le geste entier tient sur cette ligne : une table modifiée, aucun
  // agent réécrit, aucune fonction métier touchée.
  const apres = routeurNu(new AIModelConfiguration(NIVEAUX_PAR_AGENT_PAR_DEFAUT).avec({
    finance: "advanced",
  }));

  assert.equal(apres.getModelForAgent("finance"), SOL, "finance doit désormais travailler sur Sol");
  assert.equal(apres.getTierForAgent("finance"), "advanced");
});

test("p.34 — et le déplacement de finance ne déplace personne d'autre", () => {
  const avant = routeurNu();
  const apres = routeurNu(new AIModelConfiguration(NIVEAUX_PAR_AGENT_PAR_DEFAUT).avec({
    finance: "advanced",
  }));

  for (const agent of AGENTS_MODELE) {
    if (agent === "finance") continue;
    assert.equal(
      apres.getModelForAgent(agent),
      avant.getModelForAgent(agent),
      `« ${agent} » ne devait pas bouger`,
    );
  }
});

test("p.5 — le même déplacement se fait aussi par variable d'environnement, sans redéploiement", () => {
  const variable = variableEnvironnementAgent("finance");
  assert.equal(variable, "OASIS_MODEL_AGENT_FINANCE");

  const routeur = new AIModelRouter({ env: { [variable]: "advanced" } });
  assert.equal(routeur.getModelForAgent("finance"), SOL);

  // Et les autres restent où ils étaient.
  assert.equal(routeur.getModelForAgent("billing"), TERRA);
  assert.equal(routeur.getModelForAgent("executive"), SOL);
});

test("une surcharge d'agent illisible est REFUSÉE et SIGNALÉE, jamais appliquée en silence", () => {
  const routeur = new AIModelRouter({
    env: { OASIS_MODEL_AGENT_FINANCE: "turbo", OASIS_MODEL_AGENT_BILLING: "  " },
  });

  assert.equal(routeur.getModelForAgent("finance"), TERRA, "la table reste en vigueur");
  assert.equal(routeur.getModelForAgent("billing"), TERRA);

  const anomalies = routeur.etat().anomalies;
  assert.equal(anomalies.length, 2, "les deux surcharges refusées doivent être visibles");
  assert.ok(
    anomalies.some((a) => a.variable === "OASIS_MODEL_AGENT_FINANCE" && a.valeur === "turbo"),
    "un réglage d'urgence qui n'a pas pris doit se voir à l'écran",
  );
});

// ==================================================================
// 2. LES TROIS CORRESPONDANCES DE LA PAGE 34
// ==================================================================

test("p.34 — une tâche simple donne economy", () => {
  const routeur = routeurNu();

  // Sur un agent calibré standard : la spec p. 6 le montre elle-même
  // sur la facturation — « détecter les factures non émises → Luna ».
  const detection = routeur.resolve({ agent: "billing", complexity: "simple" });
  assert.equal(detection.niveau, "economy");
  assert.equal(detection.modele, LUNA);

  // Et sur l'agent que la table met d'emblée au niveau le moins cher.
  const classification = routeur.resolve({ agent: "classification" });
  assert.equal(classification.niveau, "economy");
  assert.equal(classification.modele, LUNA);
});

test("p.34 — une analyse métier donne standard", () => {
  const routeur = routeurNu();

  const analyse = routeur.resolve({ agent: "finance", complexity: "standard" });
  assert.equal(analyse.niveau, "standard");
  assert.equal(analyse.modele, TERRA);

  // Sans aucun signal, l'agent reçoit simplement ce que la table dit.
  assert.equal(routeur.resolve({ agent: "finance" }).modele, TERRA);
  assert.equal(routeur.resolve({ agent: "operations" }).modele, TERRA);
});

test("p.34 — une décision complexe donne advanced", () => {
  const routeur = routeurNu();

  // « Cas complexe avec multiples avenants → Sol » (spec p. 6).
  const complexe = routeur.resolve({ agent: "billing", complexity: "complex" });
  assert.equal(complexe.niveau, "advanced");
  assert.equal(complexe.modele, SOL);

  // La direction et le chiffrage de devis y sont déjà par la table.
  assert.equal(routeur.resolve({ agent: "executive" }).modele, SOL);
  assert.equal(routeur.resolve({ agent: "quotePricing" }).modele, SOL);
});

test("p.34 — une décision à fort impact donne advanced, MÊME annoncée comme simple", () => {
  const routeur = routeurNu();

  // Le point sensible : la complexité est une appréciation, l'argent en
  // jeu est un fait. Un appelant qui sous-estime sa tâche ne doit pas
  // pouvoir faire descendre une décision à 38 450 € sur le modèle le
  // moins capable.
  const decision = routeur.resolve({
    agent: "billing",
    complexity: "simple",
    financialImpact: 3_845_000,
  });

  assert.equal(decision.niveau, "advanced");
  assert.equal(decision.modele, SOL);
  assert.ok(
    decision.raisons.some((r) => r.includes("Impact financier")),
    "la raison doit nommer l'impact financier",
  );
});

// ==================================================================
// 3. LA GARDE : aucun nom de modèle ailleurs dans le dépôt web
// ==================================================================

const ici = dirname(fileURLToPath(import.meta.url));
const racineWeb = join(ici, "..", "..", "..");

/**
 * Les deux seuls fichiers autorisés à écrire un identifiant de modèle.
 *
 * `router.ts` parce que c'est sa raison d'être. Ce fichier de test
 * parce qu'un test qui ne connaîtrait les valeurs que par le routeur ne
 * testerait rien : il comparerait le routeur à lui-même, et une faute
 * de frappe dans `router.ts` passerait au vert.
 */
const FICHIERS_AUTORISES = new Set([
  join("lib", "ai", "model", "router.ts"),
  join("lib", "ai", "model", "router.test.ts"),
]);

const DOSSIERS_IGNORES = new Set(["node_modules", ".next", ".git", "public"]);

function fichiersSources(racine: string): string[] {
  const trouves: string[] = [];
  const pile = [racine];

  while (pile.length > 0) {
    const dossier = pile.pop();
    if (dossier === undefined) break;

    for (const entree of readdirSync(dossier, { withFileTypes: true })) {
      if (entree.isDirectory()) {
        if (DOSSIERS_IGNORES.has(entree.name)) continue;
        pile.push(join(dossier, entree.name));
        continue;
      }
      if (/\.(ts|tsx|mts)$/.test(entree.name)) trouves.push(join(dossier, entree.name));
    }
  }

  return trouves;
}

test("les trois identifiants de modèle n'existent QUE dans router.ts", () => {
  const motif = /gpt-5\.6-(sol|terra|luna)/;
  const coupables: string[] = [];

  for (const racine of [join(racineWeb, "lib"), join(racineWeb, "app")]) {
    for (const fichier of fichiersSources(racine)) {
      const relatif = relative(racineWeb, fichier);
      if (FICHIERS_AUTORISES.has(relatif)) continue;
      if (motif.test(readFileSync(fichier, "utf8"))) coupables.push(relatif.split(sep).join("/"));
    }
  }

  assert.deepEqual(
    coupables,
    [],
    "un nom de modèle écrit hors du routeur, c'est un endroit de plus à corriger le jour où il change",
  );
});

test("les identifiants par défaut sont bien ceux de la spec p. 2", () => {
  const modeles = routeurNu().modelesConfigures();
  assert.deepEqual(modeles, { economy: LUNA, standard: TERRA, advanced: SOL });
});

test("un identifiant de modèle se corrige par variable d'environnement, sans toucher au code", () => {
  const routeur = new AIModelRouter({
    env: { OASIS_MODEL_ADVANCED: "gpt-5.7-quelquechose" },
  });

  assert.equal(routeur.getModelForAgent("executive"), "gpt-5.7-quelquechose");
  assert.equal(routeur.getModelForAgent("finance"), TERRA, "les autres niveaux ne bougent pas");

  const surcharges = routeur.etat().surcharges;
  assert.equal(surcharges.length, 1);
  assert.equal(surcharges[0].variable, "OASIS_MODEL_ADVANCED");
});

test("une variable de modèle vide ne produit PAS un modèle vide", () => {
  const routeur = new AIModelRouter({ env: { OASIS_MODEL_STANDARD: "" } });

  assert.equal(routeur.getModelForAgent("finance"), TERRA);
  assert.ok(
    routeur.etat().anomalies.some((a) => a.variable === "OASIS_MODEL_STANDARD"),
    "la variable vide doit être signalée",
  );
});

// ==================================================================
// 4. LE ROUTAGE DYNAMIQUE DE LA PAGE 6
// ==================================================================

test("la complexité DÉCALE autour du niveau de l'agent, elle ne l'impose pas", () => {
  const routeur = routeurNu();

  // Une classification « complexe » monte d'un cran, pas jusqu'au
  // sommet : mille lignes de CRM sur le modèle le plus cher, c'est la
  // facture du mois qui double sans que la qualité suive.
  assert.equal(routeur.resolve({ agent: "classification", complexity: "complex" }).niveau, "standard");

  // Et une question « simple » posée à la direction ne tombe pas sur le
  // modèle le moins capable : elle descend d'un cran depuis advanced.
  assert.equal(routeur.resolve({ agent: "executive", complexity: "simple" }).niveau, "standard");
});

test("le risque pose un plancher absolu, lui", () => {
  const routeur = routeurNu();

  assert.equal(routeur.resolve({ agent: "classification", risk: "critical" }).niveau, "advanced");
  assert.equal(routeur.resolve({ agent: "classification", risk: "high" }).niveau, "advanced");
  assert.equal(routeur.resolve({ agent: "classification", risk: "medium" }).niveau, "standard");
  assert.equal(routeur.resolve({ agent: "classification", risk: "low" }).niveau, "economy");
});

test("les seuils d'impact financier sont des centimes entiers, et ils s'appliquent au centime près", () => {
  const routeur = routeurNu();
  const juste = (centimes: number) =>
    routeur.resolve({ agent: "classification", financialImpact: centimes }).niveau;

  assert.equal(juste(SEUIL_IMPACT_STANDARD_CENTIMES - 1), "economy");
  assert.equal(juste(SEUIL_IMPACT_STANDARD_CENTIMES), "standard");
  assert.equal(juste(SEUIL_IMPACT_AVANCE_CENTIMES - 1), "standard");
  assert.equal(juste(SEUIL_IMPACT_AVANCE_CENTIMES), "advanced");
  assert.equal(juste(0), "economy", "zéro euro en jeu n'est pas un enjeu");
});

test("un impact financier illisible LÈVE — il ne devient pas zéro", () => {
  const routeur = routeurNu();

  // C'est la classe de bug qui a déjà coûté à ce dépôt : `NaN >= 500000`
  // rend `false`, donc un montant mal transmis choisirait tranquillement
  // le modèle le moins cher pour la décision la plus chère.
  assert.throws(
    () => routeur.resolve({ agent: "finance", financialImpact: Number.NaN }),
    /financialImpact/,
  );
  assert.throws(() => routeur.resolve({ agent: "finance", financialImpact: -1 }), /financialImpact/);
  assert.throws(
    () => routeur.resolve({ agent: "finance", financialImpact: 12.5 }),
    /financialImpact/,
    "un montant en euros flottants n'est pas un montant en centimes",
  );
  assert.throws(() => routeur.resolve({ agent: "finance", contextSize: -3 }), /contextSize/);
  assert.throws(() => routeur.resolve({ agent: "finance", requiredTools: 1.5 }), /requiredTools/);
});

test("la taille du contexte et le nombre d'outils posent aussi un plancher", () => {
  const routeur = routeurNu();

  assert.equal(
    routeur.resolve({ agent: "classification", contextSize: SEUIL_CONTEXTE_STANDARD_CARACTERES }).niveau,
    "economy",
  );
  assert.equal(
    routeur.resolve({ agent: "classification", contextSize: SEUIL_CONTEXTE_STANDARD_CARACTERES + 1 })
      .niveau,
    "standard",
  );
  assert.equal(
    routeur.resolve({ agent: "classification", contextSize: SEUIL_CONTEXTE_AVANCE_CARACTERES + 1 })
      .niveau,
    "advanced",
  );

  assert.equal(routeur.resolve({ agent: "classification", requiredTools: 0 }).niveau, "economy");
  assert.equal(routeur.resolve({ agent: "classification", requiredTools: 4 }).niveau, "standard");
  assert.equal(
    routeur.resolve({ agent: "classification", requiredTools: SEUIL_OUTILS_AVANCE }).niveau,
    "advanced",
  );
});

test("un raisonnement en plusieurs étapes exige le niveau le plus capable", () => {
  const routeur = routeurNu();
  assert.equal(
    routeur.resolve({ agent: "classification", requiredReasoning: true }).niveau,
    "advanced",
  );
  assert.equal(
    routeur.resolve({ agent: "classification", requiredReasoning: false }).niveau,
    "economy",
  );
});

test("le plafond du plan gagne contre un plancher, et le dit", () => {
  const routeur = routeurNu();

  const decision = routeur.resolve({
    agent: "quotePricing",
    risk: "critical",
    userPlan: "standard",
  });

  assert.equal(decision.niveauDemande, "advanced", "la tâche demandait bien le sommet");
  assert.equal(decision.niveau, "standard");
  assert.equal(decision.modele, TERRA);
  assert.equal(decision.plafonne, true, "une décision rabaissée doit se déclarer telle");
  assert.ok(decision.raisons.some((r) => r.includes("Plan de l'organisation")));
});

test("un budget épuisé ramène tout au modèle le moins cher, sans jamais le taire", () => {
  const routeur = routeurNu();

  const tendu = routeur.resolve({ agent: "executive", budget: "tendu" });
  assert.equal(tendu.niveau, "standard");
  assert.equal(tendu.plafonne, true);

  const epuise = routeur.resolve({ agent: "executive", budget: "epuise" });
  assert.equal(epuise.niveau, "economy");
  assert.equal(epuise.plafonne, true);
  assert.ok(epuise.raisons.some((r) => r.includes("Budget IA épuisé")));

  const normal = routeur.resolve({ agent: "executive", budget: "normal" });
  assert.equal(normal.niveau, "advanced");
  assert.equal(normal.plafonne, false);
});

test("chaque décision explique d'où elle vient", () => {
  const decision = routeurNu().resolve({
    agent: "billing",
    complexity: "complex",
    risk: "high",
  });

  assert.ok(decision.raisons.length >= 2, "au moins la configuration et le signal qui a joué");
  assert.ok(decision.raisons[0].includes("billing"), "la première raison nomme l'agent");
  assert.equal(decision.niveauConfigure, "standard");
});

// ==================================================================
// 5. LES NOMS D'AGENTS
// ==================================================================

test("la graphie de la base et celle de la spec désignent le même agent", () => {
  assert.equal(normaliserCleAgent("quote_pricing"), "quotePricing");
  assert.equal(normaliserCleAgent("quotePricing"), "quotePricing");
  assert.equal(normaliserCleAgent("Quote Pricing"), "quotePricing");
  assert.equal(normaliserCleAgent("market_intelligence"), "market");
  assert.equal(normaliserCleAgent("  finance  "), "finance");
  assert.equal(normaliserCleAgent("inexistant"), null);
  assert.equal(normaliserCleAgent(""), null);
  assert.equal(normaliserCleAgent(null), null);
  assert.equal(normaliserCleAgent(42), null);

  // Et le routeur suit : `quote_pricing`, tel que 0072 l'écrit, doit
  // recevoir le modèle que la spec p. 5 donne à `quotePricing`.
  assert.equal(routeurNu().getModelForAgent("quote_pricing"), SOL);
});

test("un agent inconnu reçoit standard — ni le moins capable, ni le plus cher", () => {
  const routeur = routeurNu();

  const decision = routeur.resolve({ agent: "agent_qui_n_existe_pas" });
  assert.equal(decision.agent, null);
  assert.equal(decision.niveau, "standard");
  assert.ok(decision.raisons[0].includes("absent du catalogue"));

  const sansAgent = routeur.resolve({});
  assert.equal(sansAgent.niveau, "standard");
  assert.ok(sansAgent.raisons[0].includes("Aucun agent précisé"));
});

test("les quatorze agents de la spec p. 5 sont là, avec leur niveau", () => {
  // Recopie volontaire de la table de la spec : si quelqu'un modifie
  // `NIVEAUX_PAR_AGENT_PAR_DEFAUT` sans le vouloir, ce test le dit.
  const attendu: Record<CleAgentModele, string> = {
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
  };

  assert.deepEqual(routeurNu().etat().agents, attendu);
  assert.equal(AGENTS_MODELE.length, 14);
});

// ==================================================================
// 6. L'INSTANCE PARTAGÉE
// ==================================================================

test("l'instance partagée se construit à la première demande, pas à l'import", () => {
  reinitialiserRouteurModeles();
  const premier = routeurModeles();
  assert.equal(premier, routeurModeles(), "deux appels rendent le même routeur");

  reinitialiserRouteurModeles();
  assert.notEqual(premier, routeurModeles(), "après réinitialisation, un routeur neuf");
  reinitialiserRouteurModeles();
});

test("lireConfiguration ne modifie jamais la table par défaut", () => {
  const copie = { ...NIVEAUX_PAR_AGENT_PAR_DEFAUT };
  lireConfiguration({ OASIS_MODEL_AGENT_FINANCE: "advanced" });
  assert.deepEqual({ ...NIVEAUX_PAR_AGENT_PAR_DEFAUT }, copie);
});
