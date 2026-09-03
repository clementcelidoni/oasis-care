import { test } from "node:test";
import assert from "node:assert/strict";
import { AICostControlService, BUDGET_SANS_LIMITE, type BudgetIA, type PortCout } from "./cost.ts";
import { OasisAgentRunner, lireSortieModele, plafondRoutage, type PortRoutage } from "./run.ts";
import { JournalUsage, type EvenementUsage } from "./usage.ts";
import type { AgentContext } from "./context.ts";
import type { ContexteRoutage, DecisionRoutage } from "../model/types.ts";
import { MESSAGE_INDISPONIBLE, type SortieModele } from "./types.ts";

/**
 * §11V — L'ORCHESTRATION : l'ordre des gestes, et le journal complet.
 *
 * Ce fichier éprouve ce qu'aucun service isolé ne peut garantir :
 *
 *   • le déterministe passe avant tout, et ne coûte rien ;
 *   • le cache est servi MÊME au plafond ;
 *   • le plafond refuse AVANT l'appel, et le refus est journalisé ;
 *   • chaque tentative — réussie, ratée, escaladée, repliée — laisse
 *     exactement une ligne au journal ;
 *   • une décision critique ne se dégrade pas.
 *
 * Aucun réseau, aucune base, aucun jeton : tout est injecté.
 */

// ==================================================================
// Le décor
// ==================================================================

const MODELES = { economy: "eco-1", standard: "std-1", advanced: "adv-1" } as const;

/**
 * Un routeur minimal.
 *
 * Il n'utilise PAS `AIModelRouter` : ce test porte sur l'orchestration,
 * pas sur le routage — lequel a ses trente tests dans
 * `lib/ai/model/router.test.ts`. Un faux rend les scénarios lisibles.
 */
function routeur(niveauInitial: "economy" | "standard" | "advanced" = "standard"): PortRoutage {
  return {
    resolve(contexte: ContexteRoutage): DecisionRoutage {
      return {
        agent: null,
        niveau: niveauInitial,
        modele: MODELES[niveauInitial],
        niveauConfigure: niveauInitial,
        plafonne: false,
        niveauDemande: niveauInitial,
        raisons: [`test : ${String(contexte.agent)}`],
      };
    },
    modelePourNiveau: (niveau) => MODELES[niveau],
  };
}

function contexte(partiel: Partial<AgentContext> = {}): AgentContext {
  return {
    agent: "finance",
    organizationId: "org-a",
    workspaceId: "ws-a",
    userId: "user-1",
    permissions: ["invoice.create"],
    donnees: { getCompanyMetrics: { caFactureHtCents: 1_000_000 } },
    sources: [{ outil: "getCompanyMetrics", rpc: "ai_finance_snapshot", ok: true, motif: null }],
    permissionsManquantes: [],
    vide: false,
    dateArreteDonnees: "2026-09-03T08:00:00.000Z",
    empreinte: "empreinte-1",
    tailleCaracteres: 400,
    ...partiel,
  };
}

function sortie(partiel: Partial<SortieModele> = {}): SortieModele {
  return {
    texte: "réponse",
    donnees: null,
    confiance: "high",
    ambigu: false,
    jetonsEntree: 1_000,
    jetonsSortie: 500,
    appelsOutils: 1,
    ...partiel,
  };
}

type Decor = {
  runner: OasisAgentRunner;
  evenements: EvenementUsage[];
  cacheEcrit: unknown[];
  appelsBudget: number;
};

