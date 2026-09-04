import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { AGENTS_MODELE } from "../model/types.ts";
import { AGENT_LABELS, AGENTS as AGENTS_METIER } from "../types.ts";
import { MOTIFS_PANNE } from "../runtime/types.ts";
import { COLONNES_EDITEUR, COLONNES_USAGE } from "./consommation.ts";
import {
  AGENTS_SQL,
  LIBELLES_AGENT,
  LIBELLES_PANNE_CLIENT,
  cleCatalogueDeLaCleSql,
  cleSqlDeLAgent,
  estCleAgentSql,
  libellePanneClient,
  nomAgentDuJournal,
} from "./types.ts";

/**
 * §11X — CE QUE LE VOCABULAIRE DE LA CONSOMMATION DOIT GARANTIR.
 *
 * Ce fichier remplace `carte.test.ts`, qui éprouvait la carte
 * agent → modèle. Cette carte est partie dans le Control Center avec
 * l'écran qui l'affichait ; trois de ses garanties, elles, survivent et
 * n'avaient aucune raison de partir avec :
 *
 *   1. LES ACCORDS ENTRE FICHIERS. La contrainte SQL de 0072 et les
 *      libellés métier de `lib/ai/types.ts` doivent dire la même chose
 *      que ce dossier. Aucun de ces désaccords ne serait un bug dans une
 *      fonction : chacun serait un écran qui affiche tranquillement une
 *      information périmée, ou un moteur qui ignore en silence une
 *      surcharge posée par l'éditeur.
 *
 *   2. AUCUN IDENTIFIANT DE MODÈLE N'EST ÉCRIT ICI. La règle valait déjà
 *      quand ce dossier avait le droit de les AFFICHER ; elle vaut a
 *      fortiori maintenant qu'il ne l'a plus.
 *
 *   3. LA FRONTIÈRE ÉDITEUR / CLIENT, TENUE PAR LA REQUÊTE ELLE-MÊME.
 *      C'est la garantie neuve, et la plus importante des trois : ce
 *      qu'on ne demande pas à la base ne peut pas fuir vers l'écran.
 */

const ICI = dirname(fileURLToPath(import.meta.url));
const RACINE = join(ICI, "..", "..", "..", "..");

// ==================================================================
// 1. Les accords entre fichiers
// ==================================================================

test("les quatre agents surchargeables sont exactement ceux qu'accepte 0072", () => {
  // La contrainte `check (public.ai_is_supported_agent(agent))` porte sur
  // `ai_model_overrides` ; la liste vit dans une fonction SQL, que le
  // TypeScript ne peut pas lire. On relit donc la migration.
  //
  // L'enjeu a CHANGÉ DE CAMP depuis que l'écran de réglage est parti :
  // ce n'est plus un sélecteur client qui se ferait refuser par un
  // `check`, c'est `appliquerSurcharges` (routage.ts) qui ne
  // reconnaîtrait pas une surcharge posée par l'éditeur et l'ignorerait
  // en silence. Un cinquième agent ajouté d'un seul côté produirait donc
  // une dérogation payée, enregistrée, journalisée — et sans effet.
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
    assert.ok(estCleAgentSql(agent));
  }
  // Et les dix autres n'en ont pas — c'est le cas ordinaire, pas une erreur.
  const surchargeables = AGENTS_MODELE.filter((cle) => cleSqlDeLAgent(cle) !== null);
  assert.equal(surchargeables.length, AGENTS_SQL.length);
});

test("les libellés d'agent ne contredisent pas ceux des écrans métier", () => {
  // `lib/ai/types.ts` en porte quatre, affichés sur les cartes de
  // décision. Deux noms différents pour le même agent selon l'écran,
  // c'est un utilisateur qui croit qu'il y en a deux.
  for (const agent of AGENTS_METIER) {
    const cle = cleCatalogueDeLaCleSql(agent);
    assert.equal(
      LIBELLES_AGENT[cle],
      AGENT_LABELS[agent],
      `« ${agent} » s'appelle « ${AGENT_LABELS[agent]} » sur les décisions et ` +
        `« ${LIBELLES_AGENT[cle]} » dans la consommation.`,
    );
  }
});

test("chaque agent du catalogue a un libellé français", () => {
  for (const cle of AGENTS_MODELE) {
    assert.ok(LIBELLES_AGENT[cle]?.length > 0, `libellé manquant pour ${cle}`);
  }
});

test("le grand livre se lit en français, y compris hors catalogue", () => {
  // La graphie SQL et la graphie du catalogue mènent au même nom.
  assert.equal(nomAgentDuJournal("quote_pricing"), LIBELLES_AGENT.quotePricing);
  assert.equal(nomAgentDuJournal("quotePricing"), LIBELLES_AGENT.quotePricing);
  // Le consommateur qui n'est pas un agent du catalogue.
  assert.equal(nomAgentDuJournal("edge-assistant"), "Assistant (conversation)");
  // Et l'inconnu total : la clé brute, pas une erreur. Une ventilation
  // qui refuserait de s'afficher parce qu'une clé nouvelle est apparue
  // serait un mauvais échange.
  assert.equal(nomAgentDuJournal("agent-de-demain"), "agent-de-demain");
});

