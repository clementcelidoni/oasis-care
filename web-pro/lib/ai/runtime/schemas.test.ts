import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AnalyseAgentSchema,
  CATEGORIES_DECISION,
  DECISIONS_EXECUTIVE_MAX,
  DecisionRecommendationSchema,
  LONGUEUR_TITRE_MAX,
  PropositionActionSchema,
  RAISONS_MAX,
  RECOMMANDATIONS_MAX,
  SortieExecutiveSchema,
  bornerPriorite,
  normaliserAnalyse,
  normaliserBrief,
  normaliserProposition,
  normaliserRecommandation,
  relireAnalyse,
  relireBrief,
  type DecisionRecommendation,
} from "./schemas.ts";

/**
 * §11V — LES SORTIES STRUCTURÉES, ÉPROUVÉES (spec p. 13).
 *
 * ══════════════════════════════════════════════════════════════════
 * CE QU'ON VÉRIFIE, ET CE QU'ON NE PEUT PAS VÉRIFIER ICI
 * ══════════════════════════════════════════════════════════════════
 *
 * On ne peut pas vérifier qu'un modèle respecte le schéma : c'est le
 * mode strict des sorties structurées d'OpenAI qui s'en charge, et il
 * n'est pas éprouvable sans réseau. Ce qui EST éprouvable, et qui
 * compte autant, c'est ce que fait la NORMALISATION quand le modèle
 * rend quelque chose de valide-mais-faux :
 *
 *   • une priorité à 140, que la base refuserait ;
 *   • quinze recommandations là où l'écran en montre cinq ;
 *   • et surtout : « données insuffisantes » ACCOMPAGNÉ d'un montant,
 *     que 0072 refuse par CONTRAINTE et qui ferait échouer l'insertion
 *     après l'appel — c'est-à-dire après avoir payé.
 *
 * Le dernier cas est celui qui mérite ce fichier à lui seul. Il a deux
 * réparations possibles et une seule honnête : jeter le MONTANT (dire
 * « je ne sais pas chiffrer ») plutôt que relever la CONFIANCE (faire
 * passer une estimation inventée pour une conclusion). Un test l'exige
 * dans les deux sens.
 */

function recommandation(surcharge: Partial<DecisionRecommendation> = {}): DecisionRecommendation {
  return {
    title: "Facturer les dix chantiers terminés",
    summary: "Dix chantiers sont terminés et n'ont pas de facture.",
    priority: 80,
    category: "urgent",
    confidence: "high",
    estimatedImpact: "10 chantiers, 38 450 € HT à facturer",
    estimatedImpactCents: 3_845_000,
    reasons: ["Dix dossiers marqués terminés", "Aucune facture rattachée"],
    suggestedActionType: "createInvoiceDraft",
    suggestedActionLabel: "Préparer les brouillons",
    ...surcharge,
  };
}

// ==================================================================
// 1. LE CAS QUI COMPTE : données insuffisantes ET montant
// ==================================================================

test("« insufficient_data » avec un montant perd le MONTANT, jamais la confiance", () => {
  const { valeur, corrections } = normaliserRecommandation(
    recommandation({ confidence: "insufficient_data", estimatedImpactCents: 3_845_000 }),
  );

  assert.equal(
    valeur.estimatedImpactCents,
    null,
    "0072 refuse par contrainte une conclusion sans données qui porte un montant",
  );
  assert.equal(
    valeur.confidence,
    "insufficient_data",
    "relever la confiance pour faire passer la ligne serait exactement la fabrication interdite",
  );
  assert.equal(corrections.length, 1, "la correction remonte en avertissement, elle ne se fait pas en silence");
  assert.ok(corrections[0].includes("montant a été retiré"));
});

test("une confiance faible, elle, garde son montant : « peu de données » n'est pas « pas de données »", () => {
  const { valeur, corrections } = normaliserRecommandation(
    recommandation({ confidence: "low", estimatedImpactCents: 3_845_000 }),
  );

  assert.equal(valeur.estimatedImpactCents, 3_845_000);
  assert.deepEqual(corrections, []);
});

test("un montant absent reste absent, il ne devient pas zéro", () => {
  const { valeur } = normaliserRecommandation(recommandation({ estimatedImpactCents: null }));
  assert.equal(valeur.estimatedImpactCents, null);
});

test("une confiance inconnue tombe sur « insufficient_data » — le doute descend", () => {
  const { valeur } = normaliserRecommandation(
    recommandation({ confidence: "assez sûr" as unknown as DecisionRecommendation["confidence"] }),
  );
  assert.equal(valeur.confidence, "insufficient_data");
  assert.equal(valeur.estimatedImpactCents, null, "et le montant tombe avec elle");
});

// ==================================================================
// 2. La priorité, ramenée dans l'échelle de la base
// ==================================================================

test("la priorité est ramenée entre 0 et 100 plutôt que de faire échouer l'appel entier", () => {
  assert.equal(bornerPriorite(140), 100);
  assert.equal(bornerPriorite(-20), 0);
  assert.equal(bornerPriorite(72.6), 72, "tronquée, pas arrondie");
  assert.equal(bornerPriorite(0), 0);
});

