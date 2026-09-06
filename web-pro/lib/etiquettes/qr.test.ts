import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CHARSET_ALPHANUMERIQUE,
  MASQUES,
  VERSION_MAX,
  bitsCompteur,
  capaciteBrute,
  capaciteDonnees,
  carteFonctions,
  decoupageBlocs,
  encoderQr,
  entrelacer,
  gfMultiplier,
  gfPuissance,
  informationFormat,
  informationVersion,
  motsDeCodeDonnees,
  penalite,
  reedSolomon,
  tailleMatrice,
  type MatriceQr,
  type NiveauCorrection,
} from "./qr.ts";

/**
 * CE QUE CES TESTS DÉFENDENT.
 *
 * Un encodeur QR écrit à la main peut être PARFAITEMENT COHÉRENT avec
 * lui-même et produire des carrés que personne au monde ne sait lire.
 * C'est le vrai danger, et l'aller-retour seul ne le détecte pas : mon
 * décodeur relirait mes propres erreurs sans broncher.
 *
 * D'où trois ancrages EXTÉRIEURS, qui ne dépendent d'aucune ligne de
 * qr.ts et que je n'ai pas pu ajuster après coup :
 *
 *   1. LES CAPACITÉS PUBLIÉES DE LA NORME. Le nombre total de mots de
 *      code est COMPTÉ sur la matrice (modules libres ÷ 8) ; les tables
 *      de correction sont recopiées. Si l'un OU l'autre est faux, la
 *      soustraction ne rend pas 19/16/13/9, 34/28/22/16, … Deux erreurs
 *      indépendantes devraient se compenser exactement dix fois de
 *      suite pour que ça passe.
 *   2. LE VECTEUR D'ESSAI DE L'ANNEXE — « 01234567 » en 1-M. Il épingle
 *      le flux binaire ET le Reed-Solomon, octet par octet.
 *   3. LA DISTANCE DE HAMMING DU CODE BCH de format : la norme garantit
 *      qu'elle vaut au moins 7 entre deux formats quelconques. Un
 *      polynôme générateur faux la casse immédiatement.
 *
 * L'aller-retour vient PAR-DESSUS, pour ce que les ancrages ne voient
 * pas : le placement en spirale, le masquage, l'entrelacement.
 */

// ==================================================================
// ANCRAGE 1 — LES CAPACITÉS DE LA NORME
// ==================================================================

test("le nombre de mots de code par version, COMPTÉ sur la matrice, est celui de la norme", () => {
  const norme = [26, 44, 70, 100, 134, 172, 196, 242, 292, 346];
  for (let v = 1; v <= VERSION_MAX; v += 1) {
    assert.equal(capaciteBrute(v).motsDeCode, norme[v - 1], `version ${v}`);
  }
});

test("les bits restants inutilisables sont ceux de la norme", () => {
  // 0 en version 1 et 7, 7 partout ailleurs entre 2 et 6 : c'est une
  // conséquence directe du placement des motifs, pas une table.
  const norme = [0, 7, 7, 7, 7, 7, 0, 0, 0, 0];
  for (let v = 1; v <= VERSION_MAX; v += 1) {
    assert.equal(capaciteBrute(v).bitsRestants, norme[v - 1], `version ${v}`);
  }
});

test("les capacités de DONNÉES sont celles publiées par la norme", () => {
  const norme: Record<NiveauCorrection, readonly number[]> = {
    L: [19, 34, 55, 80, 108, 136, 156, 194, 232, 274],
    M: [16, 28, 44, 64, 86, 108, 124, 154, 182, 216],
    Q: [13, 22, 34, 48, 62, 76, 88, 110, 132, 154],
    H: [9, 16, 26, 36, 46, 60, 66, 86, 100, 122],
  };
  for (const niveau of ["L", "M", "Q", "H"] as const) {
    for (let v = 1; v <= VERSION_MAX; v += 1) {
      assert.equal(capaciteDonnees(v, niveau), norme[niveau][v - 1], `version ${v}-${niveau}`);
    }
  }
});

