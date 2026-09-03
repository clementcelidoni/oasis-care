// L'extension est ÉCRITE, comme dans les fichiers de test : ce module
// est chargé par `node --test`, qui l'exige, autant que par Next, qui
// s'en accommode. Sans elle, la suite tombe sur « module introuvable »
// au premier import transitif — et un test qui ne démarre pas ne
// protège rien.
import { shareOf } from "./aggregate.ts";
import type { MobileOsRow, MobileVersionRow, PlatformKpisRow } from "./types.ts";

/**
 * ==================================================================
 * LIRE « N UTILISATEURS MOBILE » SANS LUI FAIRE DIRE PLUS QU'IL NE DIT
 * ==================================================================
 *
 * Ce module ne compte rien : la base a déjà compté. Il fait UNE chose,
 * et c'est la moitié du travail — transformer cinq colonnes de
 * `admin_platform_kpis()` en ce que l'écran doit montrer À CÔTÉ du
 * chiffre, sans survol.
 *
 * ------------------------------------------------------------------
 * POURQUOI CE CHIFFRE NE PEUT PAS S'AFFICHER SEUL
 * ------------------------------------------------------------------
 * Il va monter tout seul pendant des semaines. Le jour où la migration
 * 0077 est posée, aucun iPhone ne porte encore la version qui déclare
 * sa présence : le chiffre ne contient que des DÉDUCTIONS rétroactives.
 * Puis, à mesure que le parc bascule, des déclarations s'ajoutent — et
 * une courbe qui monte sans explication se lit comme une croissance
 * d'usage, alors que c'est une croissance de la MESURE.
 *
 * L'écran doit donc dire, à côté du nombre et sans qu'il faille
 * survoler : combien sont déclarés, combien sont déduits, et depuis
 * quand la collecte existe. C'est ce que `mobilePresence()` prépare.
 *
 * ------------------------------------------------------------------
 * ET POURQUOI IL NE PEUT PAS S'AFFICHER EN ZÉRO
 * ------------------------------------------------------------------
 * La base rend `null` — jamais 0 — tant que rien n'est mesurable, avec
 * un motif DATÉ dans `unknown_reasons.mobile_users`. Ce module ne
 * fabrique donc aucun repli : pas de `?? 0`, pas de chaîne vide. Le
 * projet a déjà corrigé deux fois la confusion entre « zéro » et « je
 * ne sais pas » (migrations 0059 et 0065) ; elle ne rentrera pas par
 * ici.
 */

export type MobilePresence = {
  /** Les comptes dont un usage mobile est attesté. `null` = inconnu, jamais 0. */
  users: number | null;
  /** Ceux dont une installation s'est annoncée depuis la mise en service. */
  declared: number | null;
  /** Ceux déduits d'une activité passée. Ils ne portent ni version ni plateforme. */
  inferred: number | null;
  /** Le début de la collecte, ISO 8601. */
  startedAt: string | null;
  /** La phrase de la base : motif daté de l'inconnu, ou réserve de borne inférieure. */
  note: string | null;
  /**
   * VRAI tant qu'aucune installation ne s'est annoncée — c'est-à-dire
   * tant que le parc n'a pas basculé sur la version qui déclare sa
   * présence. Dans cet état, tout ce que l'écran montre vient de la
   * reprise rétroactive, et les distributions de versions sont VIDES
   * sans que rien ne soit en panne.
   */
  awaitingFirstDeclaration: boolean;
};

/** Ce que la base sait du parc mobile, rangé pour l'écran. */
export function mobilePresence(kpis: PlatformKpisRow): MobilePresence {
  const declared = finite(kpis.mobile_users_declared);
  return {
    users: finite(kpis.mobile_users),
    declared,
    inferred: finite(kpis.mobile_users_inferred),
    startedAt: kpis.mobile_collection_started_at,
    note: nonEmpty(kpis.mobile_users_note),
    // `null` n'est pas « zéro déclaration » : c'est « on ne sait pas
    // combien ». Les deux mènent au même écran d'attente, mais on ne
    // les confond pas dans le raisonnement — `declared === 0` est une
    // mesure, `declared === null` une absence de mesure.
    awaitingFirstDeclaration: declared === null || declared === 0,
  };
}

