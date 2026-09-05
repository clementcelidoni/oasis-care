import test from "node:test";
import assert from "node:assert/strict";

import {
  cleDeCase,
  compterCasesIndecises,
  decisionsEnAttente,
  disponibiliteDe,
  economieAnnuelle,
  fonctionnalites,
  indexerMatrice,
  prixDOffre,
  prixDeCase,
} from "./grille.ts";
import type { LigneCase, LigneModule, LigneOffre } from "./types.ts";

/**
 * ==================================================================
 * UN SEUL SUJET : LE PRIX D'UN MODULE VIENT DE LA CASE
 * ==================================================================
 *
 * La phrase du dirigeant contient l'exigence structurelle de tout ce
 * chantier : « BioLab et Pépinière inclus dans Business, et à 20 € de
 * plus dans Pro. » UN MÊME MODULE EST DONC INCLUS DANS UNE OFFRE ET
 * PAYANT DANS UNE AUTRE.
 *
 * Un modèle plat — `add_ons(cle, prix)` — ne saurait jamais dire cela,
 * et la première facture d'une entreprise Business porterait 20 € de
 * trop. Ces tests épinglent la conséquence : `prixDeCase` rend
 * « compris » là où l'offre comprend le module, et un prix ailleurs.
 *
 * Le second sujet est celui de tout le produit : `null` veut dire
 * INCONNU, jamais zéro. Une case non décidée ne se comporte ni comme
 * « inclus » ni comme « indisponible » — elle BLOQUE et se signale.
 */

function offre(partiel: Partial<LigneOffre> & { key: string; name: string }): LigneOffre {
  return {
    tagline: null,
    features: [],
    monthly_price_cents: null,
    yearly_price_cents: null,
    currency: "EUR",
    is_quote_only: false,
    price_floor_cents: null,
    max_users: null,
    included_seats: null,
    seat_policy: "billedBeyondIncluded",
    extra_seat_monthly_price_cents: null,
    ai_monthly_quota: null,
    storage_gb: null,
    badge: null,
    position: 0,
    is_active: true,
    updated_at: null,
    updated_by: null,
    ...partiel,
  };
}

function module(
  partiel: Partial<LigneModule> & { key: string; name: string },
): LigneModule {
  return {
    tagline: null,
    is_delivered: true,
    pricing_model: "flat",
    metered_unit: null,
    position: 0,
    note: null,
    ...partiel,
  };
}

function caseM(partiel: Partial<LigneCase> & { plan_key: string; module_key: string }): LigneCase {
  return {
    availability: "undecided",
    monthly_price_cents: null,
    yearly_price_cents: null,
    metered_unit_price_cents: null,
    updated_at: null,
    ...partiel,
  };
}

// ------------------------------------------------------------------
// La matrice
// ------------------------------------------------------------------

test("le même module est compris dans une offre et payant dans une autre", () => {
  const biolab = module({ key: "biolab", name: "BioLab" });
  const matrice = [
    caseM({ plan_key: "team", module_key: "biolab", availability: "optional", monthly_price_cents: 2000, yearly_price_cents: 20000 }),
    caseM({ plan_key: "business", module_key: "biolab", availability: "included" }),
  ];
  const index = indexerMatrice(matrice);

  assert.deepEqual(prixDeCase(index.get(cleDeCase("team", "biolab")), biolab, "monthly"), {
    etat: "prix",
    cents: 2000,
  });
  // Business : RIEN à facturer. C'est ce qui fait qu'un passage de Pro à
  // Business cesse de facturer le module sans qu'on touche à
  // l'abonnement.
  assert.deepEqual(prixDeCase(index.get(cleDeCase("business", "biolab")), biolab, "monthly"), {
    etat: "compris",
  });
});

test("une case absente vaut « non décidé », jamais « indisponible »", () => {
  const index = indexerMatrice([]);
  assert.equal(disponibiliteDe(index, "solo", "biolab"), "undecided");
});

test("« non décidé » bloque et se dit — il ne se comporte pas comme un prix nul", () => {
  const resultat = prixDeCase(undefined, module({ key: "biolab", name: "BioLab" }), "monthly");
  assert.equal(resultat.etat, "inconnu");
  assert.match(resultat.etat === "inconnu" ? resultat.raison : "", /non décidée/i);
});

test("un module en option sans prix pour le cycle demandé est INCONNU, pas gratuit", () => {
  const ligne = caseM({
    plan_key: "team",
    module_key: "biolab",
    availability: "optional",
    monthly_price_cents: 2000,
    // pas de prix annuel
  });
  const resultat = prixDeCase(ligne, module({ key: "biolab", name: "BioLab" }), "yearly");
  assert.equal(resultat.etat, "inconnu");
});

