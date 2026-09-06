import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CARACTERES_CODE39,
  DELIMITEUR_CODE39,
  encoderCode39,
  estEncodableCode39,
  moduleCode39Mm,
  motifsCode39,
  normaliserPourCode39,
} from "./code39.ts";

/**
 * COMMENT ON VÉRIFIE UNE TABLE RECOPIÉE SANS SOURCE SOUS LA MAIN.
 *
 * Trois filtres, et c'est exactement pour cela que Code 39 a été
 * préféré à Code 128 :
 *
 *   1. LA STRUCTURE. Chaque caractère fait neuf éléments — cinq barres,
 *      quatre espaces — dont exactement trois larges, et ces trois-là
 *      sont soit deux barres et un espace, soit trois espaces. Une
 *      faute de frappe sur un « n » ou un « w » casse cet invariant.
 *   2. L'UNICITÉ. Deux caractères ne peuvent pas partager un motif :
 *      un lecteur ne saurait pas lequel il voit.
 *   3. L'ALLER-RETOUR. Un décodeur écrit dans ce fichier relit les
 *      largeurs de barres produites et retrouve la chaîne.
 *
 * Ce que ces trois filtres NE voient pas : un échange entre deux
 * caractères (si « B » et « C » étaient intervertis, tout resterait
 * cohérent). C'est le risque résiduel, il est assumé, et il ne se
 * vérifie qu'avec une douchette devant une planche imprimée.
 */

test("chaque motif fait neuf éléments dont exactement trois larges", () => {
  const motifs = motifsCode39();
  for (const [caractere, motif] of Object.entries(motifs)) {
    assert.equal(motif.length, 9, `« ${caractere} » : ${motif.length} éléments`);
    assert.match(motif, /^[nw]{9}$/, `« ${caractere} » : caractère de motif inattendu`);
    const larges = [...motif].filter((e) => e === "w").length;
    assert.equal(larges, 3, `« ${caractere} » : ${larges} éléments larges`);
  }
});

test("les trois éléments larges sont soit deux barres et un espace, soit trois espaces", () => {
  for (const [caractere, motif] of Object.entries(motifsCode39())) {
    let barresLarges = 0;
    let espacesLarges = 0;
    for (let i = 0; i < 9; i += 1) {
      if (motif[i] !== "w") continue;
      if (i % 2 === 0) barresLarges += 1;
      else espacesLarges += 1;
    }
    const valide = (barresLarges === 2 && espacesLarges === 1) || (barresLarges === 0 && espacesLarges === 3);
    assert.ok(valide, `« ${caractere} » : ${barresLarges} barres larges, ${espacesLarges} espaces larges`);
  }
});

test("les quarante-quatre motifs sont deux à deux distincts", () => {
  const motifs = Object.values(motifsCode39());
  assert.equal(motifs.length, 44);
  assert.equal(new Set(motifs).size, 44);
});

test("le jeu de caractères est celui de la norme : 43 plus le délimiteur", () => {
  assert.equal(CARACTERES_CODE39.length, 43);
  assert.ok(!CARACTERES_CODE39.includes(DELIMITEUR_CODE39));
  for (const c of "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-. $/+%") {
    assert.ok(CARACTERES_CODE39.includes(c), `« ${c} » manque`);
  }
});

// ------------------------------------------------------------------
// L'ALLER-RETOUR
// ------------------------------------------------------------------

/** Relit les barres produites et retrouve la chaîne encodée. */
function decoder(barres: readonly { debutModules: number; largeurModules: number }[], rapport: number): string {
  const motifs = motifsCode39();
  const inverse = new Map(Object.entries(motifs).map(([c, m]) => [m, c]));
  const forme = (largeur: number) => (Math.abs(largeur - rapport) < 1e-9 ? "w" : "n");

  let texte = "";
  for (let i = 0; i < barres.length; i += 5) {
    const groupe = barres.slice(i, i + 5);
    assert.equal(groupe.length, 5, "un caractère Code 39 compte cinq barres");
    let motif = "";
    for (let b = 0; b < 5; b += 1) {
      motif += forme(groupe[b].largeurModules);
      if (b < 4) {
        // L'espace se déduit du trou entre deux barres.
        const trou = groupe[b + 1].debutModules - (groupe[b].debutModules + groupe[b].largeurModules);
        motif += forme(trou);
      }
    }
    const caractere = inverse.get(motif);
    assert.ok(caractere, `motif inconnu : ${motif}`);
    texte += caractere;
  }
  return texte;
}

