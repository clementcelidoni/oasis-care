/**
 * ==================================================================
 * LA PAGINATION — et le piège que `total_count` tend à qui l'oublie
 * ==================================================================
 *
 * « Pagination réelle — une table qui charge tout finira par ne plus
 * charger. » Les deux fonctions de liste de 0075 paginent donc en SQL
 * (`offset`/`limit`, taille plafonnée à 200), et rendent le total dans
 * une colonne `total_count`.
 *
 * ------------------------------------------------------------------
 * CE TOTAL VOYAGE SUR LES LIGNES, DONC IL DISPARAÎT AVEC ELLES
 * ------------------------------------------------------------------
 * `total_count` est répété sur chaque ligne rendue — vérifié sur la
 * vraie base. Une page qui ne rend AUCUNE ligne ne rend donc aucun
 * total : la valeur n'est pas zéro, elle est absente.
 *
 * Les deux situations n'ont rien à voir et ne doivent pas se
 * confondre :
 *
 *   • page 1 sans ligne  → il n'y a réellement aucun résultat ;
 *   • page 7 sans ligne  → il y a peut-être des centaines de
 *     résultats, mais pas au-delà de la page 6.
 *
 * Écrire `total ?? 0` ici afficherait « 0 à 0 sur 0 » à un
 * administrateur qui vient de dépasser la fin d'une liste de mille
 * comptes. C'est exactement le `?? 0` que ce projet s'interdit, appliqué
 * à un compteur de personnes : `total` reste donc `number | null`, et
 * c'est l'écran qui décide quoi dire de l'absence.
 */

/** La taille de page des listes d'administration. Le SQL plafonne à 200. */
export const PAGE_SIZE = 50;

export type Paged<Row> = {
  rows: Row[];
  page: number;
  pageSize: number;
  /** `null` quand la page est vide : le total voyageait sur les lignes. */
  total: number | null;
};

/**
 * Le numéro de page demandé par l'URL.
 *
 * Tout ce qui n'est pas un entier positif vaut 1 : `?page=0`,
 * `?page=-3`, `?page=abc`, `?page=1e9`, un paramètre répété. Une page
 * illisible n'est pas une erreur à montrer, c'est une adresse mal
 * recopiée — et le SQL applique de toute façon `greatest(page, 1)`
 * derrière.
 *
 * Le plafond n'est pas décoratif : sans lui, `?page=99999999999`
 * demanderait à PostgreSQL un `offset` de cinq mille milliards, qu'il
 * accepterait de calculer en balayant la table.
 */
export function parsePage(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined) return 1;

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return Math.min(parsed, 100_000);
}

/** Le texte d'une recherche venue de l'URL, nettoyé. Vide devient `null`. */
export function parseSearch(raw: string | string[] | undefined): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Emballe les lignes rendues par une fonction de liste.
 *
 * Le total est lu sur la PREMIÈRE ligne : la colonne est identique sur
 * toutes, la lire ailleurs ne changerait rien.
 */
export function toPage<Row extends { total_count: number }>(
  rows: Row[],
  page: number,
  pageSize: number,
): Paged<Row> {
  const first = rows[0];
  const total =
    first !== undefined && Number.isFinite(first.total_count) ? first.total_count : null;

  return { rows, page, pageSize, total };
}

/**
 * La page vide est-elle un « au-delà de la fin » plutôt qu'un « aucun
 * résultat » ? La distinction décide du message affiché, et du lien
 * qu'on propose pour s'en sortir.
 */
export function isBeyondLastPage<Row>(paged: Paged<Row>): boolean {
  return paged.rows.length === 0 && paged.page > 1;
}
