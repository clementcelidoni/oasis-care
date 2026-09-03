/**
 * ==================================================================
 * AGRÉGER SANS MENTIR — les quatre opérations du tableau de bord
 * ==================================================================
 *
 * La mise en forme proprement dite vit dans `@/lib/format`
 * (`formatCount`, `formatCents`, `formatPercent`, `formatDateTime`) et
 * ne se duplique pas ici. Ce fichier ne contient que ce qui est propre
 * au tableau de bord : les rares endroits où l'écran COMBINE deux
 * chiffres, plus la lecture des motifs d'inconnu.
 *
 * Pourquoi ces quatre fonctions existent alors qu'une addition et une
 * division tiennent sur une ligne : parce que la ligne évidente est
 * fausse. `(a ?? 0) + (b ?? 0)` rend un total trop bas qui a l'air
 * d'un total, et `a / b` rend `Infinity` ou `NaN` quand `b` vaut zéro.
 * Les deux fautes sont invisibles à la relecture et indétectables à
 * l'écran. Elles sont donc écrites une fois, ici, et testées.
 *
 * Aucun `?? 0`, aucun `|| 0` dans ce fichier, et il ne doit jamais en
 * apparaître.
 */

/**
 * Une progression signée : 482 → « +482 », -3 → « −3 », 0 → « ±0 ».
 *
 * Absente de `@/lib/format` parce qu'elle est propre au tableau de
 * bord : ailleurs, un nombre est un nombre ; ici, « +482 ce mois »
 * répond à une question de croissance et le signe porte la moitié du
 * sens. Le moins est le vrai signe typographique (U+2212), pas un
 * trait d'union : à côté d'un plus, un tiret court paraît cassé.
 */
export function formatSignedCount(value: number | null | undefined): string | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  if (value === 0) return "±0";
  const sign = value > 0 ? "+" : "−";
  return `${sign}${new Intl.NumberFormat("fr-FR").format(Math.abs(value))}`;
}

/**
 * LA RÈGLE DE L'ADDITION HONNÊTE.
 *
 * « Essais en cours » et « Résiliations » agrègent deux mondes : le
 * mobile et le Pro. Si l'un des deux est inconnu, le total l'est
 * aussi — additionner ce qu'on sait et taire le reste rendrait un
 * chiffre systématiquement trop bas, et un chiffre trop bas a l'air
 * d'un chiffre. Un tableau de bord qui ment sur un seul indicateur ne
 * se croit plus sur aucun.
 *
 * Une liste vide rend `null` : on n'a rien additionné, on ne sait rien.
 */
export function sumKnown(values: ReadonlyArray<number | null>): number | null {
  if (values.length === 0) return null;
  let total = 0;
  for (const value of values) {
    if (value === null || !Number.isFinite(value)) return null;
    total += value;
  }
  return total;
}

/**
 * La part d'un tout, entre 0 et 1 — ou `null` si la question n'a pas
 * de réponse.
 *
 * Un dénominateur nul n'est pas 0 % : « aucune entreprise, donc 0 %
 * d'entreprises couvertes » est un énoncé vide, et surtout il
 * dessinerait une barre à zéro là où il n'y a rien à répartir.
 *
 * UNE PART SUPÉRIEURE AU TOUT REND `null`, ELLE NE SE RABOTE PAS. La
 * tentation est de borner le rapport à 1 pour que la barre ne déborde
 * pas de sa piste : c'est exactement ce qu'il ne faut pas faire. Un
 * rapport supérieur à 1 n'est pas une valeur extrême, c'est la preuve
 * que le numérateur et le dénominateur ne comptent pas la même
 * population — et raboté, il se dessine comme un 100 % parfaitement
 * plausible. « Tous nos comptes sont rattachés à une entreprise Pro »
 * est une phrase qu'un tableau de bord ne doit jamais prononcer par
 * accident.
 */
export function shareOf(part: number | null, whole: number | null): number | null {
  if (part === null || whole === null) return null;
  if (!Number.isFinite(part) || !Number.isFinite(whole)) return null;
  if (whole <= 0) return null;
  if (part < 0 || part > whole) return null;
  return part / whole;
}

/** Le motif d'un inconnu, ou `null` si la base n'en a pas fourni. */
export function reasonFor(
  reasons: Record<string, string> | null | undefined,
  key: string,
): string | null {
  if (!reasons) return null;
  const reason = reasons[key];
  return typeof reason === "string" && reason !== "" ? reason : null;
}

/**
 * Le motif d'un chiffre agrégé : celui de CHAQUE source qui manque,
 * mis bout à bout.
 *
 * Deux sources muettes donnent deux explications. Ne montrer que la
 * première laisserait croire que l'autre, elle, est mesurée.
 */
export function combineReasons(
  reasons: Record<string, string> | null | undefined,
  keys: readonly string[],
): string | null {
  const parts = keys
    .map((key) => reasonFor(reasons, key))
    .filter((reason): reason is string => reason !== null);
  if (parts.length === 0) return null;
  return parts.join(" ");
}
