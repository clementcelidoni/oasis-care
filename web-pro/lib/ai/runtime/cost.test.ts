import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AICostControlService,
  BASE_TARIF_ENVIRONNEMENT,
  BUDGET_SANS_LIMITE,
  RATIO_CIBLE,
  VARIABLES_TARIF,
  construireCleCache,
  debutDuMoisParis,
  decalageParisMs,
  estimerCoutCents,
  lireBudget,
  lireGrilleTarifaire,
  repartirParNiveau,
  sommerCouts,
  verifierPlafonds,
  type BudgetIA,
  type PortCout,
} from "./cost.ts";

/**
 * §11V — LE CONTRÔLE DE COÛT (spec p. 17-19).
 *
 * Trois familles d'invariants :
 *
 *   • un tarif inconnu ne vaut pas zéro, et un total incomplet ne se
 *     présente pas comme complet ;
 *   • un plafond absent ne coupe rien, un plafond atteint coupe AVANT
 *     l'appel, et un plafond que des appels non tarifés rendent
 *     inopérant le dit ;
 *   • le ratio de la page 17 se MESURE.
 */

// ==================================================================
// 1. LA GRILLE — l'inconnu reste inconnu
// ==================================================================

test("sans variable d'environnement, aucun niveau n'est tarifé", () => {
  const grille = lireGrilleTarifaire({});
  assert.deepEqual(grille.tarifs, { economy: null, standard: null, advanced: null });
  assert.equal(grille.base, null, "sans tarif, pas de `cost_basis` : un chiffre sans provenance");
});

test("un tarif se pose par variables d'environnement, par NIVEAU", () => {
  const grille = lireGrilleTarifaire({
    [VARIABLES_TARIF.standard.entree]: "30",
    [VARIABLES_TARIF.standard.sortie]: "120",
  });
  assert.deepEqual(grille.tarifs.standard, {
    entreeCentsParMillion: 30,
    sortieCentsParMillion: 120,
  });
  assert.equal(grille.base, BASE_TARIF_ENVIRONNEMENT);
});

test("un tarif à moitié posé n'est pas un tarif", () => {
  // L'entrée sans la sortie donnerait un coût systématiquement
  // sous-estimé : la sortie est la plus chère chez tous les fournisseurs.
  const grille = lireGrilleTarifaire({ [VARIABLES_TARIF.advanced.entree]: "100" });
  assert.equal(grille.tarifs.advanced, null);
  assert.ok(grille.anomalies.some((a) => /incomplet/i.test(a.raison)));
});

test("une valeur illisible ne devient pas zéro", () => {
  const grille = lireGrilleTarifaire({
    [VARIABLES_TARIF.economy.entree]: "gratuit",
    [VARIABLES_TARIF.economy.sortie]: "5",
  });
  assert.equal(grille.tarifs.economy, null, "un tarif à zéro rendrait l'IA gratuite au tableau de bord");
  assert.ok(grille.anomalies.some((a) => a.variable === VARIABLES_TARIF.economy.entree));
});

test("l'estimation d'un niveau non tarifé est null, jamais 0", () => {
  assert.equal(estimerCoutCents(null, 1_000_000, 1_000_000), null);
});

test("l'estimation arrondit une seule fois, à la fin", () => {
  const tarif = { entreeCentsParMillion: 30, sortieCentsParMillion: 120 };
  // 500 000 × 30 + 100 000 × 120 = 15 000 000 + 12 000 000 = 27 000 000
  // ÷ 1 000 000 = 27 centimes.
  assert.equal(estimerCoutCents(tarif, 500_000, 100_000), 27);
});

test("une somme contenant un inconnu est inconnue", () => {
  assert.equal(sommerCouts([12, 30]), 42);
  assert.equal(
    sommerCouts([12, null, 30]),
    null,
    "additionner en ignorant l'inconnu rendrait un total plus bas que la réalité",
  );
  assert.equal(sommerCouts([]), 0);
});

// ==================================================================
// 2. LES PLAFONDS — avant l'appel, et sans confondre null et zéro
// ==================================================================

function budget(partiel: Partial<BudgetIA>): BudgetIA {
  return { ...BUDGET_SANS_LIMITE, ...partiel };
}

test("aucune limite posée : rien n'est refusé", () => {
  const verdict = verifierPlafonds(BUDGET_SANS_LIMITE, 5_000);
  assert.equal(verdict.autorise, true);
  assert.deepEqual(verdict.avertissements, []);
});

test("un reste NULL ne veut pas dire zéro", () => {
  // `ai_cost_budget_remaining` rend NULL quand aucune limite n'est
  // posée. Le confondre avec zéro couperait l'IA de toutes les
  // entreprises qui n'ont rien configuré.
  const verdict = verifierPlafonds(budget({ limiteJourCents: null, resteJourCents: null }), 100_000);
  assert.equal(verdict.autorise, true);
});

