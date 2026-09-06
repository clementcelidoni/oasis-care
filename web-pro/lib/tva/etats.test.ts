import { test } from "node:test";
import assert from "node:assert/strict";

import {
  etatValidationTva,
  formaterDateFr,
  type EntreeEtatTva,
  type ProfilTvaLu,
} from "./etats.ts";

/**
 * CE QUE CES TESTS DÉFENDENT VRAIMENT.
 *
 * Pas des chaînes de caractères : des DISTINCTIONS. Un écran qui
 * afficherait la même phrase pour « nous réessayons » et pour « votre
 * numéro n'est pas reconnu » fonctionnerait parfaitement, ne
 * signalerait aucune erreur, et ferait modifier un numéro juste à un
 * client dont le registre national était simplement en panne.
 *
 * D'où deux assertions qui ne ressemblent pas aux autres, en fin de
 * fichier : les quatre phrases sont deux à deux différentes, et aucune
 * n'accuse le client quand ce n'est pas lui qui est en cause.
 */

function profil(patch: Partial<ProfilTvaLu> = {}): ProfilTvaLu {
  return {
    viesStatus: null,
    vatNumberValidatedAt: null,
    validationSource: null,
    viesLastAttemptAt: null,
    viesNextAttemptAt: null,
    viesAttempts: 0,
    viesLastError: null,
    viesConsultationNumber: null,
    vatNumberChecked: null,
    ...patch,
  };
}

function belge(patch: Partial<EntreeEtatTva> = {}): EntreeEtatTva {
  return {
    zone: "unionEuropeenne",
    numero: "BE0123456789",
    profil: null,
    ...patch,
  };
}

// ==================================================================
// 1. LES DATES
// ==================================================================

test("les dates s'écrivent à l'heure de Paris, pas en UTC", () => {
  // 23 h 30 UTC le 12 mars, c'est déjà le 13 à Paris. Afficher le 12
  // ferait annoncer un essai « hier ».
  assert.equal(formaterDateFr("2026-03-12T23:30:00Z"), "13/03/2026");
  assert.equal(formaterDateFr("2026-03-12T23:30:00Z", true), "13/03/2026 à 00:30");
});

test("une date illisible ne s'affiche pas plutôt que de s'afficher de travers", () => {
  assert.equal(formaterDateFr(null), null);
  assert.equal(formaterDateFr(""), null);
  assert.equal(formaterDateFr("pas une date"), null);
});

// ==================================================================
// 2. LES CAS OÙ VIES N'A RIEN À DIRE
// ==================================================================

test("un client français ne passe pas par VIES et rien ne l'attend", () => {
  const etat = etatValidationTva({ zone: "france", numero: "FR44732829320", profil: null });
  assert.equal(etat.code, "france");
  assert.equal(etat.bloqueLaFacture, false);
  assert.equal(etat.titre.includes("français"), true);
  // Le taux se dit, parce que c'est la question que se pose le lecteur.
  assert.equal(etat.detail?.includes("20 %"), true);
});

test("un client hors Union n'attend aucune vérification", () => {
  const etat = etatValidationTva({ zone: "horsUnion", numero: null, profil: null });
  assert.equal(etat.code, "horsUnion");
  assert.equal(etat.bloqueLaFacture, false);
});

test("dans l'Union sans numéro, la facture est bloquée et on dit pourquoi", () => {
  const etat = etatValidationTva(belge({ numero: null }));
  assert.equal(etat.code, "absent");
  assert.equal(etat.bloqueLaFacture, true);
  assert.equal(etat.detail?.includes("autoliquidation"), true);
});

// ==================================================================
// 3. LES QUATRE PHRASES
// ==================================================================

test("PHRASE 1 — sans profil, la vérification est en cours et l'inscription n'attend pas", () => {
  const etat = etatValidationTva(belge({ profil: null }));
  assert.equal(etat.code, "enCours");
  assert.equal(etat.titre.includes("en cours de vérification"), true);
  assert.equal(etat.detail?.includes("n'attend pas"), true);
  // Bloquée pour la FACTURE, ce qui n'est pas la même chose que bloquée
  // pour l'inscription : c'est toute la nuance du chantier.
  assert.equal(etat.bloqueLaFacture, true);
});