function decor(
  options: {
    budget?: BudgetIA;
    enCache?: unknown;
    niveauInitial?: "economy" | "standard" | "advanced";
    tarifs?: boolean;
    journalCasse?: boolean;
  } = {},
): Decor {
  const evenements: EvenementUsage[] = [];
  const cacheEcrit: unknown[] = [];
  let appelsBudget = 0;

  const port: PortCout = {
    budget: async () => {
      appelsBudget += 1;
      return options.budget ?? BUDGET_SANS_LIMITE;
    },
    lireCache: async () => options.enCache ?? null,
    ecrireCache: async (appel) => {
      cacheEcrit.push(appel);
    },
    repartition: async () => ({ lignes: [], complet: true }),
  };

  const grille = options.tarifs
    ? {
        tarifs: {
          economy: { entreeCentsParMillion: 10, sortieCentsParMillion: 40 },
          standard: { entreeCentsParMillion: 30, sortieCentsParMillion: 120 },
          advanced: { entreeCentsParMillion: 300, sortieCentsParMillion: 1_200 },
        },
        base: "grille-test",
        anomalies: [],
      }
    : { tarifs: { economy: null, standard: null, advanced: null }, base: null, anomalies: [] };

  const journal = new JournalUsage(async (evenement) => {
    if (options.journalCasse) throw new Error("table absente");
    evenements.push(evenement);
  }, () => {});

  const runner = new OasisAgentRunner({
    routeur: routeur(options.niveauInitial),
    cout: new AICostControlService(port, { grille }),
    journal,
  });

  return {
    runner,
    evenements,
    cacheEcrit,
    get appelsBudget() {
      return appelsBudget;
    },
  };
}

// ==================================================================
// 1. LES DROITS, PUIS LE DÉTERMINISTE
// ==================================================================

test("un contexte vide faute de droits n'appelle aucun modèle", async () => {
  const d = decor();
  let appele = false;

  const resultat = await d.runner.executer({
    contexte: contexte({ vide: true, permissionsManquantes: ["invoice.create"] }),
    criticite: "ordinaire",
    executer: async () => {
      appele = true;
      return sortie();
    },
  });

  assert.equal(appele, false, "payer un raisonnement sur rien produit une réponse creuse");
  assert.equal(resultat.ok, false);
  if (resultat.ok) return;
  assert.equal(resultat.motif, "droits_manquants");
  assert.match(resultat.message, /invoice\.create/);
  assert.deepEqual(d.evenements, [], "aucun jeton brûlé, donc rien au grand livre");
});

test("une analyse partielle prévient, mais s'exécute", async () => {
  const d = decor();
  const resultat = await d.runner.executer({
    contexte: contexte({ permissionsManquantes: ["quotes.read"] }),
    criticite: "ordinaire",
    executer: async () => sortie(),
  });
  assert.equal(resultat.ok, true);
  if (!resultat.ok) return;
  assert.ok(resultat.avertissements.some((a) => /quotes\.read/.test(a)));
});

test("le déterministe passe AVANT le modèle et ne coûte rien (p. 11-12)", async () => {
  const d = decor();
  let appele = false;

  const resultat = await d.runner.executer({
    contexte: contexte(),
    criticite: "ordinaire",
    reponseDeterministe: sortie({ texte: "38 450 € à facturer" }),
    executer: async () => {
      appele = true;
      return sortie();
    },
  });

  assert.equal(appele, false);
  assert.equal(resultat.ok, true);
  if (!resultat.ok) return;
  assert.equal(resultat.origine, "deterministe");
  assert.equal(resultat.coutEstimeCents, 0);
  assert.deepEqual(d.evenements, []);
});

// ==================================================================
// 2. LE CACHE — servi même au plafond
// ==================================================================

test("une entrée de cache est servie sans appeler le modèle", async () => {
  const d = decor({ enCache: sortie({ texte: "déjà calculé" }) });
  let appele = false;

  const resultat = await d.runner.executer({
    contexte: contexte(),
    criticite: "ordinaire",
    cache: { cle: "finance:photo:2026-09" },
    executer: async () => {
      appele = true;
      return sortie();
    },
  });

  assert.equal(appele, false);
  assert.equal(resultat.ok, true);
  if (!resultat.ok) return;
  assert.equal(resultat.origine, "cache");
  assert.equal(resultat.sortie.texte, "déjà calculé");
  assert.equal(resultat.coutEstimeCents, 0);
});

