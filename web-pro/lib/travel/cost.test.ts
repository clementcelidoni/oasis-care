import { test } from "node:test";
import assert from "node:assert/strict";
import { calculerCoutDeplacement } from "./cost.ts";
import {
  connu,
  formatHeuresMinutes,
  inconnu,
  type HypothesesDeplacement,
  type PointGeographique,
} from "./types.ts";

/**
 * §11V ÉTAPE 12 — les deux choses que ce calcul doit faire sans faute.
 *
 *   1. SORTIR JUSTE L'EXEMPLE DE LA SPEC. C'est le seul cas chiffré que
 *      le document donne (p. 13), et il est chiffré jusqu'à la minute :
 *      Cannes, 46 min du siège, 4 personnes, 5 jours → 30 h 40, contre
 *      10 h au devis → sous-chiffrage potentiel.
 *
 *   2. DIRE « INCONNU » ET JAMAIS « ZÉRO ». Un coût de déplacement nul
 *      affiché faute de taux horaire n'est pas une information
 *      manquante : c'est une information FAUSSE, et elle se glisse dans
 *      une marge qui décidera d'un prix.
 */

const SIEGE_SITUE: PointGeographique = {
  libelle: "06800 Cagnes-sur-Mer",
  commune: "Cagnes-sur-Mer",
  codePostal: "06800",
  coordonnees: { latitude: 43.675413, longitude: 7.150354 },
  origine: "centreCommune",
};

const CHANTIER_SITUE: PointGeographique = {
  libelle: "06400 Cannes",
  commune: "Cannes",
  codePostal: "06400",
  coordonnees: { latitude: 43.555468, longitude: 7.004585 },
  origine: "centreCommune",
};

const POINT_NON_SITUE: PointGeographique = {
  libelle: "Adresse inconnue",
  commune: null,
  codePostal: null,
  coordonnees: null,
  origine: "inconnue",
};

const RIEN_DE_CONNU = {
  tauxHoraireCents: inconnu("aucunTaux", "Aucun salarié n'a de coût horaire renseigné."),
  coutVehiculeParKmCents: inconnu("aucunBareme", "Aucun barème kilométrique n'est enregistré."),
  peagesAllerRetourCents: inconnu("aucunPeage", "Les péages ne sont pas connus."),
  heuresDeplacementDevisees: inconnu("aucuneLigne", "Le devis ne porte aucune ligne de transport."),
};

function hypotheses(over: Partial<HypothesesDeplacement> = {}): HypothesesDeplacement {
  return {
    effectif: null,
    joursChantier: null,
    nombreDeVehicules: null,
    tempsAllerMinutesFourni: null,
    ...RIEN_DE_CONNU,
    ...over,
  };
}

// ============================================================
// 1. L'exemple de la spec, au chiffre près
// ============================================================

test("Cannes, 46 min, 4 personnes, 5 jours : 30 h 40 de déplacement humain", () => {
  const r = calculerCoutDeplacement({
    siege: SIEGE_SITUE,
    chantier: CHANTIER_SITUE,
    hypotheses: hypotheses({
      effectif: 4,
      joursChantier: 5,
      nombreDeVehicules: 1,
      tempsAllerMinutesFourni: 46,
      heuresDeplacementDevisees: connu(10, "lignes de transport du devis"),
    }),
  });

  assert.equal(r.heuresHumaines.connu, true);
  if (!r.heuresHumaines.connu) return;

  // 46 min × 2 trajets × 5 jours × 4 personnes = 1 840 min.
  assert.equal(r.heuresHumaines.valeur.heures, 1840 / 60);
  assert.equal(r.heuresHumaines.valeur.libelle, "30 h 40");

  assert.equal(r.comparaisonAuDevis.verdict, "sousChiffragePotentiel");
  assert.equal(r.comparaisonAuDevis.heuresDevisees, 10);
  assert.equal(r.comparaisonAuDevis.ecartHeures, 1840 / 60 - 10);
});

test("un temps de trajet saisi l'emporte sur l'estimation, et la confiance le dit", () => {
  const r = calculerCoutDeplacement({
    siege: SIEGE_SITUE,
    chantier: CHANTIER_SITUE,
    hypotheses: hypotheses({ effectif: 4, joursChantier: 5, tempsAllerMinutesFourni: 46 }),
  });

  assert.equal(r.temps.connu, true);
  if (!r.temps.connu) return;
  assert.equal(r.temps.valeur.origine, "fourniParLUtilisateur");
  assert.equal(r.temps.valeur.allerMinutes, 46);
  assert.equal(r.temps.valeur.allerRetourMinutes, 92);
  assert.equal(r.confiance, "high");
});

