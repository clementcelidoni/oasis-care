import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { AIModelRouter } from "../model/router.ts";
import { AGENTS_MODELE, type CleAgentModele } from "../model/types.ts";
import { AGENT_LABELS, AGENTS as AGENTS_METIER } from "../types.ts";
import {
  CHOIX_PRODUIT,
  choixCourant,
  construireCarte,
  estChoixSurcharge,
  type SurchargeOrganisation,
} from "./carte.ts";
import {
  AGENTS_PAGE_26,
  AGENTS_SQL,
  LIBELLES_AGENT,
  MISSIONS_AGENT,
  NIVEAUX_ATTENDUS_PAGE_26,
  agentsHorsPage26,
  cleCatalogueDeLaCleSql,
  cleSqlDeLAgent,
} from "./types.ts";

/**
 * §11V — CE QUE LA CARTE D'ADMINISTRATION DOIT GARANTIR.
 *
 * Trois familles de tests, et la première est la plus importante :
 *
 *   1. LES ACCORDS ENTRE FICHIERS. La page 26 de la spec, la table du
 *      routeur, la contrainte SQL de 0072 et les libellés métier de
 *      `lib/ai/types.ts` doivent dire la même chose. Aucun de ces
 *      désaccords ne serait un bug dans une fonction — chacun serait un
 *      écran qui affiche tranquillement une information périmée.
 *
 *   2. LA SUPERPOSITION DES TROIS SOURCES : produit, environnement,
 *      entreprise.
 *
 *   3. LA SURCHARGE QUI A DÉCROCHÉ — le seul défaut de cette page que
 *      personne ne remarquerait sans elle.
 */

const ICI = dirname(fileURLToPath(import.meta.url));
const RACINE = join(ICI, "..", "..", "..", "..");

// ==================================================================
// 1. Les accords entre fichiers
// ==================================================================

test("les sept lignes de la page 26 sont bien celles de la configuration du produit", () => {
  const routeur = new AIModelRouter({ env: {} });
  const carte = construireCarte(routeur.etat());

  assert.equal(carte.page26.length, 7);

  for (const ligne of carte.page26) {
    assert.equal(
      ligne.niveauLivre,
      NIVEAUX_ATTENDUS_PAGE_26[ligne.cle],
      `La page 26 annonce « ${ligne.cle} → ${NIVEAUX_ATTENDUS_PAGE_26[ligne.cle]} » et la ` +
        `configuration livre « ${ligne.niveauLivre} ». Déplacer un agent est permis (critère ` +
        `p. 34), mais l'écran d'administration et la spécification doivent bouger ensemble.`,
    );
  }
});

test("la carte couvre les quatorze agents du catalogue, sans doublon ni oubli", () => {
  const carte = construireCarte(new AIModelRouter({ env: {} }).etat());
  const vues = [...carte.page26, ...carte.reste].map((l) => l.cle);

  assert.equal(vues.length, AGENTS_MODELE.length);
  assert.deepEqual(new Set(vues), new Set(AGENTS_MODELE));
  assert.deepEqual(agentsHorsPage26(AGENTS_MODELE).length, AGENTS_MODELE.length - 7);
});

