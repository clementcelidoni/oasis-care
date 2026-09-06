/**
 * ENCODEUR QR — ISO/IEC 18004, versions 1 à 10.
 *
 * ------------------------------------------------------------------
 * POURQUOI ÉCRIRE CET ENCODEUR PLUTÔT QUE D'INSTALLER UNE BIBLIOTHÈQUE
 * ------------------------------------------------------------------
 *
 * 1. package.json est un fichier PARTAGÉ. Trois chantiers écrivent en
 *    même temps dans ce dépôt. Y ajouter une dépendance, c'est un
 *    conflit de fusion garanti et, pire, un état du dépôt où
 *    `npm test` et `npm run build` échouent pour tout le monde tant
 *    que personne n'a relancé `npm install`. Zéro dépendance, c'est du
 *    code qui marche à la seconde où il atterrit.
 *
 * 2. LA DOCTRINE DU PRODUIT EST DÉJÀ ÉCRITE, dans l'en-tête de
 *    app/(app)/devis/[id]/imprimer/page.tsx : « PAS DE BIBLIOTHÈQUE
 *    PDF […] Embarquer un moteur de rendu ajouterait plusieurs
 *    mégaoctets et une deuxième mise en page à maintenir. » Le même
 *    raisonnement vaut pour le QR : `qrcode` tire dijkstrajs, pngjs et
 *    yargs pour produire un canvas dont nous n'avons pas besoin, et
 *    nous voulons un SVG.
 *
 * 3. LA NORME NE BOUGE PAS. ISO/IEC 18004 est figée depuis 2000. Un
 *    encodeur QR n'est pas une dépendance à entretenir, c'est un
 *    calcul écrit une fois. Le coût de maintenance d'une bibliothèque
 *    tierce (montées de version, avis de sécurité, licences) est ici
 *    supérieur au coût du calcul lui-même.
 *
 * 4. LE CHOIX DU MODE. Une étiquette de 25 × 15 mm se joue à une
 *    version de QR près. Il faut pouvoir FORCER le mode alphanumérique
 *    ou comparer deux découpages en segments pour mesurer ce que coûte
 *    chaque caractère d'adresse. Les bibliothèques toutes faites
 *    segmentent toutes seules et ne disent pas ce qu'elles ont choisi.
 *
 * ------------------------------------------------------------------
 * CE QUI PROUVE QUE CET ENCODEUR EST JUSTE (voir qr.test.ts)
 * ------------------------------------------------------------------
 *
 *   • Le nombre total de mots de code par version n'est PAS une table
 *     recopiée : il est COMPTÉ sur la matrice, en soustrayant les
 *     motifs de fonction. Les valeurs obtenues (26, 44, 70, 100, 134,
 *     172, 196, 242, 292, 346) sont celles de la norme. Une erreur de
 *     placement d'un motif d'alignement se verrait immédiatement.
 *   • Le vecteur d'essai de l'annexe de la norme — « 01234567 » en
 *     version 1-M — est vérifié mot de code par mot de code, données
 *     ET correction d'erreur. Il épingle à la fois la construction du
 *     flux binaire et le Reed-Solomon sur GF(256).
 *   • Un DÉCODEUR complet vit dans le fichier de test : il relit la
 *     matrice produite, retrouve le masque, désentrelace, vérifie que
 *     les syndromes Reed-Solomon sont nuls et rend la chaîne de
 *     départ. Des centaines d'aller-retours passent dessus.
 */

/** Les quatre niveaux de correction d'erreur de la norme. */
/**
 * LA ZONE DE SILENCE DU QR : quatre modules, et ce n'est pas négociable.
 *
 * La norme l'impose, et ce n'est pas de la coquetterie : sans elle, le
 * lecteur ne trouve pas les bords du code. C'est LA cause numéro un des
 * QR d'étiquette qui « ne marchent pas » — on colle le carré au bord
 * pour gagner deux millimètres, et plus rien ne scanne.
 *
 * Conséquence à assumer : une boîte de 13 mm pour un QR de 33 modules
 * n'offre pas 13/33 = 0,39 mm par module, mais 13/41 = 0,32 mm. C'est
 * ce second chiffre qui est vrai, et c'est celui que densite.ts calcule.
 *
 * ELLE VIT ICI, DANS L'ENCODEUR, et non dans le moteur de rendu :
 * rendu.ts et densite.ts en ont tous deux besoin, et la loger dans le
 * premier faisait que le second l'importait de lui — un cycle
 * d'imports. Il ne cassait rien tant que la constante n'était lue que
 * dans des corps de fonction, mais un cycle finit toujours par mordre
 * le jour où quelqu'un l'utilise à l'initialisation d'un module.
 */
