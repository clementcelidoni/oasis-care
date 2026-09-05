import { estFamille, type FamilleAction } from "./journal.ts";

/**
 * ==================================================================
 * LES FILTRES DU JOURNAL — dans l'URL, comme partout ici
 * ==================================================================
 *
 * Un journal d'audit se lit en le découpant : « les changements de
 * droits des trente derniers jours », « tout ce qu'a fait untel ». Ces
 * découpes doivent pouvoir se coller dans un message — c'est
 * exactement ce qu'on fait quand on explique un incident à quelqu'un.
 *
 * Aucune base, aucun Next : éprouvable seul (`filtres.test.ts`).
 */

export const FENETRES = ["24h", "7j", "30j", "tout"] as const;
export type Fenetre = (typeof FENETRES)[number];

export const FENETRE_PAR_DEFAUT: Fenetre = "30j";

export const LIBELLES_FENETRE: Record<Fenetre, string> = {
  "24h": "24 heures",
  "7j": "7 jours",
  "30j": "30 jours",
  tout: "Depuis le début",
};

const HEURES: Record<Fenetre, number | null> = {
  "24h": 24,
  "7j": 24 * 7,
  "30j": 24 * 30,
  tout: null,
};

/**
 * La borne basse d'une fenêtre, en ISO — ou `null` pour « tout ».
 *
 * `maintenant` est un paramètre plutôt qu'un `new Date()` caché : sans
 * lui, ce calcul ne serait pas éprouvable, et c'est celui qui décide de
 * ce qu'on VOIT dans un journal d'audit.
 */
export function borneBasse(fenetre: Fenetre, maintenant: Date = new Date()): string | null {
  const heures = HEURES[fenetre];
  if (heures === null) return null;
  return new Date(maintenant.getTime() - heures * 3600 * 1000).toISOString();
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type FiltresEcranJournal = {
  famille: FamilleAction | null;
  fenetre: Fenetre;
  adminUserId: string | null;
  recherche: string | null;
  page: number;
};

function premiere(valeur: string | string[] | undefined): string | null {
  if (Array.isArray(valeur)) return valeur[0] ?? null;
  return typeof valeur === "string" ? valeur : null;
}

export function lireFiltresJournal(params: {
  [cle: string]: string | string[] | undefined;
}): FiltresEcranJournal {
  const familleBrute = premiere(params.famille);
  const fenetreBrute = premiere(params.fenetre);
  const adminBrut = premiere(params.admin);
  const rechercheBrute = premiere(params.q);
  const page = Number.parseInt(premiere(params.page) ?? "", 10);

  return {
    // « autre » n'a aucun préfixe : elle ne peut pas se filtrer en base,
    // et la proposer produirait une liste vide qu'on lirait « aucun
    // acte de cette famille ». Elle est donc refusée ici, à la source.
    famille:
      estFamille(familleBrute) && familleBrute !== "autre" ? familleBrute : null,
    fenetre: (FENETRES as readonly string[]).includes(fenetreBrute ?? "")
      ? (fenetreBrute as Fenetre)
      : FENETRE_PAR_DEFAUT,
    adminUserId: adminBrut !== null && UUID.test(adminBrut) ? adminBrut : null,
    recherche:
      rechercheBrute !== null && rechercheBrute.trim() !== "" ? rechercheBrute.trim() : null,
    page: Number.isFinite(page) && page >= 1 ? page : 1,
  };
}

/**
 * Reconstruit l'URL en changeant UNE chose, et remet la page à 1 dès
 * qu'autre chose bouge : la page 4 d'une liste filtrée autrement
 * afficherait un vide qu'on lirait « aucun acte ».
 */
export function lienJournal(
  base: string,
  filtres: FiltresEcranJournal,
  changement: Partial<FiltresEcranJournal>,
): string {
  const suivant = { ...filtres, ...changement };
  const parametres = new URLSearchParams();

  if (suivant.famille !== null) parametres.set("famille", suivant.famille);
  if (suivant.fenetre !== FENETRE_PAR_DEFAUT) parametres.set("fenetre", suivant.fenetre);
  if (suivant.adminUserId !== null) parametres.set("admin", suivant.adminUserId);
  if (suivant.recherche !== null) parametres.set("q", suivant.recherche);

  const page = changement.page ?? 1;
  if (page > 1) parametres.set("page", String(page));

  const chaine = parametres.toString();
  return chaine === "" ? base : `${base}?${chaine}`;
}

/** Les valeurs actives, pour les champs cachés du formulaire de recherche. */
export function champsCachesJournal(
  filtres: FiltresEcranJournal,
): { nom: string; valeur: string }[] {
  const champs: { nom: string; valeur: string }[] = [];
  if (filtres.famille !== null) champs.push({ nom: "famille", valeur: filtres.famille });
  if (filtres.fenetre !== FENETRE_PAR_DEFAUT) {
    champs.push({ nom: "fenetre", valeur: filtres.fenetre });
  }
  if (filtres.adminUserId !== null) champs.push({ nom: "admin", valeur: filtres.adminUserId });
  return champs;
}
