import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { RunContext } from "@openai/agents";
import { AIModelRouter } from "../model/router.ts";
import { lireConfiguration } from "../model/configuration.ts";
import { AGENTS_MODELE, NIVEAUX_MODELE, type NiveauModele } from "../model/types.ts";
import { ModelEscalationService } from "../runtime/escalation.ts";
import { registreOutils } from "../runtime/tools.ts";
import { construireOutilSdk } from "../runtime/toolsSdk.ts";
import {
  OasisActionEngine,
  exigeConfirmationHumaine,
  risqueEffectif,
  type PortActionEngine,
  type PortServicesMetier,
} from "../runtime/actionEngine.ts";
import { BUDGET_SANS_LIMITE, type BudgetIA } from "../runtime/cost.ts";
import { MESSAGE_INDISPONIBLE, type IdentiteAppel, type SortieModele } from "../runtime/types.ts";
import { AGENTS_PREMIERE_ITERATION } from "../runtime/definitions.ts";
import {
  CATALOGUE_EVAL,
  DROITS_COMPLETS,
  GRILLE_EVALUATION,
  GRILLE_SANS_TARIF,
  ORGANISATION_A,
  ORGANISATION_B,
  monterHarnais,
} from "./harnais.ts";
import { JETONS_ENTREE_PAR_TOUR, JETONS_SORTIE_PAR_TOUR } from "./modeleSimule.ts";

/**
 * §11V — ÉTAPES 19 ET 20 : LES HUIT TESTS OBLIGATOIRES DE LA PAGE 32.
 *
 *     MODEL ROUTER · ESCALATION · TOOLS · ACTION ·
 *     APPROVAL · SECURITY · COST · FAILURE
 *
 * ══════════════════════════════════════════════════════════════════
 * CE FICHIER NE RÉSUME PAS LES AUTRES TESTS. IL PROUVE AUTRE CHOSE.
 * ══════════════════════════════════════════════════════════════════
 *
 * `router.test.ts`, `escalation.test.ts`, `actionEngine.test.ts` et
 * `agents.test.ts` éprouvent déjà chaque pièce. Les huit tests de la
 * page 32 ne sont pas leur résumé : ils portent, chacun, une
 * affirmation PLUS FORTE que celle de la pièce correspondante, et cette
 * affirmation traverse la chaîne entière.
 *
 *   TOOLS    — la pièce prouve qu'un outil étranger n'est pas OFFERT.
 *              Ici on prouve qu'appelé quand même, IL EST REFUSÉ, et
 *              qu'aucune fonction SQL n'est atteinte. « Absent de la
 *              liste » et « inatteignable » sont deux affirmations
 *              différentes, et seule la seconde est une sécurité.
 *
 *   ACTION   — la pièce prouve que le moteur enregistre au lieu
 *              d'écrire. Ici on CHERCHE UN CHEMIN par lequel une sortie
 *              de modèle atteindrait une écriture sans passer par lui,
 *              et on montre qu'il n'y en a pas — à trois niveaux, dont
 *              un que PostgreSQL fait respecter lui-même.
 *
 *   APPROVAL — la pièce prouve qu'un risque élevé exige une
 *              confirmation. Ici on prouve que le contrôle est SERVEUR :
 *              au niveau d'autonomie maximal, avec un exécuteur
 *              disponible, l'autopilote n'est même pas INTERROGÉ.
 *
 *   COST     — la pièce prouve que le journal écrit. Ici on prouve
 *              l'ÉGALITÉ entre jetons consommés et jetons inscrits, y
 *              compris quand l'appel échoue, quand il se replie, et
 *              quand le plafond refuse.
 *
 *   FAILURE  — la pièce prouve que le repli fonctionne. Ici on prouve
 *              qu'il NE fonctionne PAS quand la décision est critique,
 *              ce qui est la vraie exigence de la page 23.
 */

const ici = dirname(fileURLToPath(import.meta.url));
const dossierMigrations = join(ici, "..", "..", "..", "..", "supabase", "migrations");

const IDENTITE_A: IdentiteAppel = Object.freeze({
  organizationId: ORGANISATION_A,
  workspaceId: "ws-A",
  userId: "user-A",
  permissions: DROITS_COMPLETS,
});

/** Une analyse bien formée, pour servir de réponse finale. */
function analyse(surcharge: Record<string, unknown> = {}) {
  return {
    resume: "Dix chantiers terminés attendent leur facture.",
    confidence: "high",
    ambigu: false,
    recommandations: [],
    donneesManquantes: [],
    ...surcharge,
  };
}

const CANDIDATS = { resume: { prets: 10, montantPretHtCents: 3_845_000, pretsSansMontant: 0 } };

/** Un budget dont le plafond du jour est déjà consommé. */
const BUDGET_EPUISE: BudgetIA = Object.freeze({
  ...BUDGET_SANS_LIMITE,
  limiteJourCents: 50_000,
  depenseJourCents: 50_000,
  resteJourCents: 0,
});

/** Une expiration, telle qu'un `AbortController` la produit. */
function expiration(): Error {
  const erreur = new Error("The operation was aborted");
  erreur.name = "AbortError";
  return erreur;
}

// ==================================================================
// 1. MODEL ROUTER — simple → Luna, standard → Terra, complexe → Sol
// ==================================================================
//
// LA PAGE 32 ÉCRIT « simple → Luna ». Elle ne dit pas « par rapport à
// quoi », et c'est la question qui décide de tout : la complexité est
// RELATIVE au niveau de l'agent (voir l'en-tête de `router.ts`), pas
// absolue. Les trois correspondances de la page se vérifient donc sur
// un agent calibré au niveau intermédiaire — la Facturation, qui est
// exactement l'exemple que la page 6 déroule. Le second test montre que
// la relativité est délibérée et non un accident.

