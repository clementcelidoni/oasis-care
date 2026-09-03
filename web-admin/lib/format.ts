/**
 * ==================================================================
 * LE FORMATAGE — et la règle qui gouverne tout ce fichier
 * ==================================================================
 *
 * Spec p.4 : « Les KPI doivent être calculés depuis les vraies données.
 * Aucune valeur fictive en production. »
 *
 * L'audit a établi que onze des seize chiffres demandés n'existent pas
 * dans cette base. Les fonctions de 0075 rendent donc `null` pour
 * ceux-là, avec un `unknown_reasons` qui dit pourquoi. Tout le travail
 * de ce fichier consiste à ne PAS écraser ce `null`.
 *
 * IL N'Y A DONC AUCUN `?? 0`, AUCUN `|| 0`, AUCUN `coalesce` ICI, et
 * il ne doit jamais y en avoir. « 0 € de MRR » se lit « nous ne gagnons
 * rien » ; la vérité est « nous ne suivons l'abonnement d'aucune
 * entreprise ». Les deux phrases n'appellent pas la même décision, et
 * une seule des deux est vraie.
 *
 * Chaque fonction rend donc `string | null`, et c'est le composant
 * `MetricCard`/`UnknownValue` qui décide comment dessiner l'inconnu —
 * jamais un `0` déguisé.
 */

const FR = "fr-FR";

/**
 * Un entier, groupé à la française. `null` reste `null`.
 *
 * `Number.isFinite` écarte `NaN` et l'infini : une division ratée en
 * amont ne doit pas s'afficher comme « NaN » à côté de chiffres vrais,
 * elle doit s'afficher comme inconnue.
 */
export function formatCount(value: number | null | undefined): string | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return new Intl.NumberFormat(FR).format(value);
}

/**
 * De l'argent, reçu en CENTIMES ENTIERS et rendu en euros.
 *
 * La convention du projet : l'argent circule en centimes entiers, du
 * SQL jusqu'ici. La division par 100 se fait à la toute dernière
 * seconde, une seule fois, dans cette fonction — un montant qui aurait
 * traversé trois calculs en euros flottants aurait déjà perdu des
 * centimes en route.
 */
export function formatCents(
  cents: number | null | undefined,
  options?: { decimals?: boolean },
): string | null {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) return null;
  const decimals = options?.decimals ?? false;
  return new Intl.NumberFormat(FR, {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: decimals ? 2 : 0,
    maximumFractionDigits: decimals ? 2 : 0,
  }).format(cents / 100);
}

/** Un pourcentage déjà calculé (12.4 → « 12,4 % »). */
export function formatPercent(
  value: number | null | undefined,
  fractionDigits = 1,
): string | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return `${new Intl.NumberFormat(FR, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value)} %`;
}

/**
 * Une date-heure, à l'heure de PARIS.
 *
 * Le fuseau est imposé, pas déduit du navigateur : la base borne déjà
 * ses journées sur Paris (0066, puis 0075), et laisser le navigateur
 * décider ferait afficher « 3 inscriptions aujourd'hui » sur une
 * journée qui n'est pas celle qu'on a comptée. Une console
 * d'administration consultée depuis un aéroport doit montrer les mêmes
 * chiffres que depuis le bureau.
 */
export function formatDateTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(FR, {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Europe/Paris",
  }).format(date);
}

export function formatDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(FR, {
    dateStyle: "medium",
    timeZone: "Europe/Paris",
  }).format(date);
}

/** L'heure seule, pour une chronologie de la journée. */
export function formatTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(FR, {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Paris",
  }).format(date);
}

/**
 * « il y a 3 jours ». Rend `null` pour une date absente — surtout pas
 * « jamais », qui est une affirmation qu'on ne peut pas faire depuis
 * une valeur manquante.
 */
export function formatRelative(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;

  const seconds = Math.round((date.getTime() - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat(FR, { numeric: "auto" });

  const steps: [Intl.RelativeTimeFormatUnit, number][] = [
    ["second", 60],
    ["minute", 60],
    ["hour", 24],
    ["day", 30],
    ["month", 12],
  ];

  let amount = seconds;
  for (const [unit, size] of steps) {
    if (Math.abs(amount) < size) return formatter.format(Math.round(amount), unit);
    amount /= size;
  }
  return formatter.format(Math.round(amount), "year");
}

/**
 * Tronque un identifiant technique pour l'affichage.
 *
 * Spec p.35 : « Les IDs techniques ne doivent apparaître que dans
 * Technical details. » Quand il faut malgré tout en montrer un, huit
 * caractères suffisent à le reconnaître et évitent qu'une colonne de
 * table soit occupée par trente-six caractères illisibles.
 */
export function shortId(id: string | null | undefined): string | null {
  if (!id) return null;
  return id.length <= 8 ? id : `${id.slice(0, 8)}…`;
}