test("une priorité illisible vaut 50 — le défaut de la colonne (0072)", () => {
  for (const valeur of [null, undefined, "haute", NaN, {}]) {
    assert.equal(bornerPriorite(valeur), 50, `« ${String(valeur)} »`);
  }
});

// ==================================================================
// 3. Les bornes, appliquées à la lecture et jamais dans le schéma
// ==================================================================

test("un titre trop long est coupé, pas rejeté", () => {
  const { valeur } = normaliserRecommandation(recommandation({ title: "x".repeat(500) }));
  assert.equal(valeur.title.length, LONGUEUR_TITRE_MAX);
  assert.ok(valeur.title.endsWith("…"), "la coupe se voit");
});

test("au-delà de huit raisons, les premières sont gardées et la coupe est annoncée", () => {
  const raisons = Array.from({ length: 12 }, (_, i) => `raison ${i + 1}`);
  const { valeur, corrections } = normaliserRecommandation(recommandation({ reasons: raisons }));

  assert.equal(valeur.reasons.length, RAISONS_MAX);
  assert.equal(valeur.reasons[0], "raison 1");
  assert.equal(corrections.length, 1);
});

test("une raison vide ou blanche est retirée sans compter dans la borne", () => {
  const { valeur } = normaliserRecommandation(recommandation({ reasons: ["vraie", "   ", ""] }));
  assert.deepEqual(valeur.reasons, ["vraie"]);
});

test("un libellé de bouton sans type d'action tombe avec lui", () => {
  // Un bouton qui ne sait pas quoi déclencher est pire qu'une absence
  // de bouton : il donne l'impression qu'une action est possible.
  const { valeur } = normaliserRecommandation(
    recommandation({ suggestedActionType: null, suggestedActionLabel: "Préparer les brouillons" }),
  );
  assert.equal(valeur.suggestedActionType, null);
  assert.equal(valeur.suggestedActionLabel, null);
});

test("un type d'action fait de blancs ne vaut pas un type d'action", () => {
  const { valeur } = normaliserRecommandation(
    recommandation({ suggestedActionType: "   ", suggestedActionLabel: "Cliquez ici" }),
  );
  assert.equal(valeur.suggestedActionType, null);
  assert.equal(valeur.suggestedActionLabel, null);
});

// ==================================================================
// 4. L'analyse d'un spécialiste
// ==================================================================

test("au-delà de dix recommandations, l'analyse est coupée et le dit", () => {
  const { valeur, corrections } = normaliserAnalyse({
    resume: "Beaucoup de choses",
    confidence: "medium",
    ambigu: false,
    recommandations: Array.from({ length: 14 }, () => recommandation()),
    donneesManquantes: [],
  });

  assert.equal(valeur.recommandations.length, RECOMMANDATIONS_MAX);
  assert.ok(corrections.some((c) => c.includes("14 recommandations")));
});

test("`ambigu` n'est vrai que s'il vaut exactement true", () => {
  // C'est le déclencheur d'escalade de la page 7. Une chaîne « oui »
  // ou un 1 ne doivent pas faire monter un appel sur le modèle avancé.
  for (const brut of ["true", 1, {}, "oui"]) {
    const { valeur } = normaliserAnalyse({
      resume: "r",
      confidence: "high",
      ambigu: brut as unknown as boolean,
      recommandations: [],
      donneesManquantes: [],
    });
    assert.equal(valeur.ambigu, false, `« ${String(brut)} » ne déclare pas une ambiguïté`);
  }
});

test("les corrections des recommandations remontent jusqu'à l'analyse", () => {
  const { corrections } = normaliserAnalyse({
    resume: "r",
    confidence: "insufficient_data",
    ambigu: false,
    recommandations: [recommandation({ confidence: "insufficient_data" })],
    donneesManquantes: ["coût de main-d'œuvre jamais saisi"],
  });

  assert.equal(corrections.length, 1);
  assert.ok(corrections[0].includes("montant a été retiré"));
});

// ==================================================================
// 5. Le brief de la Direction
// ==================================================================

test("le brief est trié par priorité ICI, pas laissé au modèle", () => {
  const { valeur } = normaliserBrief({
    resume: "Trois choses",
    confidence: "high",
    ambigu: false,
    decisions: [
      recommandation({ title: "information", priority: 10 }),
      recommandation({ title: "urgence", priority: 95 }),
      recommandation({ title: "moyen", priority: 50 }),
    ],
    agentsConsultes: ["finance"],
    donneesManquantes: [],
  });

  assert.deepEqual(
    valeur.decisions.map((d) => d.title),
    ["urgence", "moyen", "information"],
  );
});

