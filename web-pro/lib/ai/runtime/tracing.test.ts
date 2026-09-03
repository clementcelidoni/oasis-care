import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CHAMPS_SPAN_AUTORISES,
  MODES_TRACING,
  VARIABLE_DONNEES_TRACING,
  VARIABLE_MODE_TRACING,
  dureeSpanMs,
  etatTracing,
  identifiantCorrelation,
  lireModeTracing,
  metadonneesTrace,
  parametresTrace,
  resumerApprobation,
  resumerSpan,
  type SpanLu,
} from "./tracing.ts";

/**
 * §11V — ÉTAPE 17 : LE TRACING, ÉPROUVÉ (spec p. 24).
 *
 * ══════════════════════════════════════════════════════════════════
 * LA PHRASE À TENIR, ET CE QUI LA TIENT
 * ══════════════════════════════════════════════════════════════════
 *
 * « Tracer : agent, handoffs, tools, latency, errors, approvals. MAIS :
 * NE PAS mettre de secrets ni données personnelles inutiles dans les
 * traces. »
 *
 * Les deux moitiés s'opposent, et la seconde est celle qui casse en
 * silence : une trace qui manque se remarque le jour où l'on cherche ;
 * une trace qui contient le nom d'un client et le montant de son devis
 * ne se remarque JAMAIS — elle part chez un tiers, elle est indexée,
 * elle reste.
 *
 * D'où la découpe que ce fichier vérifie : une LISTE BLANCHE de champs
 * par type de span. Pas une liste noire. La différence tient en une
 * phrase : le jour où le SDK ajoutera un champ `input_preview` à
 * `FunctionSpanData`, une liste noire le laisserait passer, et
 * personne ne s'en apercevrait. Un test pousse justement un span
 * chargé de données sensibles et exige que rien n'en ressorte.
 */

// ==================================================================
// 1. Le mode, et son défaut
// ==================================================================

test("sans variable, le tracing est ÉTEINT", () => {
  // Le seul réglage qu'on puisse poser à la place du propriétaire des
  // données sans le lui demander.
  assert.equal(lireModeTracing({}), "off");
  assert.equal(etatTracing({}).desactive, true);
  assert.deepEqual(etatTracing({}).anomalies, []);
});

test("« on » reste un alias de « local » : une variable posée avant l'étape 17 ne cesse pas de marcher", () => {
  for (const valeur of ["on", "true", "1", "local", "LOCAL", " Local "]) {
    assert.equal(lireModeTracing({ [VARIABLE_MODE_TRACING]: valeur }), "local", valeur);
  }
});

test("« off », « false », « 0 » et le vide éteignent", () => {
  for (const valeur of ["off", "false", "0", "", "   "]) {
    assert.equal(lireModeTracing({ [VARIABLE_MODE_TRACING]: valeur }), "off", valeur);
  }
});

test("une valeur inconnue ÉTEINT et produit une anomalie", () => {
  // Retomber sur « local » ferait écrire dans les journaux d'une
  // machine dont le propriétaire croyait activer l'export ; retomber
  // sur « openai » enverrait ses données dehors sur une faute de frappe.
  const etat = etatTracing({ [VARIABLE_MODE_TRACING]: "oui" });
  assert.equal(etat.mode, "off");
  assert.equal(etat.anomalies.length, 1);
  assert.equal(etat.anomalies[0].variable, VARIABLE_MODE_TRACING);
  for (const mode of MODES_TRACING) assert.ok(etat.anomalies[0].raison.includes(mode));
});

// ==================================================================
// 2. LE SEUL REFUS DUR DU FICHIER
// ==================================================================

test("les données sensibles sont REFUSÉES avec l'export OpenAI, pas simplement ignorées", () => {
  // Personne ne doit pouvoir envoyer les devis et les noms de clients
  // d'une entreprise chez un tiers en posant deux variables.
  const etat = etatTracing({
    [VARIABLE_MODE_TRACING]: "openai",
    [VARIABLE_DONNEES_TRACING]: "on",
  });

  assert.equal(etat.mode, "openai");
  assert.equal(etat.donneesSensibles, false, "le refus doit être effectif, pas seulement signalé");
  assert.ok(etat.anomalies.some((a) => a.raison.includes("Refusé")));
});

test("en mode local, les données sensibles s'allument — et sont signalées comme un réglage de débogage", () => {
  const etat = etatTracing({
    [VARIABLE_MODE_TRACING]: "local",
    [VARIABLE_DONNEES_TRACING]: "on",
  });

  assert.equal(etat.donneesSensibles, true);
  assert.ok(etat.anomalies.some((a) => a.raison.includes("à retirer")));
});