export const SILENCE_QR_MODULES = 4;

export type NiveauCorrection = "L" | "M" | "Q" | "H";

/** Les modes d'encodage que nous savons produire. */
export type ModeQr = "numerique" | "alphanumerique" | "octet";

export type MatriceQr = {
  /** Côté de la matrice en modules, HORS zone de silence. */
  readonly taille: number;
  /** modules[y][x] — true = sombre. */
  readonly modules: readonly (readonly boolean[])[];
  readonly version: number;
  readonly niveau: NiveauCorrection;
  /** Les modes réellement employés, dans l'ordre des segments. */
  readonly modes: readonly ModeQr[];
  readonly masque: number;
};

// ------------------------------------------------------------------
// GF(256) — le corps de Galois du Reed-Solomon de la norme.
// Polynôme primitif 0x11D (x⁸ + x⁴ + x³ + x² + 1), générateur α = 2.
// ------------------------------------------------------------------

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);

{
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  // La seconde moitié duplique la première : elle évite un modulo à
  // chaque multiplication, dans une boucle exécutée des milliers de
  // fois par planche.
  for (let i = 255; i < 512; i += 1) GF_EXP[i] = GF_EXP[i - 255];
}

export function gfMultiplier(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

/** α^i, exposé pour que le décodeur de test calcule ses syndromes. */
export function gfPuissance(i: number): number {
  return GF_EXP[((i % 255) + 255) % 255];
}

/** Le polynôme générateur de degré `degre` : ∏ (x − α^i). */
export function polynomeGenerateur(degre: number): Uint8Array {
  let resultat = new Uint8Array([1]);
  for (let i = 0; i < degre; i += 1) {
    const suivant = new Uint8Array(resultat.length + 1);
    for (let j = 0; j < resultat.length; j += 1) {
      suivant[j] ^= resultat[j];
      suivant[j + 1] ^= gfMultiplier(resultat[j], GF_EXP[i]);
    }
    resultat = suivant;
  }
  return resultat;
}

/** Les `nbCorrection` mots de code de correction d'un bloc de données. */
export function reedSolomon(donnees: Uint8Array, nbCorrection: number): Uint8Array {
  const generateur = polynomeGenerateur(nbCorrection);
  const reste = new Uint8Array(nbCorrection);
  for (const octet of donnees) {
    const facteur = octet ^ reste[0];
    reste.copyWithin(0, 1);
    reste[nbCorrection - 1] = 0;
    if (facteur !== 0) {
      for (let i = 0; i < nbCorrection; i += 1) {
        reste[i] ^= gfMultiplier(generateur[i + 1], facteur);
      }
    }
  }
  return reste;
}

// ------------------------------------------------------------------
// LES TABLES DE LA NORME, VERSIONS 1 À 10
// ------------------------------------------------------------------
//
// POURQUOI S'ARRÊTER À 10. Le contenu d'un QR d'étiquette est une
// adresse : « https://…/x/ » plus un jeton de 32 caractères, soit une
// soixantaine d'octets. La version 10-M en accepte 216. S'arrêter à 10
// garde une table courte — donc VÉRIFIABLE ligne à ligne — tout en
// laissant un facteur trois de marge. Au-delà, l'encodeur refuse
// explicitement plutôt que de produire un QR que personne ne pourra
// scanner sur un autocollant de 25 mm.
//
// Ces deux tables sont les SEULES données recopiées de la norme. Le
// test les recoupe : mots de code totaux (comptés sur la matrice) moins
// correction doit rendre les capacités publiées de la norme.

/** Mots de code de correction PAR BLOC, [niveau][version − 1]. */
const CORRECTION_PAR_BLOC: Readonly<Record<NiveauCorrection, readonly number[]>> = {
  L: [7, 10, 15, 20, 26, 18, 20, 24, 30, 18],
  M: [10, 16, 26, 18, 24, 16, 18, 22, 22, 26],
  Q: [13, 22, 18, 26, 18, 24, 18, 22, 20, 24],
  H: [17, 28, 22, 16, 22, 28, 26, 26, 24, 28],
};

/** Nombre de blocs de correction, [niveau][version − 1]. */
const NOMBRE_BLOCS: Readonly<Record<NiveauCorrection, readonly number[]>> = {
  L: [1, 1, 1, 1, 1, 2, 2, 2, 2, 4],
  M: [1, 1, 1, 2, 2, 4, 4, 4, 5, 5],
  Q: [1, 1, 2, 2, 4, 4, 6, 6, 8, 8],
  H: [1, 1, 2, 4, 4, 4, 5, 6, 8, 8],
};

export const VERSION_MAX = 10;

/** Coordonnées des centres des motifs d'alignement, par version. */
const ALIGNEMENT: readonly (readonly number[])[] = [
  [],
  [],
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
  [6, 24, 42],
  [6, 26, 46],
  [6, 28, 50],
];

export function tailleMatrice(version: number): number {
  return version * 4 + 17;
}

// ------------------------------------------------------------------
// LES MOTIFS DE FONCTION, ET LE COMPTAGE DES MODULES LIBRES
// ------------------------------------------------------------------
//
// Le nombre de mots de code d'une version n'est pas recopié : on
// construit la carte des modules réservés et on compte ce qui reste.
// C'est plus long à écrire qu'une table de dix nombres, mais c'est la
// seule façon d'avoir une VÉRIFICATION plutôt qu'une recopie.

export function carteFonctions(version: number): boolean[][] {
  const n = tailleMatrice(version);
  const carte: boolean[][] = Array.from({ length: n }, () => new Array<boolean>(n).fill(false));
  const reserver = (x0: number, y0: number, largeur: number, hauteur: number) => {
    for (let y = y0; y < y0 + hauteur; y += 1) {
      for (let x = x0; x < x0 + largeur; x += 1) {
        if (y >= 0 && y < n && x >= 0 && x < n) carte[y][x] = true;
      }
    }
  };

  // Les trois motifs de recherche, avec leur séparateur : 8 × 8 en
  // comptant la bande blanche qui les isole.
  reserver(0, 0, 8, 8);
  reserver(n - 8, 0, 8, 8);
  reserver(0, n - 8, 8, 8);

  // Les motifs de synchronisation : la ligne 6 et la colonne 6.
  reserver(6, 0, 1, n);
  reserver(0, 6, n, 1);

  // Les motifs d'alignement : 5 × 5 centrés, sauf ceux qui
  // chevaucheraient un motif de recherche.
  const centres = ALIGNEMENT[version];
  const dernier = centres[centres.length - 1];
  for (const cy of centres) {
    for (const cx of centres) {
      const coinRecherche = (cx === 6 && cy === 6) || (cx === 6 && cy === dernier) || (cx === dernier && cy === 6);
      if (!coinRecherche) reserver(cx - 2, cy - 2, 5, 5);
    }
  }

  // Les deux copies de l'information de format, plus le module sombre
  // permanent en (8, n − 8).
  reserver(0, 8, 9, 1);
  reserver(8, 0, 1, 9);
  reserver(n - 8, 8, 8, 1);
  reserver(8, n - 8, 1, 8);

  // L'information de version, à partir de la version 7 seulement.
  if (version >= 7) {
    reserver(n - 11, 0, 3, 6);
    reserver(0, n - 11, 6, 3);
  }
  return carte;
}

/** Mots de code bruts d'une version, et bits restants inutilisables. */
export function capaciteBrute(version: number): { motsDeCode: number; bitsRestants: number } {
  const carte = carteFonctions(version);
  let libres = 0;
  for (const ligne of carte) for (const reserve of ligne) if (!reserve) libres += 1;
  return { motsDeCode: Math.floor(libres / 8), bitsRestants: libres % 8 };
}

/** Mots de code de DONNÉES disponibles pour une version et un niveau. */
export function capaciteDonnees(version: number, niveau: NiveauCorrection): number {
  const { motsDeCode } = capaciteBrute(version);
  return motsDeCode - CORRECTION_PAR_BLOC[niveau][version - 1] * NOMBRE_BLOCS[niveau][version - 1];
}

/** Découpage en blocs (données, correction) — le décodeur de test le relit. */
export function decoupageBlocs(
  version: number,
  niveau: NiveauCorrection,
): { nbBlocs: number; nbCorrection: number; taillesDonnees: number[] } {
  const nbBlocs = NOMBRE_BLOCS[niveau][version - 1];
  const nbCorrection = CORRECTION_PAR_BLOC[niveau][version - 1];
  const total = capaciteBrute(version).motsDeCode;
  const courts = nbBlocs - (total % nbBlocs);
  const tailleCourte = Math.floor(total / nbBlocs) - nbCorrection;
  const taillesDonnees = Array.from({ length: nbBlocs }, (_valeur, i) => tailleCourte + (i < courts ? 0 : 1));
  return { nbBlocs, nbCorrection, taillesDonnees };
}

// ------------------------------------------------------------------
// LES SEGMENTS
// ------------------------------------------------------------------

export const CHARSET_ALPHANUMERIQUE = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";

export function estAlphanumerique(texte: string): boolean {
  for (const c of texte) if (!CHARSET_ALPHANUMERIQUE.includes(c)) return false;
  return true;
}

export function estNumerique(texte: string): boolean {
  return texte.length > 0 && /^[0-9]+$/.test(texte);
}

type Segment = { mode: ModeQr; texte: string; octets: Uint8Array };

function segment(mode: ModeQr, texte: string): Segment {
  return { mode, texte, octets: new TextEncoder().encode(texte) };
}

const INDICATEUR_MODE: Record<ModeQr, number> = { numerique: 1, alphanumerique: 2, octet: 4 };

/** Bits de l'indicateur de longueur, selon la tranche de versions. */
export function bitsCompteur(mode: ModeQr, version: number): number {
  // Versions 1-9 / 10-26 / 27-40. Nous nous arrêtons à 10, donc seules
  // les deux premières colonnes servent — les trois sont écrites pour
  // que la fonction reste juste si VERSION_MAX bouge un jour.
  const table: Record<ModeQr, readonly [number, number, number]> = {
    numerique: [10, 12, 14],
    alphanumerique: [9, 11, 13],
    octet: [8, 16, 16],
  };
  const colonne = version <= 9 ? 0 : version <= 26 ? 1 : 2;
  return table[mode][colonne];
}

/** Longueur en bits d'un segment pour une version donnée. */
function bitsSegment(seg: Segment, version: number): number {
  const entete = 4 + bitsCompteur(seg.mode, version);
  if (seg.mode === "numerique") {
    const n = seg.texte.length;
    return entete + 10 * Math.floor(n / 3) + (n % 3 === 1 ? 4 : n % 3 === 2 ? 7 : 0);
  }
  if (seg.mode === "alphanumerique") {
    const n = seg.texte.length;
    return entete + 11 * Math.floor(n / 2) + (n % 2 === 1 ? 6 : 0);
  }
  return entete + 8 * seg.octets.length;
}

// ------------------------------------------------------------------
// LE FLUX BINAIRE
// ------------------------------------------------------------------

class FluxBits {
  private readonly bits: number[] = [];

  ajouter(valeur: number, nombre: number): void {
    for (let i = nombre - 1; i >= 0; i -= 1) this.bits.push((valeur >>> i) & 1);
  }

  get longueur(): number {
    return this.bits.length;
  }

  versOctets(): Uint8Array {
    const octets = new Uint8Array(Math.ceil(this.bits.length / 8));
    this.bits.forEach((bit, i) => {
      if (bit) octets[i >>> 3] |= 0x80 >>> (i & 7);
    });
    return octets;
  }
}

function ecrireSegment(flux: FluxBits, seg: Segment, version: number): void {
  flux.ajouter(INDICATEUR_MODE[seg.mode], 4);
  const longueur = seg.mode === "octet" ? seg.octets.length : seg.texte.length;
  flux.ajouter(longueur, bitsCompteur(seg.mode, version));

  if (seg.mode === "numerique") {
    for (let i = 0; i < seg.texte.length; i += 3) {
      const tranche = seg.texte.slice(i, i + 3);
      flux.ajouter(Number(tranche), tranche.length * 3 + 1);
    }
    return;
  }
  if (seg.mode === "alphanumerique") {
    for (let i = 0; i < seg.texte.length; i += 2) {
      const a = CHARSET_ALPHANUMERIQUE.indexOf(seg.texte[i]);
      if (i + 1 < seg.texte.length) {
        flux.ajouter(a * 45 + CHARSET_ALPHANUMERIQUE.indexOf(seg.texte[i + 1]), 11);
      } else {
        flux.ajouter(a, 6);
      }
    }
    return;
  }
  for (const octet of seg.octets) flux.ajouter(octet, 8);
}

/**
 * Les mots de code de données, remplissage compris.
 * Le remplissage alterne 0xEC et 0x11 : c'est la norme, et c'est ce
 * qui donne au QR sa texture régulière dans les zones vides.
 */
export function motsDeCodeDonnees(
  segments: readonly { mode: ModeQr; texte: string }[],
  version: number,
  niveau: NiveauCorrection,
): Uint8Array {
  const capacite = capaciteDonnees(version, niveau);
  const flux = new FluxBits();
  for (const s of segments) ecrireSegment(flux, segment(s.mode, s.texte), version);

  const bitsCapacite = capacite * 8;
  if (flux.longueur > bitsCapacite) {
    throw new Error("Contenu trop long pour cette version de QR.");
  }
  flux.ajouter(0, Math.min(4, bitsCapacite - flux.longueur)); // terminateur
  flux.ajouter(0, (8 - (flux.longueur % 8)) % 8); // alignement sur l'octet

  const octets = flux.versOctets();
  const complet = new Uint8Array(capacite);
  complet.set(octets);
  // Remplissage alterné, en commençant TOUJOURS par 0xEC.
  for (let i = octets.length; i < capacite; i += 1) {
    complet[i] = (i - octets.length) % 2 === 0 ? 0xec : 0x11;
  }
  return complet;
}

/** Entrelacement des blocs de données et de correction. */
export function entrelacer(donnees: Uint8Array, version: number, niveau: NiveauCorrection): Uint8Array {
  const { nbBlocs, nbCorrection, taillesDonnees } = decoupageBlocs(version, niveau);
  const total = capaciteBrute(version).motsDeCode;

  const blocsDonnees: Uint8Array[] = [];
  const blocsCorrection: Uint8Array[] = [];
  let curseur = 0;
  for (let i = 0; i < nbBlocs; i += 1) {
    const bloc = donnees.subarray(curseur, curseur + taillesDonnees[i]);
    curseur += taillesDonnees[i];
    blocsDonnees.push(bloc);
    blocsCorrection.push(reedSolomon(bloc, nbCorrection));
  }

  const sortie = new Uint8Array(total);
  const plusLong = Math.max(...taillesDonnees);
  let k = 0;
  for (let i = 0; i < plusLong; i += 1) {
    for (let b = 0; b < nbBlocs; b += 1) {
      if (i < blocsDonnees[b].length) sortie[k++] = blocsDonnees[b][i];
    }
  }
  for (let i = 0; i < nbCorrection; i += 1) {
    for (let b = 0; b < nbBlocs; b += 1) sortie[k++] = blocsCorrection[b][i];
  }
  return sortie;
}

// ------------------------------------------------------------------
// LES INFORMATIONS DE FORMAT ET DE VERSION (codes BCH)
// ------------------------------------------------------------------

const BITS_NIVEAU: Record<NiveauCorrection, number> = { L: 1, M: 0, Q: 3, H: 2 };

/** 15 bits : 5 de données, 10 de BCH, le tout masqué par 0x5412. */
export function informationFormat(niveau: NiveauCorrection, masque: number): number {
  const donnees = (BITS_NIVEAU[niveau] << 3) | masque;
  let reste = donnees << 10;
  for (let i = 14; i >= 10; i -= 1) {
    if ((reste >>> i) & 1) reste ^= 0x537 << (i - 10);
  }
  return ((donnees << 10) | reste) ^ 0x5412;
}

/** 18 bits : 6 de version, 12 de BCH. Versions 7 et au-delà. */
export function informationVersion(version: number): number {
  let reste = version << 12;
  for (let i = 17; i >= 12; i -= 1) {
    if ((reste >>> i) & 1) reste ^= 0x1f25 << (i - 12);
  }
  return (version << 12) | reste;
}

// ------------------------------------------------------------------
// LA MATRICE
// ------------------------------------------------------------------

function poserMotifsFixes(modules: boolean[][], version: number): void {
  const n = modules.length;

  const motifRecherche = (x0: number, y0: number) => {
    for (let dy = -1; dy <= 7; dy += 1) {
      for (let dx = -1; dx <= 7; dx += 1) {
        const x = x0 + dx;
        const y = y0 + dy;
        if (x < 0 || x >= n || y < 0 || y >= n) continue;
        const d = Math.max(Math.abs(dx - 3), Math.abs(dy - 3));
        modules[y][x] = d !== 2 && d <= 3;
      }
    }
  };
  motifRecherche(0, 0);
  motifRecherche(n - 7, 0);
  motifRecherche(0, n - 7);

  for (let i = 8; i < n - 8; i += 1) {
    modules[6][i] = i % 2 === 0;
    modules[i][6] = i % 2 === 0;
  }

  const centres = ALIGNEMENT[version];
  const dernier = centres[centres.length - 1];
  for (const cy of centres) {
    for (const cx of centres) {
      const coinRecherche = (cx === 6 && cy === 6) || (cx === 6 && cy === dernier) || (cx === dernier && cy === 6);
      if (coinRecherche) continue;
      for (let dy = -2; dy <= 2; dy += 1) {
        for (let dx = -2; dx <= 2; dx += 1) {
          modules[cy + dy][cx + dx] = Math.max(Math.abs(dx), Math.abs(dy)) !== 1;
        }
      }
    }
  }

  // Le module sombre permanent : la norme l'impose, il ne dépend de rien.
  modules[n - 8][8] = true;

  if (version >= 7) {
    const info = informationVersion(version);
    for (let i = 0; i < 18; i += 1) {
      const bit = ((info >>> i) & 1) === 1;
      modules[Math.floor(i / 3)][n - 11 + (i % 3)] = bit;
      modules[n - 11 + (i % 3)][Math.floor(i / 3)] = bit;
    }
  }
}

function poserFormat(modules: boolean[][], niveau: NiveauCorrection, masque: number): void {
  const n = modules.length;
  const info = informationFormat(niveau, masque);
  for (let i = 0; i < 15; i += 1) {
    const bit = ((info >>> i) & 1) === 1;
    // Première copie, autour du motif de recherche haut-gauche.
    if (i < 6) modules[8][i] = bit;
    else if (i === 6) modules[8][7] = bit;
    else if (i === 7) modules[8][8] = bit;
    else if (i === 8) modules[7][8] = bit;
    else modules[14 - i][8] = bit;
    // Seconde copie : SEPT modules sous le coin bas-gauche, puis HUIT à
    // droite. Pas huit et huit — le huitième module de la colonne, en
    // (8, n − 8), est le module sombre permanent de la norme. L'y
    // écraser produit un QR que la moitié des lecteurs refuse.
    if (i < 7) modules[n - 1 - i][8] = bit;
    else modules[8][n - 15 + i] = bit;
  }
}

function poserDonnees(modules: boolean[][], reserve: readonly (readonly boolean[])[], flux: Uint8Array): void {
  const n = modules.length;
  let bit = 0;
  const total = flux.length * 8;
  for (let colonneDroite = n - 1; colonneDroite >= 1; colonneDroite -= 2) {
    // La colonne 6 est un motif de synchronisation : la spirale la saute.
    const droite = colonneDroite <= 6 ? colonneDroite - 1 : colonneDroite;
    for (let pas = 0; pas < n; pas += 1) {
      // Une colonne double sur deux se parcourt de bas en haut.
      const monte = ((droite + 1) & 2) === 0;
      const y = monte ? n - 1 - pas : pas;
      for (let dx = 0; dx < 2; dx += 1) {
        const x = droite - dx;
        if (reserve[y][x]) continue;
        // AU-DELÀ DES DONNÉES, LES MODULES RESTENT CLAIRS : ce sont les
        // « bits restants » de la norme, qui ne portent rien.
        modules[y][x] = bit < total && ((flux[bit >>> 3] >>> (7 - (bit & 7))) & 1) === 1;
        bit += 1;
      }
    }
  }
}

/** Les huit masques de la norme. Exportés : le décodeur de test les rejoue. */
export const MASQUES: readonly ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

/** Les quatre pénalités de la norme. Le masque le moins pénalisé gagne. */
export function penalite(modules: readonly (readonly boolean[])[]): number {
  const n = modules.length;
  let total = 0;

  // N1 — suites de cinq modules de même teinte ou plus.
  for (let i = 0; i < n; i += 1) {
    for (const parLigne of [true, false]) {
      let precedent = false;
      let suite = 0;
      for (let j = 0; j < n; j += 1) {
        const v = parLigne ? modules[i][j] : modules[j][i];
        if (j > 0 && v === precedent) {
          suite += 1;
          if (suite === 5) total += 3;
          else if (suite > 5) total += 1;
        } else {
          suite = 1;
        }
        precedent = v;
      }
    }
  }

  // N2 — blocs de 2 × 2 uniformes.
  for (let y = 0; y < n - 1; y += 1) {
    for (let x = 0; x < n - 1; x += 1) {
      const v = modules[y][x];
      if (v === modules[y][x + 1] && v === modules[y + 1][x] && v === modules[y + 1][x + 1]) total += 3;
    }
  }

  // N3 — le motif 1:1:3:1:1 bordé de quatre modules clairs, qui
  // imiterait un motif de recherche et tromperait le décodeur.
  const motif = [true, false, true, true, true, false, true];
  const clairs = [false, false, false, false];
  const occurrences = (v: readonly boolean[], m: readonly boolean[]) => {
    let compte = 0;
    for (let i = 0; i + m.length <= v.length; i += 1) {
      let ok = true;
      for (let j = 0; j < m.length; j += 1) {
        if (v[i + j] !== m[j]) {
          ok = false;
          break;
        }
      }
      if (ok) compte += 1;
    }
    return compte;
  };
  for (let i = 0; i < n; i += 1) {
    const ligne = modules[i];
    const colonne = modules.map((r) => r[i]);
    for (const v of [ligne, colonne]) {
      total += 40 * occurrences(v, [...clairs, ...motif]);
      total += 40 * occurrences(v, [...motif, ...clairs]);
    }
  }

  // N4 — écart à 50 % de modules sombres, par tranche de 5 %.
  let sombres = 0;
  for (const ligne of modules) for (const v of ligne) if (v) sombres += 1;
  const pourcent = (sombres * 100) / (n * n);
  total += 10 * Math.floor(Math.abs(pourcent - 50) / 5);
  return total;
}

// ------------------------------------------------------------------
// LE CHOIX DES SEGMENTS ET DE LA VERSION
// ------------------------------------------------------------------

export type OptionsQr = {
  niveau?: NiveauCorrection;
  /** Forcer une version minimale (pour comparer des densités). */
  versionMinimale?: number;
  /** Forcer un mode unique au lieu de laisser l'encodeur découper. */
  modeImpose?: ModeQr;
  /** Forcer un masque (0 à 7) au lieu de prendre le moins pénalisé. */
  masqueImpose?: number;
};

/**
 * Les découpages en segments que nous mettons en concurrence.
 *
 * On ne cherche pas l'optimum théorique : trois candidats suffisent et
 * chacun se raconte en une phrase.
 *   a) tout en octet — toujours possible ;
 *   b) tout en alphanumérique — deux fois plus dense, mais exige des
 *      MAJUSCULES et un jeu de caractères restreint ;
 *   c) une coupure au dernier « / » : l'adresse en octet, le jeton en
 *      alphanumérique. C'est le cas réel d'une adresse en minuscules
 *      suivie d'un jeton en majuscules.
 */
function candidats(texte: string, modeImpose?: ModeQr): Segment[][] {
  if (modeImpose === "octet") return [[segment("octet", texte)]];
  if (modeImpose === "alphanumerique") {
    if (!estAlphanumerique(texte)) {
      throw new Error("Mode alphanumérique impossible : le texte contient des caractères hors du jeu de la norme.");
    }
    return [[segment("alphanumerique", texte)]];
  }
  if (modeImpose === "numerique") {
    if (!estNumerique(texte)) throw new Error("Mode numérique impossible : le texte n'est pas fait que de chiffres.");
    return [[segment("numerique", texte)]];
  }

  const liste: Segment[][] = [[segment("octet", texte)]];
  if (estNumerique(texte)) liste.push([segment("numerique", texte)]);
  if (estAlphanumerique(texte)) liste.push([segment("alphanumerique", texte)]);

  const coupure = texte.lastIndexOf("/");
  if (coupure > 0 && coupure < texte.length - 1) {
    const prefixe = texte.slice(0, coupure + 1);
    const suffixe = texte.slice(coupure + 1);
    if (estNumerique(suffixe)) liste.push([segment("octet", prefixe), segment("numerique", suffixe)]);
    else if (estAlphanumerique(suffixe)) liste.push([segment("octet", prefixe), segment("alphanumerique", suffixe)]);
  }
  return liste;
}

/** Encode un texte en matrice QR. */
export function encoderQr(texte: string, options: OptionsQr = {}): MatriceQr {
  const niveau = options.niveau ?? "M";
  const versionMin = Math.max(1, options.versionMinimale ?? 1);
  const listeCandidats = candidats(texte, options.modeImpose);

  let choix: { version: number; segments: Segment[] } | null = null;
  for (let version = versionMin; version <= VERSION_MAX && !choix; version += 1) {
    const capacite = capaciteDonnees(version, niveau) * 8;
    // Le candidat le plus court gagne : à version égale, un QR plus
    // creux se scanne mieux, mais surtout un candidat qui tient en
    // version 3 évite une version 4 à un autre.
    let meilleur: Segment[] | null = null;
    let meilleurBits = Number.POSITIVE_INFINITY;
    for (const segments of listeCandidats) {
      const bits = segments.reduce((somme, s) => somme + bitsSegment(s, version), 0);
      if (bits <= capacite && bits < meilleurBits) {
        meilleur = segments;
        meilleurBits = bits;
      }
    }
    if (meilleur) choix = { version, segments: meilleur };
  }
  if (!choix) {
    throw new Error(
      `Ce contenu de ${texte.length} caractères ne tient pas dans un QR de version ${VERSION_MAX} ` +
        `au niveau ${niveau}. Une étiquette ne porte qu'une adresse courte : raccourcissez le jeton ou le domaine.`,
    );
  }

  const { version, segments } = choix;
  const flux = entrelacer(motsDeCodeDonnees(segments, version, niveau), version, niveau);
  const n = tailleMatrice(version);
  const reserve = carteFonctions(version);

  const construire = (masque: number): boolean[][] => {
    const modules: boolean[][] = Array.from({ length: n }, () => new Array<boolean>(n).fill(false));
    poserMotifsFixes(modules, version);
    poserDonnees(modules, reserve, flux);
    for (let y = 0; y < n; y += 1) {
      for (let x = 0; x < n; x += 1) {
        if (!reserve[y][x] && MASQUES[masque](x, y)) modules[y][x] = !modules[y][x];
      }
    }
    poserFormat(modules, niveau, masque);
    return modules;
  };

  let meilleurMasque = options.masqueImpose ?? 0;
  let meilleuresModules = construire(meilleurMasque);
  if (options.masqueImpose === undefined) {
    let meilleureNote = penalite(meilleuresModules);
    for (let masque = 1; masque < 8; masque += 1) {
      const essai = construire(masque);
      const note = penalite(essai);
      if (note < meilleureNote) {
        meilleureNote = note;
        meilleurMasque = masque;
        meilleuresModules = essai;
      }
    }
  }

  return {
    taille: n,
    modules: meilleuresModules,
    version,
    niveau,
    modes: segments.map((s) => s.mode),
    masque: meilleurMasque,
  };
}