test("un module au compteur n'a pas de prix mensuel : aucune table n'enregistre la consommation", () => {
  const sms = module({
    key: "sms",
    name: "SMS",
    is_delivered: false,
    pricing_model: "metered",
    metered_unit: "sms",
  });
  const ligne = caseM({
    plan_key: "team",
    module_key: "sms",
    availability: "optional",
    metered_unit_price_cents: 10,
  });
  const resultat = prixDeCase(ligne, sms, "monthly");
  assert.equal(resultat.etat, "inconnu");
  assert.match(resultat.etat === "inconnu" ? resultat.raison : "", /compteur/i);
});

// ------------------------------------------------------------------
// Les prix d'une offre
// ------------------------------------------------------------------

test("une offre sur devis n'a pas de prix public, elle a un plancher", () => {
  const enterprise = offre({
    key: "enterprise",
    name: "Enterprise",
    is_quote_only: true,
    price_floor_cents: 24900,
  });
  assert.deepEqual(prixDOffre(enterprise, "monthly"), {
    etat: "surDevis",
    plancherCents: 24900,
  });
});

test("une offre à prix public sans prix rend « absent », pas zéro", () => {
  assert.deepEqual(prixDOffre(offre({ key: "team", name: "Pro" }), "monthly"), { etat: "absent" });
});

test("l'économie annuelle est CALCULÉE et non recopiée dans un libellé", () => {
  const pro = offre({
    key: "team",
    name: "Pro",
    monthly_price_cents: 7990,
    yearly_price_cents: 79900,
  });
  const economie = economieAnnuelle(pro);
  assert.ok(economie !== null);
  // 799 € pour douze mois à 79,90 € : dix mensualités, donc deux mois
  // offerts. Le jour où le prix change, la phrase change avec lui.
  assert.equal(economie.moisEquivalents, 10);
  assert.equal(economie.moisOfferts, 2);
  assert.equal(economie.economieCents, 7990 * 12 - 79900);
});

test("pas d'économie annoncée quand l'année coûte autant que douze mois", () => {
  const plat = offre({
    key: "x",
    name: "X",
    monthly_price_cents: 1000,
    yearly_price_cents: 12000,
  });
  assert.equal(economieAnnuelle(plat), null);
});

test("un `features` qui n'est pas un tableau de chaînes ne fait pas planter la page", () => {
  assert.deepEqual(fonctionnalites(null), []);
  assert.deepEqual(fonctionnalites({ a: 1 }), []);
  assert.deepEqual(fonctionnalites(["CRM", 42, "Devis"]), ["CRM", "Devis"]);
});

// ------------------------------------------------------------------
// Les décisions qui manquent
// ------------------------------------------------------------------

test("les cases indécises des offres actives et des modules LIVRÉS remontent en décision", () => {
  const offres = [
    offre({ key: "solo", name: "Pro Solo", monthly_price_cents: 3990, yearly_price_cents: 39900, included_seats: 1 }),
    offre({ key: "nursery", name: "Pépinière", is_active: false }),
  ];
  const modules = [
    module({ key: "biolab", name: "BioLab" }),
    module({ key: "sms", name: "SMS", is_delivered: false, pricing_model: "metered", metered_unit: "sms" }),
  ];
  const matrice = [
    caseM({ plan_key: "solo", module_key: "biolab" }),
    caseM({ plan_key: "solo", module_key: "sms" }),
    caseM({ plan_key: "nursery", module_key: "biolab" }),
  ];

  const decisions = decisionsEnAttente(offres, modules, matrice);
  const identifiants = decisions.map((d) => d.id);

  // Pro Solo × BioLab : livrée, active, indécise → à décider.
  assert.ok(identifiants.includes("case:solo:biolab"));
  // SMS n'est pas livré : l'annoncer comme décision à prendre noierait
  // les quatre qui comptent.
  assert.ok(!identifiants.includes("case:solo:sms"));
  // Une offre retirée de la grille n'appelle plus de décision.
  assert.ok(!identifiants.includes("case:nursery:biolab"));
});

test("des sièges compris nuls sont une décision qui manque, pas « illimité »", () => {
  const decisions = decisionsEnAttente(
    [offre({ key: "team", name: "Pro", monthly_price_cents: 7990, yearly_price_cents: 79900 })],
    [],
    [],
  );
  assert.deepEqual(
    decisions.map((d) => d.categorie),
    ["sieges"],
  );
});

test("une offre active sans prix est signalée : elle rend le MRR incalculable", () => {
  const decisions = decisionsEnAttente(
    [offre({ key: "team", name: "Pro", included_seats: 3 })],
    [],
    [],
  );
  assert.deepEqual(
    decisions.map((d) => d.categorie),
    ["prix"],
  );
});

test("le compte des cases indécises couvre TOUTE la matrice, pas seulement ce qui est priorisé", () => {
  const matrice = [
    caseM({ plan_key: "solo", module_key: "biolab" }),
    caseM({ plan_key: "solo", module_key: "sms" }),
    caseM({ plan_key: "business", module_key: "biolab", availability: "included" }),
  ];
  assert.equal(compterCasesIndecises(matrice), 2);
});