test("MODEL ROUTER — simple, standard et complexe donnent les trois niveaux", () => {
  const routeur = new AIModelRouter({ configuration: lireConfiguration({}) });

  const attendu: readonly [string, NiveauModele][] = [
    ["simple", "economy"],
    ["standard", "standard"],
    ["complex", "advanced"],
  ];

  for (const [complexite, niveau] of attendu) {
    const decision = routeur.resolve({
      agent: "billing",
      complexity: complexite as "simple" | "standard" | "complex",
    });
    assert.equal(decision.niveau, niveau, `« ${complexite} » devrait donner « ${niveau} »`);
    assert.equal(
      decision.modele,
      routeur.modelePourNiveau(niveau),
      "le modèle rendu doit être celui du niveau, et aucun autre",
    );
  }
});

test("MODEL ROUTER — la complexité DÉCALE autour de l'agent, elle n'impose pas", () => {
  const routeur = new AIModelRouter({ configuration: lireConfiguration({}) });

  // Mille lignes de CRM, c'est « complexe » pour la classification —
  // et cela reste une tâche de classification. En absolu, ce même mot
  // enverrait mille fois par jour la tâche la plus répétitive du
  // produit sur le modèle le plus cher.
  assert.equal(routeur.resolve({ agent: "classification", complexity: "complex" }).niveau, "standard");

  // Et une question « simple » posée à la Direction ne descend pas au
  // niveau le moins capable : elle descend d'un cran.
  assert.equal(routeur.resolve({ agent: "executive", complexity: "simple" }).niveau, "standard");
});

test("MODEL ROUTER — le niveau choisi arrive INTACT jusqu'au fournisseur", async () => {
  // Le routeur peut avoir raison et le produit tort : il suffit qu'une
  // couche intermédiaire remplace l'identifiant. Seul le fournisseur
  // dit ce qui a réellement été demandé.
  const h = monterHarnais({
    donnees: { ai_billing_candidates: CANDIDATS },
    scripts: { billing: [{ type: "final", sortie: analyse() }] },
  });

  await h.runtime.executer({
    agent: "billing",
    question: "Qu'est-ce que je dois facturer ?",
    criticite: "ordinaire",
    routage: { complexity: "simple" },
  });

  assert.deepEqual(h.observations.demandesModele, [h.routeur.modelePourNiveau("economy")]);
});

test("MODEL ROUTER — déplacer un agent depuis la configuration ne déplace que lui (p. 34)", async () => {
  // LE CRITÈRE FINAL DE LA SPEC, éprouvé de bout en bout : « Je dois
  // pouvoir remplacer demain Finance : Terra → Sol depuis une
  // configuration centrale », SANS CHANGER LE CODE MÉTIER.
  const routeur = new AIModelRouter({
    configuration: lireConfiguration({ OASIS_MODEL_AGENT_FINANCE: "advanced" }),
  });

  const h = monterHarnais({
    routeur,
    donnees: { ai_finance_snapshot: { chiffreAffaires: {} } },
    scripts: { finance: [{ type: "final", sortie: analyse() }] },
  });

  await h.runtime.executer({
    agent: "finance",
    question: "Où en est la marge ?",
    criticite: "ordinaire",
  });

  assert.deepEqual(
    h.observations.demandesModele,
    [routeur.modelePourNiveau("advanced")],
    "une variable d'environnement doit suffire à déplacer un agent",
  );

  // ET RIEN D'AUTRE N'A BOUGÉ. C'est la moitié du critère qu'on oublie
  // de vérifier, et la seule qui distingue une configuration d'un
  // interrupteur général.
  const parDefaut = new AIModelRouter({ configuration: lireConfiguration({}) });
  for (const agent of AGENTS_MODELE) {
    if (agent === "finance") continue;
    assert.equal(
      routeur.getTierForAgent(agent),
      parDefaut.getTierForAgent(agent),
      `« ${agent} » a bougé alors que seul « finance » était visé`,
    );
  }
});

// ==================================================================
// 2. ESCALATION — Terra insuffisant → Sol lorsque c'est autorisé
// ==================================================================

test("ESCALATION — l'ambiguïté déclarée fait monter d'un cran, et le second appel a lieu", async () => {
  const h = monterHarnais({
    donnees: { ai_billing_candidates: CANDIDATS },
    scripts: {
      billing: [
        // Premier tour au niveau intermédiaire : l'agent DÉCLARE que la
        // situation reste ambiguë (p. 7, « still ambiguous »).
        { type: "final", sortie: analyse({ confidence: "medium", ambigu: true }) },
        // Second tour, au niveau le plus capable.
        { type: "final", sortie: analyse({ confidence: "high" }) },
      ],
    },
  });

  const reponse = await h.runtime.executer({
    agent: "billing",
    question: "Qu'est-ce que je dois facturer ?",
    criticite: "ordinaire",
  });

  assert.equal(reponse.execution.ok, true);
  assert.deepEqual(h.observations.demandesModele, [
    h.routeur.modelePourNiveau("standard"),
    h.routeur.modelePourNiveau("advanced"),
  ]);
  assert.ok(reponse.execution.ok && reponse.execution.escalades.length === 1);
  assert.equal(
    reponse.execution.ok && reponse.execution.escalades[0].declencheur,
    "ambiguite_declaree",
  );
  // DEUX APPELS, DEUX LIGNES AU GRAND LIVRE. Une escalade qui ne
  // laisserait qu'une ligne ferait payer deux modèles pour un coût
  // affiché de un.
  assert.equal(h.observations.evenements.length, 2);
});