test("chaque motif de panne a une formulation écrite pour le client", () => {
  for (const motif of MOTIFS_PANNE) {
    assert.ok(LIBELLES_PANNE_CLIENT[motif]?.length > 0, `motif sans libellé : ${motif}`);
  }
  assert.equal(libellePanneClient("inconnu"), "Motif non enregistré");
});

test("le refus pour limite atteinte ne nomme ni somme ni modèle", () => {
  // C'est la formulation la plus délicate de l'écran : le client doit
  // apprendre que son IA s'est arrêtée — sinon il croit à une panne —
  // sans apprendre le montant qui l'a arrêté, qui borne la dépense de
  // l'éditeur et non la sienne.
  const phrase = LIBELLES_PANNE_CLIENT.budget_exceeded;
  assert.doesNotMatch(phrase, /€|euro|centime|plafond|dépense/i, phrase);
  assert.match(phrase, /limite/i, phrase);
});

// ==================================================================
// 2. Aucun identifiant de modèle dans ce dossier
// ==================================================================

const FICHIERS_ADMIN = [
  "types.ts",
  "consommation.ts",
  "routage.ts",
  "lecture.ts",
  "actions.ts",
  "index.ts",
];

test("aucun identifiant de modèle n'est écrit dans lib/ai/admin", () => {
  // La règle de la page 4 : `router.ts` reste le seul fichier du dépôt
  // web à porter les trois noms. Ce dossier ne les affiche plus du tout
  // — l'écran qui en avait le droit (p. 26) est parti dans le Control
  // Center — et il ne les connaît toujours pas.
  const motif = /gpt-5\.6-(sol|terra|luna)/;
  for (const nom of FICHIERS_ADMIN) {
    const source = readFileSync(join(ICI, nom), "utf8");
    assert.ok(!motif.test(source), `lib/ai/admin/${nom} contient un identifiant de modèle en dur.`);
  }
});

// ==================================================================
// 3. La frontière éditeur / client, tenue par la requête
// ==================================================================

test("la lecture du grand livre ne demande aucune colonne de l'éditeur", () => {
  // C'est la garantie de fond du déménagement. Le montant en centimes et
  // le nom du modèle restent lisibles EN BASE par tout membre — la
  // migration 0080 a délibérément conservé la politique de lecture, sans
  // quoi le moteur ne verrait plus ce que l'éditeur lui impose. Rien
  // n'empêche donc techniquement l'écran client de les demander : c'est
  // cette liste, et elle seule, qui l'en empêche.
  for (const colonne of COLONNES_EDITEUR) {
    assert.ok(
      !COLONNES_USAGE.includes(colonne),
      `COLONNES_USAGE demande « ${colonne} » : cette colonne décrit ce que l'IA coûte à ` +
        `l'éditeur, pas ce que le client consomme.`,
    );
  }
});

test("la lecture du grand livre demande exactement ce dont l'écran a besoin", () => {
  const demandees = COLONNES_USAGE.split(",").map((c) => c.trim());
  assert.deepEqual(demandees, [
    "agent",
    "input_tokens",
    "output_tokens",
    "duration_ms",
    "success",
    "failure_reason",
    "decision_id",
    "user_id",
    "created_at",
  ]);
});

test("l'écran de consommation n'affiche ni euro ni moteur", () => {
  // Le fichier est relu plutôt que rendu : un test de rendu React
  // demanderait une session, une organisation et une base. Ce qu'on
  // défend ici est plus simple qu'un rendu et se casse de la même façon
  // — quelqu'un qui rebranche `formatCents` ou le routeur sur cet écran.
  const ecran = readFileSync(
    join(RACINE, "web-pro", "app", "(app)", "parametres", "ia", "page.tsx"),
    "utf8",
  );

  assert.ok(
    !/formatCents|centsToInput|lib\/quotes\/types/.test(ecran),
    "L'écran de consommation remet un montant en euros sous les yeux du client.",
  );
  assert.ok(
    !/@\/lib\/ai\/model/.test(ecran),
    "L'écran de consommation importe le routeur : il n'a aucune raison de connaître un modèle.",
  );
  // Le motif vise un LIEN, pas le mot : le commentaire d'en-tête cite
  // l'ancienne adresse pour expliquer ce qui est parti, et il doit
  // pouvoir la citer.
  assert.ok(
    !/href=\{?["'`]\/parametres\/ia\/couts/.test(ecran),
    "L'écran de consommation renvoie vers `/parametres/ia/couts`, qui n'existe plus.",
  );
});

test("les paramètres ne proposent plus de porte vers les écrans partis", () => {
  const sommaire = readFileSync(
    join(RACINE, "web-pro", "app", "(app)", "parametres", "page.tsx"),
    "utf8",
  );
  assert.ok(
    !/href=\{?["'`]\/parametres\/ia\/couts/.test(sommaire),
    "Le sommaire des paramètres garde une carte vers `/parametres/ia/couts`, supprimée.",
  );
});
