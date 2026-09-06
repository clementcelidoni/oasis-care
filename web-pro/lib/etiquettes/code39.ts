/**
 * CODE 39 — le « code-barres éventuellement » du § 18.
 *
 * ------------------------------------------------------------------
 * POURQUOI CODE 39 ET PAS CODE 128
 * ------------------------------------------------------------------
 *
 * Code 128 est plus dense — c'est le standard des entrepôts, et sur le
 * papier il serait le meilleur choix. Mais sa table est ARBITRAIRE :
 * 107 motifs de six chiffres, sans structure interne, qu'il faut
 * recopier d'une source et croire sur parole. Un chiffre faux et le
 * code-barres imprimé n'est plus lisible par personne — un défaut
 * qu'aucun test hors ligne ne détecte, parce que le décodeur qu'on
 * écrirait pour le vérifier relirait la même table fausse.
 *
 * Code 39 a une STRUCTURE, et cette structure est vérifiable :
 * chaque caractère fait exactement neuf éléments (cinq barres, quatre
 * espaces) dont exactement TROIS sont larges, et ces trois-là sont soit
 * deux barres et un espace, soit trois espaces (pour « $ / + % »).
 * `code39.test.ts` contrôle cet invariant sur les quarante-quatre
 * motifs, plus leur unicité deux à deux, plus un aller-retour complet.
 * Une faute de recopie ne survit pas à ces trois filtres.
 *
 * CE QUE ÇA COÛTE : Code 39 est environ 30 % plus large que Code 128
 * pour le même contenu, et son jeu de caractères se limite aux
 * majuscules, aux chiffres et à sept signes. Sur une étiquette de lot
 * — « LOT-2026-004 » — les deux contraintes sont sans effet.
 *
 * LE CODE-BARRES N'EST PAS LE QR. Il ne porte PAS de jeton et
 * n'ouvre aucune fiche : c'est un numéro de lot, lisible par la
 * douchette d'un poste d'emballage qui ne sait pas lire un QR. Le § 18
 * le dit d'ailleurs « éventuellement ».
 */

/**
 * Les motifs : neuf éléments alternés, barre d'abord.
 * `w` = large, `n` = étroit.
 */
const MOTIFS: Readonly<Record<string, string>> = {
  "0": "nnnwwnwnn",
  "1": "wnnwnnnnw",
  "2": "nnwwnnnnw",
  "3": "wnwwnnnnn",
  "4": "nnnwwnnnw",
  "5": "wnnwwnnnn",
  "6": "nnwwwnnnn",
  "7": "nnnwnnwnw",
  "8": "wnnwnnwnn",
  "9": "nnwwnnwnn",
  A: "wnnnnwnnw",
  B: "nnwnnwnnw",
  C: "wnwnnwnnn",
  D: "nnnnwwnnw",
  E: "wnnnwwnnn",
  F: "nnwnwwnnn",
  G: "nnnnnwwnw",
  H: "wnnnnwwnn",
  I: "nnwnnwwnn",
  J: "nnnnwwwnn",
  K: "wnnnnnnww",
  L: "nnwnnnnww",
  M: "wnwnnnnwn",
  N: "nnnnwnnww",
  O: "wnnnwnnwn",
  P: "nnwnwnnwn",
  Q: "nnnnnnwww",
  R: "wnnnnnwwn",
  S: "nnwnnnwwn",
  T: "nnnnwnwwn",
  U: "wwnnnnnnw",
  V: "nwwnnnnnw",
  W: "wwwnnnnnn",
  X: "nwnnwnnnw",
  Y: "wwnnwnnnn",
  Z: "nwwnwnnnn",
  "-": "nwnnnnwnw",
  ".": "wwnnnnwnn",
  " ": "nwwnnnwnn",
  $: "nwnwnwnnn",
  "/": "nwnwnnnwn",
  "+": "nwnnnwnwn",
  "%": "nnnwnwnwn",
  "*": "nwnnwnwnn",
};

/** Le délimiteur de début et de fin. Il n'est pas une donnée. */
export const DELIMITEUR_CODE39 = "*";