test("PHRASE 2 — validé : la date se dit, et la preuve avec", () => {
  const etat = etatValidationTva(
    belge({
      profil: profil({
        viesStatus: "valide",
        vatNumberValidatedAt: "2026-03-12T09:30:00Z",
        validationSource: "vies",
        viesConsultationNumber: "WAPIAAAAX123",
        vatNumberChecked: "BE0123456789",
      }),
    }),
  );
  assert.equal(etat.code, "valide");
  assert.equal(etat.bloqueLaFacture, false);
  assert.equal(etat.titre.includes("vérifié le 12/03/2026"), true);
  assert.equal(etat.titre.includes("registre européen"), true);
  assert.equal(etat.detail?.includes("WAPIAAAAX123"), true);
});

test("PHRASE 3 — refusé : c'est au client d'agir, et personne ne réessaiera pour lui", () => {
  const etat = etatValidationTva(
    belge({
      profil: profil({
        viesStatus: "refuse",
        viesLastAttemptAt: "2026-03-12T09:30:00Z",
        viesLastError: "Le registre européen ne reconnaît pas ce numéro.",
        vatNumberChecked: "BE0123456789",
        viesAttempts: 1,
      }),
    }),
  );
  assert.equal(etat.code, "refuse");
  assert.equal(etat.bloqueLaFacture, true);
  assert.equal(etat.titre.includes("vérifiez la saisie"), true);
  // Le fait que rien ne repartira tout seul DOIT être dit : c'est la
  // décision de 0089 § 7.e, et un client qui l'ignore attend en vain.
  assert.equal(etat.detail?.includes("automatiquement"), true);
});

test("PHRASE 4 — indisponible : ce n'est ni un refus ni une validation, et rien à corriger", () => {
  const etat = etatValidationTva(
    belge({
      profil: profil({
        viesStatus: "indisponible",
        viesLastAttemptAt: "2026-03-12T09:30:00Z",
        viesNextAttemptAt: "2026-03-12T13:30:00Z",
        viesAttempts: 2,
        viesLastError: "Registre indisponible (MS_UNAVAILABLE).",
        vatNumberChecked: "BE0123456789",
      }),
    }),
  );
  assert.equal(etat.code, "indisponible");
  assert.equal(etat.bloqueLaFacture, true);
  assert.equal(etat.titre.includes("momentanément indisponible"), true);
  assert.equal(etat.detail?.includes("n'est pas en cause"), true);
  assert.equal(etat.detail?.includes("14:30"), true, "l'heure du prochain essai est celle de Paris");
});

test("indisponible sans prochain essai daté reste honnête plutôt que muet", () => {
  const etat = etatValidationTva(
    belge({ profil: profil({ viesStatus: "indisponible", vatNumberChecked: "BE0123456789" }) }),
  );
  assert.equal(etat.code, "indisponible");
  assert.equal(etat.detail?.includes("essai est programmé"), true);
});

// ==================================================================
// 4. LE TROU QUE `vat_number_checked` REFERME
// ==================================================================

test("un numéro modifié depuis le contrôle ne peut plus s'afficher « vérifié »", () => {
  // C'est le trou décrit par le constat : sans cette comparaison,
  // changer de numéro laissait la validation de l'ancien valoir pour le
  // nouveau — à l'écran comme en base.
  const etat = etatValidationTva(
    belge({
      numero: "BE9999999999",
      profil: profil({
        viesStatus: "valide",
        vatNumberValidatedAt: "2026-03-12T09:30:00Z",
        validationSource: "vies",
        vatNumberChecked: "BE0123456789",
      }),
    }),
  );
  assert.equal(etat.code, "enCours");
  assert.equal(etat.detail?.includes("venez de modifier"), true);
  assert.equal(etat.bloqueLaFacture, true);
});