test("les capacités EN CARACTÈRES recoupent celles des tables publiques", () => {
  // Trois nombres que tout le monde peut retrouver ailleurs : le mode
  // octet au niveau M, en versions 3, 4 et 5.
  const octetsMax = (version: number, niveau: NiveauCorrection) =>
    Math.floor((capaciteDonnees(version, niveau) * 8 - 4 - bitsCompteur("octet", version)) / 8);
  assert.equal(octetsMax(3, "M"), 42);
  assert.equal(octetsMax(4, "M"), 62);
  assert.equal(octetsMax(5, "M"), 84);

  // Et le mode alphanumérique, versions 1 à 3 au niveau M.
  const alnumMax = (version: number, niveau: NiveauCorrection) => {
    const bits = capaciteDonnees(version, niveau) * 8 - 4 - bitsCompteur("alphanumerique", version);
    return Math.floor(bits / 11) * 2 + (bits % 11 >= 6 ? 1 : 0);
  };
  assert.equal(alnumMax(1, "M"), 20);
  assert.equal(alnumMax(2, "M"), 38);
  assert.equal(alnumMax(3, "M"), 61);
});

// ==================================================================
// ANCRAGE 2 — LE VECTEUR D'ESSAI DE L'ANNEXE DE LA NORME
// ==================================================================

test("« 01234567 » en 1-M donne les mots de code de l'annexe de la norme", () => {
  const donnees = motsDeCodeDonnees([{ mode: "numerique", texte: "01234567" }], 1, "M");
  assert.deepEqual(
    [...donnees],
    [0x10, 0x20, 0x0c, 0x56, 0x61, 0x80, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11],
  );

  const correction = reedSolomon(donnees, 10);
  assert.deepEqual([...correction], [0xa5, 0x24, 0xd4, 0xc1, 0xed, 0x36, 0xc7, 0x87, 0x2c, 0x55]);
});

test("le corps de Galois est bien GF(256) modulo 0x11D", () => {
  // α⁸ = α⁴ + α³ + α² + 1 = 0b00011101 = 29. C'est la définition même
  // du polynôme primitif choisi par la norme.
  assert.equal(gfPuissance(8), 29);
  assert.equal(gfPuissance(0), 1);
  assert.equal(gfPuissance(255), 1);
  // Le corps est un corps : tout élément non nul a un inverse.
  for (let a = 1; a < 256; a += 1) {
    let inverse = 0;
    for (let b = 1; b < 256; b += 1) if (gfMultiplier(a, b) === 1) inverse = b;
    assert.notEqual(inverse, 0, `${a} n'a pas d'inverse`);
  }
});

// ==================================================================
// ANCRAGE 3 — LES CODES BCH DE FORMAT ET DE VERSION
// ==================================================================

test("les 32 informations de format sont deux à deux distantes d'au moins 7 bits", () => {
  const tous: number[] = [];
  for (const niveau of ["L", "M", "Q", "H"] as const) {
    for (let masque = 0; masque < 8; masque += 1) tous.push(informationFormat(niveau, masque));
  }
  assert.equal(new Set(tous).size, 32);
  let minimum = 15;
  for (let i = 0; i < tous.length; i += 1) {
    for (let j = i + 1; j < tous.length; j += 1) {
      let distance = 0;
      let x = tous[i] ^ tous[j];
      while (x) {
        distance += x & 1;
        x >>>= 1;
      }
      minimum = Math.min(minimum, distance);
    }
  }
  // La norme garantit d ≥ 7 : c'est ce qui permet de corriger trois
  // erreurs sur l'information de format d'un QR abîmé.
  assert.equal(minimum, 7);
  // Et la valeur publiée pour le niveau L avec le masque 0.
  assert.equal(informationFormat("L", 0), 0b111011111000100);
});