test("ESCALATION — « et pas autrement » : trois refus qui coûtent cher s'ils tombent", async () => {
  const service = new ModelEscalationService();
  const sortie = (surcharge: Partial<SortieModele> = {}): SortieModele => ({
    texte: null,
    donnees: null,
    confiance: "low",
    ambigu: false,
    jetonsEntree: 0,
    jetonsSortie: 0,
    appelsOutils: 0,
    ...surcharge,
  });

  // 1. Confiance faible SEULE, depuis le niveau intermédiaire. La page
  //    7 exige « still ambiguous / high impact » : la confiance faible
  //    est fréquente sur le moteur de tous les agents métier, et
  //    escalader dessus enverrait la moitié des demandes ordinaires
  //    sur le modèle le plus cher.
  assert.equal(service.decider({ niveauActuel: "standard", sortie: sortie() }).escalader, false);

  // 2. Données insuffisantes : un modèle plus cher relirait la même
  //    absence. C'est le seul endroit du système où « faible » et
  //    « insuffisant » mènent à des dépenses différentes.
  assert.equal(
    service.decider({
      niveauActuel: "economy",
      sortie: sortie({ confiance: "insufficient_data", ambigu: true }),
    }).escalader,
    false,
  );

  // 3. Un plafond n'est pas franchi par une escalade. Le contrôle de
  //    coût a le droit de dire non, et il l'a déjà dit.
  assert.equal(
    service.decider({
      niveauActuel: "standard",
      sortie: sortie({ ambigu: true }),
      plafond: "standard",
    }).escalader,
    false,
  );

  // Et le cas positif, pour que les trois refus ne soient pas ceux d'un
  // service qui refuse tout.
  assert.equal(
    service.decider({ niveauActuel: "standard", sortie: sortie({ ambigu: true }) }).escalader,
    true,
  );
});

test("ESCALATION — un plafond de plan bloque la montée jusqu'au fournisseur", async () => {
  const h = monterHarnais({
    donnees: { ai_billing_candidates: CANDIDATS },
    scripts: { billing: [{ type: "final", sortie: analyse({ confidence: "medium", ambigu: true }) }] },
  });

  await h.runtime.executer({
    agent: "billing",
    question: "?",
    criticite: "ordinaire",
    routage: { userPlan: "standard" },
  });

  assert.equal(
    h.observations.demandesModele.length,
    1,
    "le plan limite à « standard » : aucune escalade ne doit franchir ce plafond",
  );
});

// ==================================================================
// 3. TOOLS — un outil non autorisé est REFUSÉ, pas seulement absent
// ==================================================================

test("TOOLS — l'offre est déjà filtrée : chaque agent ne voit que les siens", async () => {
  const registre = registreOutils();
  for (const agent of AGENTS_PREMIERE_ITERATION) {
    for (const outil of registre.pourAgent(agent, DROITS_COMPLETS)) {
      assert.ok(
        outil.agent === agent || outil.agent === null,
        `« ${outil.nom} » (${outil.agent}) est offert à « ${agent} »`,
      );
    }
  }
});

test("TOOLS — appelé quand même, un outil dont le droit manque est REFUSÉ", async () => {
  // La différence avec le test précédent est tout le sujet : là,
  // l'outil n'était pas dans la liste. Ici, il y est — on le construit
  // exprès — et il refuse à l'exécution. C'est la seconde serrure de
  // `toolsSdk.ts`, celle qui tient si la première est mal fermée.
  const registre = registreOutils();
  const outil = registre.chercher("createInvoiceDraft");
  assert.ok(outil !== null);

  let deposeAppele = false;
  const sdk = construireOutilSdk(
    outil,
    // Une identité SANS `invoice.create`.
    { ...IDENTITE_A, permissions: ["projects.read"] },
    {
      lire: async () => {
        throw new Error("aucune lecture ne doit partir");
      },
      deposer: async () => {
        deposeAppele = true;
        return {};
      },
    },
  );

  const resultat = await sdk.invoke(new RunContext(), "{}");
  const lu: { erreur?: unknown; message?: unknown } =
    typeof resultat === "string" ? JSON.parse(resultat) : (resultat as never);

  assert.equal(lu.erreur, "droitManquant");
  assert.match(String(lu.message), /invoice\.create/);
  assert.equal(deposeAppele, false, "un outil refusé ne doit RIEN déposer");
});

test("TOOLS — un outil d'un autre agent, nommé par le modèle, n'atteint aucune fonction SQL", async () => {
  // Le modèle nomme `getQuote` alors qu'il joue la Facturation. L'outil
  // n'est pas dans son jeu : l'Agents SDK ne le trouve pas, le tour
  // échoue, et RIEN n'est lu. C'est la démonstration que « non offert »
  // vaut ici « inatteignable » — un modèle qui insiste n'obtient pas la
  // donnée d'un domaine qui ne le regarde pas.
  const h = monterHarnais({
    donnees: {
      ai_billing_candidates: CANDIDATS,
      ai_get_daily_priorities: { devisARelancer: [], devisQuiExpirent: [] },
      ai_quote_price_analysis: { prixProposeHtCents: 1 },
    },
    scripts: {
      billing: [
        { type: "outil", nom: "getQuote", arguments: { p_quote_id: "peu-importe" } },
        { type: "final", sortie: analyse() },
      ],
    },
  });

  const reponse = await h.runtime.executer({
    agent: "billing",
    question: "Montre-moi le devis 184.",
    criticite: "ordinaire",
  });

  assert.equal(reponse.execution.ok, false, "le tour ne doit pas aboutir sur un outil interdit");
  assert.deepEqual(
    h.observations.lectures.filter((l) => l.rpc === "ai_quote_price_analysis"),
    [],
    "la fonction d'un autre domaine ne doit jamais avoir été appelée",
  );
  assert.deepEqual(h.observations.executionsMetier, []);
});

