import { arrondirKm, distanceRoutiereEstimeeKm, distanceVolDoiseauKm, dureeEstimeeMinutes, vitesseMoyenneKmH } from "./distance.ts";
import {
  FACTEUR_SINUOSITE,
  TRAJETS_PAR_JOUR,
  connu,
  formatHeuresMinutes,
  inconnu,
  type ComparaisonAuDevis,
  type Confiance,
  type CoutTotal,
  type DetailDistance,
  type DetailHeuresHumaines,
  type DetailTemps,
  type DetailTrajets,
  type EntreeTravelCost,
  type PeutEtreInconnu,
  type PosteDeCout,
  type ResultatTravelCost,
} from "./types.ts";

/**
 * §11V ÉTAPE 12 — `TravelCostService`.
 *
 * « Company HQ → Customer Site. Calculer : distance,
 * estimatedTravelTime, roundTripDistance, numberOfTrips,
 * employeeTravelHours, vehicleCost, tolls optional. » (spec p. 12)
 *
 * L'EXEMPLE QUI FAIT FOI (spec p. 13) : chantier à Cannes, 46 min du
 * siège, équipe de 4, 5 jours → 30 h 40 de déplacement humain, quand le
 * devis n'en compte que 10 → « ⚠ Sous-chiffrage potentiel ».
 *
 *     46 min × 2 trajets/jour × 5 jours × 4 personnes = 1 840 min = 30 h 40
 *
 * Ce chiffre-là ne dépend NI de la distance NI du modèle de vitesse : il
 * ne dépend que d'un temps de trajet, d'un effectif et d'une durée. D'où
 * la forme de cette fonction — chaque grandeur est calculée
 * indépendamment, et l'absence de l'une n'efface pas les autres. Un
 * chantier dont on ignore l'adresse peut parfaitement rendre ses heures
 * humaines si le patron sait qu'il est à trois quarts d'heure.
 *
 * CE QUI MANQUE SE DIT. Aucune sortie ne vaut zéro par défaut : le
 * nombre de véhicules, le taux horaire, le coût kilométrique et les
 * péages sont soit fournis, soit rendus `inconnu` avec leur motif.
 * Le coût total ne prétend jamais être complet quand il ne l'est pas —
 * il annonce les postes retenus et les postes manquants, et se lit
 * alors comme un plancher.
 *
 * Fonction pure : pas de base, pas de réseau, pas d'horloge.
 */
export function calculerCoutDeplacement(entree: EntreeTravelCost): ResultatTravelCost {
  const { siege, chantier, hypotheses } = entree;
  const avertissements: string[] = [];

  const effectif = entierStrictementPositif(hypotheses.effectif);
  const jours = entierStrictementPositif(hypotheses.joursChantier);
  const vehicules = entierStrictementPositif(hypotheses.nombreDeVehicules);

  // ---------- 1. La distance ----------
  const distance = calculerDistance(siege, chantier);

  // ---------- 2. Le temps de trajet ----------
  const temps = calculerTemps(hypotheses.tempsAllerMinutesFourni, distance);

  // ---------- 3. Les trajets ----------
  const trajets = calculerTrajets(jours, vehicules, distance);

  // ---------- 4. Les heures humaines de déplacement ----------
  const heuresHumaines = calculerHeuresHumaines(temps, effectif, jours);

  // ---------- 5. Le coût humain ----------
  const coutHumainCents = multiplierEnCentimes(
    heuresHumaines.connu ? heuresHumaines.valeur.heures : null,
    hypotheses.tauxHoraireCents,
    heuresHumaines.connu
      ? null
      : inconnu(
          "heuresHumainesInconnues",
          "Sans heures de déplacement, il n'y a rien à multiplier par un taux horaire.",
        ),
    (source) => `heures de déplacement × ${source}`,
  );

  // ---------- 6. Le coût véhicule ----------
  const kmTotaux = trajets.connu ? trajets.valeur.kmTotauxVehicules : null;
  const coutVehiculeCents = multiplierEnCentimes(
    kmTotaux,
    hypotheses.coutVehiculeParKmCents,
    kmTotaux === null
      ? inconnu(
          "kilometrageInconnu",
          "Le kilométrage total suppose une distance, une durée de chantier et un nombre de véhicules ; l'un des trois manque.",
        )
      : null,
    (source) => `kilométrage estimé × ${source}`,
  );

  // ---------- 7. Les péages ----------
  const peagesCents = calculerPeages(hypotheses.peagesAllerRetourCents, jours, vehicules);

  // ---------- 8. Le coût total, complet ou non ----------
  const coutTotal = totaliser({
    heuresHumaines: coutHumainCents,
    vehicule: coutVehiculeCents,
    peages: peagesCents,
  });

  // ---------- 9. La confrontation au devis ----------
  const comparaisonAuDevis = comparerAuDevis(heuresHumaines, hypotheses.heuresDeplacementDevisees);

  // ---------- 10. Ce qu'il faut dire à l'utilisateur ----------
  if (!distance.connu) avertissements.push(distance.explication);
  if (distance.connu && (siege.origine === "centreCommune" || chantier.origine === "centreCommune")) {
    avertissements.push(
      "La distance part du centre de la commune et non de l'adresse exacte : comptez quelques kilomètres d'écart.",
    );
  }
  if (temps.connu && temps.valeur.origine === "estimeDepuisLaDistance") {
    avertissements.push(
      `Temps de trajet estimé à ${temps.valeur.vitesseMoyenneKmH} km/h de moyenne. Si vous connaissez le temps réel, saisissez-le : il remplacera cette estimation.`,
    );
  }
  if (!heuresHumaines.connu) avertissements.push(heuresHumaines.explication);
  if (!hypotheses.tauxHoraireCents.connu) avertissements.push(hypotheses.tauxHoraireCents.explication);
  if (!hypotheses.coutVehiculeParKmCents.connu) {
    avertissements.push(hypotheses.coutVehiculeParKmCents.explication);
  }
  if (!hypotheses.peagesAllerRetourCents.connu) avertissements.push(hypotheses.peagesAllerRetourCents.explication);

  return {
    siege,
    chantier,
    trajetsParJour: TRAJETS_PAR_JOUR,
    distance,
    temps,
    trajets,
    heuresHumaines,
    coutHumainCents,
    coutVehiculeCents,
    peagesCents,
    coutTotal,
    comparaisonAuDevis,
    confiance: evaluerConfiance(heuresHumaines, temps, siege.origine, chantier.origine),
    avertissements,
  };
}

