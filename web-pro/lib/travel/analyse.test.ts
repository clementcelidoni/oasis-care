import { test } from "node:test";
import assert from "node:assert/strict";
import { calculerCoutDeplacement } from "./cost.ts";
import {
  construireRecommandations,
  construireRisques,
  lireAnalysePrix,
  type AnalysePrix,
} from "./analyse.ts";
import { connu, inconnu, type PointGeographique, type ResultatTravelCost } from "./types.ts";

/**
 * Les règles du panneau d'analyse.
 *
 * Elles sont DÉTERMINISTES, donc testables, et c'est tout l'intérêt :
 * les phrases qu'un chef d'entreprise lira avant de fixer un prix ne
 * doivent pas dépendre de l'humeur d'un modèle de langage.
 *
 * Deux interdits de la spec sont vérifiés ici plutôt que promis :
 * « ne pas dire automatiquement : vous êtes trop cher » (p. 14), et
 * « une donnée absente se dit insufficientData, jamais zéro » (p. 2).
 */

const POINT: PointGeographique = {
  libelle: "06800 Cagnes-sur-Mer",
  commune: "Cagnes-sur-Mer",
  codePostal: "06800",
  coordonnees: { latitude: 43.675413, longitude: 7.150354 },
  origine: "centreCommune",
};

function deplacement(over: {
  effectif?: number | null;
  jours?: number | null;
  minutes?: number | null;
  devisees?: number | null;
} = {}): ResultatTravelCost {
  return calculerCoutDeplacement({
    siege: POINT,
    chantier: { ...POINT, libelle: "06400 Cannes", commune: "Cannes", codePostal: "06400",
      coordonnees: { latitude: 43.555468, longitude: 7.004585 } },
    hypotheses: {
      effectif: over.effectif ?? null,
      joursChantier: over.jours ?? null,
      nombreDeVehicules: 1,
      tempsAllerMinutesFourni: over.minutes ?? null,
      tauxHoraireCents: inconnu("aucunTaux", "Aucun coût horaire."),
      coutVehiculeParKmCents: inconnu("aucunBareme", "Aucun barème."),
      peagesAllerRetourCents: inconnu("aucunPeage", "Aucun péage."),
      heuresDeplacementDevisees:
        over.devisees === undefined || over.devisees === null
          ? inconnu("aucuneLigne", "Pas de ligne de transport.")
          : connu(over.devisees, "devis"),
    },
  });
}

function analyse(over: Partial<AnalysePrix> = {}): AnalysePrix {
  return {
    prixProposeHtCents: 1_140_000,
    coutEstimeCents: 890_000,
    margeCents: 250_000,
    tauxMarquePct: 21.9,
    margeCiblePct: 35,
    ecartALaCiblePoints: -13.1,
    manqueAGagnerCents: 149_340,
    lignesTotal: 14,
    lignesSansCoutSaisi: 0,
    coutPartiel: false,
    verdictMarge: "insuffisant",
    verdictComparables: "dansLaFourchette",
    verdict: "insuffisant",
    confiance: "high",
    comparables: {
      nombreComparables: 12,
      seuilComparables: 5,
      confiance: "high",
      motifInsuffisance: null,
      explicationInsuffisance: null,
      heuresMainDoeuvreDevisees: 120,
      familleDominante: "labor",
      bandeHeuresPct: 40,
      ancienneteMaximaleMois: 36,
      fourchette: {
        minHtCents: 1_250_000,
        q1HtCents: 1_300_000,
        medianeHtCents: 1_400_000,
        q3HtCents: 1_480_000,
        maxHtCents: 1_520_000,
        tauxMarqueReelMedianPct: 30,
        comparablesAvecCoutsReels: 8,
      },
      echantillon: [],
    },
    explicationHypotheses: [],
    explicationComparaison: null,
    explicationConclusion: null,
    ...over,
  };
}

// ============================================================
// L'exemple chiffré de la spec, jusqu'à la recommandation
// ============================================================