export const CARACTERES_CODE39: readonly string[] = Object.keys(MOTIFS).filter((c) => c !== DELIMITEUR_CODE39);

/** Les motifs, exposés pour que le test contrôle leur structure. */
export function motifsCode39(): Readonly<Record<string, string>> {
  return MOTIFS;
}

export function estEncodableCode39(texte: string): boolean {
  for (const c of texte) if (!(c in MOTIFS) || c === DELIMITEUR_CODE39) return false;
  return true;
}

/**
 * Met un texte en forme pour Code 39 : majuscules, accents retirés,
 * caractères impossibles remplacés par un tiret.
 *
 * POURQUOI NE PAS REFUSER. Un numéro de lot vient d'une saisie libre ;
 * refuser d'imprimer la planche entière parce qu'un lot s'appelle
 * « Lot n°4 » serait absurde. On normalise, et le rendu SIGNALE la
 * substitution dans ses avertissements — jamais en silence.
 */
export function normaliserPourCode39(texte: string): { valeur: string; modifie: boolean } {
  const sansAccents = [...texte.normalize("NFD")]
    .filter((c) => {
      const n = c.codePointAt(0) ?? 0;
      return n < 0x300 || n > 0x36f;
    })
    .join("")
    .toUpperCase();
  let valeur = "";
  for (const c of sansAccents) valeur += c in MOTIFS && c !== DELIMITEUR_CODE39 ? c : "-";
  return { valeur, modifie: valeur !== texte };
}

export type BarreCode39 = {
  /** Décalage du bord gauche de la barre, en modules étroits. */
  readonly debutModules: number;
  readonly largeurModules: number;
};

export type Code39 = {
  readonly texte: string;
  /** Largeur totale, en modules étroits. */
  readonly largeurModules: number;
  readonly barres: readonly BarreCode39[];
};

/**
 * Encode un texte en barres.
 *
 * `rapport` est le rapport large/étroit. La norme accepte 2,0 à 3,0 ;
 * 2,5 est le réglage habituel des imprimantes thermiques et le meilleur
 * compromis entre densité et tolérance de lecture. On travaille en
 * modules ÉTROITS entiers et demi pour que le rendu place ensuite tout
 * sur une grille régulière — un code-barres dont les barres tombent à
 * des positions arbitraires imprime mal sur une tête à 203 dpi.
 */
export function encoderCode39(texte: string, rapport = 2.5): Code39 {
  if (rapport < 2 || rapport > 3) {
    throw new Error(`Le rapport large/étroit d'un Code 39 doit être entre 2 et 3 ; reçu ${rapport}.`);
  }
  const contenu = `${DELIMITEUR_CODE39}${texte}${DELIMITEUR_CODE39}`;
  for (const c of contenu) {
    if (!(c in MOTIFS)) throw new Error(`Le caractère « ${c} » n'existe pas en Code 39.`);
  }

  const barres: BarreCode39[] = [];
  let curseur = 0;
  contenu.split("").forEach((caractere, index) => {
    const motif = MOTIFS[caractere];
    for (let i = 0; i < 9; i += 1) {
      const largeur = motif[i] === "w" ? rapport : 1;
      // Les indices pairs sont des barres, les impairs des espaces.
      if (i % 2 === 0) barres.push({ debutModules: curseur, largeurModules: largeur });
      curseur += largeur;
    }
    // L'espace inter-caractère : un module étroit, sauf après le dernier.
    if (index < contenu.length - 1) curseur += 1;
  });

  return { texte, largeurModules: curseur, barres };
}

/**
 * La largeur d'un module étroit pour tenir dans une boîte donnée.
 * C'est ce nombre qui décide si une douchette lira quoi que ce soit :
 * en dessous de 0,19 mm (7,5 mils), la plupart des lecteurs de poste
 * décrochent, et une tête thermique à 203 dpi ne sait pas descendre
 * sous 0,125 mm de toute façon.
 */
export function moduleCode39Mm(code: Code39, largeurBoiteMm: number): number {
  return largeurBoiteMm / code.largeurModules;
}
