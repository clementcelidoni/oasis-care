import { test } from "node:test";
import assert from "node:assert/strict";

import {
  economieAnnuelle,
  formaterHt,
  formaterHtParPeriode,
  modulesAttendusPour,
  optionAffichable,
  recommanderOffre,
  type ModuleDansOffre,
  type OffrePourRecommandation,
} from "./grille.ts";

/** Les montants de la grille, tels que 0081 les sème. Tous HORS TAXES. */
const PRO_MENSUEL = 7990;
const PRO_ANNUEL = 79900;
const MODULE_MENSUEL = 2000;
const MODULE_ANNUEL = 20000;

function moduleDansOffre(patch: Partial<ModuleDansOffre> = {}): ModuleDansOffre {
  return {
    key: "nursery",
    name: "Pépinière",
    tagline: "Lots, emplacements, mouvements de stock",
    disponibilite: "optional",
    livre: true,
    modeleTarifaire: "flat",
    uniteComptee: null,
    prixMensuelHtCents: MODULE_MENSUEL,
    prixAnnuelHtCents: MODULE_ANNUEL,
    ...patch,
  };
}

// ------------------------------------------------------------------
// L'ARGENT, ET SA MENTION
// ------------------------------------------------------------------

test("un montant porte TOUJOURS sa mention HT", () => {
  // C'est la garantie centrale du fichier : il n'existe aucun chemin
  // par lequel un gabarit pourrait afficher un prix nu.
  assert.equal(formaterHt(PRO_MENSUEL), "79,90 € HT");
  assert.equal(formaterHt(PRO_ANNUEL), "799,00 € HT");
  assert.equal(formaterHt(2990), "29,90 € HT");
  assert.equal(formaterHt(24900), "249,00 € HT");
});

test("les deux décimales sont toujours écrites", () => {
  // « 399 € HT » et « 399,00 € HT » se lisent pareil, mais dans une
  // colonne de prix la seconde s'aligne et la première saute à l'œil.
  assert.equal(formaterHt(39900), "399,00 € HT");
  assert.equal(formaterHt(0), "0,00 € HT");
});

test("un prix inconnu reste inconnu — il ne devient pas zéro", () => {
  // Une offre sur devis n'a pas de prix mensuel. L'afficher « 0,00 € »
  // serait annoncer la gratuité.
  assert.equal(formaterHt(null), null);
  assert.equal(formaterHtParPeriode(null, "monthly"), null);
});

test("la période accompagne le montant", () => {
  assert.equal(formaterHtParPeriode(PRO_MENSUEL, "monthly"), "79,90 € HT / mois");
  assert.equal(formaterHtParPeriode(PRO_ANNUEL, "yearly"), "799,00 € HT / an");
});

// ------------------------------------------------------------------
// L'ÉCONOMIE DE L'ANNUEL
// ------------------------------------------------------------------

test("l'annuel de la grille annonce bien deux mois offerts", () => {
  // 79,90 × 12 = 958,80 ; l'annuel est à 799 ; l'écart vaut 159,80,
  // soit exactement deux mensualités.
  const economie = economieAnnuelle(PRO_MENSUEL, PRO_ANNUEL);
  assert.equal(economie?.montant, "159,80 € HT");
  assert.match(economie?.phrase ?? "", /2 mois offerts/);
});

test("l'économie se DÉDUIT des deux montants, elle n'est pas codée à dix mois", () => {
  // Si le dirigeant pose demain l'annuel à onze mois, la phrase doit
  // suivre toute seule. Un « × 10 » en dur afficherait une économie
  // fausse dès le lendemain.
  const economie = economieAnnuelle(1000, 11000);
  assert.match(economie?.phrase ?? "", /un mois offert/);
});

test("une économie qui ne tombe pas juste s'exprime en pourcentage", () => {
  // « 1,7 mois offert » serait pire que de se taire.
  const economie = economieAnnuelle(1000, 10500);
  assert.match(economie?.phrase ?? "", /%/);
  assert.doesNotMatch(economie?.phrase ?? "", /mois offert/);
});

