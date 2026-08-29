import type { QuantityReport } from "../twin/quantities.ts";
import type { CatalogItemType } from "./types.ts";

/**
 * §"DIGITAL TWIN → DEVIS" — `QuoteFromDigitalTwinService`.
 *
 * « L'utilisateur sélectionne : Massif Méditerranéen. Puis : Ajouter au
 * devis. Oasis propose : Préparation sol 36.4 m², Géotextile 36.4 m²,
 * Paillage X m³, Bordure 22.8 ml, Irrigation 41.2 ml, Plantation 31
 * unités. L'utilisateur valide/modifie. »
 *
 * Et surtout, en gras dans le document : « NE PAS ajouter
 * silencieusement des coûts. »
 *
 * D'où la forme de ce fichier. Il PROPOSE des lignes, il n'en crée
 * aucune : rien n'est écrit tant que l'utilisateur n'a pas relu l'écran
 * de validation. Aucune ligne ne porte de prix ici — le prix vient du
 * catalogue au moment de l'insertion, et vaut zéro si l'article n'y est
 * pas, ce que l'écran signale plutôt que de le combler.
 *
 * TOUTE HYPOTHÈSE EST VISIBLE DANS LE LIBELLÉ. Un volume de paillage
 * suppose une épaisseur ; on l'écrit dans la désignation (« ép. 5 cm »)
 * au lieu de la cacher dans un calcul. L'utilisateur qui pose 10 cm
 * corrige la quantité en voyant pourquoi elle était fausse.
 *
 * Fonction pure : testable, et c'est ce dont on a besoin d'un calcul
 * qui alimente un prix.
 */

export type ProposedLine = {
  /** Clé stable pour React et pour la case à cocher du formulaire. */
  key: string;
  /** Poste du devis auquel la rattacher. */
  section: string;
  description: string;
  quantity: number;
  unit: string;
  /** Sert à retrouver un article du catalogue de même nature. */
  itemType: CatalogItemType;
  /**
   * Ce d'où vient la quantité, en une phrase. Affiché sous la ligne :
   * un chiffre dont on ne sait pas d'où il sort ne se vérifie pas.
   */
  origin: string;
};

/** Épaisseur de paillage retenue par défaut, en mètres. Toujours affichée. */
const MULCH_DEPTH_METERS = 0.05;

/** Les sections du devis, dans l'ordre du chantier — §SECTIONS. */
export const TWIN_SECTIONS = [
  "Préparation",
  "Plantation",
  "Irrigation",
  "Éclairage",
  "Finitions",
] as const;

function round(value: number, decimals = 2): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

/**
 * Traduit un métré en lignes de devis proposées.
 *
 * Les surfaces engendrent plusieurs lignes — un massif se prépare, se
 * bâche, se paille et se plante — parce que c'est ainsi qu'on le
 * chiffre. Les linéaires et les comptes en engendrent une chacun : leur
 * unité de vente EST leur mesure.
 */
export function proposeQuoteLines(report: QuantityReport): ProposedLine[] {
  const proposed: ProposedLine[] = [];

  for (const surface of report.surfaces) {
    // Le terrain n'est pas un ouvrage : c'est le périmètre du chantier,
    // pas une surface à préparer. Le chiffrer reviendrait à facturer la
    // parcelle entière.
    if (surface.key === "boundary-area") continue;

    const area = round(surface.value, 1);
    const what = surface.label.replace(/\s*\(\d+\)$/, "").toLowerCase();

    proposed.push({
      key: `prep-${surface.key}`,
      section: "Préparation",
      description: `Préparation du sol — ${what}`,
      quantity: area, unit: "m²", itemType: "labor",
      origin: `Surface mesurée sur le plan : ${area} m²`,
    });
    proposed.push({
      key: `geo-${surface.key}`,
      section: "Préparation",
      description: `Géotextile — ${what}`,
      quantity: area, unit: "m²", itemType: "material",
      origin: "Même surface que la préparation",
    });
    proposed.push({
      key: `mulch-${surface.key}`,
      section: "Finitions",
      description: `Paillage — ${what} (ép. ${MULCH_DEPTH_METERS * 100} cm)`,
      quantity: round(area * MULCH_DEPTH_METERS, 2), unit: "m³", itemType: "material",
      origin: `${area} m² × ${MULCH_DEPTH_METERS * 100} cm — corrigez la quantité si l'épaisseur diffère`,
    });
  }

  for (const length of report.lengths) {
    // Le périmètre du terrain sert à situer, pas à chiffrer : personne
    // ne facture une bordure tout autour de la parcelle.
    if (length.key === "boundary-perimeter") continue;

    const metres = round(length.value, 1);

    if (length.key.startsWith("edge-")) {
      proposed.push({
        key: length.key,
        section: "Finitions",
        description: `Bordure — ${length.label.replace(/^Bordure — /, "")}`,
        quantity: metres, unit: "m", itemType: "material",
        origin: `Périmètre de la zone : ${metres} m`,
      });
      continue;
    }

    if (length.key.startsWith("pipe-")) {
      proposed.push({
        key: length.key,
        section: "Irrigation",
        description: length.label,
        quantity: metres, unit: "m", itemType: "material",
        origin: `Tracé mesuré sur le plan : ${metres} m`,
      });
      continue;
    }

    if (length.key.startsWith("cable-")) {
      proposed.push({
        key: length.key,
        section: "Éclairage",
        description: length.label,
        quantity: metres, unit: "m", itemType: "material",
        origin: `Tracé mesuré sur le plan : ${metres} m`,
      });
    }
  }

  for (const count of report.counts) {
    const isVegetation = count.key.startsWith("veg-");
    proposed.push({
      key: count.key,
      section: isVegetation ? "Plantation" : "Irrigation",
      description: isVegetation
        ? `Fourniture et plantation — ${count.label}`
        : `Fourniture et pose — ${count.label}`,
      quantity: count.value,
      unit: "u",
      itemType: isVegetation ? "plant" : "equipment",
      origin: `${count.value} sur le plan`,
    });
  }

  // Les équipements d'arrosage sont dans la section Irrigation, mais un
  // nichoir n'y a rien à faire. Reclassé après coup plutôt que dans la
  // boucle : la règle tient en une ligne ici, elle aurait fait trois
  // branches au-dessus.
  const IRRIGATION_WORDS = /arroseur|goutteur|vanne|pompe|filtre|point d'eau/i;
  for (const line of proposed) {
    if (line.section === "Irrigation" && line.itemType === "equipment"
        && !IRRIGATION_WORDS.test(line.description)) {
      line.section = "Finitions";
    }
  }

  return proposed;
}

/** Les sections effectivement utilisées, dans l'ordre du chantier. */
export function usedSections(lines: ProposedLine[]): string[] {
  return TWIN_SECTIONS.filter((s) => lines.some((l) => l.section === s));
}
