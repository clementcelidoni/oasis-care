import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { JETON_0090, adresseEtiquette, adressesEtiquettes } from "./adresse.ts";

const JETON = "3f8a1c4e9b2d7a604f5e1c8b3d9a2e70";
const BASE = "https://oasisrarecare.fr";

test("l'adresse se compose comme le § 15 la décrit", () => {
  assert.equal(adresseEtiquette(BASE, JETON), `https://oasisrarecare.fr/x/${JETON}`);
  assert.equal(adresseEtiquette("https://oasisrarecare.fr/", JETON), `https://oasisrarecare.fr/x/${JETON}`);
  // Une base qui traîne un chemin ne doit pas le faire entrer dans le
  // QR : chaque caractère de trop se paie en modules.
  assert.equal(adresseEtiquette("https://oasisrarecare.fr/app/", JETON), `https://oasisrarecare.fr/x/${JETON}`);
  assert.equal(adresseEtiquette(BASE, JETON, { chemin: "e" }), `https://oasisrarecare.fr/e/${JETON}`);
});

test("le jeton de la migration 0090 est reconnu, et lui seul est attendu", () => {
  assert.ok(JETON_0090.test(JETON));
  assert.ok(!JETON_0090.test(JETON.toUpperCase()));
  assert.ok(!JETON_0090.test("3f8a1c4e-9b2d-7a60-4f5e-1c8b3d9a2e70"));
});

test("une adresse de base absente est REFUSÉE, en nommant la variable d'environnement", () => {
  for (const vide of ["", "   "]) {
    assert.throws(() => adresseEtiquette(vide, JETON), /OASIS_ETIQUETTES_BASE_URL/);
    assert.throws(() => adresseEtiquette(vide, JETON), /jamais codée en dur/);
  }
});

test("le domaine réservé de la RFC 2606 est refusé — c'est l'erreur qui a tué cinq étiquettes", () => {
  assert.throws(() => adresseEtiquette("https://oasis-care.example", JETON), /RFC 2606/);
  assert.throws(() => adresseEtiquette("https://oasis-care.example", JETON), /morte le jour où on la colle/);
  for (const mauvais of ["https://example", "https://a.invalid", "https://a.test", "https://app.localhost"]) {
    assert.throws(() => adresseEtiquette(mauvais, JETON), /RFC 2606/, mauvais);
  }
});

test("http est refusé : un jeton d'étiquette voyage pendant des années", () => {
  assert.throws(() => adresseEtiquette("http://oasisrarecare.fr", JETON), /doit être en https/);
});

test("une base qui n'est pas une URL est refusée", () => {
  assert.throws(() => adresseEtiquette("oasisrarecare.fr", JETON), /n'est pas une URL valide/);
});

test("un identifiant passé à la place d'un jeton est attrapé", () => {
  // L'erreur qui coûte un tirage papier entier : envoyer l'UUID de la
  // plante au lieu du jeton de son étiquette.
  assert.throws(() => adresseEtiquette(BASE, "3f8a1c4e-9b2d-7a60-4f5e-1c8b3d9a2e70"), /forme d'un jeton/);
  assert.throws(() => adresseEtiquette(BASE, ""), /forme d'un jeton/);
  assert.throws(() => adresseEtiquette(BASE, "abc"), /forme d'un jeton/);
  assert.throws(() => adresseEtiquette(BASE, `${JETON}/../autre`), /forme d'un jeton/);
});

test("un chemin fantaisiste est refusé plutôt que glissé dans l'adresse", () => {
  assert.throws(() => adresseEtiquette(BASE, JETON, { chemin: "a/b" }), /n'est pas utilisable/);
  assert.throws(() => adresseEtiquette(BASE, JETON, { chemin: "é" }), /n'est pas utilisable/);
});

test("un lot de jetons donne un lot d'adresses, dans l'ordre", () => {
  const jetons = [JETON, JETON.replace("3f", "aa"), JETON.replace("3f", "bb")];
  const adresses = adressesEtiquettes(BASE, jetons);
  assert.equal(adresses.length, 3);
  adresses.forEach((a, i) => assert.equal(a, `https://oasisrarecare.fr/x/${jetons[i]}`));
});

/**
 * LE TEST QUI GARDE LA RÈGLE, ET PAS SEULEMENT SON INTENTION.
 *
 * Une règle écrite dans un commentaire d'en-tête se contourne au
 * premier « juste pour dépanner ». Celui-ci relit les fichiers de la
 * bibliothèque et refuse qu'un domaine apparaisse dans du CODE. Les
 * commentaires et les tests ont le droit d'en parler — c'est là qu'on
 * explique le raisonnement ; le code exécutable, non.
 */
test("AUCUN domaine n'est codé en dur dans le code de la bibliothèque", () => {
  const dossier = dirname(fileURLToPath(import.meta.url));
  const suspects = /(oasisrarecare|oasis-care|oasisrare)\.(fr|com|app|example)/i;

  for (const fichier of readdirSync(dossier)) {
    if (!fichier.endsWith(".ts") || fichier.endsWith(".test.ts")) continue;
    const lignes = readFileSync(join(dossier, fichier), "utf8").split("\n");
    let dansUnBloc = false;
    lignes.forEach((ligne, index) => {
      const nue = ligne.trim();
      if (nue.startsWith("/*")) dansUnBloc = true;
      const commentaire = dansUnBloc || nue.startsWith("//") || nue.startsWith("*");
      if (nue.includes("*/")) dansUnBloc = false;
      if (commentaire) return;
      assert.ok(
        !suspects.test(ligne),
        `${fichier}:${index + 1} code un domaine en dur : « ${nue} ». ` +
          `L'adresse arrive par variable d'environnement, sinon une étiquette collée est une étiquette à décoller.`,
      );
    });
  }
});
