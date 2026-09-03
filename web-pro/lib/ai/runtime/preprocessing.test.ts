import { test } from "node:test";
import assert from "node:assert/strict";
import { AICostControlService, BUDGET_SANS_LIMITE, type PortCout } from "./cost.ts";
import { OasisAgentRunner, type Executeur, type PortRoutage } from "./run.ts";
import { JournalUsage } from "./usage.ts";
import {
  BUDGET_CARACTERES_LOT,
  ServicePreTraitement,
  contexteDeLot,
  decouper,
  decouperParBudget,
  type ElementAClasser,
} from "./preprocessing.ts";
import { AIModelRouter } from "../model/router.ts";
import type { IdentiteAppel, SortieModele } from "./types.ts";

/**
 * §11V — ÉTAPE 13 : LE PRÉ-TRAITEMENT (spec p. 3, p. 29).
 *
 * Trois façons de se ruiner sur mille éléments, et les trois tests qui
 * les ferment : un appel par élément, un modèle pour ce qu'une règle
 * sait faire, une escalade par élément incertain.
 */

const MODELES = { economy: "eco-1", standard: "std-1", advanced: "adv-1" } as const;

const identite: IdentiteAppel = {
  organizationId: "org-a",
  workspaceId: "ws-a",
  userId: "user-1",
  permissions: ["projects.read"],
};

/**
 * LE VRAI ROUTEUR, avec ses trois identifiants remplacés par des noms
 * de test.
 *
 * ══════════════════════════════════════════════════════════════════
 * POURQUOI PAS UN FAUX ROUTEUR
 * ══════════════════════════════════════════════════════════════════
 *
 * Ce fichier en portait un, et il mentait. Il décidait sur la seule
 * `complexity` et IGNORAIT `contextSize` — sous un commentaire qui
 * affirmait « c'est ce que fait AIModelRouter pour un agent configuré
 * economy ». C'était faux pour tout lot réel : le routeur pose un
 * PLANCHER de niveau au-delà de `SEUIL_CONTEXTE_STANDARD_CARACTERES`,
 * et cent notes d'activité le franchissaient. Le scénario canonique de
 * la spec — mille activités CRM sur Luna — ne tournait donc jamais sur
 * Luna, et aucun test ne pouvait le voir.
 *
 * Les trois identifiants viennent des variables d'environnement du
 * routeur : le test éprouve la vraie logique sans écrire un seul nom de
 * modèle, ce que `router.test.ts` interdit partout ailleurs.
 */
const routeur: PortRoutage = new AIModelRouter({
  env: {
    OASIS_MODEL_ECONOMY: MODELES.economy,
    OASIS_MODEL_STANDARD: MODELES.standard,
    OASIS_MODEL_ADVANCED: MODELES.advanced,
  },
});

function runner(): { runner: OasisAgentRunner; appels: { modele: string; taille: number }[] } {
  const appels: { modele: string; taille: number }[] = [];
  const port: PortCout = {
    budget: async () => BUDGET_SANS_LIMITE,
    lireCache: async () => null,
    ecrireCache: async () => {},
    repartition: async () => ({ lignes: [], complet: true }),
  };
  return {
    runner: new OasisAgentRunner({
      routeur,
      cout: new AICostControlService(port, {
        grille: { tarifs: { economy: null, standard: null, advanced: null }, base: null, anomalies: [] },
      }),
      journal: new JournalUsage(async () => {}, () => {}),
    }),
    appels,
  };
}

function sortieLot(
  classements: { id: string; categorie: string; confiance?: string }[],
): SortieModele {
  return {
    texte: null,
    donnees: { classements },
    confiance: "high",
    ambigu: false,
    jetonsEntree: 100,
    jetonsSortie: 50,
    appelsOutils: 0,
  };
}

function elements(nombre: number, prefixe = "e"): ElementAClasser[] {
  return Array.from({ length: nombre }, (_, i) => ({ id: `${prefixe}${i}`, texte: `texte ${i}` }));
}

// ==================================================================
// 1. LES RÈGLES PASSENT AVANT LE MODÈLE
// ==================================================================

test("un élément qu'une règle sait classer ne part JAMAIS chez le fournisseur", async () => {
  const { runner: r, appels } = runner();
  const service = new ServicePreTraitement(r);
  const vus: string[] = [];

  const resultat = await service.classer({
    identite,
    elements: [
      { id: "a", texte: "RE: devis" },
      { id: "b", texte: "appel du client" },
    ],
    categories: ["email", "appel"],
    regles: [(element) => (element.texte.startsWith("RE:") ? "email" : null)],
    executerLot: (lot): Executeur => async () => {
      for (const element of lot) vus.push(element.id);
      return sortieLot(lot.map((e) => ({ id: e.id, categorie: "appel", confiance: "high" })));
    },
  });

  assert.deepEqual(vus, ["b"], "« a » a été classé par une règle : son texte ne sort pas");
  assert.equal(resultat.parRegle, 1);
  assert.equal(resultat.parModele, 1);
  assert.equal(appels.length, 0);
});