// ============================================================
// Les morceaux
// ============================================================

/**
 * Un entier strictement positif, ou `null`.
 *
 * Zéro personne, zéro jour et zéro véhicule ne sont pas des hypothèses :
 * ce sont des champs vides. On les traite comme absents, sans jamais
 * faire l'inverse — un `0` saisi ailleurs (un péage à zéro, par
 * exemple, sur un trajet sans autoroute) reste un zéro qui compte.
 */
function entierStrictementPositif(valeur: number | null): number | null {
  if (valeur === null || !Number.isFinite(valeur)) return null;
  const entier = Math.round(valeur);
  return entier > 0 ? entier : null;
}

function calculerDistance(
  siege: EntreeTravelCost["siege"],
  chantier: EntreeTravelCost["chantier"],
): PeutEtreInconnu<DetailDistance> {
  if (!siege.coordonnees && !chantier.coordonnees) {
    return inconnu(
      "deuxPointsInconnus",
      "Ni l'adresse du siège ni celle du chantier n'ont pu être situées : aucune distance ne peut être calculée.",
    );
  }
  if (!siege.coordonnees) {
    return inconnu(
      "siegeInconnu",
      "L'adresse du siège n'a pas pu être située. Complétez la fiche entreprise pour obtenir une distance.",
    );
  }
  if (!chantier.coordonnees) {
    return inconnu(
      "chantierInconnu",
      "L'adresse du chantier n'a pas pu être située. Renseignez la ville ou les coordonnées du site pour obtenir une distance.",
    );
  }

  const volDoiseauKm = arrondirKm(distanceVolDoiseauKm(siege.coordonnees, chantier.coordonnees));
  const allerKm = distanceRoutiereEstimeeKm(siege.coordonnees, chantier.coordonnees);

  return connu(
    {
      volDoiseauKm,
      facteurSinuosite: FACTEUR_SINUOSITE,
      allerKm,
      allerRetourKm: arrondirKm(allerKm * 2),
      estimation: true,
      origineDepart: siege.origine,
      origineArrivee: chantier.origine,
    },
    `vol d'oiseau × facteur de détour ${FACTEUR_SINUOSITE.toLocaleString("fr-FR")}`,
  );
}

function calculerTemps(
  minutesFournies: number | null,
  distance: PeutEtreInconnu<DetailDistance>,
): PeutEtreInconnu<DetailTemps> {
  // UN TEMPS SAISI L'EMPORTE TOUJOURS. C'est une observation ; le reste
  // est un modèle. Et zéro minute est une réponse valable — un chantier
  // au pied du dépôt.
  if (minutesFournies !== null && Number.isFinite(minutesFournies) && minutesFournies >= 0) {
    const allerMinutes = Math.round(minutesFournies);
    return connu(
      {
        allerMinutes,
        allerRetourMinutes: allerMinutes * 2,
        origine: "fourniParLUtilisateur",
        vitesseMoyenneKmH: null,
      },
      "temps de trajet saisi",
    );
  }

  if (!distance.connu) {
    return inconnu(
      "aucuneBasePourEstimerLeTemps",
      "Sans distance ni temps saisi, la durée du trajet est inconnue.",
    );
  }

  const allerMinutes = dureeEstimeeMinutes(distance.valeur.allerKm);
  return connu(
    {
      allerMinutes,
      allerRetourMinutes: allerMinutes * 2,
      origine: "estimeDepuisLaDistance",
      vitesseMoyenneKmH: vitesseMoyenneKmH(distance.valeur.allerKm),
    },
    "distance estimée ÷ vitesse moyenne par tranche",
  );
}