test("un reste à zéro refuse — et le motif est celui de 0076", () => {
  const verdict = verifierPlafonds(
    budget({ limiteJourCents: 100_000, depenseJourCents: 100_000, resteJourCents: 0 }),
    1,
  );
  assert.equal(verdict.autorise, false);
  assert.equal(verdict.motif, "budget_exceeded");
  assert.match(verdict.message ?? "", /journalier/);
});

test("un reste dépassé (négatif) refuse aussi", () => {
  const verdict = verifierPlafonds(
    budget({ limiteMoisCents: 100_000, resteMoisCents: -2_500 }),
    null,
  );
  assert.equal(verdict.autorise, false);
  assert.match(verdict.message ?? "", /mensuel/);
});

test("un appel qui FRANCHIRAIT le plafond est refusé AVANT d'être passé", () => {
  const verdict = verifierPlafonds(budget({ limiteJourCents: 10_000, resteJourCents: 500 }), 900);
  assert.equal(verdict.autorise, false, "constater après coup ne sert à rien");
});

test("le plafond de l'agent joue aussi", () => {
  const verdict = verifierPlafonds(budget({ limiteAgentCents: 5_000, resteAgentCents: 0 }), null);
  assert.equal(verdict.autorise, false);
  assert.match(verdict.message ?? "", /cet agent/);
});

test("un plafond posé avec des appels non tarifés le DIT", () => {
  // C'est l'avertissement le plus important du fichier : sans tarif, la
  // dépense affichée est un minorant et le plafond ne protège de rien.
  const verdict = verifierPlafonds(
    budget({ limiteMoisCents: 100_000, resteMoisCents: 100_000, appelsNonTarifesMois: 412 }),
    null,
  );
  assert.equal(verdict.autorise, true);
  assert.ok(verdict.avertissements.some((a) => /minorant/.test(a)));
  assert.ok(verdict.avertissements.some((a) => /OASIS_AI_TARIF/.test(a)));
});

test("sans plafond posé, les appels non tarifés n'alertent pas", () => {
  const verdict = verifierPlafonds(budget({ appelsNonTarifesMois: 900 }), null);
  assert.deepEqual(verdict.avertissements, []);
});

test("on prévient à 10 % du plafond avant de couper", () => {
  const verdict = verifierPlafonds(budget({ limiteJourCents: 100_000, resteJourCents: 9_000 }), 10);
  assert.equal(verdict.autorise, true);
  assert.ok(verdict.avertissements.some((a) => /10 %/.test(a)));
});

test("la ligne SQL se relit sans jamais transformer un null en zéro", () => {
  const lu = lireBudget({
    daily_limit_cents: null,
    daily_spent_cents: 0,
    daily_remaining_cents: null,
    monthly_limit_cents: "250000",
    monthly_spent_cents: "12345",
    monthly_remaining_cents: "237655",
    agent_limit_cents: null,
    agent_spent_cents: null,
    agent_remaining_cents: null,
    unpriced_events_today: 3,
    unpriced_events_month: 11,
  });
  assert.equal(lu.limiteJourCents, null);
  assert.equal(lu.depenseJourCents, 0);
  assert.equal(lu.limiteMoisCents, 250_000);
  assert.equal(lu.appelsNonTarifesMois, 11);
});

// ==================================================================
// 3. LE RATIO DE LA PAGE 17, MESURÉ
// ==================================================================

const MODELES = { economy: "eco-1", standard: "std-1", advanced: "adv-1" } as const;

test("la répartition se compare à la cible ~15 / 80 / 5", () => {
  const repartition = repartirParNiveau(
    [
      { modele: "eco-1", appels: 15, coutCents: 10 },
      { modele: "std-1", appels: 80, coutCents: 400 },
      { modele: "adv-1", appels: 5, coutCents: 900 },
    ],
    MODELES,
  );
  assert.deepEqual(repartition.parNiveau, RATIO_CIBLE);
  assert.deepEqual(repartition.ecartCible, { economy: 0, standard: 0, advanced: 0 });
  assert.equal(repartition.coutTotalCents, 1_310);
});

test("un écart se voit, signé", () => {
  const repartition = repartirParNiveau(
    [
      { modele: "std-1", appels: 50, coutCents: 0 },
      { modele: "adv-1", appels: 50, coutCents: 0 },
    ],
    MODELES,
  );
  assert.equal(repartition.parNiveau.advanced, 50);
  assert.equal(repartition.ecartCible.advanced, 45, "dix fois la cible : ça doit sauter aux yeux");
});

test("un modèle inconnu n'est pas rangé d'office dans un niveau", () => {
  const repartition = repartirParNiveau(
    [
      { modele: "std-1", appels: 80, coutCents: 100 },
      { modele: "un-ancien-identifiant", appels: 20, coutCents: 50 },
    ],
    MODELES,
  );
  assert.equal(repartition.appelsNiveauInconnu, 20);
  assert.deepEqual(repartition.modelesInconnus, ["un-ancien-identifiant"]);
  assert.equal(repartition.parNiveau.standard, 100, "le dénominateur exclut les non classés");
  assert.equal(repartition.total, 100);
});

