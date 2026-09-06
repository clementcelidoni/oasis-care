/**
 * ÉCRITURE PDF — la sortie « PDF » et « imprimante thermique » du § 17.
 *
 * ------------------------------------------------------------------
 * POURQUOI PAS jsPDF, pdf-lib OU PDFKit
 * ------------------------------------------------------------------
 *
 * Ce qu'une planche d'étiquettes demande à un PDF tient en cinq
 * opérateurs : une taille de page, des rectangles noirs, du texte dans
 * une police standard, un rognage, une pagination. jsPDF pèse environ
 * un mégaoctet, pdf-lib un et demi, PDFKit deux avec fontkit et ses
 * fichiers de métriques. Aucun des trois n'apporte quoi que ce soit
 * ici : nous n'embarquons pas de fonte (les quatorze polices standard
 * sont dans tous les lecteurs), nous ne composons pas de paragraphes,
 * nous n'incorporons pas d'images.
 *
 * S'y ajoutent deux raisons de fond :
 *   • package.json est PARTAGÉ entre trois chantiers simultanés ;
 *   • la doctrine du produit est déjà écrite dans l'en-tête de
 *     app/(app)/devis/[id]/imprimer/page.tsx : « PAS DE BIBLIOTHÈQUE
 *     PDF ». Ce fichier ne la contredit pas, il la complète : le devis
 *     passe par « Imprimer » du navigateur parce qu'il a besoin de
 *     césure et de pagination ; l'étiquette a besoin de cotes exactes
 *     au dixième de millimètre, ce que seul un MediaBox garantit.
 *
 * ------------------------------------------------------------------
 * CE QUE CE MODULE NE FAIT PAS, ET IL FAUT LE SAVOIR
 * ------------------------------------------------------------------
 *
 * IL N'INCORPORE AUCUNE IMAGE. Un logo en PNG ou en JPEG n'entre pas
 * dans ce PDF ; il est remplacé par le nom de l'entreprise en
 * vectoriel, et le rendu le signale. Deux raisons : un logo raster de
 * 6 mm de haut sur une tête thermique à 203 dpi (48 points de haut)
 * sort en bouillie, alors que du texte vectoriel sort net ; et
 * incorporer un PNG à canal alpha exigerait un décompresseur zlib
 * complet pour séparer la transparence. Le chemin navigateur (SVG +
 * « Enregistrer au format PDF ») affiche les logos, lui, et c'est celui
 * qu'on prendra pour une planche A4 sur laser de bureau.
 *
 * IL NE COMPRESSE PAS LES FLUX. Une planche A4 de quarante étiquettes
 * pèse environ 120 Ko non compressée. La compresser exigerait
 * `node:zlib`, donc du code qui ne tourne que côté serveur ; ce module
 * marche partout, y compris dans le navigateur, et 120 Ko ne gênent
 * personne.
 */

import { HAUTEUR_CAPITALE, arrondiMm, largeurTexteMm, mmVersPoints, pt } from "./mesures.ts";
import type { ElementRendu } from "./types.ts";

export type PagePdf = {
  readonly largeurMm: number;
  readonly hauteurMm: number;
  readonly elements: readonly ElementRendu[];
};

// ------------------------------------------------------------------
// ENCODAGE DU TEXTE
// ------------------------------------------------------------------
//
// Les polices standard sont déclarées en WinAnsiEncoding, qui est la
// page de code 1252. Les accents français y sont, ainsi que les
// guillemets « », l'apostrophe typographique et le tiret cadratin —
// tout ce qu'un nom de cultivar peut contenir.

/** Les caractères de CP1252 qui ne sont pas à leur place Unicode. */
const CP1252_SPECIAUX: Readonly<Record<string, number>> = {
  "€": 0x80, "‚": 0x82, "ƒ": 0x83, "„": 0x84, "…": 0x85,
  "†": 0x86, "‡": 0x87, "ˆ": 0x88, "‰": 0x89, "Š": 0x8a,
  "‹": 0x8b, "Œ": 0x8c, "Ž": 0x8e, "‘": 0x91, "’": 0x92,
  "“": 0x93, "”": 0x94, "•": 0x95, "–": 0x96, "—": 0x97,
  "˜": 0x98, "™": 0x99, "š": 0x9a, "›": 0x9b, "œ": 0x9c,
  "ž": 0x9e, "Ÿ": 0x9f,
};

/** Un caractère hors CP1252 devient « ? » : visible, jamais silencieux. */
export function versWinAnsi(texte: string): number[] {
  const octets: number[] = [];
  for (const caractere of texte) {
    const point = caractere.codePointAt(0) ?? 63;
    if (point >= 0x20 && point <= 0x7e) octets.push(point);
    else if (CP1252_SPECIAUX[caractere] !== undefined) octets.push(CP1252_SPECIAUX[caractere]);
    else if (point >= 0xa0 && point <= 0xff) octets.push(point);
    else octets.push(63);
  }
  return octets;
}