/**
 * La ligne courte affichée SOUS le chiffre, sur la carte du tableau de
 * bord. Visible, pas en survol : c'est la consigne.
 *
 * Rend `null` quand il n'y a rien à mettre sous un chiffre qui
 * n'existe pas — la carte affiche alors l'inconnu et son motif daté, ce
 * qui dit déjà tout.
 *
 * ------------------------------------------------------------------
 * ELLE NE RECOPIE PAS LA PHRASE DE LA BASE, ET C'EST VOULU
 * ------------------------------------------------------------------
 * `mobile_users_note` fait trois lignes : c'est le bon texte pour un
 * paragraphe, pas pour la ligne d'une carte. Les deux coexistent —
 * cette ligne-ci pour lire le chiffre d'un coup d'œil, la phrase de la
 * base, en entier, un peu plus bas sur le même écran. Résumer sans
 * afficher l'original aurait perdu la réserve ; afficher l'original
 * sans résumé aurait noyé le chiffre.
 */
export function mobileBreakdown(presence: MobilePresence): string | null {
  if (presence.users === null) return null;

  const parts: string[] = [];

  // Une répartition dont une moitié manque n'est pas une répartition :
  // « 3 déclarés » sans son pendant laisserait croire que les autres
  // n'existent pas. On exige les deux, ou aucun.
  if (presence.declared !== null && presence.inferred !== null) {
    parts.push(`${plural(presence.declared, "déclaré")} par l'application`);
    parts.push(`${plural(presence.inferred, "déduit")} de l'activité passée`);
  } else {
    parts.push("répartition déclaré / déduit inconnue");
  }

  const since = frenchDate(presence.startedAt);
  parts.push(since === null ? "borne inférieure" : `borne inférieure · collecte depuis le ${since}`);

  return parts.join(" · ");
}

/**
 * La part d'une ligne de distribution, en pourcentage — ou `null`.
 *
 * Le dénominateur est `declared_installations_total`, que la base
 * répète sur chaque ligne. On ne le reconstitue SURTOUT PAS en
 * additionnant les lignes affichées : une page tronquée donnerait un
 * total plus petit que la réalité, et donc des pourcentages gonflés qui
 * finiraient par dépasser 100 % sans que rien ne le signale.
 *
 * `shareOf` refuse une part supérieure au tout au lieu de la raboter :
 * un rapport raboté se dessine comme un 100 % parfaitement plausible.
 */
export function distributionPercent(row: {
  installations: number;
  declared_installations_total: number;
}): number | null {
  const ratio = shareOf(row.installations, row.declared_installations_total);
  if (ratio === null) return null;
  return Math.round(ratio * 1000) / 10;
}

/**
 * Le nombre d'installations déclarées, lu sur les lignes rendues.
 *
 * Il vient de `declared_installations_total`, identique sur toutes les
 * lignes ; on prend la première plutôt que d'additionner, pour la
 * raison ci-dessus. Un tableau vide rend `0` et non `null` : ici, le
 * zéro est MESURÉ — la fonction a bien répondu, elle n'avait aucune
 * installation déclarée à décrire. C'est la seule place de ce chantier
 * où un zéro est la vérité, et il ne se lit pas « aucun utilisateur
 * mobile » mais « aucune installation ne s'est encore annoncée ».
 */
export function declaredInstallations(
  rows: ReadonlyArray<MobileVersionRow | MobileOsRow>,
): number {
  if (rows.length === 0) return 0;
  const total = rows[0].declared_installations_total;
  return Number.isFinite(total) ? total : 0;
}

/** `null` pour tout ce qui n'est pas un nombre utilisable. Aucun repli sur 0. */
function finite(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return value;
}

function nonEmpty(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * « 1 déclaré », « 3 déclarés ». Le pluriel français se joue à partir de
 * DEUX : « 0 déclaré » et « 1 déclaré » s'écrivent au singulier, et
 * l'oublier ferait écrire « 0 déclarés » sur la carte la plus lue du
 * Control Center.
 */
function plural(count: number, word: string): string {
  const formatted = new Intl.NumberFormat("fr-FR").format(count);
  return `${formatted} ${word}${Math.abs(count) >= 2 ? "s" : ""}`;
}

/**
 * Une date courte, à l'heure de PARIS — le même fuseau que la base, qui
 * a déjà écrit la sienne dans `mobile_users_note`. Deux dates
 * différentes pour le même instant, sur le même écran, se lisent comme
 * deux collectes.
 */
function frenchDate(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "short",
    timeZone: "Europe/Paris",
  }).format(date);
}