test("prix 11 400 €, coût 8 900 €, marge 21,9 % contre 35 % : on recommande de remonter le prix", () => {
  const recommandations = construireRecommandations(analyse(), deplacement());
  assert.equal(recommandations[0].cle, "remonterLePrix");
  assert.ok(recommandations[0].pourquoi.some((p) => p.includes("21,9 %")));
  assert.ok(recommandations[0].pourquoi.some((p) => p.includes("35 %")));
});

// ============================================================
// Le coût passe avant tout le reste
// ============================================================

test("sans coût saisi, la première recommandation est de saisir les coûts", () => {
  const sansCout = analyse({
    coutEstimeCents: null,
    margeCents: null,
    tauxMarquePct: null,
    verdictMarge: "insufficientData",
    verdict: "insufficientData",
    confiance: "insufficient_data",
  });

  const risques = construireRisques(sansCout, deplacement());
  const recommandations = construireRecommandations(sansCout, deplacement());

  assert.equal(risques[0].cle, "coutAbsent");
  assert.equal(risques[0].niveau, "eleve");
  assert.equal(recommandations[0].cle, "saisirLesCouts");
});

test("un devis chiffré à moitié le dit, et l'annonce comme optimiste", () => {
  const partiel = analyse({ coutPartiel: true, lignesSansCoutSaisi: 13, lignesTotal: 14 });
  const risques = construireRisques(partiel, deplacement());
  const coutPartiel = risques.find((r) => r.cle === "coutPartiel");
  assert.ok(coutPartiel, "le risque de coût partiel devrait être levé");
  assert.equal(coutPartiel.niveau, "eleve");
  assert.match(coutPartiel.explication, /optimiste/);
});

// ============================================================
// L'interdit de la page 14
// ============================================================

test("au-dessus des comparables, on demande de vérifier — jamais « vous êtes trop cher »", () => {
  const auDessus = analyse({
    verdictMarge: "conforme",
    verdictComparables: "auDessus",
    verdict: "auDessusDesComparables",
  });

  const recommandations = construireRecommandations(auDessus, deplacement());
  const cible = recommandations.find((r) => r.cle === "verifierLEcartAuxComparables");
  assert.ok(cible, "la recommandation de vérification devrait exister");

  for (const mot of ["prestation", "complexité", "accès", "finition"]) {
    assert.ok(
      cible.pourquoi.some((p) => p.toLowerCase().includes(mot)),
      `le « pourquoi » devrait citer ${mot}`,
    );
  }

  const tout = [...recommandations, ...construireRisques(auDessus, deplacement())]
    .flatMap((x) => ("pourquoi" in x ? [x.titre, ...x.pourquoi] : [x.titre, x.explication]))
    .join(" ")
    .toLowerCase();
  assert.ok(!tout.includes("trop cher"), "la spec interdit ce verdict automatique");
});

test("sans assez de comparables, aucune fourchette n'est promise", () => {
  const sansComparables = analyse({
    verdictMarge: "conforme",
    verdictComparables: "insufficientData",
    verdict: "correct",
    comparables: {
      ...analyse().comparables,
      nombreComparables: 2,
      motifInsuffisance: "tropPeuDeComparables",
      explicationInsuffisance: "Moins de 5 chantiers comparables terminés.",
      fourchette: null,
      echantillon: [],
    },
  });

  const risques = construireRisques(sansComparables, deplacement());
  const risque = risques.find((r) => r.cle === "comparablesInsuffisants");
  assert.ok(risque);
  assert.equal(risque.confiance, "insufficient_data");
});

// ============================================================
// Le déplacement se mêle des recommandations
// ============================================================

test("le sous-chiffrage du déplacement produit sa propre recommandation, en heures", () => {
  const d = deplacement({ effectif: 4, jours: 5, minutes: 46, devisees: 10 });
  const recommandations = construireRecommandations(
    analyse({ verdictMarge: "conforme", verdict: "correct" }),
    d,
  );
  const cible = recommandations.find((r) => r.cle === "chiffrerLeDeplacement");
  assert.ok(cible);
  assert.match(cible.titre, /20 h 40/);
});