test("la comparaison ignore les espaces et la casse, comme la saisie", () => {
  const etat = etatValidationTva(
    belge({
      numero: "be 0123.456.789",
      profil: profil({
        viesStatus: "valide",
        vatNumberValidatedAt: "2026-03-12T09:30:00Z",
        validationSource: "vies",
        vatNumberChecked: "BE0123456789",
      }),
    }),
  );
  assert.equal(etat.code, "valide");
});

test("une validation humaine sans numéro interrogé reste une validation", () => {
  // `validation_source = 'manual'` : un administrateur a vu la pièce.
  // `vat_number_checked` est alors nul, et le traiter comme un
  // changement afficherait « en cours » sur un geste parfaitement
  // volontaire.
  const etat = etatValidationTva(
    belge({
      profil: profil({
        viesStatus: null,
        vatNumberValidatedAt: "2026-03-12T09:30:00Z",
        validationSource: "manual",
        vatNumberChecked: null,
      }),
    }),
  );
  assert.equal(etat.code, "valide");
  assert.equal(etat.titre.includes("notre équipe"), true);
});

test("« validé » sans date enregistrée n'affiche pas de coche verte", () => {
  // Le déclencheur de 0089 § 7.a interdit cet état en base. S'il
  // apparaissait malgré tout, la vérité honnête est « pas de réponse »,
  // et surtout pas une facturation en autoliquidation présentée comme
  // acquise.
  const etat = etatValidationTva(
    belge({ profil: profil({ viesStatus: "valide", vatNumberChecked: "BE0123456789" }) }),
  );
  assert.equal(etat.code, "enCours");
  assert.equal(etat.bloqueLaFacture, true);
});

test("une date de validation illisible ne fabrique pas une phrase bancale", () => {
  const etat = etatValidationTva(
    belge({
      profil: profil({
        viesStatus: "valide",
        vatNumberValidatedAt: "n'importe quoi",
        validationSource: "vies",
        vatNumberChecked: "BE0123456789",
      }),
    }),
  );
  assert.notEqual(etat.code, "valide");
  assert.equal(etat.titre.includes("null"), false);
  assert.equal((etat.detail ?? "").includes("null"), false);
});

// ==================================================================
// 5. LES DISTINCTIONS ELLES-MÊMES
// ==================================================================

test("les quatre situations donnent quatre phrases différentes", () => {
  const enCours = etatValidationTva(belge({ profil: null }));
  const valide = etatValidationTva(
    belge({
      profil: profil({
        viesStatus: "valide",
        vatNumberValidatedAt: "2026-03-12T09:30:00Z",
        validationSource: "vies",
        vatNumberChecked: "BE0123456789",
      }),
    }),
  );
  const refuse = etatValidationTva(
    belge({ profil: profil({ viesStatus: "refuse", vatNumberChecked: "BE0123456789" }) }),
  );
  const indisponible = etatValidationTva(
    belge({ profil: profil({ viesStatus: "indisponible", vatNumberChecked: "BE0123456789" }) }),
  );

  const titres = [enCours.titre, valide.titre, refuse.titre, indisponible.titre];
  assert.equal(new Set(titres).size, 4, "quatre situations, quatre phrases");
  for (const titre of titres) assert.equal(titre.trim().length > 20, true);
});

test("une panne du registre n'accuse jamais le client", () => {
  const indisponible = etatValidationTva(
    belge({ profil: profil({ viesStatus: "indisponible", vatNumberChecked: "BE0123456789" }) }),
  );
  const texte = `${indisponible.titre} ${indisponible.detail ?? ""}`.toLowerCase();
  // Ces mots-là appartiennent au refus. Les voir ici ferait corriger un
  // numéro parfaitement juste pendant une panne à Bruxelles.
  for (const accusation of ["vérifiez la saisie", "n'est pas reconnu", "invalide"]) {
    assert.equal(texte.includes(accusation), false, `« ${accusation} » n'a rien à faire ici`);
  }
});
