/**
 * LES MILLIMÈTRES SONT DES MILLIMÈTRES.
 *
 * Une étiquette imprimée qui sort 2 % trop grande ne colle pas sur son
 * support : le rouleau die-cut a des découpes à un pas fixe, et le
 * décalage s'accumule d'une étiquette à la suivante. C'est une
 * contrainte PHYSIQUE, pas une préférence esthétique — d'où ce fichier
 * minuscule, qui n'existe que pour qu'une seule et même conversion
 * serve partout.
 *
 * DEUX PIÈGES, ET ILS NE SONT PAS DANS NOTRE CODE :
 *
 *   • L'ÉCHELLE de la boîte de dialogue d'impression. « Ajuster à la
 *     page » redimensionne silencieusement. Il faut 100 %.
 *   • LES MARGES du navigateur, que certains dialogues réimposent
 *     par-dessus @page. Il faut « Marges : aucune ».
 *
 * Aucune ligne de code ne peut les forcer. C'est pour cela que
 * planche.ts sait imprimer une RÈGLE DE CONTRÔLE : une barre de 50 mm
 * qu'un paysagiste vérifie en trois secondes avec un décamètre. Une
 * mesure vaut mieux qu'une promesse.
 */

/** 1 pouce = 25,4 mm, exactement. Ce n'est pas une approximation. */
export const MM_PAR_POUCE = 25.4;

/** Le point PostScript : 72 par pouce, exactement. L'unité du PDF. */
export const POINTS_PAR_POUCE = 72;

/** Le pixel CSS : 96 par pouce, exactement. C'est ce qui rend `mm` fiable en CSS. */
export const PIXELS_CSS_PAR_POUCE = 96;

export function mmVersPoints(mm: number): number {
  return (mm * POINTS_PAR_POUCE) / MM_PAR_POUCE;
}

export function pointsVersMm(points: number): number {
  return (points * MM_PAR_POUCE) / POINTS_PAR_POUCE;
}

/**
 * Arrondi d'affichage : le dix-millième de millimètre, soit 0,1 µm.
 *
 * POURQUOI ARRONDIR DU TOUT. `0.1 + 0.2` vaut 0,30000000000000004 en
 * virgule flottante ; sans arrondi, une planche produirait des chaînes
 * comme « 60.00000000000001mm » — juste, mais illisible, et qui rend
 * les tests de cotes impossibles à écrire. 0,1 µm est mille fois plus
 * fin que le point d'une tête thermique à 300 dpi (85 µm) : l'arrondi
 * ne peut RIEN déplacer de perceptible.
 */
export function arrondiMm(valeur: number): number {
  return Math.round(valeur * 1e4) / 1e4;
}

/** Le même arrondi, en chaîne, sans zéros inutiles. */
export function mm(valeur: number): string {
  return String(arrondiMm(valeur));
}

/** Arrondi des points PDF : le millième de point, soit 0,35 µm. */
export function pt(valeur: number): string {
  return String(Math.round(valeur * 1e3) / 1e3);
}

// ------------------------------------------------------------------
// LARGEUR DU TEXTE — MÉTRIQUES HELVETICA
// ------------------------------------------------------------------
//
// À QUOI ELLES SERVENT, ET À QUOI ELLES NE SERVENT PAS.
//
// Elles servent UNIQUEMENT à décider si un texte tient dans son cadre,
// et de combien réduire le corps sinon. Elles n'entrent dans AUCUN
// calcul de cote : la taille de la page, la position des étiquettes et
// le pas de la grille sont de l'arithmétique en millimètres, que les
// tests épinglent au dix-millième. Une erreur de métrique ferait donc
// réduire un texte d'un demi-point de trop — jamais dériver une planche.
//
// POURQUOI HELVETICA. C'est l'une des quatorze polices que tout lecteur
// PDF possède : ne pas l'embarquer économise 300 Ko par planche et
// supprime toute question de licence de fonte. Côté navigateur, la pile
// « Helvetica, Arial, sans-serif » a les MÊMES chasses (Arial a été
// dessinée pour être métriquement compatible), donc l'aperçu écran et
// le PDF se superposent.