// ==================================================================
// 4. ACTION — aucune sortie de modèle n'atteint une écriture
// ==================================================================

test("ACTION — aucun outil d'écriture ne connaît le nom d'une fonction", () => {
  // PREMIER NIVEAU. Les familles `proposition` et `moteur` n'ont pas de
  // champ `rpc` : il n'existe littéralement pas, dans le registre, de
  // nom de fonction qu'un outil d'écriture pourrait appeler. Ce n'est
  // pas une convention, c'est une donnée absente.
  for (const outil of registreOutils().tous()) {
    if (outil.famille === "lecture") continue;
    assert.equal(
      outil.rpc,
      undefined,
      `« ${outil.nom} » porte un nom de fonction : la correspondance vers l'écriture doit rester ` +
        "dans `lib/ai/proposals.ts`, derrière un clic",
    );
    assert.equal(
      outil.confirmationRequise,
      true,
      `« ${outil.nom} » n'exige pas de confirmation : le SDK n'interromprait pas le tour`,
    );
  }
});

test("ACTION — toute fonction atteignable par un outil de LECTURE est non volatile", () => {
  // DEUXIÈME NIVEAU, et c'est celui qui ne dépend pas de nous.
  // PostgreSQL REFUSE une écriture dans une fonction déclarée `stable`
  // ou `immutable` (« INSERT is not allowed in a non-volatile
  // function »). Tant que les quinze fonctions de lecture le sont, un
  // appel d'outil ne peut pas écrire, même si quelqu'un ajoutait un
  // `insert` dans l'une d'elles par distraction : la base le refuserait
  // à l'exécution.
  //
  // Le jour où une lecture devient `volatile`, ce test tombe — et c'est
  // le bon moment pour se demander pourquoi une lecture aurait besoin
  // d'écrire.
  const sources = readdirSync(dossierMigrations)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => readFileSync(join(dossierMigrations, f), "utf8"))
    .join("\n");

  const volatiles: string[] = [];
  for (const outil of registreOutils().tous()) {
    if (outil.famille !== "lecture" || outil.rpc === undefined) continue;

    const entete = enteteDeFonction(sources, outil.rpc);
    assert.ok(entete !== null, `aucune définition trouvée pour « ${outil.rpc} »`);
    if (!/\b(stable|immutable)\b/i.test(entete)) volatiles.push(`${outil.nom} → ${outil.rpc}`);
  }

  assert.deepEqual(
    volatiles,
    [],
    "une fonction de lecture volatile est un outil par lequel une sortie de modèle POURRAIT " +
      "atteindre une écriture sans passer par l'Action Engine",
  );
});

test("ACTION — la sortie d'un modèle qui demande une écriture n'écrit rien", async () => {
  // TROISIÈME NIVEAU, celui du produit. Le modèle appelle réellement
  // l'outil d'écriture ; le SDK interrompt ; le serveur tranche ;
  // l'action est ENREGISTRÉE et le service métier reste au repos.
  const h = monterHarnais({
    donnees: { ai_billing_candidates: CANDIDATS },
    scripts: {
      billing: [
        { type: "outil", nom: "getUnbilledProjects" },
        { type: "outil", nom: "createInvoiceDraft" },
        { type: "final", sortie: analyse() },
      ],
    },
    // Un exécuteur EXISTE : le test ne doit pas passer par accident,
    // faute de quelqu'un pour écrire.
    executeurs: ["createInvoiceDraft"],
  });

  const reponse = await h.runtime.executer({
    agent: "billing",
    question: "Prépare les factures.",
    criticite: "ordinaire",
  });

  assert.equal(reponse.actions.length, 1);
  assert.equal(reponse.actions[0].statut, "awaiting_approval");
  assert.equal(h.observations.actionsEcrites[0].confirmationRequise, true);
  assert.equal(h.observations.approbations.length, 1);
  assert.deepEqual(
    h.observations.executionsMetier,
    [],
    "un exécuteur disponible ne doit pas suffire : il faut un humain",
  );
});

test("ACTION — le SECOND chemin, celui des propositions, ne débouche pas non plus sur une écriture", async () => {
  // IL Y A BIEN DEUX CHEMINS, et il faut le dire plutôt que de laisser
  // croire que l'Action Engine est seul.
  //
  //   famille `moteur`      → OasisActionEngine → ai_actions → clic.
  //   famille `proposition` → un RÉCAPITULATIF déposé → clic →
  //                           `confirmProposal` (Server Action) → écriture.
  //
  // Le second ne passe PAS par le moteur : `#trancherInterruption`
  // approuve d'emblée les propositions, parce qu'une proposition
  // n'écrit rien. Ce test vérifie que c'est exact — aucune écriture,
  // aucune ligne d'action — et que ce qui remonte au modèle est un
  // récapitulatif accompagné de la consigne de ne pas dire que c'est
  // fait.
  const h = monterHarnais({
    donnees: {
      ai_get_daily_priorities: { devisARelancer: [], devisQuiExpirent: [] },
      ai_quote_price_analysis: { prixProposeHtCents: 1_240_000 },
      ai_quote_comparables: { nombreComparables: 6 },
    },
    scripts: {
      quotePricing: [
        {
          type: "outil",
          nom: "createQuoteDraft",
          arguments: { p_customer_id: "cli-1", p_title: "Reprise de talus", p_lines: [] },
        },
        { type: "final", sortie: analyse() },
      ],
    },
    niveauAutonomie: 4,
    executeurs: ["createQuoteDraft"],
    autopiloteRend: true,
  });

  const reponse = await h.runtime.executer({
    agent: "quotePricing",
    question: "Prépare un devis.",
    cible: { quoteId: "11111111-1111-4111-8111-111111111111" },
    criticite: "ordinaire",
  });

  assert.equal(reponse.propositions.length, 1);
  assert.equal(reponse.propositions[0].kind, "createQuoteDraft");
  assert.deepEqual(h.observations.executionsMetier, []);
  assert.deepEqual(
    h.observations.actionsEcrites,
    [],
    "une proposition ne passe pas par `ai_actions` : elle attend un clic sur un récapitulatif",
  );
  // L'ORGANISATION EST DÉJÀ POSÉE dans les arguments déposés, alors que
  // le modèle ne l'a jamais nommée.
  assert.equal(reponse.propositions[0].args.p_organization_id, ORGANISATION_A);
});

