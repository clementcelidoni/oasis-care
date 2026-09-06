import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { lienPdf, lireRequete } from "./planche.ts";
import { PLAFOND_SELECTION } from "./lecture.ts";

/**
 * LA REQUÊTE DE PLANCHE — ce qui voyage dans l'adresse.
 *
 * ══════════════════════════════════════════════════════════════════
 * POURQUOI CETTE LECTURE MÉRITE DES TESTS
 * ══════════════════════════════════════════════════════════════════
 *
 * Tout ce qui décide de la planche vient de l'URL, donc du navigateur,
 * donc de n'importe qui. Trois choses doivent tenir :
 *
 *   • CE QUI N'EST PAS UN IDENTIFIANT EST JETÉ. Ce qui sort d'ici part
 *     dans un `in (…)` PostgREST et dans un nom de fichier PDF.
 *   • LE PLAFOND EST RESPECTÉ AVANT LA BASE. `etiquettes_creer_lot`
 *     lève au-delà de cinq cents, avec un message venu de Postgres ;
 *     on s'arrête donc avant, proprement.
 *   • LES NOMBRES SONT BORNÉS. « copies=99999 » ne doit pas composer
 *     une planche de cent mille étiquettes qui ferait tomber le
 *     serveur — c'est le seul paramètre de cette page qui multiplie le
 *     travail.
 *
 * AUCUN APPEL RÉSEAU : `lireRequete` est une fonction pure.
 */

const UN = "3f2a1b4c-5d6e-7f80-9a1b-2c3d4e5f6071";
const DEUX = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

test("une requête minimale se lit, avec des valeurs par défaut sensées", () => {
  const requete = lireRequete({ source: "nurseryLot", objets: UN });
  assert.ok(requete);
  assert.equal(requete.source, "nurseryLot");
  assert.deepEqual(requete.ids, [UN]);
  // La planche A4 par défaut : c'est le support que tout le monde a.
  assert.equal(requete.support, "a4");
  assert.equal(requete.copies, 1);
  assert.equal(requete.casesSautees, 0);
  assert.equal(requete.traitsDeCoupe, false);
});

test("un gisement inconnu ne rend rien du tout", () => {
  assert.equal(lireRequete({ source: "prixDeVente", objets: UN }), null);
  assert.equal(lireRequete({ objets: UN }), null);
  // `rack` est une valeur d'entity_kind en base, mais aucune table ne
  // porte de rack : il n'y a rien à lister ni à imprimer en lot.
  assert.equal(lireRequete({ source: "rack", objets: UN }), null);
});

test("sans identifiant valide, il n'y a pas de planche", () => {
  assert.equal(lireRequete({ source: "plant", objets: "" }), null);
  assert.equal(lireRequete({ source: "plant" }), null);
  assert.equal(lireRequete({ source: "plant", objets: "coucou,../../etc/passwd" }), null);
});

test("ce qui n'est pas un identifiant est jeté, le reste est gardé", () => {
  const requete = lireRequete({ source: "plant", objets: `${UN},pas-un-uuid,${DEUX}` });
  assert.deepEqual(requete?.ids, [UN, DEUX]);
});

test("un identifiant écrit sans tirets est reconnu — l'adresse est plus courte ainsi", () => {
  const requete = lireRequete({ source: "plant", objets: UN.replace(/-/g, "") });
  assert.deepEqual(requete?.ids, [UN]);
});

test("un doublon n'imprime pas deux fois la même étiquette", () => {
  const requete = lireRequete({ source: "plant", objets: `${UN},${UN},${UN.replace(/-/g, "")}` });
  assert.deepEqual(requete?.ids, [UN]);
});

test("le plafond est celui de la base, et il est appliqué avant elle", () => {
  const beaucoup = Array.from({ length: PLAFOND_SELECTION + 40 }, (_, i) =>
    `${String(i).padStart(8, "0")}-bbbb-cccc-dddd-eeeeeeeeeeee`,
  ).join(",");
  const requete = lireRequete({ source: "plant", objets: beaucoup });
  assert.equal(requete?.ids.length, PLAFOND_SELECTION);
});

