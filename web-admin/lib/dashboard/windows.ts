/**
 * OASIS CONTROL CENTER — les fenêtres de l'écran d'activité.
 *
 * La spec p.4 dit « aujourd'hui ». On en offre trois autres, parce que
 * « rien depuis minuit » à 00 h 10 ne veut rien dire et que l'équipe
 * doit pouvoir reculer d'une heure ou d'une semaine pour savoir si
 * c'est normal.
 *
 * TOUTES LES FENÊTRES SE TERMINENT MAINTENANT, et ce n'est pas un
 * choix d'interface : `signed_in_users` est dérivé de
 * `last_sign_in_at`, qui ne donne que la DERNIÈRE connexion de chaque
 * compte. « Dernière connexion postérieure à X » n'est l'ensemble des
 * comptes connectés depuis X que si la fenêtre se termine à l'instant
 * présent. Une fenêtre passée (« hier ») rendrait un chiffre faux,
 * silencieusement. On ne l'offre donc pas.
 */

export type ActivityWindowKey = "jour" | "1h" | "24h" | "7j";

export type ActivityWindow = {
  key: ActivityWindowKey;
  /** L'étiquette du sélecteur. */
  label: string;
  /** Ce que la fenêtre veut dire, en toutes lettres. */
  description: string;
  /**
   * Le début de la fenêtre, ou `null` pour laisser la BASE décider —
   * minuit à Paris. Déléguer ce calcul au SQL évite que le fuseau du
   * serveur Node décide de ce qu'est « aujourd'hui » : 0075 et 0066
   * ont déjà tranché en faveur de Paris.
   */
  since: Date | null;
};

const HOUR_MS = 60 * 60 * 1000;

/**
 * Traduit `?fenetre=…` en fenêtre. Une valeur absente, inconnue ou
 * multiple retombe sur « aujourd'hui » : l'écran doit s'afficher même
 * si l'URL a été bricolée à la main.
 */
export function resolveActivityWindow(
  raw: string | string[] | undefined,
  now: Date = new Date(),
): ActivityWindow {
  const key = typeof raw === "string" ? raw : undefined;

  switch (key) {
    case "1h":
      return {
        key: "1h",
        label: "1 heure",
        description: "la dernière heure",
        since: new Date(now.getTime() - HOUR_MS),
      };
    case "24h":
      return {
        key: "24h",
        label: "24 heures",
        description: "les vingt-quatre dernières heures",
        since: new Date(now.getTime() - 24 * HOUR_MS),
      };
    case "7j":
      return {
        key: "7j",
        label: "7 jours",
        description: "les sept derniers jours",
        since: new Date(now.getTime() - 7 * 24 * HOUR_MS),
      };
    default:
      return {
        key: "jour",
        label: "Aujourd'hui",
        description: "aujourd'hui, depuis minuit à Paris",
        since: null,
      };
  }
}

/** Les quatre fenêtres, dans l'ordre du sélecteur. */
export const ACTIVITY_WINDOWS: readonly { key: ActivityWindowKey; label: string }[] = [
  { key: "jour", label: "Aujourd'hui" },
  { key: "1h", label: "1 heure" },
  { key: "24h", label: "24 heures" },
  { key: "7j", label: "7 jours" },
];