/** Chasses Helvetica, en millièmes de cadratin, pour l'ASCII imprimable. */
const CHASSES_HELVETICA: Readonly<Record<string, number>> = {
  " ": 278, "!": 278, '"': 355, "#": 556, $: 556, "%": 889, "&": 667, "'": 191,
  "(": 333, ")": 333, "*": 389, "+": 584, ",": 278, "-": 333, ".": 278, "/": 278,
  "0": 556, "1": 556, "2": 556, "3": 556, "4": 556, "5": 556, "6": 556, "7": 556,
  "8": 556, "9": 556, ":": 278, ";": 278, "<": 584, "=": 584, ">": 584, "?": 556,
  "@": 1015, A: 667, B: 667, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722,
  I: 278, J: 500, K: 667, L: 556, M: 833, N: 722, O: 778, P: 667, Q: 778, R: 722,
  S: 667, T: 611, U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611,
  "[": 278, "\\": 278, "]": 278, "^": 469, _: 556, "`": 333,
  a: 556, b: 556, c: 500, d: 556, e: 556, f: 278, g: 556, h: 556, i: 222, j: 222,
  k: 500, l: 222, m: 833, n: 556, o: 556, p: 556, q: 556, r: 333, s: 500, t: 278,
  u: 556, v: 500, w: 722, x: 500, y: 500, z: 500,
  "{": 334, "|": 260, "}": 334, "~": 584,
};

/**
 * Le facteur du gras.
 *
 * Helvetica-Bold a sa propre table de chasses ; la recopier de mémoire
 * serait 96 nombres invérifiables hors ligne. Le rapport gras/romain
 * varie de 1,00 (le « a », identique) à 1,17 (le « r ») et vaut 1,07 en
 * moyenne sur du texte français. On prend 1,07 ET on garde 2 % de marge
 * de sécurité dans l'ajustement : le pire cas est un mot réduit d'un
 * demi-point de trop, jamais un débordement — le rendu découpe de toute
 * façon au cadre du champ.
 */
const FACTEUR_GRAS = 1.07;

/**
 * Les accents ne changent pas la chasse dans Helvetica : « é » est
 * exactement aussi large que « e ». On ramène donc chaque caractère
 * accentué à sa lettre de base plutôt que d'allonger la table.
 */
function sansAccent(caractere: string): string {
  // On retire les signes diacritiques combinants (U+0300 à U+036F),
  // que la décomposition NFD vient de séparer de leur lettre.
  return [...caractere.normalize("NFD")]
    .filter((c) => { const n = c.codePointAt(0) ?? 0; return n < 0x300 || n > 0x36f; })
    .join("");
}

/** Largeur d'un texte, en millimètres, pour un corps donné en points. */
export function largeurTexteMm(texte: string, taillePt: number, gras = false): number {
  let millieme = 0;
  for (const caractere of texte) {
    const base = sansAccent(caractere) || caractere;
    // Un caractère hors table (idéogramme, émoji) est compté large :
    // mieux vaut réduire un peu trop que déborder.
    millieme += CHASSES_HELVETICA[base] ?? CHASSES_HELVETICA[base.toLowerCase()] ?? 600;
  }
  const chasse = (millieme / 1000) * (gras ? FACTEUR_GRAS : 1);
  return pointsVersMm(chasse * taillePt);
}

/**
 * Hauteur de capitale d'Helvetica, en cadratins.
 * Elle sert à centrer verticalement une ligne dans son cadre : un texte
 * centré sur la hauteur de capitale se lit droit, alors qu'un texte
 * centré sur la hauteur totale paraît trop haut.
 */
export const HAUTEUR_CAPITALE = 0.717;

/**
 * Profondeur de jambage d'Helvetica, en cadratins.
 *
 * C'est ce que descendent le « p », le « g » et le « j » sous la ligne
 * de base. Elle sert à savoir si une ligne de texte DÉBORDE de son
 * cadre par le bas — la hauteur de capitale seule ne le dit pas, et
 * c'est ainsi qu'un corps trop grand sortait sans un mot.
 */
export const PROFONDEUR_JAMBAGE = 0.212;