test("le plafond du web est bien celui écrit dans la migration", () => {
  // 0090 § 7 : « Trop d'éléments d'un coup : % demandés, 500 au
  // maximum. » Deux bornes différentes donneraient un refus venu de
  // Postgres, illisible pour un pépiniériste.
  const sql = readFileSync(
    join(process.cwd(), "..", "supabase", "migrations", "0090_etiquettes.sql"),
    "utf8",
  );
  const trouve = /array_length\(p_entite_ids, 1\) > (\d+)/.exec(sql);
  assert.ok(trouve, "Le garde-fou de etiquettes_creer_lot a changé de forme.");
  assert.equal(Number(trouve[1]), PLAFOND_SELECTION);
});

test("les exemplaires sont bornés : un paramètre d'URL ne compose pas cent mille étiquettes", () => {
  assert.equal(lireRequete({ source: "plant", objets: UN, copies: "99999" })?.copies, 50);
  assert.equal(lireRequete({ source: "plant", objets: UN, copies: "-4" })?.copies, 1);
  assert.equal(lireRequete({ source: "plant", objets: UN, copies: "coucou" })?.copies, 1);
  assert.equal(lireRequete({ source: "plant", objets: UN, copies: "3" })?.copies, 3);
});

test("sur rouleau, les cases sautées n'ont aucun sens et valent zéro", () => {
  // Une page = une étiquette : il n'y a pas de grille à entamer.
  const requete = lireRequete({
    source: "plant",
    objets: UN,
    support: "rouleau",
    cases_sautees: "12",
  });
  assert.equal(requete?.support, "rouleau");
  assert.equal(requete?.casesSautees, 0);
});

test("sur A4, les cases sautées sont gardées et bornées", () => {
  assert.equal(lireRequete({ source: "plant", objets: UN, cases_sautees: "7" })?.casesSautees, 7);
  assert.equal(lireRequete({ source: "plant", objets: UN, cases_sautees: "9999" })?.casesSautees, 200);
});

test("un support inconnu retombe sur la planche A4, pas sur une erreur", () => {
  assert.equal(lireRequete({ source: "plant", objets: UN, support: "papyrus" })?.support, "a4");
});

test("le texte libre est tronqué : il finit sur une étiquette, pas dans un roman", () => {
  const requete = lireRequete({ source: "plant", objets: UN, texte_libre: "x".repeat(500) });
  assert.equal(requete?.texteLibre.length, 200);
});

test("un format personnalisé se lit en virgule française comme en point", () => {
  assert.equal(
    lireRequete({ source: "plant", objets: UN, largeur_mm: "62,5", hauteur_mm: "41" })?.largeurMm,
    62.5,
  );
  assert.equal(
    lireRequete({ source: "plant", objets: UN, largeur_mm: "62.5", hauteur_mm: "41" })?.hauteurMm,
    41,
  );
  assert.equal(lireRequete({ source: "plant", objets: UN })?.largeurMm, null);
});

test("un paramètre répété ne fait pas dérailler la lecture", () => {
  // Next rend un tableau quand un paramètre apparaît deux fois.
  const requete = lireRequete({ source: ["plant", "nurseryLot"], objets: [UN, DEUX] });
  assert.equal(requete?.source, "plant");
  assert.deepEqual(requete?.ids, [UN]);
});

// ══════════════════════════════════════════════════════════════════
// LE LIEN VERS LE PDF
// ══════════════════════════════════════════════════════════════════

test("le lien PDF reprend les paramètres de la planche", () => {
  const lien = lienPdf({ source: "nurseryLot", objets: UN, support: "rouleau", vide: "" });
  assert.match(lien, /^\/etiquettes\/imprimer\/pdf\?/);
  assert.ok(lien.includes("source=nurseryLot"));
  assert.ok(lien.includes("support=rouleau"));
  // Un paramètre vide n'a rien à faire dans l'adresse.
  assert.equal(lien.includes("vide="), false);
});

test("le téléchargement se demande par un paramètre, pas par une autre route", () => {
  assert.equal(lienPdf({ source: "plant", objets: UN }).includes("telecharger"), false);
  assert.ok(lienPdf({ source: "plant", objets: UN }, true).includes("telecharger=1"));
});