test("une règle qui rend une catégorie hors liste est ignorée", async () => {
  const { runner: r } = runner();
  const service = new ServicePreTraitement(r);

  const resultat = await service.classer({
    identite,
    elements: [{ id: "a", texte: "x" }],
    categories: ["email"],
    regles: [() => "categorie-inventee"],
    executerLot: (lot): Executeur => async () =>
      sortieLot(lot.map((e) => ({ id: e.id, categorie: "email", confiance: "high" }))),
  });

  assert.equal(resultat.parRegle, 0);
  assert.equal(resultat.parModele, 1);
});

// ==================================================================
// 2. LES LOTS — pas un appel par élément
// ==================================================================

test("250 éléments font 3 appels, pas 250", async () => {
  const { runner: r } = runner();
  const service = new ServicePreTraitement(r, { tailleLot: 100 });
  const tailles: number[] = [];

  const resultat = await service.classer({
    identite,
    elements: elements(250),
    categories: ["a"],
    executerLot: (lot): Executeur => async () => {
      tailles.push(lot.length);
      return sortieLot(lot.map((e) => ({ id: e.id, categorie: "a", confiance: "high" })));
    },
  });

  assert.deepEqual(tailles, [100, 100, 50]);
  assert.equal(resultat.appelsModele, 3);
  assert.equal(resultat.classements.length, 250);
});