test("sans analyse SQL, le panneau reste utile grâce au déplacement", () => {
  const d = deplacement({ effectif: 4, jours: 5, minutes: 46, devisees: 10 });
  const risques = construireRisques(null, d);
  assert.equal(risques[0].cle, "analyseIndisponible");
  assert.ok(risques.some((r) => r.cle === "deplacementSousChiffre"));

  const recommandations = construireRecommandations(null, d);
  assert.equal(recommandations[0].cle, "chiffrerLeDeplacement");
});

// ============================================================
// Le silence n'est pas une validation
// ============================================================

test("sans donnée exploitable, on le dit au lieu de féliciter", () => {
  const recommandations = construireRecommandations(null, deplacement());
  assert.equal(recommandations.length, 1);
  assert.equal(recommandations[0].cle, "rienASignaler");
  assert.equal(recommandations[0].confiance, "insufficient_data");
  assert.match(recommandations[0].pourquoi.join(" "), /ne vaut pas validation/);
});

test("un devis sain est déclaré sain, avec ses raisons", () => {
  const sain = analyse({
    verdictMarge: "conforme",
    verdictComparables: "dansLaFourchette",
    verdict: "correct",
    manqueAGagnerCents: null,
    ecartALaCiblePoints: 3,
  });
  const d = deplacement({ effectif: 4, jours: 5, minutes: 46, devisees: 29 });
  const recommandations = construireRecommandations(sain, d);
  assert.equal(recommandations.length, 1);
  assert.equal(recommandations[0].cle, "rienASignaler");
  assert.equal(recommandations[0].confiance, "medium");
});

test("aucune recommandation n'est muette : titre, pourquoi et source", () => {
  const cas = [
    construireRecommandations(analyse(), deplacement()),
    construireRecommandations(null, deplacement({ effectif: 4, jours: 5, minutes: 46, devisees: 0 })),
    construireRecommandations(analyse({ coutEstimeCents: null }), deplacement()),
  ];
  for (const recommandations of cas) {
    for (const r of recommandations) {
      assert.ok(r.titre.length > 0);
      assert.ok(r.pourquoi.length > 0, `« ${r.titre} » n'explique rien`);
      assert.ok(r.source.length > 0);
    }
  }
});

// ============================================================
// La lecture du jsonb rendu par la fonction SQL
// ============================================================

test("un numeric rendu en chaîne est lu comme un nombre", () => {
  const lu = lireAnalysePrix({ prixProposeHtCents: "1140000", tauxMarquePct: "21.90" });
  assert.equal(lu?.prixProposeHtCents, 1_140_000);
  assert.equal(lu?.tauxMarquePct, 21.9);
});

test("un champ absent reste null, il ne devient pas zéro", () => {
  const lu = lireAnalysePrix({ devisId: "x" });
  assert.equal(lu?.coutEstimeCents, null);
  assert.equal(lu?.margeCents, null);
  assert.equal(lu?.tauxMarquePct, null);
  assert.equal(lu?.margeCiblePct, null);
  assert.equal(lu?.confiance, "insufficient_data");
  assert.equal(lu?.comparables.fourchette, null);
});

test("une valeur illisible ne devient pas un nombre", () => {
  const lu = lireAnalysePrix({ prixProposeHtCents: "onze mille", tauxMarquePct: {} });
  assert.equal(lu?.prixProposeHtCents, null);
  assert.equal(lu?.tauxMarquePct, null);
});

test("un NaN ou un infini reste inconnu : c'est l'accident le plus facile à afficher en euros", () => {
  const lu = lireAnalysePrix({
    prixProposeHtCents: Number.NaN,
    coutEstimeCents: Number.POSITIVE_INFINITY,
  });
  assert.equal(lu?.prixProposeHtCents, null);
  assert.equal(lu?.coutEstimeCents, null);
});

test("un retour qui n'est pas un objet ne produit pas une analyse vide crédible", () => {
  assert.equal(lireAnalysePrix(null), null);
  assert.equal(lireAnalysePrix("erreur"), null);
});