test("sans temps saisi, la distance estimée en produit un — et la confiance baisse", () => {
  const r = calculerCoutDeplacement({
    siege: SIEGE_SITUE,
    chantier: CHANTIER_SITUE,
    hypotheses: hypotheses({ effectif: 4, joursChantier: 5 }),
  });

  assert.equal(r.temps.connu, true);
  if (!r.temps.connu || !r.distance.connu) return;
  assert.equal(r.temps.valeur.origine, "estimeDepuisLaDistance");
  assert.equal(r.distance.valeur.estimation, true);
  assert.equal(r.distance.valeur.allerRetourKm, Math.round(r.distance.valeur.allerKm * 2 * 10) / 10);
  // Centres de commune des deux côtés : la moins bonne des confiances
  // qui ne soit pas « données insuffisantes ».
  assert.equal(r.confiance, "low");
  assert.ok(r.avertissements.some((a) => a.includes("centre de la commune")));
});

// ============================================================
// 2. Ce qui manque se dit, et ne vaut jamais zéro
// ============================================================

test("sans effectif, les heures humaines sont inconnues — pas nulles", () => {
  const r = calculerCoutDeplacement({
    siege: SIEGE_SITUE,
    chantier: CHANTIER_SITUE,
    hypotheses: hypotheses({ joursChantier: 5, tempsAllerMinutesFourni: 46 }),
  });

  assert.equal(r.heuresHumaines.connu, false);
  if (r.heuresHumaines.connu) return;
  assert.match(r.heuresHumaines.explication, /effectif/);
  assert.match(r.heuresHumaines.explication, /pas zéro heure/);
  assert.equal(r.coutHumainCents.connu, false);
  assert.equal(r.comparaisonAuDevis.verdict, "insufficientData");
  assert.equal(r.confiance, "insufficient_data");
});

test("sans aucune adresse située, la distance est inconnue et le reste tient debout", () => {
  const r = calculerCoutDeplacement({
    siege: POINT_NON_SITUE,
    chantier: POINT_NON_SITUE,
    hypotheses: hypotheses({
      effectif: 4,
      joursChantier: 5,
      nombreDeVehicules: 1,
      tempsAllerMinutesFourni: 46,
      heuresDeplacementDevisees: connu(10, "devis"),
    }),
  });

  assert.equal(r.distance.connu, false);
  if (r.distance.connu) return;
  assert.equal(r.distance.motif, "deuxPointsInconnus");

  // L'exemple de la spec ne donne QUE le temps de trajet : les heures
  // humaines doivent sortir quand même.
  assert.equal(r.heuresHumaines.connu, true);
  if (!r.heuresHumaines.connu) return;
  assert.equal(r.heuresHumaines.valeur.libelle, "30 h 40");
  assert.equal(r.comparaisonAuDevis.verdict, "sousChiffragePotentiel");

  // Mais pas le coût véhicule : sans kilométrage, il n'y a rien à
  // valoriser.
  assert.equal(r.coutVehiculeCents.connu, false);
});

test("le siège non situé et le chantier situé donnent un motif qui nomme le coupable", () => {
  const r = calculerCoutDeplacement({
    siege: POINT_NON_SITUE,
    chantier: CHANTIER_SITUE,
    hypotheses: hypotheses(),
  });
  assert.equal(r.distance.connu, false);
  if (r.distance.connu) return;
  assert.equal(r.distance.motif, "siegeInconnu");
  assert.match(r.distance.explication, /siège/);
});

test("un taux horaire absent laisse les heures visibles et le coût inconnu", () => {
  const r = calculerCoutDeplacement({
    siege: SIEGE_SITUE,
    chantier: CHANTIER_SITUE,
    hypotheses: hypotheses({ effectif: 4, joursChantier: 5, tempsAllerMinutesFourni: 46 }),
  });

  assert.equal(r.heuresHumaines.connu, true);
  assert.equal(r.coutHumainCents.connu, false);
  if (r.coutHumainCents.connu) return;
  assert.equal(r.coutHumainCents.motif, "aucunTaux");
  assert.equal(r.coutTotal.totalCents, null);
  assert.equal(r.coutTotal.complet, false);
  assert.deepEqual(r.coutTotal.postesRetenus, []);
  assert.deepEqual(r.coutTotal.postesManquants, ["heuresHumaines", "vehicule", "peages"]);
});

// ============================================================
// 3. L'argent, en centimes entiers
// ============================================================