test("un coût inconnu rend le total inconnu, pas plus petit", () => {
  const repartition = repartirParNiveau(
    [
      { modele: "std-1", appels: 10, coutCents: 100 },
      { modele: "adv-1", appels: 1, coutCents: null },
    ],
    MODELES,
  );
  assert.equal(repartition.coutTotalCents, null);
});

test("une lecture tronquée se signale", () => {
  const repartition = repartirParNiveau([{ modele: "std-1", appels: 1, coutCents: 1 }], MODELES, false);
  assert.equal(repartition.complet, false);
});

// ==================================================================
// 4. LE MOIS, ALIGNÉ SUR CELUI DE LA BASE
// ==================================================================

test("le mois commence à minuit à PARIS, pas à minuit UTC", () => {
  // En septembre, Paris est à UTC+2 : le mois commence le 31 août à
  // 22:00 UTC. Compter à partir du 1er 00:00 UTC amputerait le ratio
  // de deux heures, et le tableau de bord ne parlerait plus de la même
  // période que le calcul du plafond.
  const debut = debutDuMoisParis(new Date("2026-09-15T12:00:00Z"));
  assert.equal(debut.toISOString(), "2026-08-31T22:00:00.000Z");
});

test("en hiver, Paris est à UTC+1", () => {
  const debut = debutDuMoisParis(new Date("2026-01-15T12:00:00Z"));
  assert.equal(debut.toISOString(), "2025-12-31T23:00:00.000Z");
});

test("le mois d'un instant situé dans l'heure charnière reste le bon", () => {
  // 2026-09-01T00:30Z est déjà le 1er septembre 02:30 à Paris.
  const debut = debutDuMoisParis(new Date("2026-09-01T00:30:00Z"));
  assert.equal(debut.toISOString(), "2026-08-31T22:00:00.000Z");

  // 2026-08-31T23:00Z est le 1er septembre 01:00 à Paris : le mois a
  // déjà changé pour la base, il doit changer ici aussi.
  const bascule = debutDuMoisParis(new Date("2026-08-31T23:00:00Z"));
  assert.equal(bascule.toISOString(), "2026-08-31T22:00:00.000Z");
});

test("le décalage parisien suit l'heure d'été", () => {
  assert.equal(decalageParisMs(new Date("2026-01-15T12:00:00Z")), 3_600_000);
  assert.equal(decalageParisMs(new Date("2026-07-15T12:00:00Z")), 7_200_000);
});

// ==================================================================
// 5. LA CLÉ DE CACHE
// ==================================================================

test("une clé de cache se compose de morceaux non vides", () => {
  assert.equal(construireCleCache(["devis", "abc", "v1"]), "devis:abc:v1");
  assert.throws(() => construireCleCache(["devis", "", "v1"]), /incomplète/);
  assert.throws(() => construireCleCache([]), /vide/);
});

test("la clé ne porte ni l'organisation ni le modèle", () => {
  // Les deux sont des colonnes séparées d'`ai_result_cache` : les
  // remettre dans la clé donnerait deux vérités à tenir d'accord.
  const cle = construireCleCache(["quote-pricing", "analyse", "abc"]);
  assert.ok(!cle.includes("org"));
});

// ==================================================================
// 6. LE SERVICE — l'ordre des gestes
// ==================================================================

function portFaux(surcharges: Partial<PortCout> = {}): PortCout {
  return {
    budget: async () => BUDGET_SANS_LIMITE,
    lireCache: async () => null,
    ecrireCache: async () => {},
    repartition: async () => ({ lignes: [], complet: true }),
    ...surcharges,
  };
}

test("l'estimation avant appel refuse quand elle franchirait le plafond", async () => {
  const service = new AICostControlService(
    portFaux({
      budget: async () => budget({ limiteJourCents: 1_000, resteJourCents: 10 }),
    }),
    {
      grille: {
        tarifs: {
          economy: null,
          standard: { entreeCentsParMillion: 1_000_000, sortieCentsParMillion: 1_000_000 },
          advanced: null,
        },
        base: "grille-test",
        anomalies: [],
      },
    },
  );

  const verdict = await service.autoriserAppel({
    organizationId: "org-a",
    agent: "finance",
    niveau: "standard",
    tailleContexteCaracteres: 400_000,
  });
  assert.equal(verdict.autorise, false);
  assert.equal(verdict.motif, "budget_exceeded");
});

test("un niveau non tarifé n'invente pas de coût prévisionnel", async () => {
  // Grille explicitement vide : ce test ne doit pas dépendre de
  // l'environnement de la machine qui l'exécute.
  const service = new AICostControlService(portFaux(), { grille: lireGrilleTarifaire({}) });
  assert.equal(service.estimerAvantAppel("advanced", 100_000), null);
  assert.equal(service.baseTarifaire(), null);
});