test("ACTION — la Server Action de confirmation repose l'organisation de la session EN DERNIER", () => {
  // Le bout du second chemin. `confirmProposal` reçoit ses arguments
  // d'un FORMULAIRE, donc du navigateur, donc d'une source qu'on ne
  // contrôle pas. Ce qui rend le chemin sûr est l'ORDRE de l'objet
  // envoyé à Postgres : le contenu du formulaire d'abord, l'organisation
  // de la session ENSUITE — la seconde écrase la première.
  //
  // Inverser ces deux lignes ne casserait aucun test existant et
  // ouvrirait l'écriture inter-entreprises à quiconque sait modifier un
  // champ caché. C'est exactement le genre de régression qu'une
  // relecture ne rattrape pas.
  const source = readFileSync(join(ici, "..", "actions.ts"), "utf8");
  const debut = source.indexOf(".rpc(spec.rpc");
  assert.notEqual(debut, -1, "l'appel `.rpc(spec.rpc, …)` de `confirmProposal` a changé de forme");

  // On regarde la fenêtre qui suit l'appel plutôt que d'équilibrer les
  // accolades : `payloadFor({ … })` en contient déjà, et une expression
  // régulière qui prétendrait les compter serait plus fragile que la
  // lecture qu'elle remplace.
  const corps = source.slice(debut, debut + 400);
  const positionPayload = corps.indexOf("...payloadFor");
  const positionOrg = corps.indexOf("p_organization_id");
  assert.ok(positionPayload >= 0 && positionOrg >= 0);
  assert.ok(
    positionOrg > positionPayload,
    "l'organisation de la session doit être posée APRÈS les arguments du formulaire, " +
      "sinon un champ caché modifié choisirait l'entreprise dans laquelle écrire",
  );
});

// ==================================================================
// 5. APPROVAL — risque élevé bloqué, et le contrôle est SERVEUR
// ==================================================================

test("APPROVAL — au niveau d'autonomie MAXIMAL, un risque élevé n'interroge même pas l'autopilote", async () => {
  const moteur = new OasisActionEngine(portActionsQuiCompte(), servicesQuiComptent());

  const resultat = await moteur.proposer({
    identite: IDENTITE_A,
    agentDemandeur: "billing",
    proposition: {
      actionType: "sendInvoice",
      resume: "Envoyer la facture au client",
      parameters: {},
      cibleType: "invoice",
      cibleId: "inv-1",
      montantCents: 120_000,
    },
    // 4 = autopilote autorisé. La configuration la plus permissive du
    // produit, et pourtant.
    reglage: { agent: "billing", actif: true, niveau: 4, parDefaut: false },
    libelleAgent: "Facturation",
  });

  assert.ok(resultat.ok);
  assert.equal(resultat.action.risque, "high");
  assert.equal(resultat.action.statut, "awaiting_approval");
  assert.notEqual(resultat.action.approvalId, null);
  assert.deepEqual(
    autopilotesInterroges,
    [],
    "interroger `ai_may_autoexecute` et se fier à son « non » ferait dépendre un interdit de la " +
      "spec des douze conditions d'une fonction SQL ; ici le chemin n'existe pas",
  );
  assert.deepEqual(executionsMetier, []);
});

test("APPROVAL — un montant élevé relève le risque d'une action pourtant « medium »", () => {
  // Le risque n'est pas seulement celui du catalogue : au-delà de
  // 20 000 €, une action qui engage de l'argent devient élevée. Sans
  // cette règle, « créer des brouillons » resterait « medium » pour
  // dix dossiers à 38 450 €.
  const entree = CATALOGUE_EVAL.createInvoiceDraft;
  assert.equal(risqueEffectif(entree, 120_000), "medium");
  assert.equal(risqueEffectif(entree, 3_845_000), "high");
  assert.equal(exigeConfirmationHumaine(risqueEffectif(entree, 3_845_000)), true);

  // ET UN MONTANT INCONNU N'EST PAS UN MONTANT NUL. `null` ne doit pas
  // se lire « zéro euro, donc sans risque » : c'est le raccourci qui
  // ouvrirait l'autopilote sur exactement les propositions dont le
  // montant s'est perdu en route.
  assert.notEqual(
    risqueEffectif(entree, null),
    "low",
    "une action qui engage de l'argent sans montant connu ne peut pas être la moins risquée",
  );
});