test("le tri est STABLE : deux priorités égales gardent l'ordre du modèle", () => {
  // Le modèle a vu les détails que le tri ignore. À priorité égale,
  // son ordre est une information, pas du bruit.
  const { valeur } = normaliserBrief({
    resume: "",
    confidence: "high",
    ambigu: false,
    decisions: [
      recommandation({ title: "premier", priority: 60 }),
      recommandation({ title: "second", priority: 60 }),
      recommandation({ title: "troisieme", priority: 60 }),
    ],
    agentsConsultes: [],
    donneesManquantes: [],
  });

  assert.deepEqual(
    valeur.decisions.map((d) => d.title),
    ["premier", "second", "troisieme"],
  );
});

test("« Top 5 » (p. 9) : la sixième décision est retirée, et ce sont les CINQ PLUS PRIORITAIRES", () => {
  const { valeur, corrections } = normaliserBrief({
    resume: "",
    confidence: "high",
    ambigu: false,
    decisions: [
      recommandation({ title: "a", priority: 10 }),
      recommandation({ title: "b", priority: 20 }),
      recommandation({ title: "c", priority: 30 }),
      recommandation({ title: "d", priority: 40 }),
      recommandation({ title: "e", priority: 50 }),
      recommandation({ title: "f", priority: 99 }),
    ],
    agentsConsultes: [],
    donneesManquantes: [],
  });

  assert.equal(valeur.decisions.length, DECISIONS_EXECUTIVE_MAX);
  assert.equal(valeur.decisions[0].title, "f", "on coupe APRÈS avoir trié, sinon on jette l'urgence");
  assert.ok(!valeur.decisions.some((d) => d.title === "a"));
  assert.equal(corrections.length, 1);
});

// ==================================================================
// 6. La relecture d'une sortie revenue de `jsonb`
// ==================================================================

test("une entrée de cache illisible rend null plutôt qu'un objet à moitié vrai", () => {
  assert.equal(relireAnalyse({ resume: "sans confiance ni recommandations" }), null);
  assert.equal(relireAnalyse(null), null);
  assert.equal(relireAnalyse("du texte"), null);
  assert.equal(relireBrief({ decisions: "pas un tableau" }), null);
});

test("une sortie complète survit à l'aller-retour JSON, normalisation comprise", () => {
  const brut = {
    resume: "Dix chantiers à facturer",
    confidence: "high",
    ambigu: false,
    recommandations: [recommandation({ priority: 500 })],
    donneesManquantes: [],
  };

  const relue = relireAnalyse(JSON.parse(JSON.stringify(brut)));
  assert.ok(relue !== null);
  assert.equal(relue.recommandations[0].priority, 100, "la borne s'applique aussi au retour du cache");
});

// ==================================================================
// 7. La proposition d'action
// ==================================================================

test("une proposition sans type d'action est retirée plutôt que transmise", () => {
  assert.equal(normaliserProposition(null), null);
  assert.equal(
    normaliserProposition({
      actionType: "  ",
      resume: "x",
      parameters: {},
      cibleType: null,
      cibleId: null,
      montantCents: null,
    }),
    null,
  );
});

test("des paramètres qui ne sont pas un objet deviennent un objet vide, pas un tableau", () => {
  const p = normaliserProposition({
    actionType: "createInvoiceDraft",
    resume: "x",
    parameters: ["oups"] as unknown as Record<string, unknown>,
    cibleType: null,
    cibleId: null,
    montantCents: null,
  });
  assert.deepEqual(p?.parameters, {});
});

test("un montant illisible vaut null, jamais 0", () => {
  const p = normaliserProposition({
    actionType: "createInvoiceDraft",
    resume: "x",
    parameters: {},
    cibleType: null,
    cibleId: null,
    montantCents: "beaucoup" as unknown as number,
  });
  assert.equal(p?.montantCents, null);
});

// ==================================================================
// 8. Les schémas eux-mêmes
// ==================================================================

test("aucune clé facultative : le mode strict exige qu'elles soient toutes présentes", () => {
  // `.nullable()` et non `.optional()`. Un schéma dont une clé serait
  // facultative serait refusé par le mode strict d'OpenAI au premier
  // appel réel — c'est-à-dire en production, pas ici.
  for (const schema of [
    DecisionRecommendationSchema,
    AnalyseAgentSchema,
    SortieExecutiveSchema,
    PropositionActionSchema,
  ]) {
    for (const [nom, champ] of Object.entries(schema.shape)) {
      assert.equal(
        (champ as { safeParse(v: unknown): { success: boolean } }).safeParse(undefined).success,
        false,
        `« ${nom} » accepte undefined : c'est une clé facultative déguisée`,
      );
    }
  }
});

test("les catégories sont exactement celles d'`ai_decisions`", () => {
  assert.deepEqual(
    [...CATEGORIES_DECISION],
    ["urgent", "important", "opportunite", "optimisation", "information"],
  );
});

test("le schéma refuse une catégorie inventée", () => {
  const resultat = DecisionRecommendationSchema.safeParse(
    recommandation({ category: "tres_urgent" as unknown as DecisionRecommendation["category"] }),
  );
  assert.equal(resultat.success, false);
});