test("un annuel qui ne fait rien économiser ne s'annonce pas", () => {
  assert.equal(economieAnnuelle(1000, 12000), null);
  assert.equal(economieAnnuelle(1000, 13000), null);
});

test("sans les deux montants, aucune économie n'est annoncée", () => {
  assert.equal(economieAnnuelle(null, PRO_ANNUEL), null);
  assert.equal(economieAnnuelle(PRO_MENSUEL, null), null);
});

// ------------------------------------------------------------------
// LA MATRICE, VUE DE L'ÉCRAN
// ------------------------------------------------------------------

test("un module en option, livré et tarifé, se coche et montre son prix", () => {
  const option = optionAffichable(moduleDansOffre(), "monthly");
  assert.equal(option.cochable, true);
  assert.equal(option.prix, "20,00 € HT / mois");
  assert.equal(option.motif, null);
  assert.equal(option.compris, false);
});

test("le même module, à l'année, prend son tarif annuel", () => {
  const option = optionAffichable(moduleDansOffre(), "yearly");
  assert.equal(option.prix, "200,00 € HT / an");
});

test("un module COMPRIS ne se coche pas, et ne coûte rien", () => {
  // C'est tout l'intérêt de la matrice : passer de Pro à Pro Business
  // cesse de facturer BioLab sans qu'on touche à quoi que ce soit.
  const option = optionAffichable(moduleDansOffre({ disponibilite: "included" }), "monthly");
  assert.equal(option.cochable, false);
  assert.equal(option.compris, true);
  assert.equal(option.prix, null);
  assert.match(option.motif ?? "", /sans supplément/);
});

test("un module ANNONCÉ MAIS NON LIVRÉ ne se vend pas, et l'écran le dit", () => {
  // Le vendre serait vendre du vent.
  const option = optionAffichable(
    moduleDansOffre({ key: "whiteLabel", name: "Marque blanche", livre: false }),
    "monthly",
  );
  assert.equal(option.cochable, false);
  assert.match(option.motif ?? "", /pas encore livré/);
});