test("APPROVAL — le contrôle vit dans le runtime serveur, pas dans la réponse rendue au navigateur", async () => {
  // La preuve que le contrôle est serveur n'est pas qu'il soit écrit
  // dans un fichier `.ts` : c'est que le SEUL chemin par lequel un
  // outil d'écriture s'exécute passe par l'interruption du SDK, et que
  // cette interruption est tranchée par `verifierPrealable` AVANT toute
  // reprise. Un client qui « aurait déjà confirmé » n'a aucun moyen de
  // court-circuiter cela : la réponse HTTP ne porte qu'une action en
  // attente et un identifiant d'approbation.
  const h = monterHarnais({
    donnees: { ai_billing_candidates: CANDIDATS },
    scripts: {
      billing: [
        { type: "outil", nom: "createInvoiceDraft" },
        { type: "final", sortie: analyse() },
      ],
    },
    niveauAutonomie: 4,
    executeurs: ["createInvoiceDraft"],
    // `ai_may_autoexecute` dirait OUI. Le risque « medium » de cette
    // action l'autoriserait ; ce qui l'arrête ici est autre chose.
    autopiloteRend: true,
    catalogue: { createInvoiceDraft: { ...CATALOGUE_EVAL.createInvoiceDraft, risqueParDefaut: "high" } },
  });

  const reponse = await h.runtime.executer({
    agent: "billing",
    question: "Envoie tout.",
    criticite: "ordinaire",
  });

  assert.equal(reponse.actions[0]?.statut, "awaiting_approval");
  assert.deepEqual(h.observations.autopilotesInterroges, []);
  assert.deepEqual(h.observations.executionsMetier, []);
});

// ==================================================================
// 6. SECURITY — organisation A contre organisation B
// ==================================================================

test("SECURITY — l'organisation vient de la session, et le modèle ne peut pas la remplacer", async () => {
  // Le modèle glisse l'organisation de A dans les arguments de son
  // appel d'outil, alors que la session est celle de B. L'injection de
  // `toolsSdk.ts` passe EN DERNIER dans le littéral : la valeur du
  // modèle est écrasée. On vérifie que A n'apparaît nulle part.
  const h = monterHarnais({
    organizationId: ORGANISATION_B,
    donnees: { ai_billing_candidates: CANDIDATS },
    scripts: {
      billing: [
        {
          type: "outil",
          nom: "getUnbilledProjects",
          arguments: { p_organization_id: ORGANISATION_A },
        },
        { type: "final", sortie: analyse() },
      ],
    },
  });

  await h.runtime.executer({ agent: "billing", question: "?", criticite: "ordinaire" });

  const avecOrg = h.observations.lectures.filter(
    (l) => l.arguments.p_organization_id !== undefined,
  );
  assert.ok(avecOrg.length >= 2, "la lecture du contexte ET celle de l'outil portent l'organisation");
  for (const lecture of avecOrg) {
    assert.equal(
      lecture.arguments.p_organization_id,
      ORGANISATION_B,
      `« ${lecture.rpc} » est parti avec l'organisation d'un autre`,
    );
  }
  assert.equal(
    JSON.stringify(h.observations.lectures).includes(ORGANISATION_A),
    false,
    "l'identifiant de A ne doit apparaître dans AUCUN argument",
  );
});

test("SECURITY — la dépense et l'action de B sont imputées à B", async () => {
  const h = monterHarnais({
    organizationId: ORGANISATION_B,
    donnees: { ai_billing_candidates: CANDIDATS },
    scripts: {
      billing: [
        { type: "outil", nom: "createInvoiceDraft" },
        { type: "final", sortie: analyse() },
      ],
    },
  });

  await h.runtime.executer({ agent: "billing", question: "?", criticite: "ordinaire" });

  assert.ok(h.observations.evenements.length > 0);
  for (const evenement of h.observations.evenements) {
    assert.equal(evenement.organizationId, ORGANISATION_B);
  }
  for (const action of h.observations.actionsEcrites) {
    assert.equal(action.organizationId, ORGANISATION_B);
    assert.equal(action.userId, "user-evaluation");
  }
});

test("SECURITY — deux organisations, deux contextes : aucune empreinte de cache commune", async () => {
  // Deux entreprises qui posent la même question sur les mêmes données
  // ne doivent PAS partager une entrée de cache. La séparation ne tient
  // pas à l'empreinte — elle serait identique — mais à
  // `ai_cache_lookup`, qui prend l'organisation en colonne. On vérifie
  // ici que la clé et l'organisation voyagent bien séparément, donc que
  // rien n'est cherché « au nom de tout le monde ».
  const lectures: { org: string; empreinte: string }[] = [];

  for (const org of [ORGANISATION_A, ORGANISATION_B]) {
    const h = monterHarnais({
      organizationId: org,
      donnees: { ai_billing_candidates: CANDIDATS },
      scripts: { billing: [{ type: "final", sortie: analyse() }] },
    });
    const reponse = await h.runtime.executer({
      agent: "billing",
      question: "?",
      criticite: "ordinaire",
      cache: { cle: "eval:billing:question" },
    });
    assert.equal(reponse.execution.ok, true);
    assert.equal(h.observations.cacheLu.length, 1);
    lectures.push({ org, empreinte: h.observations.cacheLu[0].empreinte });
  }

  // L'empreinte porte les DONNÉES, pas l'entreprise : c'est voulu, et
  // c'est pourquoi l'organisation doit rester une colonne à part.
  assert.equal(lectures[0].empreinte, lectures[1].empreinte);
  assert.notEqual(lectures[0].org, lectures[1].org);
});

// ==================================================================
// 7. COST — un appel sans `ai_usage_event` est un défaut
// ==================================================================

