/**
 * OASIS CONTROL CENTER — le contrat de données du tableau de bord.
 *
 * Ces types recopient, colonne pour colonne, les tables de retour de
 * `admin_platform_kpis()` et `admin_live_activity(p_since)` (migration
 * 0075, la première élargie de cinq colonnes par 0077), puis des deux
 * distributions du parc mobile posées par 0077. Ils ne les devinent
 * pas — chaque forme ci-dessous a été relevée en appelant la fonction
 * dans une transaction ANNULÉE sur la vraie base. Si la base change,
 * l'écart se voit ici, à un seul endroit, et le compilateur emmène le
 * reste de l'écran avec lui.
 *
 * ------------------------------------------------------------------
 * POURQUOI TOUT EST `number | null`, MÊME CE QUE LA BASE SAIT COMPTER
 * ------------------------------------------------------------------
 * Dix de ces chiffres se calculent aujourd'hui, six non — la migration
 * 0077 en a fait passer un, `mobile_users`, du second groupe au
 * premier, et c'est précisément le genre de bascule qui rend la règle
 * ci-dessous nécessaire : le type n'a pas eu à changer. La
 * tentation serait de typer les calculables en `number` et les autres
 * en `number | null` : le compilateur dirait alors la vérité
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
  /**
   * Les comptes VIVANTS dont un usage de l'application iPhone est
   * attesté — déclaré par l'application, ou déduit d'une activité passée
   * qui ne peut venir que d'elle (migration 0077).
   *
   * DEUX LECTURES, ET IL FAUT LES DEUX.
   *
   *   • `null` veut dire « la collecte existe, personne ne s'est encore
   *     annoncé et aucune activité passée ne permet de déduire quoi que
   *     ce soit ». Le motif rendu dans `unknown_reasons.mobile_users`
   *     est alors DATÉ (« Collecte démarrée le … »). C'est le cas du
   *     jour du déploiement, et « 0 utilisateur mobile » s'y lirait
   *     « personne n'utilise l'iPhone » au lieu de « le parc n'a pas
   *     encore basculé ».
   *   • un entier reste une BORNE INFÉRIEURE, et le restera : un compte
   *     qui n'a pas rouvert l'application depuis la mise en service est
   *     invisible, et le mode invité n'est jamais compté. C'est
   *     `mobile_users_note` qui porte cette réserve, en toutes lettres.
   *   • et une réserve dans l'AUTRE sens, que la note porte aussi : la
   *     déclaration est faite par l'application et n'est pas vérifiable
   *     côté serveur — le CHECK `platform in ('ios')` filtre une chaîne
   *     de caractères, pas une provenance. Un compte purement Pro
   *     pourrait donc s'y inscrire lui-même.
   *
   * Ce n'est donc pas un chiffre qu'on affiche seul. Les quatre colonnes
   * qui suivent existent pour qu'il ne le soit jamais.
   */
  mobile_users: number | null;
  /** Comptes dont une INSTALLATION s'est annoncée depuis la mise en service. */
  mobile_users_declared: number | null;
  /**
   * Comptes rattrapés par la reprise rétroactive de 0077 : ils n'ont
   * rien déclaré, mais ils ont laissé une trace que seule l'application
   * iPhone sait écrire. Ils ne portent NI version, NI nombre
   * d'installations, NI date d'annonce — déduire un usage n'est pas
   * mesurer une installation. La PLATEFORME, en revanche, est
   * renseignée : les tables sur lesquelles repose la déduction ne sont
   * écrites par aucun autre client.
   */
  mobile_users_inferred: number | null;
  /**
   * Quand la collecte a démarré, c'est-à-dire quand 0077 a tourné. ISO
   * 8601. Une question sur la TABLE, pas sur les gens : 0077 la range
   * dans une ligne unique plutôt que dans un `first_seen_at` par
   * compte, qui aurait été de la donnée personnelle de plus.
   */
  mobile_collection_started_at: string | null;
  /**
   * La phrase que la base écrit à côté du chiffre : soit le motif daté
   * de l'inconnu, soit la réserve de borne inférieure avec sa
   * répartition. Elle est rendue MÊME quand `mobile_users` vaut un
   * entier — c'est tout l'intérêt : un chiffre exact n'a pas besoin
   * d'être expliqué, celui-ci si.
   */
  mobile_users_note: string | null;
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

/**
 * ==================================================================
 * LA DISTRIBUTION DU PARC MOBILE — 0077 §5.c
 * ==================================================================
 *
 * DEUX TABLES DE RETOUR ET NON UNE, parce que ce sont deux questions
 * différentes : « reste-t-il des téléphones sur une vieille version de
 * l'application ? » et « peut-on relever la cible de déploiement iOS
 * sans couper quelqu'un ? ». Les empiler aurait forcé une colonne
 * « dimension » et des colonnes nulles une ligne sur deux.
 *
 * ------------------------------------------------------------------
 * CES DEUX LECTURES NE COMPTENT QUE LES LIGNES DÉCLARÉES
 * ------------------------------------------------------------------
 * Forcément : une déduction ne porte aucune version. Leur total n'est
 * donc PAS `mobile_users` du tableau de bord, et les confondre ferait
 * calculer des pourcentages sur la mauvaise population. C'est la raison
 * d'être de `declared_installations_total`, répété sur chaque ligne
 * (l'idiome de `total_count` dans 0075) : le dénominateur voyage avec
 * le numérateur, personne n'a à le reconstituer.
 *
 * Conséquence à ne pas perdre de vue à l'écran : un tableau VIDE ne
 * veut pas dire « aucune version en circulation », il veut dire
 * « aucune installation ne s'est encore annoncée ».
 */

/** Une ligne de `admin_mobile_version_distribution()`. */
export type MobileVersionRow = {
  /** `'ios'`, et rien d'autre : la table n'accepte que cette valeur. */
  platform: string;
  /** `CFBundleShortVersionString` — la version publiée. */
  app_version: string;
  /**
   * `CFBundleVersion` — le numéro de séquence de la CI. Il est affiché
   * À CÔTÉ de la version et non à sa place : `project.yml` fige
   * `MARKETING_VERSION` à « 0.1.0 » et seul le build est réécrit par la
   * CI, donc une distribution bâtie sur la seule version afficherait
   * « 100 % sur 0.1.0 » — exact, et sans aucune valeur.
   */
  app_build: string;
  /** Des INSTALLATIONS, pas des appareils : voir `install_id` dans 0077. */
  installations: number;
  /** Des comptes distincts. Plus petit que `installations` dès qu'un compte a deux téléphones. */
  users: number;
  /** La dernière annonce de cette version. ISO 8601. */
  last_seen_at: string;
  /** Le dénominateur : toutes les installations déclarées, répété sur chaque ligne. */
  declared_installations_total: number;
};

/** Une ligne de `admin_mobile_os_distribution()`. */
export type MobileOsRow = {
  platform: string;
  /**
   * La version MAJEURE d'iOS, seule. 26, jamais 26.3.1 : la mineure ne
   * change aucune décision de cible de déploiement et rendrait
   * l'empreinte plus fine pour rien.
   */
  os_major: number;
  installations: number;
  users: number;
  last_seen_at: string;
  declared_installations_total: number;
};