test("les informations de version sont distantes d'au moins 8 bits", () => {
  const tous: number[] = [];
  for (let v = 7; v <= 40; v += 1) tous.push(informationVersion(v));
  assert.equal(new Set(tous).size, 34);
  let minimum = 18;
  for (let i = 0; i < tous.length; i += 1) {
    for (let j = i + 1; j < tous.length; j += 1) {
      let distance = 0;
      let x = tous[i] ^ tous[j];
      while (x) {
        distance += x & 1;
        x >>>= 1;
      }
      minimum = Math.min(minimum, distance);
    }
  }
  assert.equal(minimum, 8);
  // 18 bits : 6 de version (000111) suivis de 12 de BCH (110010010100).
  assert.equal(informationVersion(7), 0b000111110010010100);
});

// ==================================================================
// LE DÉCODEUR DE TEST
// ==================================================================
//
// Il ne partage avec l'encodeur que la carte des motifs de fonction et
// les huit masques — deux choses déjà épinglées par l'ancrage 1. Tout
// le reste (lecture du format, parcours en spirale, désentrelacement,
// syndromes, analyse des segments) est réécrit à l'envers.

const NIVEAU_PAR_BITS: Record<number, NiveauCorrection> = { 1: "L", 0: "M", 3: "Q", 2: "H" };

function lireFormat(matrice: MatriceQr): { niveau: NiveauCorrection; masque: number } {
  const n = matrice.taille;
  let brut = 0;
  for (let i = 0; i < 15; i += 1) {
    let bit: boolean;
    if (i < 6) bit = matrice.modules[8][i];
    else if (i === 6) bit = matrice.modules[8][7];
    else if (i === 7) bit = matrice.modules[8][8];
    else if (i === 8) bit = matrice.modules[7][8];
    else bit = matrice.modules[14 - i][8];
    if (bit) brut |= 1 << i;
  }
  // La seconde copie doit dire exactement la même chose.
  let copie = 0;
  for (let i = 0; i < 15; i += 1) {
    const bit = i < 7 ? matrice.modules[n - 1 - i][8] : matrice.modules[8][n - 15 + i];
    if (bit) copie |= 1 << i;
  }
  assert.equal(copie, brut, "les deux copies de l'information de format divergent");

  const demasque = brut ^ 0x5412;
  // Le reste de la division par le générateur BCH doit être nul : sans
  // cette vérification, on croirait lire un format alors qu'on lit du
  // bruit.
  let reste = demasque;
  for (let i = 14; i >= 10; i -= 1) if ((reste >>> i) & 1) reste ^= 0x537 << (i - 10);
  assert.equal(reste, 0, "l'information de format ne vérifie pas son BCH");

  const donnees = demasque >>> 10;
  return { niveau: NIVEAU_PAR_BITS[donnees >>> 3], masque: donnees & 7 };
}

function lireMotsDeCode(matrice: MatriceQr, masque: number): Uint8Array {
  const n = matrice.taille;
  const reserve = carteFonctions(matrice.version);
  const bits: number[] = [];
  for (let colonneDroite = n - 1; colonneDroite >= 1; colonneDroite -= 2) {
    const droite = colonneDroite <= 6 ? colonneDroite - 1 : colonneDroite;
    for (let pas = 0; pas < n; pas += 1) {
      const monte = ((droite + 1) & 2) === 0;
      const y = monte ? n - 1 - pas : pas;
      for (let dx = 0; dx < 2; dx += 1) {
        const x = droite - dx;
        if (reserve[y][x]) continue;
        const valeur = MASQUES[masque](x, y) ? !matrice.modules[y][x] : matrice.modules[y][x];
        bits.push(valeur ? 1 : 0);
      }
    }
  }
  const total = capaciteBrute(matrice.version).motsDeCode;
  const octets = new Uint8Array(total);
  for (let i = 0; i < total * 8; i += 1) if (bits[i]) octets[i >>> 3] |= 0x80 >>> (i & 7);
  return octets;
}