function calculerTrajets(
  jours: number | null,
  vehicules: number | null,
  distance: PeutEtreInconnu<DetailDistance>,
): PeutEtreInconnu<DetailTrajets> {
  if (jours === null) {
    return inconnu(
      "dureeChantierInconnue",
      "La durée du chantier n'est pas connue : le nombre de trajets ne peut pas être compté.",
    );
  }

  const trajetsParPersonne = TRAJETS_PAR_JOUR * jours;
  const trajetsVehicules = vehicules === null ? null : trajetsParPersonne * vehicules;
  const kmTotauxVehicules =
    distance.connu && trajetsVehicules !== null
      ? arrondirKm(distance.valeur.allerKm * trajetsVehicules)
      : null;

  return connu(
    { trajetsParPersonne, trajetsVehicules, nombreDeVehicules: vehicules, kmTotauxVehicules },
    `${TRAJETS_PAR_JOUR} trajets par jour × ${jours} jour(s)`,
  );
}

function calculerHeuresHumaines(
  temps: PeutEtreInconnu<DetailTemps>,
  effectif: number | null,
  jours: number | null,
): PeutEtreInconnu<DetailHeuresHumaines> {
  const manquants: string[] = [];
  if (!temps.connu) manquants.push("le temps de trajet");
  if (effectif === null) manquants.push("l'effectif de l'équipe");
  if (jours === null) manquants.push("la durée du chantier");

  if (!temps.connu || effectif === null || jours === null) {
    return inconnu(
      "hypothesesIncompletes",
      `Heures de déplacement inconnues : il manque ${manquants.join(", ")}. ` +
        "Ce n'est pas zéro heure, c'est une information absente.",
    );
  }

  const minutes = temps.valeur.allerMinutes * TRAJETS_PAR_JOUR * jours * effectif;
  const heures = minutes / 60;

  return connu(
    { heures, libelle: formatHeuresMinutes(heures), effectif, joursChantier: jours },
    `${temps.valeur.allerMinutes} min × ${TRAJETS_PAR_JOUR} trajets × ${jours} jour(s) × ${effectif} personne(s)`,
  );
}

/**
 * Une quantité multipliée par un prix unitaire, en centimes entiers.
 *
 * L'arrondi n'a lieu qu'à la fin, sur le produit : arrondir le taux
 * horaire puis multiplier par trente heures déplacerait le total de
 * plusieurs euros.
 */
function multiplierEnCentimes(
  quantite: number | null,
  prixUnitaire: PeutEtreInconnu<number>,
  absenceDeQuantite: PeutEtreInconnu<number> | null,
  decrireSource: (source: string) => string,
): PeutEtreInconnu<number> {
  if (absenceDeQuantite !== null && !absenceDeQuantite.connu) return absenceDeQuantite;
  if (quantite === null) {
    return inconnu("quantiteInconnue", "La quantité à valoriser n'est pas connue.");
  }
  if (!prixUnitaire.connu) return prixUnitaire;
  return connu(Math.round(quantite * prixUnitaire.valeur), decrireSource(prixUnitaire.source));
}

function calculerPeages(
  peagesAllerRetourCents: PeutEtreInconnu<number>,
  jours: number | null,
  vehicules: number | null,
): PeutEtreInconnu<number> {
  if (!peagesAllerRetourCents.connu) return peagesAllerRetourCents;
  if (jours === null || vehicules === null) {
    return inconnu(
      "assietteDesPeagesInconnue",
      "Le montant des péages est connu par aller-retour, mais la durée du chantier ou le nombre de véhicules manque pour le totaliser.",
    );
  }
  return connu(
    peagesAllerRetourCents.valeur * jours * vehicules,
    `${peagesAllerRetourCents.source} × ${jours} jour(s) × ${vehicules} véhicule(s)`,
  );
}

/**
 * La somme des postes CONNUS, et la liste de ceux qui manquent.
 *
 * On ne rend pas un total qui aurait l'air complet en n'ayant qu'un
 * poste sur trois. On rend un total, et à côté ce qu'il ne contient
 * pas — charge à l'écran d'écrire « au moins », ce qu'il fait.
 */