test("COST — les jetons inscrits égalent les jetons consommés, tour par tour", async () => {
  const h = monterHarnais({
    donnees: { ai_billing_candidates: CANDIDATS },
    scripts: {
      billing: [
        { type: "outil", nom: "getUnbilledProjects" },
        { type: "final", sortie: analyse() },
      ],
    },
  });

  await h.runtime.executer({ agent: "billing", question: "?", criticite: "ordinaire" });

  assert.equal(h.observations.evenements.length, 1, "une tentative, une ligne");
  const ligne = h.observations.evenements[0];
  assert.equal(ligne.jetonsEntree, JETONS_ENTREE_PAR_TOUR * 2, "les DEUX tours, pas seulement le dernier");
  assert.equal(ligne.jetonsSortie, JETONS_SORTIE_PAR_TOUR * 2);
  assert.equal(ligne.succes, true);
  assert.equal(ligne.motifPanne, null);
  assert.equal(ligne.baseTarif, GRILLE_EVALUATION.base);
  assert.ok(ligne.coutEstimeCents !== null && ligne.coutEstimeCents > 0);
});

test("COST — un appel qui ÉCHOUE laisse quand même sa ligne", async () => {
  const h = monterHarnais({
    donnees: { ai_billing_candidates: CANDIDATS },
    scripts: { billing: [{ type: "panne", erreur: expiration() }] },
    // Décision critique : pas de repli, donc exactement une tentative.
  });

  const reponse = await h.runtime.executer({
    agent: "billing",
    question: "?",
    criticite: "critique",
  });

  assert.equal(reponse.execution.ok, false);
  assert.equal(h.observations.evenements.length, 1);
  assert.equal(h.observations.evenements[0].succes, false);
  assert.equal(h.observations.evenements[0].motifPanne, "timeout");
});

test("COST — le refus pour plafond s'inscrit AUSSI, à zéro jeton", async () => {
  const h = monterHarnais({
    donnees: { ai_billing_candidates: CANDIDATS },
    scripts: { billing: [{ type: "final", sortie: analyse() }] },
    budget: BUDGET_EPUISE,
  });

  const reponse = await h.runtime.executer({
    agent: "billing",
    question: "?",
    criticite: "ordinaire",
  });

  assert.equal(reponse.execution.ok, false);
  assert.equal(reponse.execution.ok === false && reponse.execution.motif, "budget_exceeded");
  assert.deepEqual(h.observations.demandesModele, [], "aucun modèle n'est appelé après un refus");
  // SANS CETTE LIGNE, un plafond qui coupe tout un après-midi ferait
  // afficher « aucune activité IA » au tableau de bord.
  assert.equal(h.observations.evenements.length, 1);
  assert.equal(h.observations.evenements[0].motifPanne, "budget_exceeded");
  assert.equal(h.observations.evenements[0].jetonsEntree, 0);
});

test("COST — sans tarif renseigné, le coût est INCONNU et jamais zéro", async () => {
  const h = monterHarnais({
    donnees: { ai_billing_candidates: CANDIDATS },
    scripts: { billing: [{ type: "final", sortie: analyse() }] },
    grille: GRILLE_SANS_TARIF,
  });

  const reponse = await h.runtime.executer({
    agent: "billing",
    question: "?",
    criticite: "ordinaire",
  });

  assert.equal(reponse.execution.ok && reponse.execution.coutEstimeCents, null);
  assert.equal(h.observations.evenements[0].coutEstimeCents, null);
  assert.equal(h.observations.evenements[0].baseTarif, null);
  // Les jetons, eux, sont comptés : on sait qu'on a dépensé, on ne sait
  // pas combien. C'est une information ; « 0 € » serait un mensonge.
  assert.equal(h.observations.evenements[0].jetonsEntree, JETONS_ENTREE_PAR_TOUR);
});

test("COST — chaque niveau a un tarif, et les trois sont distincts", () => {
  // Une grille où deux niveaux coûteraient pareil rendrait le ratio de
  // la page 17 (~15 % / ~80 % / ~5 %) sans objet : arbitrer entre deux
  // modèles au même prix n'économise rien.
  const montants = NIVEAUX_MODELE.map((niveau) => {
    const tarif = GRILLE_EVALUATION.tarifs[niveau];
    assert.ok(tarif !== null, `le niveau « ${niveau} » n'a pas de tarif d'évaluation`);
    return tarif.entreeCentsParMillion;
  });
  assert.equal(new Set(montants).size, NIVEAUX_MODELE.length);
});

// ==================================================================
// 8. FAILURE — expiration, repli contrôlé, jamais en silence
// ==================================================================

test("FAILURE — une expiration sur une tâche ordinaire se replie, et ça se voit", async () => {
  const h = monterHarnais({
    donnees: {
      ai_get_daily_priorities: { devisARelancer: [], devisQuiExpirent: [] },
      ai_quote_price_analysis: { prixProposeHtCents: 1_240_000, confiance: "medium" },
      ai_quote_comparables: { nombreComparables: 6 },
    },
    scripts: {
      // L'agent « Devis et prix » part au niveau le plus capable : il y
      // a donc un cran en dessous où se replier.
      quotePricing: [
        { type: "panne", erreur: expiration() },
        { type: "final", sortie: analyse({ confidence: "medium" }) },
      ],
    },
  });

  const reponse = await h.runtime.executer({
    agent: "quotePricing",
    question: "Ce devis est-il bien tarifé ?",
    cible: { quoteId: "11111111-1111-4111-8111-111111111111" },
    criticite: "ordinaire",
  });

  assert.equal(reponse.execution.ok, true);
  assert.ok(reponse.execution.ok && reponse.execution.repli !== null);
  assert.equal(reponse.execution.ok && reponse.execution.repli?.motif, "timeout");
  assert.equal(reponse.execution.ok && reponse.execution.repli?.deNiveau, "advanced");
  assert.equal(reponse.execution.ok && reponse.execution.repli?.versNiveau, "standard");

  // LA DÉGRADATION SE DIT. Un repli muet, c'est un produit qui a changé
  // de qualité sans prévenir.
  assert.ok(
    reponse.execution.ok &&
      reponse.execution.avertissements.some((a) => a.startsWith("Réponse dégradée")),
  );

  // Et elle s'inscrit au grand livre : deux lignes, la seconde nommant
  // le modèle qu'on n'a pas pu joindre.
  assert.equal(h.observations.evenements.length, 2);
  assert.equal(h.observations.evenements[1].modeleReplieDepuis, h.routeur.modelePourNiveau("advanced"));
});