test("le découpage rend des lots complets et ne perd rien", () => {
  assert.deepEqual(decouper([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(decouper([], 10), []);
  assert.throws(() => decouper([1], 0), /Taille de lot/);
});

// ==================================================================
// 2 bis. LE SCÉNARIO DE LA PAGE 29 TOURNE VRAIMENT SUR LE PETIT MODÈLE
// ==================================================================

/** Une note d'activité CRM réaliste : au-delà de soixante-trois caractères. */
function activitesCrm(nombre: number): ElementAClasser[] {
  return Array.from({ length: nombre }, (_, i) => ({
    id: `act-${i}`,
    texte:
      `Appel de M. Durand le 12/03 au sujet de l'entretien annuel de la haie de charmilles ; ` +
      `rappeler avant vendredi pour confirmer le passage de l'équipe (dossier ${i}).`,
  }));
}

test("p.29 — 1000 activités CRM se classent sur le niveau ÉCONOMIQUE, pas sur le standard", async () => {
  const { runner: r } = runner();
  const service = new ServicePreTraitement(r);
  const niveaux: string[] = [];
  const modeles: string[] = [];

  const resultat = await service.classer({
    identite,
    elements: activitesCrm(1000),
    categories: ["relance", "information"],
    executerLot:
      (lot): Executeur =>
      async (tentative) => {
        niveaux.push(tentative.niveau);
        modeles.push(tentative.modele);
        return sortieLot(lot.map((e) => ({ id: e.id, categorie: "relance", confiance: "high" })));
      },
  });

  assert.equal(resultat.classements.length, 1000);
  assert.ok(niveaux.length > 0, "il faut bien que des appels aient eu lieu");
  assert.deepEqual(
    [...new Set(niveaux)],
    ["economy"],
    "aucun lot ne doit franchir le plancher de taille du routeur",
  );
  assert.deepEqual([...new Set(modeles)], [MODELES.economy]);
  // Bien moins d'un appel par élément : c'est la raison d'être du lot.
  assert.ok(niveaux.length <= 1000 / 10, `${niveaux.length} appels pour mille éléments`);
});

test("un lot reste sous le budget de caractères, et un élément trop gros part seul", () => {
  const petits = activitesCrm(1000);
  for (const lot of decouperParBudget(petits, BUDGET_CARACTERES_LOT, 100)) {
    assert.ok(
      contexteDeLot(identite, lot).tailleCaracteres <= BUDGET_CARACTERES_LOT,
      "un lot au-dessus du budget relèverait le niveau du routeur",
    );
  }

  const enorme: ElementAClasser = { id: "gros", texte: "x".repeat(BUDGET_CARACTERES_LOT + 500) };
  const lots = decouperParBudget([petits[0], enorme, petits[1]], BUDGET_CARACTERES_LOT, 100);
  assert.deepEqual(
    lots.map((l) => l.map((e) => e.id)),
    [["act-0"], ["gros"], ["act-1"]],
    "on ne peut pas rendre petit ce qui est gros : il part seul, et le plancher jouera",
  );
});

// ==================================================================
// 3. LES INCERTAINS REPASSENT EN UN LOT, PAS UN PAR UN
// ==================================================================

test("cent éléments douteux font UN repassage, pas cent escalades", async () => {
  const { runner: r } = runner();
  const service = new ServicePreTraitement(r, { tailleLot: 200 });
  const modelesVus: string[] = [];
  const taillesVues: number[] = [];

  const resultat = await service.classer({
    identite,
    elements: elements(200),
    categories: ["a", "b"],
    executerLot:
      (lot): Executeur =>
      async (tentative) => {
        modelesVus.push(tentative.modele);
        taillesVues.push(lot.length);
        // Premier passage : la moitié est douteuse.
        if (tentative.niveau === "economy") {
          return sortieLot(
            lot.map((e, i) => ({
              id: e.id,
              categorie: "a",
              confiance: i < 100 ? "high" : "low",
            })),
          );
        }
        return sortieLot(lot.map((e) => ({ id: e.id, categorie: "b", confiance: "high" })));
      },
  });

  assert.deepEqual(modelesVus, ["eco-1", "std-1"], "un passage, puis UN repassage");
  assert.deepEqual(taillesVues, [200, 100]);
  assert.equal(resultat.repasses, 100);
  assert.equal(resultat.classements.length, 200);
});

test("ce qui reste douteux après le repassage n'est pas repassé une troisième fois", async () => {
  const { runner: r } = runner();
  const service = new ServicePreTraitement(r);
  let appels = 0;

  const resultat = await service.classer({
    identite,
    elements: elements(3),
    categories: ["a"],
    executerLot: (lot): Executeur => async () => {
      appels += 1;
      return sortieLot(lot.map((e) => ({ id: e.id, categorie: "a", confiance: "low" })));
    },
  });

  assert.equal(appels, 2, "un passage, un repassage, et on s'arrête");
  // Le repassage est retenu tel quel, même en confiance faible : c'est
  // le meilleur avis disponible, et il est rendu avec sa confiance.
  assert.equal(resultat.classements.length, 3);
  assert.ok(resultat.classements.every((c) => c.confiance === "low"));
});

// ==================================================================
// 4. CE QUE LE MODÈLE INVENTE EST JETÉ
// ==================================================================

test("un identifiant que le lot ne contenait pas est rejeté", async () => {
  const { runner: r } = runner();
  const service = new ServicePreTraitement(r);

  const resultat = await service.classer({
    identite,
    elements: [{ id: "a", texte: "x" }],
    categories: ["email"],
    executerLot: (): Executeur => async () =>
      sortieLot([
        { id: "a", categorie: "email", confiance: "high" },
        { id: "fantome", categorie: "email", confiance: "high" },
      ]),
  });

  assert.deepEqual(resultat.classements.map((c) => c.id), ["a"]);
});

test("une catégorie hors liste est rejetée, et l'élément compté comme non classé", async () => {
  const { runner: r } = runner();
  const service = new ServicePreTraitement(r);

  const resultat = await service.classer({
    identite,
    elements: [{ id: "a", texte: "x" }],
    categories: ["email"],
    executerLot: (): Executeur => async () =>
      sortieLot([{ id: "a", categorie: "categorie-inventee", confiance: "high" }]),
  });

  assert.deepEqual(resultat.classements, []);
  assert.equal(resultat.nonClasses, 1);
  assert.ok(resultat.avertissements.some((a) => /pas pu être classés/.test(a)));
});

test("une confiance absente vaut « insuffisante » : le doute descend", async () => {
  const { runner: r } = runner();
  const service = new ServicePreTraitement(r);
  const niveaux: string[] = [];

  await service.classer({
    identite,
    elements: [{ id: "a", texte: "x" }],
    categories: ["email"],
    executerLot:
      (): Executeur =>
      async (tentative) => {
        niveaux.push(tentative.niveau);
        return sortieLot([{ id: "a", categorie: "email" }]);
      },
  });

  assert.deepEqual(niveaux, ["economy", "standard"], "sans confiance déclarée, l'élément repasse");
});

// ==================================================================
// 5. LA PANNE D'UN LOT NE FAIT PAS DISPARAÎTRE SES ÉLÉMENTS
// ==================================================================

test("un lot en échec est signalé, et ses éléments comptés comme non classés", async () => {
  const { runner: r } = runner();
  const service = new ServicePreTraitement(r, { tailleLot: 2 });

  const resultat = await service.classer({
    identite,
    elements: elements(4),
    categories: ["a"],
    executerLot:
      (lot): Executeur =>
      async () => {
        if (lot[0].id === "e0") throw new Error("fetch failed");
        return sortieLot(lot.map((e) => ({ id: e.id, categorie: "a", confiance: "high" })));
      },
  });

  assert.equal(resultat.classements.length, 2);
  assert.equal(resultat.nonClasses, 2);
  assert.ok(resultat.avertissements.some((a) => /non classé/.test(a)));
});

// ==================================================================
// 6. LE CONTEXTE D'UN LOT
// ==================================================================

test("le contexte d'un lot porte l'identité complète et une empreinte", () => {
  const contexte = contexteDeLot(identite, elements(3));
  assert.equal(contexte.agent, "classification");
  assert.equal(contexte.organizationId, "org-a");
  assert.equal(contexte.workspaceId, "ws-a");
  assert.equal(contexte.userId, "user-1");
  assert.equal(contexte.vide, false);
  assert.match(contexte.empreinte, /^[0-9a-f]{64}$/);
});

test("un lot vide produit un contexte vide : le runner ne l'appellera pas", () => {
  assert.equal(contexteDeLot(identite, []).vide, true);
});