function totaliser(postes: Record<PosteDeCout, PeutEtreInconnu<number>>): CoutTotal {
  const retenus: PosteDeCout[] = [];
  const manquants: PosteDeCout[] = [];
  let total = 0;

  for (const nom of ["heuresHumaines", "vehicule", "peages"] as PosteDeCout[]) {
    const poste = postes[nom];
    if (poste.connu) {
      total += poste.valeur;
      retenus.push(nom);
    } else {
      manquants.push(nom);
    }
  }

  return {
    complet: manquants.length === 0,
    totalCents: retenus.length === 0 ? null : total,
    postesRetenus: retenus,
    postesManquants: manquants,
  };
}

/**
 * « Le devis actuel ne contient que 10 h → ⚠ Sous-chiffrage potentiel. »
 *
 * LE SEUIL EST DOUBLE, et volontairement. Un écart relatif seul ferait
 * hurler sur un chantier d'une demi-journée où l'on passe de 40 min à
 * 1 h de déplacement ; un écart absolu seul laisserait passer 100 h
 * contre 90 h sur un gros chantier. On alerte quand les deux sont
 * franchis : plus de 20 % ET plus de deux heures.
 *
 * Le sens inverse est signalé aussi, mais plus tard (moitié en plus) :
 * facturer du déplacement en trop est une erreur commerciale, pas une
 * perte d'argent, et une alerte trop bavarde ne se lit plus.
 */
const ECART_RELATIF_ALERTE = 0.2;
const ECART_ABSOLU_ALERTE_HEURES = 2;

function comparerAuDevis(
  heuresHumaines: PeutEtreInconnu<DetailHeuresHumaines>,
  heuresDevisees: PeutEtreInconnu<number>,
): ComparaisonAuDevis {
  if (!heuresHumaines.connu) {
    return {
      verdict: "insufficientData",
      heuresEstimees: null,
      heuresDevisees: heuresDevisees.connu ? heuresDevisees.valeur : null,
      ecartHeures: null,
      explication: heuresHumaines.explication,
    };
  }
  if (!heuresDevisees.connu) {
    return {
      verdict: "insufficientData",
      heuresEstimees: heuresHumaines.valeur.heures,
      heuresDevisees: null,
      ecartHeures: null,
      explication: heuresDevisees.explication,
    };
  }

  const estimees = heuresHumaines.valeur.heures;
  const devisees = heuresDevisees.valeur;
  const ecart = estimees - devisees;

  if (ecart > ECART_ABSOLU_ALERTE_HEURES && ecart > estimees * ECART_RELATIF_ALERTE) {
    return {
      verdict: "sousChiffragePotentiel",
      heuresEstimees: estimees,
      heuresDevisees: devisees,
      ecartHeures: ecart,
      explication:
        `Le déplacement estimé représente ${formatHeuresMinutes(estimees)} de temps humain, ` +
        `quand le devis en compte ${formatHeuresMinutes(devisees)} : ` +
        `${formatHeuresMinutes(ecart)} ne sont pas chiffrées.`,
    };
  }

  if (devisees > estimees * 1.5 && -ecart > ECART_ABSOLU_ALERTE_HEURES) {
    return {
      verdict: "devisSuperieurAuBesoin",
      heuresEstimees: estimees,
      heuresDevisees: devisees,
      ecartHeures: ecart,
      explication:
        `Le devis compte ${formatHeuresMinutes(devisees)} de déplacement pour ` +
        `${formatHeuresMinutes(estimees)} estimées. Vérifiez que ce n'est pas une saisie en double.`,
    };
  }

  return {
    verdict: "coherent",
    heuresEstimees: estimees,
    heuresDevisees: devisees,
    ecartHeures: ecart,
    explication:
      `Le devis compte ${formatHeuresMinutes(devisees)} de déplacement pour ` +
      `${formatHeuresMinutes(estimees)} estimées : l'écart reste dans la marge du modèle.`,
  };
}

function evaluerConfiance(
  heuresHumaines: PeutEtreInconnu<DetailHeuresHumaines>,
  temps: PeutEtreInconnu<DetailTemps>,
  origineSiege: string,
  origineChantier: string,
): Confiance {
  if (!heuresHumaines.connu || !temps.connu) return "insufficient_data";
  // Un temps observé ne dépend d'aucun de nos modèles.
  if (temps.valeur.origine === "fourniParLUtilisateur") return "high";
  // Estimation : deux approximations empilées, la distance et la vitesse.
  const adressesPrecises =
    origineSiege === "coordonneesSaisies" && origineChantier === "coordonneesSaisies";
  return adressesPrecises ? "medium" : "low";
}