/** Une chaîne littérale PDF, parenthèses et antislash échappés. */
function chainePdf(texte: string): string {
  let sortie = "(";
  for (const octet of versWinAnsi(texte)) {
    if (octet === 0x28 || octet === 0x29 || octet === 0x5c) sortie += `\\${String.fromCharCode(octet)}`;
    else sortie += String.fromCharCode(octet);
  }
  return `${sortie})`;
}

// ------------------------------------------------------------------
// LE FLUX DE CONTENU D'UNE PAGE
// ------------------------------------------------------------------

const POLICES = [
  { ressource: "F1", base: "Helvetica" },
  { ressource: "F2", base: "Helvetica-Bold" },
  { ressource: "F3", base: "Helvetica-Oblique" },
  { ressource: "F4", base: "Helvetica-BoldOblique" },
] as const;

function ressourcePolice(gras: boolean, italique: boolean): string {
  if (gras && italique) return "F4";
  if (gras) return "F2";
  if (italique) return "F3";
  return "F1";
}

function contenuPage(page: PagePdf): string {
  const hauteurPt = mmVersPoints(page.hauteurMm);
  /** Origine en BAS à gauche côté PDF, en HAUT à gauche côté modèle. */
  const y = (yMm: number) => hauteurPt - mmVersPoints(yMm);

  const lignes: string[] = [];
  for (const element of page.elements) {
    if (element.type === "rectangle") {
      const x0 = mmVersPoints(element.xMm);
      const y0 = y(element.yMm + element.hauteurMm);
      const l = mmVersPoints(element.largeurMm);
      const h = mmVersPoints(element.hauteurMm);
      if (element.rempli) {
        lignes.push(`0 g ${pt(x0)} ${pt(y0)} ${pt(l)} ${pt(h)} re f`);
      } else {
        const trait = mmVersPoints(element.epaisseurMm ?? 0.1);
        lignes.push(`0 G ${pt(trait)} w ${pt(x0)} ${pt(y0)} ${pt(l)} ${pt(h)} re S`);
      }
      continue;
    }

    if (element.type === "image") {
      // Voir l'en-tête : pas d'image dans le PDF direct. Le moteur de
      // rendu a déjà prévenu ; on ne laisse pas un trou muet, on trace
      // le cadre pour que la place réservée se voie.
      const x0 = mmVersPoints(element.xMm);
      const y0 = y(element.yMm + element.hauteurMm);
      lignes.push(
        `0.5 G 0.2 w ${pt(x0)} ${pt(y0)} ${pt(mmVersPoints(element.largeurMm))} ` +
          `${pt(mmVersPoints(element.hauteurMm))} re S`,
      );
      continue;
    }

    // PDF ne connaît pas l'alignement : on décale l'origine du texte de
    // sa largeur mesurée. C'est la même mesure que celle qui a servi à
    // l'ajuster, donc les deux ne peuvent pas diverger.
    const largeur = largeurTexteMm(element.texte, element.taillePt, element.gras);
    const decalage =
      element.alignement === "centre" ? -largeur / 2 : element.alignement === "droite" ? -largeur : 0;

    // `q` et `Q` seuls sur leur ligne : c'est ce qui rend l'état
    // graphique lisible à l'œil quand on ouvre le flux dans un éditeur,
    // et vérifiable par un test qui compte les empilements.
    const boite = element.decoupe;
    lignes.push("q");
    lignes.push(
      `${pt(mmVersPoints(boite.xMm))} ${pt(y(boite.yMm + boite.hauteurMm))} ` +
        `${pt(mmVersPoints(boite.largeurMm))} ${pt(mmVersPoints(boite.hauteurMm))} re W n`,
    );
    lignes.push(
      `BT 0 g /${ressourcePolice(element.gras, element.italique)} ${pt(element.taillePt)} Tf ` +
        `1 0 0 1 ${pt(mmVersPoints(element.xMm + decalage))} ${pt(y(element.yMm))} Tm ` +
        `${chainePdf(element.texte)} Tj ET`,
    );
    lignes.push("Q");
  }
  return lignes.join("\n");
}

// ------------------------------------------------------------------
// LE FICHIER
// ------------------------------------------------------------------

function octetsAscii(texte: string): Uint8Array {
  const sortie = new Uint8Array(texte.length);
  for (let i = 0; i < texte.length; i += 1) sortie[i] = texte.charCodeAt(i) & 0xff;
  return sortie;
}