test("le cache est servi MÊME quand le plafond est atteint", async () => {
  // Couper le cache en même temps que les appels transformerait un
  // plafond de dépense en panne totale.
  const d = decor({
    enCache: sortie({ texte: "déjà calculé" }),
    budget: { ...BUDGET_SANS_LIMITE, limiteJourCents: 1_000, resteJourCents: 0 },
  });

  const resultat = await d.runner.executer({
    contexte: contexte(),
    criticite: "ordinaire",
    cache: { cle: "finance:photo" },
    executer: async () => sortie(),
  });

  assert.equal(resultat.ok, true);
  if (!resultat.ok) return;
  assert.equal(resultat.origine, "cache");
  assert.equal(d.appelsBudget, 0, "le budget n'a même pas eu besoin d'être consulté");
});

test("une entrée de cache mal formée est un défaut de cache, pas une réponse à moitié vraie", async () => {
  const d = decor({ enCache: { texte: "sans confiance" } });
  let appele = false;
  const resultat = await d.runner.executer({
    contexte: contexte(),
    criticite: "ordinaire",
    cache: { cle: "x" },
    executer: async () => {
      appele = true;
      return sortie();
    },
  });
  assert.equal(appele, true);
  assert.equal(resultat.ok, true);
  if (!resultat.ok) return;
  assert.equal(resultat.origine, "modele");
});

test("une réponse obtenue du modèle est mise en cache avec son empreinte", async () => {
  const d = decor();
  await d.runner.executer({
    contexte: contexte(),
    criticite: "ordinaire",
    cache: { cle: "finance:photo", ttlSecondes: 120 },
    executer: async () => sortie(),
  });

  assert.equal(d.cacheEcrit.length, 1);
  const ecrit = d.cacheEcrit[0] as Record<string, unknown>;
  assert.equal(ecrit.empreinte, "empreinte-1");
  assert.equal(ecrit.ttlSecondes, 120);
  assert.deepEqual(ecrit.sources, ["getCompanyMetrics"]);
});

test("sans clé de cache, rien n'est mis en cache", async () => {
  const d = decor();
  await d.runner.executer({
    contexte: contexte(),
    criticite: "ordinaire",
    executer: async () => sortie(),
  });
  assert.deepEqual(d.cacheEcrit, []);
});

// ==================================================================
// 3. LE PLAFOND — avant l'appel, et journalisé
// ==================================================================

test("un plafond atteint refuse AVANT l'appel", async () => {
  const d = decor({ budget: { ...BUDGET_SANS_LIMITE, limiteJourCents: 1_000, resteJourCents: 0 } });
  let appele = false;

  const resultat = await d.runner.executer({
    contexte: contexte(),
    criticite: "ordinaire",
    executer: async () => {
      appele = true;
      return sortie();
    },
  });

  assert.equal(appele, false, "constater après coup ne sert à rien");
  assert.equal(resultat.ok, false);
  if (resultat.ok) return;
  assert.equal(resultat.motif, "budget_exceeded");
});

test("le refus pour plafond est INSCRIT au journal", async () => {
  // Sans cette ligne, un plafond qui coupe tout un après-midi
  // n'apparaîtrait nulle part : le tableau de bord dirait « aucune
  // activité IA », ce qui est exactement le contraire de la vérité.
  const d = decor({ budget: { ...BUDGET_SANS_LIMITE, limiteMoisCents: 100, resteMoisCents: 0 } });

  await d.runner.executer({
    contexte: contexte(),
    criticite: "ordinaire",
    executer: async () => sortie(),
  });

  assert.equal(d.evenements.length, 1);
  assert.equal(d.evenements[0].succes, false);
  assert.equal(d.evenements[0].motifPanne, "budget_exceeded");
  assert.equal(d.evenements[0].jetonsEntree, 0);
  assert.equal(d.evenements[0].coutEstimeCents, null);
});

// ==================================================================
// 4. LE JOURNAL — une ligne par tentative, toujours
// ==================================================================

test("un appel réussi laisse exactement une ligne, avec ses jetons et sa base tarifaire", async () => {
  const d = decor({ tarifs: true });
  await d.runner.executer({
    contexte: contexte(),
    criticite: "ordinaire",
    decisionId: "decision-1",
    executer: async () => sortie({ jetonsEntree: 1_000_000, jetonsSortie: 100_000 }),
  });

  assert.equal(d.evenements.length, 1);
  const evenement = d.evenements[0];
  assert.equal(evenement.modele, "std-1");
  assert.equal(evenement.succes, true);
  assert.equal(evenement.decisionId, "decision-1");
  assert.equal(evenement.baseTarif, "grille-test");
  // 1 000 000 × 30 + 100 000 × 120 = 42 000 000 ÷ 1e6 = 42 centimes.
  assert.equal(evenement.coutEstimeCents, 42);
});