/** Désentrelace et vérifie les syndromes Reed-Solomon de chaque bloc. */
function desentrelacer(brut: Uint8Array, matrice: MatriceQr): Uint8Array {
  const { nbBlocs, nbCorrection, taillesDonnees } = decoupageBlocs(matrice.version, matrice.niveau);
  const blocs: number[][] = Array.from({ length: nbBlocs }, () => []);
  const correction: number[][] = Array.from({ length: nbBlocs }, () => []);

  let k = 0;
  const plusLong = Math.max(...taillesDonnees);
  for (let i = 0; i < plusLong; i += 1) {
    for (let b = 0; b < nbBlocs; b += 1) if (i < taillesDonnees[b]) blocs[b].push(brut[k++]);
  }
  for (let i = 0; i < nbCorrection; i += 1) {
    for (let b = 0; b < nbBlocs; b += 1) correction[b].push(brut[k++]);
  }
  assert.equal(k, brut.length, "le désentrelacement n'a pas consommé tous les mots de code");

  // LE VRAI CONTRÔLE : les syndromes. Un mot Reed-Solomon valide
  // s'annule en α¹ … α^nbCorrection. Si l'entrelacement, le masquage ou
  // le parcours en spirale étaient faux, ils ne s'annuleraient pas.
  for (let b = 0; b < nbBlocs; b += 1) {
    const mot = [...blocs[b], ...correction[b]];
    // LES RACINES SONT α⁰ … α^(t−1), pas α¹ … α^t : le polynôme
    // générateur de la norme QR démarre à α⁰. Se tromper d'un cran rend
    // le DERNIER syndrome non nul sur un mot pourtant parfaitement
    // valide — une fausse alerte très convaincante.
    for (let s = 0; s < nbCorrection; s += 1) {
      let valeur = 0;
      for (const octet of mot) valeur = gfMultiplier(valeur, gfPuissance(s)) ^ octet;
      assert.equal(valeur, 0, `syndrome ${s} non nul sur le bloc ${b}`);
    }
  }
  return Uint8Array.from(blocs.flat());
}

function decoderSegments(donnees: Uint8Array, version: number): string {
  const bits: number[] = [];
  for (const octet of donnees) for (let i = 7; i >= 0; i -= 1) bits.push((octet >>> i) & 1);
  let curseur = 0;
  const prendre = (n: number) => {
    let valeur = 0;
    for (let i = 0; i < n; i += 1) valeur = (valeur << 1) | bits[curseur + i];
    curseur += n;
    return valeur;
  };

  let texte = "";
  for (;;) {
    if (curseur + 4 > bits.length) break;
    const mode = prendre(4);
    if (mode === 0) break; // terminateur
    if (mode === 1) {
      const n = prendre(bitsCompteur("numerique", version));
      for (let i = 0; i < n; i += 3) {
        const reste = Math.min(3, n - i);
        const valeur = prendre(reste * 3 + 1);
        texte += String(valeur).padStart(reste, "0");
      }
    } else if (mode === 2) {
      const n = prendre(bitsCompteur("alphanumerique", version));
      for (let i = 0; i < n; i += 2) {
        if (n - i >= 2) {
          const valeur = prendre(11);
          texte += CHARSET_ALPHANUMERIQUE[Math.floor(valeur / 45)] + CHARSET_ALPHANUMERIQUE[valeur % 45];
        } else {
          texte += CHARSET_ALPHANUMERIQUE[prendre(6)];
        }
      }
    } else if (mode === 4) {
      const n = prendre(bitsCompteur("octet", version));
      const octets = new Uint8Array(n);
      for (let i = 0; i < n; i += 1) octets[i] = prendre(8);
      texte += new TextDecoder().decode(octets);
    } else {
      throw new Error(`mode inconnu : ${mode}`);
    }
  }
  return texte;
}

/** Relit une matrice produite par l'encodeur et rend son contenu. */
function decoder(matrice: MatriceQr): { texte: string; niveau: NiveauCorrection; masque: number } {
  const { niveau, masque } = lireFormat(matrice);
  assert.equal(niveau, matrice.niveau);
  assert.equal(masque, matrice.masque);
  const brut = lireMotsDeCode(matrice, masque);
  const donnees = desentrelacer(brut, matrice);
  return { texte: decoderSegments(donnees, matrice.version), niveau, masque };
}

// ==================================================================
// L'ALLER-RETOUR
// ==================================================================