/**
 * Assemble le PDF.
 *
 * LA TABLE DE RÉFÉRENCES CROISÉES EXIGE DES DÉCALAGES EN OCTETS EXACTS.
 * D'où l'accumulation par morceaux avec un compteur : concaténer des
 * chaînes puis mesurer `length` donnerait des CARACTÈRES, et un seul
 * accent dans un nom de cultivar suffirait à décaler toute la table —
 * le lecteur afficherait alors une page blanche sans dire pourquoi.
 */
export function ecrirePdf(pages: readonly PagePdf[]): Uint8Array {
  if (pages.length === 0) throw new Error("Un PDF sans page ne s'ouvre nulle part : il n'y a rien à imprimer.");

  const morceaux: Uint8Array[] = [];
  let position = 0;
  const decalages: number[] = [];

  const ecrire = (texte: string) => {
    const octets = octetsAscii(texte);
    morceaux.push(octets);
    position += octets.length;
  };
  const objet = (numero: number, corps: string) => {
    decalages[numero] = position;
    ecrire(`${numero} 0 obj\n${corps}\nendobj\n`);
  };

  // Numérotation : 1 catalogue, 2 arbre des pages, 3-6 polices, puis
  // deux objets par page (la page, son contenu).
  const premierObjetPage = 3 + POLICES.length;
  const idsPages = pages.map((_page, i) => premierObjetPage + i * 2);

  ecrire("%PDF-1.4\n");
  // Un commentaire binaire : il dit aux outils de transfert que le
  // fichier n'est pas du texte et ne doit pas subir de conversion de
  // fins de ligne.
  ecrire("%âãÏÓ\n");

  objet(1, "<< /Type /Catalog /Pages 2 0 R >>");
  objet(2, `<< /Type /Pages /Kids [${idsPages.map((n) => `${n} 0 R`).join(" ")}] /Count ${pages.length} >>`);
  POLICES.forEach((police, i) => {
    objet(3 + i, `<< /Type /Font /Subtype /Type1 /BaseFont /${police.base} /Encoding /WinAnsiEncoding >>`);
  });

  const ressources = `<< /Font << ${POLICES.map((p, i) => `/${p.ressource} ${3 + i} 0 R`).join(" ")} >> >>`;

  pages.forEach((page, i) => {
    const idPage = idsPages[i];
    const idContenu = idPage + 1;
    const contenu = contenuPage(page);
    // Le MediaBox EST la cote de la planche. Tout le reste du fichier
    // peut être approximatif ; ces quatre nombres, non.
    objet(
      idPage,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pt(mmVersPoints(page.largeurMm))} ` +
        `${pt(mmVersPoints(page.hauteurMm))}] /Resources ${ressources} /Contents ${idContenu} 0 R >>`,
    );
    objet(idContenu, `<< /Length ${octetsAscii(contenu).length} >>\nstream\n${contenu}\nendstream`);
  });

  const nombreObjets = premierObjetPage + pages.length * 2;
  const debutXref = position;
  let xref = `xref\n0 ${nombreObjets}\n0000000000 65535 f \n`;
  for (let n = 1; n < nombreObjets; n += 1) {
    xref += `${String(decalages[n] ?? 0).padStart(10, "0")} 00000 n \n`;
  }
  ecrire(xref);
  ecrire(`trailer\n<< /Size ${nombreObjets} /Root 1 0 R >>\nstartxref\n${debutXref}\n%%EOF\n`);

  const total = morceaux.reduce((somme, m) => somme + m.length, 0);
  const fichier = new Uint8Array(total);
  let curseur = 0;
  for (const m of morceaux) {
    fichier.set(m, curseur);
    curseur += m.length;
  }
  return fichier;
}

/**
 * Relit les MediaBox d'un PDF que nous venons d'écrire, en millimètres.
 *
 * ELLE EXISTE POUR LES TESTS, et elle est exportée exprès : « les
 * millimètres sont sacrés » n'est une promesse que tant que personne ne
 * les mesure. Ici, on ouvre le fichier produit et on lit les cotes que
 * le lecteur PDF lira.
 */
export function lireCotesPdf(fichier: Uint8Array): { largeurMm: number; hauteurMm: number }[] {
  let texte = "";
  for (const octet of fichier) texte += String.fromCharCode(octet);
  const cotes: { largeurMm: number; hauteurMm: number }[] = [];
  const motif = /\/MediaBox\s*\[\s*(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s*\]/g;
  for (let trouve = motif.exec(texte); trouve; trouve = motif.exec(texte)) {
    const enMm = (points: string) => arrondiMm((Number(points) * 25.4) / 72);
    cotes.push({
      largeurMm: enMm(trouve[3]) - enMm(trouve[1]),
      hauteurMm: enMm(trouve[4]) - enMm(trouve[2]),
    });
  }
  return cotes;
}

/** La hauteur de capitale, réexportée : les tests de calage en ont besoin. */
export { HAUTEUR_CAPITALE };