test("demander les données alors que le tracing est éteint est signalé comme sans effet", () => {
  const etat = etatTracing({ [VARIABLE_DONNEES_TRACING]: "on" });
  assert.equal(etat.donneesSensibles, false);
  assert.equal(etat.desactive, true);
  assert.ok(etat.anomalies.some((a) => a.raison.includes("Sans effet")));
});

test("le RunConfig par défaut coupe le tracing ET les données", () => {
  const parametres = parametresTrace({
    agent: "finance",
    criticite: "ordinaire",
    correlation: "corr-1",
    organizationId: "org-A",
    env: {},
  });

  assert.equal(parametres.tracingDisabled, true);
  assert.equal(parametres.traceIncludeSensitiveData, false);
});

// ==================================================================
// 3. LES MÉTADONNÉES — ce qu'elles ne portent jamais
// ==================================================================

test("aucune métadonnée ne porte l'utilisateur, dans aucun mode", () => {
  for (const mode of MODES_TRACING) {
    const meta = metadonneesTrace({
      agent: "billing",
      mode,
      criticite: "critique",
      correlation: "corr-1",
      organizationId: "org-A",
    });
    assert.equal(JSON.stringify(meta).includes("user"), false, `mode ${mode}`);
  }
});

test("l'organisation n'entre dans une trace qu'en LOCAL", () => {
  // Un UUID d'entreprise n'est pas anonyme : croisé avec n'importe quoi
  // d'autre, il désigne une société. En local, on est déjà chez soi.
  const local = metadonneesTrace({
    agent: "finance",
    mode: "local",
    criticite: "ordinaire",
    correlation: "c",
    organizationId: "org-A",
  });
  const chezOpenAI = metadonneesTrace({
    agent: "finance",
    mode: "openai",
    criticite: "ordinaire",
    correlation: "c",
    organizationId: "org-A",
  });

  assert.equal(local.organisation, "org-A");
  assert.equal(chezOpenAI.organisation, undefined);
});

test("le nom du flux est celui de l'agent, jamais la question posée", () => {
  const parametres = parametresTrace({
    agent: "quotePricing",
    criticite: "ordinaire",
    correlation: "corr-9",
    env: { [VARIABLE_MODE_TRACING]: "local" },
  });

  assert.equal(parametres.workflowName, "Oasis AI · quotePricing");
  assert.equal(parametres.groupId, "corr-9");
});

test("deux corrélations tirées de suite diffèrent, et ne dérivent de personne", () => {
  const a = identifiantCorrelation();
  const b = identifiantCorrelation();
  assert.notEqual(a, b);
  assert.match(a, /^[0-9a-f-]{36}$/);
});

// ==================================================================
// 4. LA LISTE BLANCHE — le cœur du fichier
// ==================================================================

function span(surcharge: Partial<SpanLu> = {}): SpanLu {
  return {
    type: "function",
    startedAt: "2026-09-03T09:00:00.000Z",
    endedAt: "2026-09-03T09:00:01.500Z",
    error: null,
    donnees: { type: "function", name: "getUnbilledProjects" },
    ...surcharge,
  };
}

test("un span d'outil rend son NOM et sa DURÉE, et rien de ce qu'il a lu", () => {
  const ligne = resumerSpan(
    span({
      donnees: {
        type: "function",
        name: "getQuote",
        // Ce que `FunctionSpanData` porte réellement : les arguments et
        // la réponse. Un devis, un client, un montant.
        input: JSON.stringify({ p_quote_id: "11111111-2222-3333-4444-555555555555" }),
        output: JSON.stringify({ client: "Jardins de Bellevue", total_cents: 3_845_000 }),
      },
    }),
  );

  assert.ok(ligne !== null);
  assert.ok(ligne.includes("name=getQuote"));
  assert.ok(ligne.includes("duree_ms=1500"));
  assert.ok(!ligne.includes("Bellevue"), "le nom du client ne doit pas entrer dans une trace");
  assert.ok(!ligne.includes("3845000"), "le montant non plus");
  assert.ok(!ligne.includes("11111111"), "ni l'identifiant du devis");
});

test("un span de génération ne rend que le modèle, jamais le contexte ni la réponse", () => {
  const ligne = resumerSpan(
    span({
      type: "generation",
      donnees: {
        type: "generation",
        model: "un-modele",
        input: [{ role: "user", content: "trésorerie de Jardins de Bellevue" }],
        output: [{ role: "assistant", content: "38 450 € à facturer" }],
      },
    }),
  );

  assert.ok(ligne !== null);
  assert.ok(ligne.includes("model=un-modele"));
  assert.ok(!ligne.includes("Bellevue"));
  assert.ok(!ligne.includes("38 450"));
});