test("un niveau non tarifé produit un événement SANS montant, jamais à zéro", async () => {
  const d = decor({ tarifs: false });
  const resultat = await d.runner.executer({
    contexte: contexte(),
    criticite: "ordinaire",
    executer: async () => sortie(),
  });

  assert.equal(d.evenements[0].coutEstimeCents, null);
  assert.equal(d.evenements[0].baseTarif, null);
  assert.equal(resultat.ok, true);
  if (!resultat.ok) return;
  assert.equal(resultat.coutEstimeCents, null, "un coût inconnu ne se totalise pas à zéro");
});

test("un appel en ERREUR est journalisé avant même qu'on décide du repli", async () => {
  const d = decor({ niveauInitial: "economy" });
  const resultat = await d.runner.executer({
    contexte: contexte(),
    criticite: "ordinaire",
    executer: async () => {
      throw Object.assign(new Error("nope"), { status: 429 });
    },
  });

  assert.equal(d.evenements.length, 1);
  assert.equal(d.evenements[0].succes, false);
  assert.equal(d.evenements[0].motifPanne, "rate_limit");
  assert.equal(resultat.ok, false);
});

test("un journal en panne ne perd pas la réponse, mais le dit", async () => {
  const d = decor({ journalCasse: true });
  const resultat = await d.runner.executer({
    contexte: contexte(),
    criticite: "ordinaire",
    executer: async () => sortie(),
  });

  assert.equal(resultat.ok, true, "les jetons sont déjà payés : perdre la réponse perdrait les deux");
  if (!resultat.ok) return;
  assert.ok(
    resultat.avertissements.some((a) => /journal des coûts/.test(a)),
    "un trou dans le journal doit se voir quelque part",
  );
});

// ==================================================================
// 5. L'ESCALADE, DANS LE VRAI CHEMIN
// ==================================================================

test("economy + confiance faible escalade, et laisse DEUX lignes au journal", async () => {
  const d = decor({ niveauInitial: "economy", tarifs: true });
  const modelesVus: string[] = [];

  const resultat = await d.runner.executer({
    contexte: contexte(),
    criticite: "ordinaire",
    executer: async (tentative) => {
      modelesVus.push(tentative.modele);
      return modelesVus.length === 1 ? sortie({ confiance: "low" }) : sortie({ confiance: "high" });
    },
  });

  assert.deepEqual(modelesVus, ["eco-1", "std-1"]);
  assert.equal(d.evenements.length, 2, "chaque tentative coûte, donc chaque tentative se journalise");
  assert.equal(resultat.ok, true);
  if (!resultat.ok) return;
  assert.equal(resultat.escalades.length, 1);
  assert.equal(resultat.escalades[0].declencheur, "confiance_insuffisante");
  assert.equal(resultat.tentative?.niveau, "standard");
});

test("l'escalade revérifie le plafond : elle coûte plus cher", async () => {
  const d = decor({ niveauInitial: "economy" });
  await d.runner.executer({
    contexte: contexte(),
    criticite: "ordinaire",
    executer: async (tentative) =>
      tentative.niveau === "economy" ? sortie({ confiance: "low" }) : sortie(),
  });
  assert.equal(d.appelsBudget, 2);
});

test("standard + confiance faible n'escalade pas : un seul appel", async () => {
  const d = decor({ niveauInitial: "standard" });
  let appels = 0;
  await d.runner.executer({
    contexte: contexte(),
    criticite: "ordinaire",
    executer: async () => {
      appels += 1;
      return sortie({ confiance: "low" });
    },
  });
  assert.equal(appels, 1, "sinon la moitié des demandes ordinaires partiraient sur le grand modèle");
});