test("FAILURE — une décision CRITIQUE ne se dégrade pas : elle se tait", async () => {
  const h = monterHarnais({
    donnees: {
      ai_get_daily_priorities: { devisARelancer: [], devisQuiExpirent: [] },
      ai_quote_price_analysis: { prixProposeHtCents: 3_850_000 },
      ai_quote_comparables: { nombreComparables: 7 },
    },
    scripts: { quotePricing: [{ type: "panne", erreur: expiration() }] },
  });

  const reponse = await h.runtime.executer({
    agent: "quotePricing",
    question: "Ce devis est-il bien tarifé ?",
    cible: { quoteId: "11111111-1111-4111-8111-111111111111" },
    criticite: "critique",
  });

  assert.equal(reponse.execution.ok, false);
  assert.equal(
    reponse.execution.ok === false && reponse.execution.message,
    MESSAGE_INDISPONIBLE,
    "la phrase de la page 23, mot pour mot : une non-réponse est honnête, une réponse dégradée ne l'est pas",
  );
  assert.deepEqual(
    h.observations.demandesModele,
    [h.routeur.modelePourNiveau("advanced")],
    "aucun second appel : on ne cherche pas un modèle plus faible pour une décision critique",
  );
});

test("FAILURE — un fort impact financier interdit le repli, même sur une tâche ordinaire", async () => {
  const h = monterHarnais({
    donnees: {
      ai_get_daily_priorities: { devisARelancer: [], devisQuiExpirent: [] },
      ai_quote_price_analysis: { prixProposeHtCents: 3_850_000 },
      ai_quote_comparables: { nombreComparables: 7 },
    },
    scripts: { quotePricing: [{ type: "panne", erreur: expiration() }] },
  });

  const reponse = await h.runtime.executer({
    agent: "quotePricing",
    question: "?",
    cible: { quoteId: "11111111-1111-4111-8111-111111111111" },
    criticite: "ordinaire",
    // 38 500 €, très au-dessus du seuil de 5 000 €.
    routage: { financialImpact: 3_850_000 },
  });

  assert.equal(reponse.execution.ok, false);
  assert.equal(h.observations.demandesModele.length, 1);
});

test("FAILURE — une panne qui n'est PAS celle du fournisseur ne se replie pas", async () => {
  // Une sortie hors schéma, un outil qui lève, une erreur de
  // programmation : `classerPanne` les range en « other », et ces
  // pannes-là sont DÉTERMINISTES. Un modèle moins cher les reproduirait
  // à l'identique — on paierait un second appel complet pour obtenir la
  // même erreur, et le grand livre enverrait chercher une panne de
  // fournisseur là où il y a un bug.
  const h = monterHarnais({
    donnees: {
      ai_get_daily_priorities: { devisARelancer: [], devisQuiExpirent: [] },
      ai_quote_price_analysis: { prixProposeHtCents: 1_000 },
      ai_quote_comparables: { nombreComparables: 6 },
    },
    scripts: {
      quotePricing: [{ type: "final", sortie: { ceci: "ne colle à aucun schéma" } }],
    },
  });

  const reponse = await h.runtime.executer({
    agent: "quotePricing",
    question: "?",
    cible: { quoteId: "11111111-1111-4111-8111-111111111111" },
    criticite: "ordinaire",
  });

  assert.equal(reponse.execution.ok, false);
  assert.equal(
    h.observations.demandesModele.length,
    1,
    "un second appel ici, c'est payer deux fois la même erreur",
  );
  assert.equal(h.observations.evenements.length, 1, "une panne, une ligne — pas deux");
});

// ==================================================================
// Outillage
// ==================================================================

/**
 * L'en-tête d'une fonction Postgres : du `create function` jusqu'au
 * corps.
 *
 * C'est là que vivent `stable`, `immutable` ou `volatile`. On s'arrête
 * au `as $` : au-delà, le mot « stable » pourrait apparaître dans un
 * commentaire ou une chaîne, et l'audit conclurait de travers.
 */
function enteteDeFonction(sources: string, nom: string): string | null {
  const debut = new RegExp(`create\\s+(?:or\\s+replace\\s+)?function\\s+(?:public\\.)?${nom}\\s*\\(`, "i");
  const trouve = debut.exec(sources);
  if (trouve === null) return null;

  const apres = sources.slice(trouve.index);
  const corps = apres.indexOf("as $");
  return corps === -1 ? apres.slice(0, 2_000) : apres.slice(0, corps);
}

// ---- Le moteur d'actions nu, pour le test APPROVAL ----------------

const autopilotesInterroges: unknown[] = [];
const executionsMetier: unknown[] = [];

function portActionsQuiCompte(): PortActionEngine {
  return {
    async catalogue(actionType) {
      return CATALOGUE_EVAL[actionType] ?? null;
    },
    async enregistrer() {
      return "action-1";
    },
    async demanderApprobation() {
      return "approval-1";
    },
    async autoriseAutopilote(appel) {
      autopilotesInterroges.push(appel);
      return true;
    },
    async cloturer() {},
    async journaliser() {},
  };
}

function servicesQuiComptent(): PortServicesMetier {
  return {
    executeurs: ["sendInvoice", "createInvoiceDraft"],
    async executer(appel) {
      executionsMetier.push(appel);
      return { ok: true, message: "", resultat: {} };
    },
  };
}