test("un module AU COMPTEUR ne se souscrit pas au forfait", () => {
  const option = optionAffichable(
    moduleDansOffre({
      key: "sms",
      name: "SMS",
      modeleTarifaire: "metered",
      uniteComptee: "sms",
      prixMensuelHtCents: null,
      prixAnnuelHtCents: null,
    }),
    "monthly",
  );
  assert.equal(option.cochable, false);
  assert.match(option.motif ?? "", /à l'usage \(sms\)/);
});

test("« non décidé » bloque, et ne se comporte ni comme inclus ni comme indisponible", () => {
  const option = optionAffichable(moduleDansOffre({ disponibilite: "undecided" }), "monthly");
  assert.equal(option.cochable, false);
  assert.match(option.motif ?? "", /pas encore arrêtées/);
});

test("un module sans tarif annuel se refuse à l'année, en disant de prendre le mois", () => {
  const option = optionAffichable(
    moduleDansOffre({ prixAnnuelHtCents: null }),
    "yearly",
  );
  assert.equal(option.cochable, false);
  assert.match(option.motif ?? "", /se souscrit au mois/);
  // ... et se coche toujours au mois.
  assert.equal(optionAffichable(moduleDansOffre({ prixAnnuelHtCents: null }), "monthly").cochable, true);
});

test("chaque refus porte un motif DIFFÉRENT", () => {
  // Une phrase générique — « indisponible » — enverrait tout le monde
  // écrire au support.
  const motifs = new Set(
    [
      optionAffichable(moduleDansOffre({ disponibilite: "included" }), "monthly").motif,
      optionAffichable(moduleDansOffre({ disponibilite: "unavailable" }), "monthly").motif,
      optionAffichable(moduleDansOffre({ disponibilite: "undecided" }), "monthly").motif,
      optionAffichable(moduleDansOffre({ livre: false }), "monthly").motif,
      optionAffichable(moduleDansOffre({ modeleTarifaire: "commission" }), "monthly").motif,
      optionAffichable(moduleDansOffre({ prixAnnuelHtCents: null }), "yearly").motif,
    ].filter((m) => m !== null),
  );
  assert.equal(motifs.size, 6);
});

// ------------------------------------------------------------------
// LE MÉTIER
// ------------------------------------------------------------------

const GRILLE: OffrePourRecommandation[] = [
  { key: "solo", name: "Pro Solo", monthlyPriceCents: 3990, isQuoteOnly: false, badge: null, modulesCompris: [] },
  { key: "team", name: "Pro", monthlyPriceCents: 7990, isQuoteOnly: false, badge: "bestSeller", modulesCompris: [] },
  {
    key: "business",
    name: "Pro Business",
    monthlyPriceCents: 13990,
    isQuoteOnly: false,
    badge: null,
    modulesCompris: ["biolab", "nursery", "api"],
  },
  {
    key: "enterprise",
    name: "Enterprise",
    monthlyPriceCents: null,
    isQuoteOnly: true,
    badge: null,
    modulesCompris: ["biolab", "nursery", "api"],
  },
];

const NOMS = { nursery: "Pépinière", biolab: "BioLab" };

test("un pépiniériste se voit recommander l'offre où la Pépinière est COMPRISE", () => {
  const reco = recommanderOffre("nursery", "Pépiniériste", GRILLE, NOMS);
  assert.equal(reco?.planKey, "business");
  assert.match(reco?.raison ?? "", /Pépinière/);
  assert.match(reco?.raison ?? "", /sans supplément/);
});

test("un paysagiste pur retombe sur l'offre phare", () => {
  const reco = recommanderOffre("landscaper", "Paysagiste", GRILLE, NOMS);
  assert.equal(reco?.planKey, "team");
});

test("la recommandation SUIT la matrice : si Pro comprend la Pépinière, c'est Pro", () => {
  // Le test qui prouve que la règle n'est pas écrite en dur. Le jour où
  // le dirigeant fait basculer le module dans l'offre Pro, la
  // recommandation change sans qu'on touche au code.
  const grilleModifiee = GRILLE.map((offre) =>
    offre.key === "team" ? { ...offre, modulesCompris: ["nursery"] } : offre,
  );
  assert.equal(recommanderOffre("nursery", "Pépiniériste", grilleModifiee, NOMS)?.planKey, "team");
});

test("la MOINS CHÈRE des offres qui couvrent le besoin est retenue", () => {
  const grilleModifiee = GRILLE.map((offre) =>
    offre.key === "solo" ? { ...offre, modulesCompris: ["nursery"] } : offre,
  );
  assert.equal(recommanderOffre("nursery", "Pépiniériste", grilleModifiee, NOMS)?.planKey, "solo");
});

test("une offre SUR DEVIS n'est jamais recommandée", () => {
  // Enterprise comprend tout, et elle est la seule à comprendre le
  // module dans cette grille-là. Elle ne doit pourtant pas sortir : on
  // ne peut pas la souscrire, et la mettre en avant enverrait le
  // visiteur dans un cul-de-sac.
  const sansBusiness = GRILLE.filter((offre) => offre.key !== "business");
  const reco = recommanderOffre("nursery", "Pépiniériste", sansBusiness, NOMS);
  assert.notEqual(reco?.planKey, "enterprise");
  assert.equal(reco?.planKey, "team", "on retombe sur le badge");
});

test("sans badge et sans besoin de module, on ne recommande rien plutôt que d'inventer", () => {
  const sansBadge = GRILLE.map((offre) => ({ ...offre, badge: null }));
  assert.equal(recommanderOffre("landscaper", "Paysagiste", sansBadge, NOMS), null);
});

test("« Autre » comme métier n'appelle aucun module particulier", () => {
  assert.deepEqual(modulesAttendusPour("other"), []);
  assert.equal(recommanderOffre("other", "Autre", GRILLE, NOMS)?.planKey, "team");
});

test("les trois métiers du végétal appellent le module Pépinière", () => {
  for (const metier of ["nursery", "landscaperAndNursery", "horticulturalProducer"] as const) {
    assert.deepEqual(modulesAttendusPour(metier), ["nursery"], metier);
  }
});

test("une grille vide ne recommande rien et ne lève pas", () => {
  assert.equal(recommanderOffre("nursery", "Pépiniériste", [], NOMS), null);
});