test("un QR se relit : l'adresse d'étiquette, aux quatre niveaux", () => {
  const adresse = "https://oasisrarecare.fr/x/3f8a1c4e9b2d7a604f5e1c8b3d9a2e70";
  for (const niveau of ["L", "M", "Q", "H"] as const) {
    const matrice = encoderQr(adresse, { niveau });
    assert.equal(decoder(matrice).texte, adresse, `niveau ${niveau}`);
  }
});

test("un QR se relit : 400 jetons tirés au hasard, longueurs et modes mélangés", () => {
  const hex = "0123456789abcdef";
  for (let essai = 0; essai < 200; essai += 1) {
    const longueur = 1 + (essai % 32);
    let jeton = "";
    for (let i = 0; i < longueur; i += 1) jeton += hex[Math.floor(Math.random() * 16)];
    const adresse = `https://oasisrarecare.fr/x/${jeton}`;
    assert.equal(decoder(encoderQr(adresse)).texte, adresse);

    // Le même en majuscules : l'encodeur doit basculer en
    // alphanumérique, et le décodeur le relire pareillement.
    const majuscule = adresse.toUpperCase();
    const matrice = encoderQr(majuscule);
    assert.equal(decoder(matrice).texte, majuscule);
  }
});

test("un QR se relit : tous les masques imposés, sur toutes les versions atteintes", () => {
  const adresse = "https://oasisrarecare.fr/x/3f8a1c4e9b2d7a604f5e1c8b3d9a2e70";
  for (let masque = 0; masque < 8; masque += 1) {
    for (let version = 4; version <= VERSION_MAX; version += 1) {
      const matrice = encoderQr(adresse, { masqueImpose: masque, versionMinimale: version });
      assert.equal(matrice.masque, masque);
      assert.equal(matrice.version, version);
      assert.equal(decoder(matrice).texte, adresse, `masque ${masque}, version ${version}`);
    }
  }
});

test("un QR se relit : de l'accentué, de l'émoji, du texte libre", () => {
  for (const texte of [
    "Trachycarpus fortunei « Wagnerianus »",
    "Lot 2026-004 — étage 3, rack B",
    "Serre nº 2 / bâche ⌀ 4 m",
    "01234567",
    "ABCDEF 123$%*+-./:",
  ]) {
    assert.equal(decoder(encoderQr(texte)).texte, texte, texte);
  }
});

test("un QR se relit : chaîne vide et caractère unique", () => {
  assert.equal(decoder(encoderQr("")).texte, "");
  assert.equal(decoder(encoderQr("A")).texte, "A");
});

// ==================================================================
// LES CHOIX DE L'ENCODEUR
// ==================================================================

test("le mode alphanumérique est choisi quand il est possible, et il gagne une version", () => {
  const jeton = "3F8A1C4E9B2D7A604F5E1C8B3D9A2E70";
  const minuscule = encoderQr(`https://oasisrarecare.fr/x/${jeton.toLowerCase()}`);
  const majuscule = encoderQr(`HTTPS://OASISRARECARE.FR/X/${jeton}`);

  assert.deepEqual([...minuscule.modes], ["octet"]);
  assert.deepEqual([...majuscule.modes], ["alphanumerique"]);
  // 59 caractères : 59 octets ne tiennent pas en version 3-M (42), mais
  // 59 caractères alphanumériques si (61).
  assert.equal(minuscule.version, 4);
  assert.equal(majuscule.version, 3);
});

test("un jeton majuscule derrière une adresse minuscule est coupé en deux segments", () => {
  const matrice = encoderQr("https://oasisrarecare.fr/x/3F8A1C4E9B2D7A60");
  assert.deepEqual([...matrice.modes], ["octet", "alphanumerique"]);
});

test("un contenu trop long est REFUSÉ, avec une phrase qui dit quoi faire", () => {
  // Le drapeau `s` demanderait ES2018 ; la cible du projet est ES2017.
  // `[\s\S]` fait la même chose partout, sans toucher tsconfig.json —
  // un fichier partagé que deux autres chantiers modifient.
  assert.throws(
    () => encoderQr("x".repeat(400)),
    /ne tient pas dans un QR de version 10[\s\S]*raccourcissez le jeton ou le domaine/,
  );
});

