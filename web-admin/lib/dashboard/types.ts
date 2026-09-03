/**
 * OASIS CONTROL CENTER — le contrat de données du tableau de bord.
 *
 * Ces deux types recopient, colonne pour colonne, les tables de retour
 * de `admin_platform_kpis()` et `admin_live_activity(p_since)` posées
 * par la migration 0075. Ils ne les devinent pas : si la base change,
 * l'écart se voit ici, à un seul endroit, et le compilateur emmène le
 * reste de l'écran avec lui.
 *
 * ------------------------------------------------------------------
 * POURQUOI TOUT EST `number | null`, MÊME CE QUE LA BASE SAIT COMPTER
 * ------------------------------------------------------------------
 * Neuf de ces chiffres se calculent aujourd'hui, sept non. La
 * tentation serait de typer les neuf en `number` et les sept en
 * `number | null` : le compilateur dirait alors la vérité
 * d'aujourd'hui, et deviendrait un menteur le jour où une source se
 * tarit — une table vidée, un compteur retiré, une fonction qui rend
 * NULL faute de mieux. Ce jour-là, quelqu'un ferait taire l'erreur de
 * type avec un `?? 0` et le tableau de bord afficherait un zéro
 * fabriqué.
 *
 * Tout est donc nullable, et chaque chiffre passe par le même chemin
 * honnête : une valeur, ou un tiret accompagné de son motif. La spec
 * p.4 : « Les KPI doivent être calculés depuis les vraies données.
 * Aucune valeur fictive en production. »
 */

/**
 * Le dictionnaire des motifs. La clé est le NOM DE COLONNE inconnue
 * (`mrr_cents`, `churn_30d_percent`, …), la valeur la phrase que 0075
 * a écrite pour expliquer ce qui manque. Une colonne calculable n'y
 * figure pas : le motif disparaît de lui-même le jour où le chiffre
 * existe.
 */
export type UnknownReasons = Record<string, string>;

/** Le retour de `admin_platform_kpis()` — spec p.3-4, les grands KPI. */
export type PlatformKpisRow = {
  /** `auth.users`, effacements doux exclus. */
  total_users: number | null;
  /** Inscriptions depuis le 1er du mois, à l'heure de Paris. */
  new_users_this_month: number | null;
  /** Toujours NULL : rien n'enregistre par quelle application un compte est entré. */
  mobile_users: number | null;
  /** Entreprises Pro non archivées. */
  pro_organizations: number | null;
  /**
   * Comptes distincts, VIVANTS, membres d'au moins une entreprise NON
   * ARCHIVÉE. Les deux restrictions ne sont pas cosmétiques : ce
   * chiffre est le numérateur d'une barre dont `total_users` est le
   * dénominateur, et deux populations différentes donnent un
   * pourcentage qui peut dépasser 100 %.
   */
  pro_users: number | null;
  /** Instantané : sessions vivantes des 30 dernières minutes. */
  open_sessions: number | null;
  /**
   * Abonnements enregistrés d'entreprises NON ARCHIVÉES — même
   * population que `pro_organizations`, dont il est le numérateur.
   * 0 signifie « aucun abonnement suivi ».
   */
  tracked_subscriptions: number | null;
  /** En CENTIMES entiers. NULL tant qu'aucun abonnement n'est suivi ou qu'un forfait n'a pas de prix. */
  mrr_cents: number | null;
  /** En CENTIMES entiers. Dérivé du MRR. */
  arr_cents: number | null;
  pro_trials: number | null;
  /** Toujours NULL : le webhook Apple ne distingue pas un essai d'un abonnement payé. */
  mobile_trials: number | null;
  churn_30d_percent: number | null;
  /** Nombre de REQUÊTES du mois, pas d'euros. */
  pro_ai_requests_this_month: number | null;
  mobile_ai_requests_this_month: number | null;
  /** Toujours NULL : aucune table n'enregistre de jetons, de modèle ni de coût. */
  ai_cost_cents: number | null;
  unknown_reasons: UnknownReasons;
  /** Horodatage du calcul, côté base. ISO 8601. */
  computed_at: string;
};

/** Le retour de `admin_live_activity(p_since)` — spec p.4-5, l'activité. */
export type LiveActivityRow = {
  /** Début de la fenêtre. Par défaut : minuit à Paris. ISO 8601. */
  since_at: string;
  /** Fin de la fenêtre : l'instant du calcul. ISO 8601. */
  until_at: string;
  signups: number | null;
  new_organizations: number | null;
  /**
   * Des PERSONNES, pas des connexions : `last_sign_in_at` ne donne que
   * la dernière. Exact pour une fenêtre qui se termine maintenant,
   * faux pour une fenêtre passée — d'où l'absence de paramètre
   * « jusqu'à » côté SQL.
   */
  signed_in_users: number | null;
  /** Instantané, 30 dernières minutes. Ne dépend pas de la fenêtre. */
  open_sessions: number | null;
  /**
   * Abonnés distincts ayant reçu une notification Apple SUBSCRIBED
   * pendant la fenêtre. Ni DID_RENEW (une reconduction d'abonné déjà
   * payant) ni OFFER_REDEEMED (qui s'applique aussi à un abonné
   * existant). RÉSERVE : le sous-type qui distingue un premier achat
   * d'un réabonnement n'est pas stocké par le webhook, donc un client
   * qui revient est compté comme une conversion.
   */
  premium_conversions: number | null;
  /** Toujours NULL : rien n'écrit `organization_subscriptions`. */
  pro_conversions: number | null;
  mobile_cancellations: number | null;
  /** Toujours NULL : pas d'historique côté Pro, `cancelled_at` est écrasé. */
  pro_cancellations: number | null;
  /** La seule trace IA horodatée au jour — et seulement les analyses rattachées à une plante. */
  plant_ai_analyses: number | null;
  /** Toujours NULL : les compteurs IA sont mensuels et cumulatifs. */
  ai_requests: number | null;
  /** Toujours NULL : aucune table d'erreurs n'existe. */
  important_errors: number | null;
  unknown_reasons: UnknownReasons;
};