test("un code-barres se relit : les numéros de lot du produit", () => {
  for (const valeur of ["LOT-2026-004", "OASIS", "12345", "A", "SERRE 2 / B3", "$100.50", "+ABC%"]) {
    const code = encoderCode39(valeur);
    assert.equal(decoder(code.barres, 2.5), `*${valeur}*`);
  }
});

test("un code-barres se relit à tous les rapports large/étroit admis", () => {
  for (const rapport of [2, 2.25, 2.5, 2.75, 3]) {
    const code = encoderCode39("LOT-2026-004", rapport);
    assert.equal(decoder(code.barres, rapport), "*LOT-2026-004*");
  }
});

test("un rapport hors norme est refusé", () => {
  assert.throws(() => encoderCode39("A", 1.5), /entre 2 et 3/);
  assert.throws(() => encoderCode39("A", 4), /entre 2 et 3/);
});

// ------------------------------------------------------------------
// LA GÉOMÉTRIE
// ------------------------------------------------------------------

test("la largeur totale est celle que la norme prévoit", () => {
  // Par caractère : trois éléments larges (rapport) et six étroits, plus
  // un espace inter-caractère d'un module — sauf après le dernier.
  const rapport = 2.5;
  for (const valeur of ["A", "LOT-2026-004", "0123456789"]) {
    const nb = valeur.length + 2; // les deux délimiteurs
    const attendu = nb * (3 * rapport + 6) + (nb - 1);
    assert.ok(Math.abs(encoderCode39(valeur, rapport).largeurModules - attendu) < 1e-9, valeur);
  }
});

test("les barres ne se chevauchent jamais et restent dans la largeur annoncée", () => {
  const code = encoderCode39("LOT-2026-004");
  let precedent = -1;
  for (const barre of code.barres) {
    assert.ok(barre.debutModules > precedent, "deux barres se chevauchent");
    precedent = barre.debutModules + barre.largeurModules;
  }
  assert.ok(precedent <= code.largeurModules + 1e-9);
});

test("la largeur d'un module étroit dit si une douchette lira", () => {
  const code = encoderCode39("LOT-2026-004");
  // 14 caractères (12 plus les deux délimiteurs) × 13,5 modules, moins
  // le dernier espace inter-caractère : 202 modules étroits.
  assert.equal(code.largeurModules, 202);
  // Sur 26 mm — la largeur de la colonne de texte du modèle Pépinière —
  // cela fait 0,129 mm par module étroit : trop fin pour une douchette
  // de poste, et à la limite du point d'une thermique 203 dpi.
  assert.ok(moduleCode39Mm(code, 26) < 0.19);
  // IL FAUT 38,4 MM POUR ATTEINDRE 0,19 MM. Autrement dit : un
  // code-barres Code 39 de douze caractères ne rentre PAS sur une
  // étiquette de 25 × 15 ni de 40 × 20. C'est un fait à dire au
  // producteur avant qu'il ne dessine son modèle, pas après.
  assert.ok(moduleCode39Mm(code, 38) < 0.19);
  assert.ok(moduleCode39Mm(code, 39) >= 0.19);
});

// ------------------------------------------------------------------
// LA NORMALISATION
// ------------------------------------------------------------------

test("une saisie réelle est normalisée, et la substitution se signale", () => {
  assert.deepEqual(normaliserPourCode39("Lot-2026-004"), { valeur: "LOT-2026-004", modifie: true });
  assert.deepEqual(normaliserPourCode39("LOT-2026-004"), { valeur: "LOT-2026-004", modifie: false });
  // Les accents tombent sur leur lettre de base, pas sur un tiret.
  assert.equal(normaliserPourCode39("Pépinière").valeur, "PEPINIERE");
  // Ce qui n'existe pas en Code 39 devient un tiret, jamais rien.
  assert.equal(normaliserPourCode39("Lot n°4").valeur, "LOT N-4");
  // Le délimiteur ne peut pas entrer dans les données : il fermerait le code.
  assert.equal(normaliserPourCode39("A*B").valeur, "A-B");
});

test("estEncodableCode39 refuse le délimiteur et les minuscules", () => {
  assert.ok(estEncodableCode39("LOT-2026-004"));
  assert.ok(!estEncodableCode39("lot"));
  assert.ok(!estEncodableCode39("A*B"));
  assert.ok(!estEncodableCode39("Pépinière"));
});

test("un caractère impossible atteint quand même l'encodeur : il refuse clairement", () => {
  assert.throws(() => encoderCode39("é"), /n'existe pas en Code 39/);
});