test("le coût humain arrondit le produit, pas le taux", () => {
  const r = calculerCoutDeplacement({
    siege: SIEGE_SITUE,
    chantier: CHANTIER_SITUE,
    hypotheses: hypotheses({
      effectif: 4,
      joursChantier: 5,
      tempsAllerMinutesFourni: 46,
      tauxHoraireCents: connu(2500, "coût horaire médian des salariés"),
    }),
  });

  assert.equal(r.coutHumainCents.connu, true);
  if (!r.coutHumainCents.connu) return;
  // 30,6667 h × 25,00 € = 766,666… € → 76 667 centimes.
  assert.equal(r.coutHumainCents.valeur, Math.round((1840 / 60) * 2500));
  assert.equal(r.coutHumainCents.valeur, 76_667);
});

test("le coût véhicule suit le kilométrage de tous les véhicules", () => {
  const r = calculerCoutDeplacement({
    siege: SIEGE_SITUE,
    chantier: CHANTIER_SITUE,
    hypotheses: hypotheses({
      effectif: 4,
      joursChantier: 5,
      nombreDeVehicules: 2,
      tempsAllerMinutesFourni: 46,
      coutVehiculeParKmCents: connu(40, "entretien observé par kilomètre"),
    }),
  });

  assert.equal(r.trajets.connu, true);
  if (!r.trajets.connu || !r.distance.connu || !r.coutVehiculeCents.connu) {
    assert.fail("le kilométrage et son coût devraient être connus");
  }
  assert.equal(r.trajets.valeur.trajetsParPersonne, 10);
  assert.equal(r.trajets.valeur.trajetsVehicules, 20);
  assert.equal(
    r.trajets.valeur.kmTotauxVehicules,
    Math.round(r.distance.valeur.allerKm * 20 * 10) / 10,
  );
  assert.equal(
    r.coutVehiculeCents.valeur,
    Math.round((r.trajets.valeur.kmTotauxVehicules ?? 0) * 40),
  );
});

test("les péages se totalisent par aller-retour et par véhicule", () => {
  const r = calculerCoutDeplacement({
    siege: SIEGE_SITUE,
    chantier: CHANTIER_SITUE,
    hypotheses: hypotheses({
      effectif: 4,
      joursChantier: 5,
      nombreDeVehicules: 2,
      tempsAllerMinutesFourni: 46,
      peagesAllerRetourCents: connu(320, "saisi pour ce chantier"),
    }),
  });

  assert.equal(r.peagesCents.connu, true);
  if (!r.peagesCents.connu) return;
  assert.equal(r.peagesCents.valeur, 320 * 5 * 2);
});

test("un péage nul saisi reste un zéro, il n'est pas pris pour une absence", () => {
  const r = calculerCoutDeplacement({
    siege: SIEGE_SITUE,
    chantier: CHANTIER_SITUE,
    hypotheses: hypotheses({
      effectif: 4,
      joursChantier: 5,
      nombreDeVehicules: 1,
      tempsAllerMinutesFourni: 46,
      peagesAllerRetourCents: connu(0, "aucune autoroute sur le trajet"),
    }),
  });

  assert.equal(r.peagesCents.connu, true);
  if (!r.peagesCents.connu) return;
  assert.equal(r.peagesCents.valeur, 0);
  assert.ok(r.coutTotal.postesRetenus.includes("peages"));
});

test("un total partiel s'annonce partiel", () => {
  const r = calculerCoutDeplacement({
    siege: SIEGE_SITUE,
    chantier: CHANTIER_SITUE,
    hypotheses: hypotheses({
      effectif: 4,
      joursChantier: 5,
      nombreDeVehicules: 1,
      tempsAllerMinutesFourni: 46,
      tauxHoraireCents: connu(2500, "coût horaire médian"),
    }),
  });

  assert.equal(r.coutTotal.complet, false);
  assert.equal(r.coutTotal.totalCents, 76_667);
  assert.deepEqual(r.coutTotal.postesRetenus, ["heuresHumaines"]);
  assert.deepEqual(r.coutTotal.postesManquants, ["vehicule", "peages"]);
});

test("tous les postes connus donnent un total complet", () => {
  const r = calculerCoutDeplacement({
    siege: SIEGE_SITUE,
    chantier: CHANTIER_SITUE,
    hypotheses: hypotheses({
      effectif: 4,
      joursChantier: 5,
      nombreDeVehicules: 1,
      tempsAllerMinutesFourni: 46,
      tauxHoraireCents: connu(2500, "coût horaire médian"),
      coutVehiculeParKmCents: connu(40, "entretien observé"),
      peagesAllerRetourCents: connu(0, "aucune autoroute"),
    }),
  });

  assert.equal(r.coutTotal.complet, true);
  assert.deepEqual(r.coutTotal.postesManquants, []);
  if (!r.coutHumainCents.connu || !r.coutVehiculeCents.connu || !r.peagesCents.connu) {
    assert.fail("les trois postes devraient être connus");
  }
  assert.equal(
    r.coutTotal.totalCents,
    r.coutHumainCents.valeur + r.coutVehiculeCents.valeur + r.peagesCents.valeur,
  );
});

