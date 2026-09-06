/**
 * LES TROIS MODÈLES FOURNIS PAR OASIS — § 18.
 *
 * « BioLab, Nursery et Jardins doivent pouvoir avoir leurs propres
 *   modèles. »
 *
 * CE FICHIER EST LA COPIE EXACTE des trois modèles semés par la
 * migration 0090 § 8.b, avec `organization_id` à NULL. Pourquoi les
 * dupliquer côté web plutôt que de toujours les lire en base :
 *
 *   • l'aperçu de l'éditeur, la page de démonstration et les tests
 *     doivent fonctionner sans base — « aucun appel réseau dans les
 *     tests » ;
 *   • une entreprise qui n'a encore rien créé doit voir quelque chose
 *     de juste à l'écran avant même le premier aller-retour serveur.
 *
 * ET LA CONTREPARTIE, ASSUMÉE : si 0090 § 8.b change, ce fichier doit
 * changer. Le test `modeles.test.ts` vérifie au moins que les trois
 * modèles sont valides, tiennent dans leurs cotes et se rendent sans
 * avertissement — une divergence de cote se verrait immédiatement.
 */

import type { FamilleEtiquette, ModeleEtiquette } from "./types.ts";

/** Jardins — étiquette botanique 60 × 40, celle qu'on plante en pot. */
const JARDINS: ModeleEtiquette = {
  famille: "jardins",
  nom: "Jardins — étiquette botanique 60 × 40",
  largeurMm: 60,
  hauteurMm: 40,
  margeMm: 2,
  champs: [
    { champ: "nom", x: 2, y: 2, largeur: 34, hauteur: 7, taille: 9, gras: true },
    { champ: "nomScientifique", x: 2, y: 9, largeur: 34, hauteur: 6, taille: 7, italique: true },
    { champ: "cultivar", x: 2, y: 15, largeur: 34, hauteur: 5, taille: 7 },
    { champ: "emplacement", x: 2, y: 21, largeur: 34, hauteur: 5, taille: 6 },
    { champ: "qr", x: 40, y: 6, largeur: 18, hauteur: 18 },
    { champ: "logo", x: 2, y: 32, largeur: 18, hauteur: 6 },
  ],
};

/** Pépinière — étiquette de lot 50 × 30, celle qui suit le stock. */
const PEPINIERE: ModeleEtiquette = {
  famille: "pepiniere",
  nom: "Pépinière — étiquette de lot 50 × 30",
  largeurMm: 50,
  hauteurMm: 30,
  margeMm: 2,
  champs: [
    { champ: "nom", x: 2, y: 2, largeur: 26, hauteur: 6, taille: 8, gras: true },
    { champ: "cultivar", x: 2, y: 8, largeur: 26, hauteur: 5, taille: 7 },
    { champ: "numeroLot", x: 2, y: 13, largeur: 26, hauteur: 5, taille: 7 },
    { champ: "quantite", x: 2, y: 18, largeur: 12, hauteur: 5, taille: 7 },
    { champ: "emplacement", x: 14, y: 18, largeur: 14, hauteur: 5, taille: 7 },
    { champ: "date", x: 2, y: 23, largeur: 26, hauteur: 5, taille: 6 },
    { champ: "qr", x: 30, y: 5, largeur: 18, hauteur: 18 },
  ],
};

/** BioLab — étiquette de lot 40 × 20, celle qui colle sur un bocal. */
const BIOLAB: ModeleEtiquette = {
  famille: "biolab",
  nom: "BioLab — étiquette de lot 40 × 20",
  largeurMm: 40,
  hauteurMm: 20,
  margeMm: 1.5,
  champs: [
    { champ: "numeroLot", x: 1.5, y: 1.5, largeur: 21, hauteur: 5, taille: 7, gras: true },
    { champ: "stade", x: 1.5, y: 6.5, largeur: 21, hauteur: 4, taille: 6 },
    { champ: "date", x: 1.5, y: 10.5, largeur: 21, hauteur: 4, taille: 6 },
    { champ: "quantite", x: 1.5, y: 14.5, largeur: 21, hauteur: 4, taille: 6 },
    // LE CADRE DU QR EST PASSÉ DE 13 À 15 mm, en même temps que 0090
    // § 8.b. À 13 mm, un QR de version 4 (33 modules + 8 de zone de
    // silence = 41) donnait 0,317 mm par module — sous le plancher de
    // 0,33. L’étiquette sortait parfaite et ne se scannait pas.
    { champ: "qr", x: 23, y: 2, largeur: 15, hauteur: 15 },
  ],
};

export const MODELES_OASIS: Readonly<Record<FamilleEtiquette, ModeleEtiquette>> = {
  jardins: JARDINS,
  pepiniere: PEPINIERE,
  biolab: BIOLAB,
};

export function modeleOasis(famille: FamilleEtiquette): ModeleEtiquette {
  return MODELES_OASIS[famille];
}
