/**
 * TRANSCRIPTION SVG — la sortie « navigateur » du § 17.
 *
 * POURQUOI DU SVG ET PAS UNE IMAGE. Un QR pixelisé ne se scanne pas :
 * une tête thermique à 203 dpi rend 8 points par millimètre, un écran
 * en rend 4 ; imprimer un PNG d'écran, c'est imprimer des modules aux
 * bords sales, et un lecteur qui hésite. Le SVG est du vectoriel : la
 * planche sort à la définition de l'imprimante, quelle qu'elle soit.
 *
 * L'UNITÉ EST LE MILLIMÈTRE, ET C'EST CE QUI REND LES COTES JUSTES.
 * `width="60mm" height="40mm" viewBox="0 0 60 40"` : une unité
 * utilisateur vaut exactement un millimètre. Le `mm` de CSS est absolu
 * (1 mm = 96/25,4 px), donc le navigateur imprime bien 60 mm — à deux
 * conditions qui ne sont PAS dans notre code : échelle à 100 % et
 * marges du navigateur à zéro. Voir la règle de contrôle de planche.ts.
 */

import { mm, pointsVersMm } from "./mesures.ts";
import type { ElementRendu } from "./types.ts";

function echapper(texte: string): string {
  return texte
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * La pile de polices.
 *
 * Arial a été dessinée pour être métriquement compatible avec
 * Helvetica : les deux ont exactement les mêmes chasses. L'aperçu à
 * l'écran, la sortie « Imprimer » du navigateur et le PDF direct
 * (qui, lui, emploie l'Helvetica intégrée au lecteur) tombent donc au
 * même endroit, au caractère près.
 */
export const PILE_POLICES = "Helvetica, Arial, sans-serif";

const ANCRAGES = { gauche: "start", centre: "middle", droite: "end" } as const;

/** Transcrit une liste d'éléments en fragment SVG, sans balise racine. */
export function elementsVersSvg(elements: readonly ElementRendu[], prefixeId: string): string {
  const morceaux: string[] = [];
  const decoupes: string[] = [];
  // Un cadre identique ne mérite qu'une définition : voir plus bas.
  const identifiants = new Map<string, string>();

  elements.forEach((element, index) => {
    if (element.type === "rectangle") {
      if (element.rempli) {
        morceaux.push(
          `<rect x="${mm(element.xMm)}" y="${mm(element.yMm)}" width="${mm(element.largeurMm)}" ` +
            `height="${mm(element.hauteurMm)}" fill="#000"/>`,
        );
      } else {
        const trait = element.epaisseurMm ?? 0.1;
        morceaux.push(
          `<rect x="${mm(element.xMm)}" y="${mm(element.yMm)}" width="${mm(element.largeurMm)}" ` +
            `height="${mm(element.hauteurMm)}" fill="none" stroke="#000" stroke-width="${mm(trait)}"/>`,
        );
      }
      return;
    }

    if (element.type === "image") {
      morceaux.push(
        `<image x="${mm(element.xMm)}" y="${mm(element.yMm)}" width="${mm(element.largeurMm)}" ` +
          `height="${mm(element.hauteurMm)}" preserveAspectRatio="xMidYMid meet" ` +
          `href="${echapper(element.dataUri)}"/>`,
      );
      return;
    }

    const tailleMm = pointsVersMm(element.taillePt);
    const attributs =
      `x="${mm(element.xMm)}" y="${mm(element.yMm)}" font-family="${PILE_POLICES}" ` +
      `font-size="${mm(tailleMm)}" text-anchor="${ANCRAGES[element.alignement]}" fill="#000"` +
      (element.gras ? ' font-weight="bold"' : "") +
      (element.italique ? ' font-style="italic"' : "");

    // LA DÉCOUPE EST POSÉE SUR TOUT TEXTE, SANS CONDITION — et c'est
    // une correction, pas une précaution.
    //
    // Elle ne l'était qu'en cas de débordement en LARGEUR. Le PDF, lui,
    // découpe toujours (`re W n`). Un texte trop haut pour son cadre —
    // un corps de 24 points dans 4 mm — sortait donc entier à l'écran
    // et tranché sur le papier : l'aperçu montrait autre chose que le
    // fichier imprimé, ce que l'en-tête de rendu.ts promet impossible
    // (« un seul moteur, deux transcriptions bêtes »). Le moteur
    // avertit désormais du débordement vertical ; la découpe est ce qui
    // rend l'aperçu HONNÊTE quand on choisit de l'ignorer.
    //
    // LE POIDS EST TENU AUTREMENT : les cadres identiques partagent une
    // seule définition. Une planche de quarante étiquettes bâties sur
    // le même modèle porte donc autant de `clipPath` que le modèle a de
    // champs, pas quarante fois plus.
    const cle = `${mm(element.decoupe.xMm)},${mm(element.decoupe.yMm)},${mm(element.decoupe.largeurMm)},${mm(element.decoupe.hauteurMm)}`;
    let id = identifiants.get(cle);
    if (id === undefined) {
      id = `${prefixeId}-d${index}`;
      identifiants.set(cle, id);
      decoupes.push(
        `<clipPath id="${id}"><rect x="${mm(element.decoupe.xMm)}" y="${mm(element.decoupe.yMm)}" ` +
          `width="${mm(element.decoupe.largeurMm)}" height="${mm(element.decoupe.hauteurMm)}"/></clipPath>`,
      );
    }
    morceaux.push(`<g clip-path="url(#${id})"><text ${attributs}>${echapper(element.texte)}</text></g>`);
  });

  return (decoupes.length > 0 ? `<defs>${decoupes.join("")}</defs>` : "") + morceaux.join("");
}

export type OptionsSvg = {
  /** Fond blanc explicite. Vrai par défaut : le papier est blanc, l'écran non. */
  readonly fondBlanc?: boolean;
  /** Attribut `class` de la balise racine, pour que la page CSS s'y accroche. */
  readonly classe?: string;
};

/** Un document SVG complet, aux cotes exactes en millimètres. */
export function documentSvg(
  largeurMm: number,
  hauteurMm: number,
  contenu: string,
  options: OptionsSvg = {},
): string {
  const fond =
    (options.fondBlanc ?? true)
      ? `<rect x="0" y="0" width="${mm(largeurMm)}" height="${mm(hauteurMm)}" fill="#fff"/>`
      : "";
  const classe = options.classe ? ` class="${echapper(options.classe)}"` : "";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" version="1.1"${classe} ` +
    `width="${mm(largeurMm)}mm" height="${mm(hauteurMm)}mm" ` +
    `viewBox="0 0 ${mm(largeurMm)} ${mm(hauteurMm)}" shape-rendering="crispEdges">` +
    fond +
    contenu +
    `</svg>`
  );
}
