import assert from "node:assert/strict";
import { test } from "node:test";

import {
  estEnvoyable,
  ligneDAccroche,
  paragraphes,
  rendreApercu,
  verifierBrouillon,
} from "./apercu.ts";

/**
 * ==================================================================
 * CE QUE CES TESTS PROTÈGENT
 * ==================================================================
 *
 * UNE SEULE CHOSE, ET ELLE VAUT LE FICHIER ENTIER : qu'un texte
 * contenant encore une variable ne puisse pas partir à tout le parc.
 * « Bonjour {{prenom}} » envoyé à cinq cents entreprises est le défaut
 * le plus embarrassant de ce chantier, il ne coûte rien à empêcher, et
 * il est invisible à la relecture d'un formulaire.
 *
 * Le reste — le découpage en paragraphes, la longueur de l'objet — est
 * vérifié parce que c'est gratuit une fois le fichier importé.
 *
 * CE QUE CES TESTS NE PROTÈGENT PAS, et il faut le savoir : ils ne
 * garantissent pas que l'aperçu ressemble au message réellement
 * expédié. Le rendu qui fait foi vit dans
 * `web-pro/lib/email/gabarits/catalogue.ts`, dans une autre application
 * Next, et ce fichier en est un MIROIR. Le jour où le gabarit change de
 * forme, ces tests continueront de passer et l'aperçu mentira. La seule
 * vraie correction est un rendu unique, partagé — elle est notée dans
 * le compte rendu de ce lot.
 */

const BROUILLON_SAIN = {
  titre: "Nouveauté : les devis se signent en ligne",
  objet: "Vos devis se signent maintenant en ligne",
  corps: "Vos clients peuvent désormais accepter un devis d'un clic.\n\nBonne journée.",
  motif: "Annonce de la signature en ligne, décidée en comité produit du 2 septembre.",
};

test("un brouillon complet et sans variable est envoyable", () => {
  const problemes = verifierBrouillon(BROUILLON_SAIN);
  assert.equal(estEnvoyable(problemes), true);
  assert.equal(
    problemes.filter((probleme) => probleme.gravite === "bloquant").length,
    0,
  );
});

test("une variable en accolades doubles BLOQUE l'envoi", () => {
  const problemes = verifierBrouillon({
    ...BROUILLON_SAIN,
    corps: "Bonjour {{prenom}}, voici notre nouveauté.",
  });

  assert.equal(estEnvoyable(problemes), false);
  const bloquant = problemes.find(
    (probleme) => probleme.gravite === "bloquant" && probleme.champ === "corps",
  );
  assert.ok(bloquant, "le corps doit porter un problème bloquant");
  assert.match(bloquant.phrase, /\{\{prenom\}\}/);
});

test("une variable en accolades doubles dans l'OBJET bloque aussi", () => {
  // L'objet est le premier mot que le destinataire lit, et le seul que
  // beaucoup liront. Une variable non remplie y est plus visible
  // qu'ailleurs, donc plus coûteuse.
  const problemes = verifierBrouillon({ ...BROUILLON_SAIN, objet: "Bonjour {{entreprise}}" });
  assert.equal(estEnvoyable(problemes), false);
  assert.ok(
    problemes.some((probleme) => probleme.champ === "objet" && probleme.gravite === "bloquant"),
  );
});

test("la forme ${…} bloque aussi : rien ne la remplace non plus", () => {
  const problemes = verifierBrouillon({ ...BROUILLON_SAIN, corps: "Bonjour ${nom}," });
  assert.equal(estEnvoyable(problemes), false);
});

test("une accolade SIMPLE est une réserve, pas un blocage", () => {
  // Bloquer dessus finirait par apprendre à contourner la
  // vérification : une accolade simple peut être du texte légitime.
  const problemes = verifierBrouillon({
    ...BROUILLON_SAIN,
    corps: "Le tarif {inchangé} reste celui de janvier.",
  });

  assert.equal(estEnvoyable(problemes), true);
  assert.ok(problemes.some((probleme) => probleme.gravite === "reserve"));
});

test("un motif vide bloque — la base le refuserait de toute façon", () => {
  const problemes = verifierBrouillon({ ...BROUILLON_SAIN, motif: "   " });
  assert.equal(estEnvoyable(problemes), false);
  assert.ok(problemes.some((probleme) => probleme.champ === "motif"));
});

test("un objet vide bloque, un objet long est seulement une réserve", () => {
  assert.equal(estEnvoyable(verifierBrouillon({ ...BROUILLON_SAIN, objet: "" })), false);

  const long = "a".repeat(120);
  const problemes = verifierBrouillon({ ...BROUILLON_SAIN, objet: long });
  assert.equal(estEnvoyable(problemes), true);
  assert.ok(problemes.some((probleme) => probleme.gravite === "reserve"));
});

test("un objet de plus de 300 caractères bloque, comme la contrainte de la base", () => {
  const problemes = verifierBrouillon({ ...BROUILLON_SAIN, objet: "a".repeat(301) });
  assert.equal(estEnvoyable(problemes), false);
});

test("un retour à la ligne dans l'objet bloque — c'est une injection d'en-tête", () => {
  const problemes = verifierBrouillon({
    ...BROUILLON_SAIN,
    objet: "Nouveauté\r\nBcc: quelquun@ailleurs.fr",
  });
  assert.equal(estEnvoyable(problemes), false);
});

test("le corps se découpe en paragraphes sur les lignes vides, sans bloc vide", () => {
  assert.deepEqual(paragraphes("Un.\n\n\n  \n\nDeux.\n"), ["Un.", "Deux."]);
  assert.deepEqual(paragraphes("   "), []);
});

test("l'aperçu commence par la ligne d'accroche, avec le VRAI nom", () => {
  const lignes = rendreApercu("Jardins Dupont", "Première.\n\nSeconde.");
  assert.deepEqual(lignes, ["Bonjour Jardins Dupont,", "Première.", "Seconde."]);
  assert.equal(ligneDAccroche("Jardins Dupont"), "Bonjour Jardins Dupont,");
});