// ==================================================================
// 6. LE REPLI, DANS LE VRAI CHEMIN
// ==================================================================

test("advanced en panne se replie sur standard pour une tâche ordinaire, ET LE DIT", async () => {
  const d = decor({ niveauInitial: "advanced" });
  const modelesVus: string[] = [];

  const resultat = await d.runner.executer({
    contexte: contexte(),
    criticite: "ordinaire",
    executer: async (tentative) => {
      modelesVus.push(tentative.modele);
      if (tentative.niveau === "advanced") {
        throw Object.assign(new Error("indisponible"), { status: 404 });
      }
      return sortie();
    },
  });

  assert.deepEqual(modelesVus, ["adv-1", "std-1"]);
  assert.equal(resultat.ok, true);
  if (!resultat.ok) return;
  assert.notEqual(resultat.repli, null, "le champ existe toujours : on ne peut pas l'oublier");
  assert.equal(resultat.repli?.deNiveau, "advanced");
  assert.equal(resultat.repli?.versModele, "std-1");
  assert.ok(resultat.avertissements.some((a) => /dégradée/i.test(a)));

  // Deux lignes : l'échec, puis le succès marqué comme repli.
  assert.equal(d.evenements.length, 2);
  assert.equal(d.evenements[1].modeleReplieDepuis, "adv-1");
});

test("une décision CRITIQUE ne se dégrade pas : « Service temporairement indisponible »", async () => {
  const d = decor({ niveauInitial: "advanced" });
  const modelesVus: string[] = [];

  const resultat = await d.runner.executer({
    contexte: contexte(),
    criticite: "critique",
    executer: async (tentative) => {
      modelesVus.push(tentative.modele);
      throw Object.assign(new Error("indisponible"), { status: 503 });
    },
  });

  assert.deepEqual(modelesVus, ["adv-1"], "aucune seconde tentative");
  assert.equal(resultat.ok, false);
  if (resultat.ok) return;
  assert.equal(resultat.message, MESSAGE_INDISPONIBLE);
  assert.equal(resultat.motif, "provider_error");
});

test("une réponse obtenue après repli n'escalade pas", async () => {
  // Remonter rappellerait le modèle qui vient d'échouer.
  const d = decor({ niveauInitial: "standard" });
  const modelesVus: string[] = [];

  const resultat = await d.runner.executer({
    contexte: contexte(),
    criticite: "ordinaire",
    executer: async (tentative) => {
      modelesVus.push(tentative.modele);
      if (tentative.niveau === "standard") throw new Error("fetch failed");
      return sortie({ confiance: "low", ambigu: true });
    },
  });

  assert.deepEqual(modelesVus, ["std-1", "eco-1"]);
  assert.equal(resultat.ok, true);
  if (!resultat.ok) return;
  assert.deepEqual(resultat.escalades, []);
});

test("un repli ne revérifie pas le plafond : il coûte moins cher", async () => {
  const d = decor({ niveauInitial: "advanced" });
  await d.runner.executer({
    contexte: contexte(),
    criticite: "ordinaire",
    executer: async (tentative) => {
      if (tentative.niveau === "advanced") throw new Error("fetch failed");
      return sortie();
    },
  });
  assert.equal(d.appelsBudget, 1);
});

// ==================================================================
// 7. LES AIDES
// ==================================================================

test("le plafond de routage recopie la troisième étape du routeur", () => {
  assert.equal(plafondRoutage({}), "advanced");
  assert.equal(plafondRoutage({ budget: "tendu" }), "standard");
  assert.equal(plafondRoutage({ budget: "epuise" }), "economy");
  assert.equal(plafondRoutage({ userPlan: "standard" }), "standard");
  assert.equal(plafondRoutage({ userPlan: "advanced", budget: "epuise" }), "economy");
});

test("une sortie relue du cache sans confiance vaut « données insuffisantes », pas « élevée »", () => {
  const relue = lireSortieModele({ confiance: "n'importe quoi", texte: "x" });
  assert.equal(relue?.confiance, "insufficient_data");
  assert.equal(lireSortieModele(null), null);
  assert.equal(lireSortieModele({ texte: "x" }), null);
});
