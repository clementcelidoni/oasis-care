import { test } from "node:test";
import assert from "node:assert/strict";

import {
  avertissements,
  chiffresSeuls,
  manquePourFacturer,
  normaliserTva,
  sirenDepuisSiret,
  tvaFrancaiseAttendue,
  verifierCoherenceSirenSiret,
  verifierSiren,
  verifierSiret,
  verifierTvaIntracom,
  zoneFiscale,
  type IdentiteSaisie,
} from "./identite.ts";

/**
 * LES NUMÉROS D'ESSAI SONT DE VRAIS NUMÉROS PUBLICS.
 *
 * Un jeu de test fabriqué à la main prouverait seulement que le code
 * est cohérent avec lui-même. On prend donc des identifiants publiés :
 * Danone (SIREN 732829320) et le SIREN 356000000 de La Poste, dont les
 * SIRET sont la seule exception connue à la clé de Luhn.
 */
const SIREN_DANONE = "732829320";
const SIRET_DANONE = "73282932000074";
const TVA_DANONE = "FR44732829320";

function identite(patch: Partial<IdentiteSaisie> = {}): IdentiteSaisie {
  return {
    legalName: "DANONE",
    legalForm: "SA",
    siren: SIREN_DANONE,
    siret: SIRET_DANONE,
    vatNumber: TVA_DANONE,
    addressLine1: "17 boulevard Haussmann",
    postalCode: "75009",
    city: "Paris",
    country: "FR",
    ...patch,
  };
}

// ------------------------------------------------------------------
// Normalisation
// ------------------------------------------------------------------

test("un SIRET copié depuis un Kbis, avec ses espaces, est accepté", () => {
  // C'est LA saisie réelle : personne ne retape quatorze chiffres à la
  // suite. Y compris l'espace insécable, que les traitements de texte
  // insèrent tout seuls.
  assert.equal(chiffresSeuls("732 829 320 00074"), SIRET_DANONE);
  assert.equal(chiffresSeuls("732 829 320 00074"), SIRET_DANONE);
  assert.equal(verifierSiret("732 829 320 00074").etat, "valide");
  assert.equal(verifierSiret(" 73282932000074 ").etat, "valide");
});

test("un numéro de TVA se normalise en majuscules sans ponctuation", () => {
  assert.equal(normaliserTva("fr 44 732 829 320"), TVA_DANONE);
});

// ------------------------------------------------------------------
// SIREN / SIRET
// ------------------------------------------------------------------

test("un SIREN publié passe la clé de Luhn", () => {
  assert.equal(verifierSiren(SIREN_DANONE).etat, "valide");
});

test("un SIRET publié passe la clé de Luhn", () => {
  assert.equal(verifierSiret(SIRET_DANONE).etat, "valide");
});

test("un chiffre inversé est attrapé, et le message dit quoi chercher", () => {
  // 732829320 → 732829230 : deux chiffres permutés, longueur correcte.
  const verdict = verifierSiren("732829230");
  assert.equal(verdict.etat, "invalide");
  assert.match(verdict.message ?? "", /clé de contrôle/i);
});

test("un SIRET d'un chiffre faux est refusé", () => {
  assert.equal(verifierSiret("73282932000075").etat, "invalide");
});