// ============================================================
// 4. Les bords
// ============================================================

test("un effectif ou une durée à zéro est une case vide, pas une équipe fantôme", () => {
  const r = calculerCoutDeplacement({
    siege: SIEGE_SITUE,
    chantier: CHANTIER_SITUE,
    hypotheses: hypotheses({ effectif: 0, joursChantier: 0, tempsAllerMinutesFourni: 46 }),
  });
  assert.equal(r.heuresHumaines.connu, false);
  assert.equal(r.trajets.connu, false);
});

test("un trajet de zéro minute est une réponse, pas une absence de réponse", () => {
  const r = calculerCoutDeplacement({
    siege: SIEGE_SITUE,
    chantier: CHANTIER_SITUE,
    hypotheses: hypotheses({ effectif: 3, joursChantier: 2, tempsAllerMinutesFourni: 0 }),
  });
  assert.equal(r.temps.connu, true);
  if (!r.temps.connu || !r.heuresHumaines.connu) assert.fail("le zéro saisi devait être retenu");
  assert.equal(r.temps.valeur.origine, "fourniParLUtilisateur");
  assert.equal(r.heuresHumaines.valeur.heures, 0);
});

test("un devis plus généreux que le besoin est signalé, mais dans l'autre sens", () => {
  const r = calculerCoutDeplacement({
    siege: SIEGE_SITUE,
    chantier: CHANTIER_SITUE,
    hypotheses: hypotheses({
      effectif: 1,
      joursChantier: 1,
      tempsAllerMinutesFourni: 30,
      heuresDeplacementDevisees: connu(10, "devis"),
    }),
  });
  assert.equal(r.comparaisonAuDevis.verdict, "devisSuperieurAuBesoin");
});

test("un écart relatif énorme sur un petit chantier n'alerte pas : le seuil absolu tient", () => {
  // 1 personne, 1 jour, 30 min → 1 h estimée contre 30 min devisées.
  // 100 % d'écart, mais une demi-heure : alerter ici, c'est alerter
  // sur tous les chantiers d'une journée.
  const r = calculerCoutDeplacement({
    siege: SIEGE_SITUE,
    chantier: CHANTIER_SITUE,
    hypotheses: hypotheses({
      effectif: 1,
      joursChantier: 1,
      tempsAllerMinutesFourni: 30,
      heuresDeplacementDevisees: connu(0.5, "devis"),
    }),
  });
  assert.equal(r.comparaisonAuDevis.verdict, "coherent");
});

test("un écart absolu de deux heures sur trente n'alerte pas : le seuil relatif tient", () => {
  const r = calculerCoutDeplacement({
    siege: SIEGE_SITUE,
    chantier: CHANTIER_SITUE,
    hypotheses: hypotheses({
      effectif: 4,
      joursChantier: 5,
      tempsAllerMinutesFourni: 46,
      heuresDeplacementDevisees: connu(28, "devis"),
    }),
  });
  // 30 h 40 − 28 h = 2 h 40 : au-dessus du seuil absolu, très en
  // dessous du seuil relatif de 20 %.
  assert.equal(r.comparaisonAuDevis.verdict, "coherent");
});

test("un écart faible ne déclenche aucune alerte", () => {
  const r = calculerCoutDeplacement({
    siege: SIEGE_SITUE,
    chantier: CHANTIER_SITUE,
    hypotheses: hypotheses({
      effectif: 4,
      joursChantier: 5,
      tempsAllerMinutesFourni: 46,
      heuresDeplacementDevisees: connu(29, "devis"),
    }),
  });
  assert.equal(r.comparaisonAuDevis.verdict, "coherent");
});

test("les durées se lisent en heures et minutes", () => {
  assert.equal(formatHeuresMinutes(1840 / 60), "30 h 40");
  assert.equal(formatHeuresMinutes(10), "10 h");
  assert.equal(formatHeuresMinutes(0), "0 h");
  assert.equal(formatHeuresMinutes(1.5), "1 h 30");
  assert.equal(formatHeuresMinutes(0.1), "0 h 06");
});