test("les quatre agents surchargeables sont exactement ceux qu'accepte 0072", () => {
  // La contrainte `check (public.ai_is_supported_agent(agent))` porte sur
  // `ai_model_overrides` ; la liste vit dans une fonction SQL, que le
  // TypeScript ne peut pas lire. On relit donc la migration. Sans ce
  // test, ajouter un cinquième agent au produit produirait un sélecteur
  // dont l'enregistrement se ferait refuser par un `check`, six semaines
  // plus tard, chez un client.
  const sql = readFileSync(
    join(RACINE, "supabase", "migrations", "0072_phase11v_socle.sql"),
    "utf8",
  );
  const corps = /ai_is_supported_agent[\s\S]*?select p_agent in \(([^)]*)\)/.exec(sql);
  assert.ok(corps, "`ai_is_supported_agent` introuvable dans 0072.");

  const declares = [...corps[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  assert.deepEqual(
    new Set(declares),
    new Set(AGENTS_SQL),
    "AGENTS_SQL et `ai_is_supported_agent` (0072) ne désignent plus les mêmes agents.",
  );
});

test("chaque agent surchargeable a une traduction aller-retour", () => {
  for (const agent of AGENTS_SQL) {
    assert.equal(cleSqlDeLAgent(cleCatalogueDeLaCleSql(agent)), agent);
  }
  // Et les dix autres n'en ont pas — c'est le cas ordinaire, pas une erreur.
  const surchargeables = AGENTS_MODELE.filter((cle) => cleSqlDeLAgent(cle) !== null);
  assert.equal(surchargeables.length, AGENTS_SQL.length);
});

test("les libellés d'agent ne contredisent pas ceux des écrans métier", () => {
  // `lib/ai/types.ts` en porte quatre, affichés sur le centre de
  // décision. Deux noms différents pour le même agent selon l'écran,
  // c'est un utilisateur qui croit qu'il y en a deux.
  for (const agent of AGENTS_METIER) {
    const cle = cleCatalogueDeLaCleSql(agent);
    assert.equal(
      LIBELLES_AGENT[cle],
      AGENT_LABELS[agent],
      `« ${agent} » s'appelle « ${AGENT_LABELS[agent]} » sur le centre de décision et ` +
        `« ${LIBELLES_AGENT[cle]} » sur l'écran d'administration.`,
    );
  }
});

test("chaque agent du catalogue a un libellé et une mission", () => {
  for (const cle of AGENTS_MODELE) {
    assert.ok(LIBELLES_AGENT[cle]?.length > 0, `libellé manquant pour ${cle}`);
    assert.ok(MISSIONS_AGENT[cle]?.length > 0, `mission manquante pour ${cle}`);
  }
});

test("aucun identifiant de modèle n'est écrit dans lib/ai/admin", () => {
  // La règle de la page 4, vérifiée une seconde fois ici : `router.ts`
  // reste le seul fichier du dépôt web à porter les trois noms. Ce
  // dossier les AFFICHE (page 26 l'exige) mais ne les CONNAÎT pas — il
  // les reçoit du routeur.
  const motif = /gpt-5\.6-(sol|terra|luna)/;
  const fichiers = [
    "types.ts",
    "carte.ts",
    "montants.ts",
    "agregation.ts",
    "routage.ts",
    "lecture.ts",
    "actions.ts",
    "index.ts",
  ];
  for (const nom of fichiers) {
    const source = readFileSync(join(ICI, nom), "utf8");
    assert.ok(
      !motif.test(source),
      `lib/ai/admin/${nom} contient un identifiant de modèle en dur.`,
    );
  }
});

// ==================================================================
// 2. La superposition des trois sources
// ==================================================================

test("sans surcharge, chaque agent suit le produit", () => {
  const routeur = new AIModelRouter({ env: {} });
  const carte = construireCarte(routeur.etat());

  const finance = carte.page26.find((l) => l.cle === "finance");
  assert.ok(finance);
  assert.equal(finance.source, "produit");
  assert.equal(finance.niveauEffectif, "standard");
  assert.equal(finance.modeleEffectif, routeur.modelePourNiveau("standard"));
  assert.equal(finance.surcharge, null);
  assert.equal(finance.deplaceParEnvironnement, false);
  assert.equal(carte.nombreSurcharges, 0);
  assert.deepEqual(carte.surchargesDesalignees, []);
});

test("une variable d'environnement déplace l'agent, et l'écran le dit", () => {
  const routeur = new AIModelRouter({ env: { OASIS_MODEL_AGENT_FINANCE: "advanced" } });
  const carte = construireCarte(routeur.etat());

  const finance = carte.page26.find((l) => l.cle === "finance");
  assert.ok(finance);
  assert.equal(finance.source, "environnement");
  assert.equal(finance.deplaceParEnvironnement, true);
  assert.equal(finance.niveauLivre, "standard", "le produit, lui, n'a pas bougé");
  assert.equal(finance.niveauConfigure, "advanced");
  assert.equal(finance.variableEnvironnement, "OASIS_MODEL_AGENT_FINANCE");

  // Et les treize autres n'ont pas bougé — c'est la moitié qui compte
  // du critère p. 34.
  for (const ligne of [...carte.page26, ...carte.reste]) {
    if (ligne.cle === "finance") continue;
    assert.equal(ligne.deplaceParEnvironnement, false, `${ligne.cle} a bougé sans raison`);
  }
});

test("une surcharge d'entreprise gagne contre l'environnement", () => {
  const routeur = new AIModelRouter({ env: { OASIS_MODEL_AGENT_FINANCE: "advanced" } });
  const surcharge: SurchargeOrganisation = {
    agent: "finance",
    modele: routeur.modelePourNiveau("economy"),
    motif: "Test de coût sur un mois.",
    posLe: "2026-09-01T08:00:00.000Z",
  };

  const carte = construireCarte(routeur.etat(), [surcharge]);
  const finance = carte.page26.find((l) => l.cle === "finance");
  assert.ok(finance);

  assert.equal(finance.source, "entreprise");
  assert.equal(finance.niveauEffectif, "economy");
  assert.equal(finance.niveauConfigure, "advanced", "ce que le serveur ferait sans la surcharge");
  assert.equal(finance.desalignee, false);
  assert.equal(carte.nombreSurcharges, 1);
  assert.equal(choixCourant(finance), "economy");
});

test("une surcharge sur un agent qu'on ne reconnaît pas est ignorée, pas fatale", () => {
  const routeur = new AIModelRouter({ env: {} });
  const carte = construireCarte(routeur.etat(), [
    // Cette valeur ne peut pas venir de la base — la contrainte 0072 la
    // refuse — mais rien ne garantit qu'elle ne viendra jamais.
    { agent: "fantome" as never, modele: "x", motif: null, posLe: null },
  ]);
  assert.equal(carte.nombreSurcharges, 0);
  assert.equal(carte.page26.length, 7);
});

// ==================================================================
// 3. La surcharge qui a décroché
// ==================================================================

test("une surcharge pointant un identifiant hors configuration est SIGNALÉE, pas rangée", () => {
  // Le scénario réel : quelqu'un pose une surcharge « avancé » en
  // septembre ; en novembre, `OASIS_MODEL_ADVANCED` corrige un nom faux.
  // L'entreprise reste accrochée à l'ancien identifiant, et son IA tombe
  // en 404 pendant que celle du voisin tourne.
  const routeur = new AIModelRouter({ env: { OASIS_MODEL_ADVANCED: "gpt-5.7-corrige" } });
  const carte = construireCarte(routeur.etat(), [
    { agent: "billing", modele: "gpt-5.6-nom-perime", motif: "Posée en septembre.", posLe: null },
  ]);

  const billing = carte.page26.find((l) => l.cle === "billing");
  assert.ok(billing);
  assert.equal(billing.modeleEffectif, "gpt-5.6-nom-perime");
  assert.equal(
    billing.niveauEffectif,
    null,
    "ranger d'office cette surcharge sur un niveau ferait disparaître l'anomalie",
  );
  assert.equal(billing.desalignee, true);
  assert.equal(choixCourant(billing), null, "aucune des quatre options ne la représente");
  assert.deepEqual(
    carte.surchargesDesalignees.map((l) => l.cle),
    ["billing"],
  );
});

test("le sélecteur n'accepte que « produit » et les trois niveaux", () => {
  assert.equal(estChoixSurcharge(CHOIX_PRODUIT), true);
  assert.equal(estChoixSurcharge("economy"), true);
  assert.equal(estChoixSurcharge("standard"), true);
  assert.equal(estChoixSurcharge("advanced"), true);

  // Un IDENTIFIANT n'est pas un choix : le sélecteur parle en niveaux.
  // La valeur de test se demande au routeur plutôt que de s'écrire —
  // sans quoi ce fichier serait un endroit de plus à corriger le jour où
  // un nom de modèle change, ce que `router.test.ts` interdit.
  assert.equal(
    estChoixSurcharge(new AIModelRouter({ env: {} }).modelePourNiveau("advanced")),
    false,
  );
  assert.equal(estChoixSurcharge("turbo"), false);
  assert.equal(estChoixSurcharge(""), false);
  assert.equal(estChoixSurcharge(null), false);
});

test("les anomalies de configuration remontent jusqu'à la carte", () => {
  // Une variable posée avec une valeur illisible ne doit pas se perdre :
  // l'administrateur qui a tapé « turbo » à 7 h du matin doit apprendre
  // que son réglage n'a pas pris, et l'apprendre ici.
  const routeur = new AIModelRouter({
    env: { OASIS_MODEL_AGENT_FINANCE: "turbo", OASIS_MODEL_ECONOMY: "  " },
  });
  const carte = construireCarte(routeur.etat());

  const variables = carte.anomalies.map((a) => a.variable);
  assert.ok(variables.includes("OASIS_MODEL_AGENT_FINANCE"));
  assert.ok(variables.includes("OASIS_MODEL_ECONOMY"));

  const finance = carte.page26.find((l) => l.cle === "finance");
  assert.equal(finance?.niveauConfigure, "standard", "le réglage refusé n'a rien déplacé");
});

test("les trois identifiants affichés sont ceux du routeur, y compris surchargés", () => {
  const routeur = new AIModelRouter({ env: { OASIS_MODEL_ADVANCED: "gpt-5.7-essai" } });
  const carte = construireCarte(routeur.etat());
  assert.equal(carte.modeles.advanced, "gpt-5.7-essai");

  const direction = carte.page26.find((l) => l.cle === "executive");
  assert.equal(direction?.modeleEffectif, "gpt-5.7-essai");
});

test("le choix courant d'un agent sans surcharge est « produit »", () => {
  const carte = construireCarte(new AIModelRouter({ env: {} }).etat());
  for (const ligne of carte.page26) {
    assert.equal(choixCourant(ligne), CHOIX_PRODUIT);
  }
});

test("les agents hors page 26 ne portent pas de surcharge modifiable", () => {
  const carte = construireCarte(new AIModelRouter({ env: {} }).etat());
  const modifiables = carte.reste.filter((l) => l.surchargeable).map((l) => l.cle);
  // Aucun des sept restants n'est dans `AGENTS_SQL` : la page 26 couvre
  // déjà les quatre agents que la base accepte.
  assert.deepEqual(modifiables, [] as CleAgentModele[]);
  assert.deepEqual(
    AGENTS_PAGE_26.filter((cle) => cleSqlDeLAgent(cle) !== null).length,
    AGENTS_SQL.length,
  );
});