test("le masque retenu est bien celui de pénalité minimale", () => {
  const adresse = "https://oasisrarecare.fr/x/3f8a1c4e9b2d7a604f5e1c8b3d9a2e70";
  const choisi = encoderQr(adresse);
  for (let masque = 0; masque < 8; masque += 1) {
    const essai = encoderQr(adresse, { masqueImpose: masque });
    assert.ok(
      penalite(choisi.modules) <= penalite(essai.modules),
      `le masque ${masque} est moins pénalisé que le masque retenu ${choisi.masque}`,
    );
  }
});

// ==================================================================
// LA STRUCTURE DE LA MATRICE
// ==================================================================

test("les trois motifs de recherche sont là, et le module sombre permanent aussi", () => {
  for (let version = 1; version <= VERSION_MAX; version += 1) {
    const m = encoderQr("test", { versionMinimale: version });
    const n = m.taille;
    assert.equal(n, tailleMatrice(version));
    for (const [x0, y0] of [
      [0, 0],
      [n - 7, 0],
      [0, n - 7],
    ]) {
      // Le centre 3 × 3 est sombre, l'anneau qui l'entoure est clair.
      for (let dy = 0; dy < 7; dy += 1) {
        for (let dx = 0; dx < 7; dx += 1) {
          const d = Math.max(Math.abs(dx - 3), Math.abs(dy - 3));
          assert.equal(m.modules[y0 + dy][x0 + dx], d !== 2, `version ${version}, motif (${x0},${y0})`);
        }
      }
    }
    assert.equal(m.modules[n - 8][8], true, `module sombre permanent, version ${version}`);
  }
});

test("les motifs de synchronisation alternent sur toute la ligne 6 et la colonne 6", () => {
  const m = encoderQr("https://oasisrarecare.fr/x/3f8a1c4e9b2d7a604f5e1c8b3d9a2e70", { versionMinimale: 7 });
  for (let i = 8; i < m.taille - 8; i += 1) {
    assert.equal(m.modules[6][i], i % 2 === 0, `ligne 6, colonne ${i}`);
    assert.equal(m.modules[i][6], i % 2 === 0, `colonne 6, ligne ${i}`);
  }
});

test("aucun module de donnée ne déborde sur un motif de fonction", () => {
  // Contrôle indirect mais net : le nombre de positions libres doit
  // valoir exactement 8 × mots de code + bits restants.
  for (let version = 1; version <= VERSION_MAX; version += 1) {
    const carte = carteFonctions(version);
    let libres = 0;
    for (const ligne of carte) for (const r of ligne) if (!r) libres += 1;
    const { motsDeCode, bitsRestants } = capaciteBrute(version);
    assert.equal(libres, motsDeCode * 8 + bitsRestants, `version ${version}`);
  }
});

test("l'entrelacement conserve tous les mots de code, sans doublon ni trou", () => {
  for (const niveau of ["L", "M", "Q", "H"] as const) {
    for (let version = 1; version <= VERSION_MAX; version += 1) {
      const capacite = capaciteDonnees(version, niveau);
      const donnees = new Uint8Array(capacite);
      for (let i = 0; i < capacite; i += 1) donnees[i] = (i * 7 + 3) & 0xff;
      const sortie = entrelacer(donnees, version, niveau);
      assert.equal(sortie.length, capaciteBrute(version).motsDeCode, `version ${version}-${niveau}`);
      // Toutes les données d'entrée doivent se retrouver dans la sortie,
      // avec la bonne multiplicité.
      const compte = new Map<number, number>();
      for (const o of sortie) compte.set(o, (compte.get(o) ?? 0) + 1);
      for (const o of donnees) {
        const restant = compte.get(o) ?? 0;
        assert.ok(restant > 0, `mot de code ${o} perdu en version ${version}-${niveau}`);
        compte.set(o, restant - 1);
      }
    }
  }
});