test("un SIREN saisi dans le champ SIRET reçoit un message qui l'explique", () => {
  // L'erreur la plus fréquente en pratique, et « 14 chiffres attendus,
  // 9 reçus » n'apprend rien à qui croit avoir saisi le bon numéro.
  const verdict = verifierSiret(SIREN_DANONE);
  assert.equal(verdict.etat, "invalide");
  assert.match(verdict.message ?? "", /SIREN/);
  assert.match(verdict.message ?? "", /numéro d'établissement/);
});

test("un champ vide n'est pas une erreur : il est vide", () => {
  // La différence compte. Un formulaire qui affiche « SIRET invalide »
  // sur un champ jamais touché fait croire à une faute qui n'existe pas.
  assert.equal(verifierSiret("").etat, "vide");
  assert.equal(verifierSiret(null).etat, "vide");
  assert.equal(verifierSiret("   ").etat, "vide");
  assert.equal(verifierSiret("").message, null);
});

test("LA POSTE : ses SIRET ne satisfont pas Luhn et doivent quand même passer", () => {
  // Règle INSEE : pour le SIREN 356000000, c'est la somme des 14
  // chiffres qui doit être un multiple de 5, et non la clé de Luhn.
  // Sans ce cas particulier, tout bureau de poste client se verrait
  // refuser un SIRET parfaitement valide, sans qu'aucun écran ne puisse
  // expliquer pourquoi.
  const siretLaPoste = "35600000049837";

  // Le cas d'essai ne prouverait RIEN s'il passait aussi Luhn : on
  // vérifie donc d'abord qu'il discrimine bien les deux règles.
  const somme = [...siretLaPoste].reduce((t, c) => t + Number(c), 0);
  assert.equal(somme % 5, 0, "le cas d'essai doit satisfaire la règle de La Poste");
  assert.equal(
    verifierSiret("35600000049838").etat,
    "invalide",
    "un voisin qui ne satisfait ni Luhn ni la règle de La Poste doit être refusé",
  );

  assert.equal(verifierSiret(siretLaPoste).etat, "valide");
});

test("le SIREN de La Poste n'est PAS une exception : il satisfait Luhn comme les autres", () => {
  // L'exception ne porte que sur les SIRET. Un cas particulier écrit
  // « au cas où » sur le SIREN serait un trou dans le contrôle.
  assert.equal(verifierSiren("356000000").etat, "valide");
  assert.equal(verifierSiren("356000001").etat, "invalide");
});

test("le SIREN se déduit du SIRET, et seulement d'un SIRET complet", () => {
  assert.equal(sirenDepuisSiret(SIRET_DANONE), SIREN_DANONE);
  assert.equal(sirenDepuisSiret("7328293200007"), null);
});

test("un SIREN qui contredit le SIRET est signalé, avec les deux valeurs", () => {
  const verdict = verifierCoherenceSirenSiret("404833048", SIRET_DANONE);
  assert.equal(verdict.etat, "invalide");
  assert.match(verdict.message ?? "", /732829320/);
  assert.match(verdict.message ?? "", /404833048/);
});

test("SIREN et SIRET cohérents ne produisent aucun message", () => {
  const verdict = verifierCoherenceSirenSiret(SIREN_DANONE, SIRET_DANONE);
  assert.equal(verdict.etat, "valide");
  assert.equal(verdict.message, null);
});

// ------------------------------------------------------------------
// TVA
// ------------------------------------------------------------------

test("la clé de TVA française se recalcule à partir du SIREN", () => {
  // (12 + 3 × (732829320 mod 97)) mod 97 = 44
  assert.equal(tvaFrancaiseAttendue(SIREN_DANONE), TVA_DANONE);
});

test("la clé de TVA est toujours sur deux caractères, même quand elle est petite", () => {
  // Un padStart manquant produirait « FR9123456782 » — douze caractères
  // au lieu de treize — et la facture porterait un numéro faux.
  for (const s9 of ["000000000", "000000097", "111111111", "222222222"]) {
    const numero = tvaFrancaiseAttendue(s9);
    assert.equal(numero?.length, 13, `${s9} doit donner 13 caractères`);
    assert.match(numero ?? "", /^FR\d{2}\d{9}$/);
  }
});

test("un numéro de TVA français juste est validé", () => {
  assert.equal(verifierTvaIntracom(TVA_DANONE, "FR", SIREN_DANONE).etat, "valide");
});

test("une clé de TVA française fausse rend « invérifiable », pas « invalide », et propose la bonne", () => {
  // Quelques numéros anciens portent une clé alphanumérique attribuée
  // avant la formule. Les refuser serait recaler des numéros valides.
  const verdict = verifierTvaIntracom("FR43732829320", "FR", SIREN_DANONE);
  assert.equal(verdict.etat, "inverifiable");
  assert.match(verdict.message ?? "", /FR44732829320/);
});

test("un numéro de TVA français dont le SIREN ne correspond pas est refusé", () => {
  const verdict = verifierTvaIntracom("FR32404833048", "FR", SIREN_DANONE);
  assert.equal(verdict.etat, "invalide");
  assert.match(verdict.message ?? "", /404833048/);
});

test("un numéro étranger sur une adresse française est refusé", () => {
  const verdict = verifierTvaIntracom("BE0403170701", "FR", SIREN_DANONE);
  assert.equal(verdict.etat, "invalide");
  assert.match(verdict.message ?? "", /FR/);
});

test("un numéro étranger bien formé est INVÉRIFIABLE, et le dit", () => {
  // Le point du fichier : « invérifiable » n'est pas « valide ». Afficher
  // une coche verte devant un numéro dont on ne sait rien serait mentir.
  const verdict = verifierTvaIntracom("NL123456789B01", "NL", null);
  assert.equal(verdict.etat, "inverifiable");
  assert.match(verdict.message ?? "", /ne peut pas être vérifiée ici/);
});

test("la Grèce s'écrit EL sur un numéro de TVA et GR en code pays", () => {
  // Sans ce cas particulier, tout numéro grec serait refusé.
  assert.equal(verifierTvaIntracom("EL123456789", "GR", null).etat, "inverifiable");
  assert.equal(verifierTvaIntracom("GR123456789", "GR", null).etat, "invalide");
});

test("un numéro sans préfixe pays est refusé avec une explication", () => {
  const verdict = verifierTvaIntracom("44732829320", "FR", SIREN_DANONE);
  assert.equal(verdict.etat, "invalide");
  assert.match(verdict.message ?? "", /code du pays/);
});

// ------------------------------------------------------------------
// Zone fiscale
// ------------------------------------------------------------------

test("les trois zones sont distinguées, et le défaut est la France", () => {
  assert.equal(zoneFiscale("FR"), "france");
  assert.equal(zoneFiscale("NL"), "unionEuropeenne");
  assert.equal(zoneFiscale("CH"), "horsUnion");
  assert.equal(zoneFiscale("GB"), "horsUnion"); // depuis le Brexit
  assert.equal(zoneFiscale(null), "france");
  assert.equal(zoneFiscale("fr"), "france");
});

// ------------------------------------------------------------------
// Ce qui manque pour facturer
// ------------------------------------------------------------------

test("une entreprise française complète ne manque de rien", () => {
  assert.deepEqual(manquePourFacturer(identite()), []);
});

test("FRANCE : sans SIRET, on ne peut pas facturer — et la raison est dite", () => {
  const manque = manquePourFacturer(identite({ siret: null }));
  assert.equal(manque.length, 1);
  assert.equal(manque[0].champ, "siret");
  assert.match(manque[0].raison, /facture/i);
});

test("FRANCE : un numéro de TVA absent ne bloque PAS", () => {
  // Il se déduit du SIREN, et 0081 n'exige que le SIRET en régime
  // français. Le réclamer serait un champ obligatoire de plus sans
  // aucune conséquence sur la facture.
  assert.deepEqual(manquePourFacturer(identite({ vatNumber: null })), []);
});

test("UNION : c'est le numéro de TVA qui est exigé, pas le SIRET", () => {
  const manque = manquePourFacturer(
    identite({ country: "NL", siret: null, siren: null, vatNumber: null }),
  );
  assert.deepEqual(
    manque.map((m) => m.champ).sort(),
    ["vat_number"],
  );
  assert.match(manque[0].raison, /autoliquidation/i);
});

test("UNION : un numéro simplement invérifiable ne bloque pas la souscription", () => {
  // Sinon aucune entreprise européenne ne pourrait jamais souscrire :
  // la validation VIES n'a pas lieu ici.
  const manque = manquePourFacturer(
    identite({ country: "NL", siret: null, siren: null, vatNumber: "NL123456789B01" }),
  );
  assert.deepEqual(manque, []);
});

test("UNION : un numéro dont le préfixe contredit le pays bloque", () => {
  const manque = manquePourFacturer(
    identite({ country: "NL", siret: null, siren: null, vatNumber: "BE0403170701" }),
  );
  assert.equal(manque.length, 1);
  assert.equal(manque[0].champ, "vat_number");
});

test("HORS UNION : ni SIRET ni numéro de TVA ne sont exigés", () => {
  const manque = manquePourFacturer(
    identite({ country: "CH", siret: null, siren: null, vatNumber: null, postalCode: null }),
  );
  assert.deepEqual(manque, []);
});

test("la dénomination sociale et l'adresse sont exigées partout", () => {
  const manque = manquePourFacturer(
    identite({ country: "CH", legalName: "  ", addressLine1: null, siret: null, siren: null, vatNumber: null }),
  );
  assert.deepEqual(manque.map((m) => m.champ).sort(), ["address_line1", "legal_name"]);
});

test("un SIRET dont la clé est fausse bloque le paiement — c'est une faute de frappe", () => {
  const manque = manquePourFacturer(identite({ siret: "73282932000075" }));
  assert.equal(manque.length, 1);
  assert.equal(manque[0].champ, "siret");
  assert.match(manque[0].raison, /clé de contrôle/i);
});

// ------------------------------------------------------------------
// Avertissements doux
// ------------------------------------------------------------------

test("un SIREN incohérent avec le SIRET est un avertissement, pas un blocage", () => {
  const fiche = identite({ siren: "404833048" });
  assert.deepEqual(manquePourFacturer(fiche), []);
  const doux = avertissements(fiche);
  assert.equal(doux.length, 1);
  assert.match(doux[0], /732829320/);
});

test("une fiche parfaite ne produit aucun avertissement", () => {
  assert.deepEqual(avertissements(identite()), []);
});