test("un CHAMP AJOUTÉ DEMAIN par le SDK n'est pas recopié", () => {
  // C'est toute la différence entre une liste blanche et une liste
  // noire, et elle ne se voit que par ce test.
  const ligne = resumerSpan(
    span({ donnees: { type: "function", name: "getQuote", input_preview: "Jardins de Bellevue" } }),
  );
  assert.ok(ligne !== null);
  assert.ok(!ligne.includes("Bellevue"));
});

test("un TYPE de span inconnu n'est pas écrit du tout", () => {
  // On ne sait pas quels champs y sont sûrs ; l'écrire « au cas où »
  // est la façon exacte dont une donnée personnelle finit dans un
  // journal.
  assert.equal(resumerSpan(span({ type: "un_span_futur", donnees: { secret: "x" } })), null);
});

test("chaque type autorisé ne liste que des champs de structure", () => {
  const interdits = ["input", "output", "_input", "_response", "arguments", "result", "content"];
  for (const [type, champs] of Object.entries(CHAMPS_SPAN_AUTORISES)) {
    for (const champ of champs) {
      assert.ok(!interdits.includes(champ), `« ${type}.${champ} » porte une charge utile`);
    }
  }
});

test("une erreur est TRONQUÉE, pas omise : « rate limit » doit rester reconnaissable", () => {
  const ligne = resumerSpan(span({ error: { message: `429 rate limit ${"x".repeat(500)}` } }));
  assert.ok(ligne !== null);
  assert.ok(ligne.includes("rate limit"));
  assert.ok(ligne.length < 400, "deux cents caractères suffisent à reconnaître une erreur");
});

test("une valeur imbriquée n'entre jamais dans une trace, même sur un champ autorisé", () => {
  const ligne = resumerSpan(
    span({ type: "agent", donnees: { type: "agent", name: { secret: "Bellevue" } } }),
  );
  assert.ok(ligne !== null);
  assert.ok(!ligne.includes("Bellevue"));
});

test("un tableau de chaînes est accepté sur un champ autorisé, et borné", () => {
  const ligne = resumerSpan(
    span({
      type: "agent",
      donnees: { type: "agent", name: "Oasis Direction", tools: ["getExecutiveBrief", "demanderFinance"] },
    }),
  );
  assert.ok(ligne !== null);
  assert.ok(ligne.includes("tools=getExecutiveBrief, demanderFinance"));
});

test("une durée non mesurable ne produit pas de « duree_ms=NaN »", () => {
  assert.equal(dureeSpanMs(span({ endedAt: null })), null);
  assert.equal(dureeSpanMs(span({ startedAt: "pas une date" })), null);
  const ligne = resumerSpan(span({ endedAt: null }));
  assert.ok(ligne !== null && !ligne.includes("duree_ms"));
});

test("une horloge qui recule ne produit pas une durée négative", () => {
  assert.equal(
    dureeSpanMs(span({ startedAt: "2026-09-03T09:00:02.000Z", endedAt: "2026-09-03T09:00:01.000Z" })),
    0,
  );
});

// ==================================================================
// 5. LES APPROBATIONS — que la p. 24 demande et qu'aucun span ne porte
// ==================================================================

test("une approbation trace le type d'action et le verdict, jamais les paramètres", () => {
  const ligne = resumerApprobation({
    agent: "billing",
    outil: "createInvoiceDraft",
    actionType: "createInvoiceDraft",
    risque: "medium",
    verdict: "approuvee",
  });

  assert.ok(ligne.includes("span=approbation"));
  assert.ok(ligne.includes("agent=billing"));
  assert.ok(ligne.includes("verdict=approuvee"));
  assert.ok(ligne.includes("risque=medium"));
  assert.ok(!ligne.includes("motif="), "pas de motif quand il n'y en a pas");
});

test("un refus porte son motif, tronqué", () => {
  const ligne = resumerApprobation({
    agent: "executive",
    outil: "inventé",
    actionType: null,
    risque: null,
    verdict: "refusee",
    motif: `hors catalogue ${"y".repeat(400)}`,
  });

  assert.ok(ligne.includes("verdict=refusee"));
  assert.ok(ligne.includes("action=—"), "un type absent se dit, il ne disparaît pas");
  assert.ok(ligne.includes("motif=hors catalogue"));
  assert.ok(ligne.length < 400);
});
