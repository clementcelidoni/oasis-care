/**
 * ==================================================================
 * LE CONTRAT DES TROIS LECTURES — utilisateurs, entreprises, recherche
 * ==================================================================
 *
 * Ces types recopient, colonne par colonne, ce que les fonctions de la
 * migration 0075 déclarent en `returns table (…)`. Ils ne sont pas une
 * modélisation : ce sont les mêmes noms, dans le même ordre, avec les
 * mêmes nullités.
 *
 * ------------------------------------------------------------------
 * ILS ONT ÉTÉ VÉRIFIÉS SUR LA VRAIE BASE, PAS DÉDUITS DU SQL
 * ------------------------------------------------------------------
 * 0075 n'est pas encore appliquée en production. Les formes ci-dessous
 * ont donc été obtenues en appliquant la migration dans une transaction
 * ANNULÉE, en s'y posant un administrateur jetable, et en appelant
 * chaque fonction pour lire le JSON réellement rendu. Trois choses en
 * sont ressorties, qu'on n'aurait pas devinées en lisant le SQL :
 *
 *   • un tableau vide côté SQL arrive en `null`, pas en `[]` —
 *     `organizations` et `pro_plans` valent `null` pour un compte sans
 *     rattachement, d'où le `| null` sur les deux ;
 *   • `total_count` est répété sur CHAQUE ligne, et disparaît donc
 *     entièrement quand la page ne rend aucune ligne (voir
 *     `pagination.ts`, qui en tire les conséquences) ;
 *   • `display_name` peut valoir l'adresse e-mail : le trigger de
 *     `profiles` la recopie faute de mieux.
 *
 * `bigint` de PostgreSQL arrive en `number` à travers PostgREST. Les
 * comptages de cette application (des utilisateurs, des devis) restent
 * très loin de 2^53 ; le jour où l'un d'eux s'en approcherait, le
 * problème ne serait pas d'affichage.
 */

/** Une ligne de `admin_list_users(p_search, p_filter, p_page, p_page_size)`. */
export type AdminUserRow = {
  user_id: string;
  email: string | null;
  display_name: string | null;
  created_at: string;
  /**
   * La dernière CONNEXION, pas la dernière activité. La spec p.8 écrit
   * « Dernière activité » ; la base ne sait dater qu'un `last_sign_in_at`.
   * Le nom est conservé tel que la base l'appelle, et l'écran affiche
   * l'étiquette exacte — promettre une activité qu'on ne mesure pas
   * serait une invention polie.
   */
  last_sign_in_at: string | null;
  banned_until: string | null;
  /**
   * `'pro'`, `'mobile'`, `'both'` — ou `null`.
   *
   * La phrase de la spec p.8 (« Oasis Care Mobile / Pro / ou les
   * deux ») est enfin complète depuis 0077 : l'appartenance à une
   * organisation prouve Pro, une ligne de `mobile_app_installations`
   * prouve Mobile, et les deux ensemble donnent `'both'`.
   *
   * `null` reste possible et veut TOUJOURS dire « on ne sait pas » : un
   * compte sans organisation et sans trace mobile n'est pas un compte
   * gratuit, c'est un compte dont on ignore par où il passe. Le mode
   * invité en est la cause la plus fréquente — l'application entière
   * s'utilise sans compte, et rien ne remonte alors.
   */
  product: string | null;
  organization_count: number;
  /** `null` — et non `[]` — pour un compte sans organisation. */
  organizations: string[] | null;
  /** Les forfaits des entreprises où ce compte est membre. `null` aujourd'hui : aucun abonnement n'est suivi. */
  pro_plans: string[] | null;
  mobile_plan: string | null;
  /**
   * LE PIÈGE DE L'AUDIT. Les 25 lignes de `subscription_entitlements`
   * du compte propriétaire sont un ACCÈS OFFERT (migration 0042,
   * `source='complimentary'`), pas un abonnement payé. Un écran qui
   * ignore ce drapeau compte un client de plus qu'il n'y en a.
   */
  complimentary: boolean;

  /**
   * ----------------------------------------------------------------
   * LA PRÉSENCE MOBILE — les cinq colonnes de la spec p.8-9 (0077)
   * ----------------------------------------------------------------
   * Les cinq valent `null` ENSEMBLE pour un compte sans aucune ligne de
   * présence, et ce `null` veut dire « on ne sait pas » — jamais « zéro
   * appareil », jamais « pas mobile ». La distinction n'est pas
   * théorique : la collecte a une date de début, et tout ce qui s'est
   * passé avant elle sans laisser de trace rétroactive est
   * définitivement invisible.
   *
   * `install_id` N'EST PAS DANS CETTE LISTE, et son absence est
   * délibérée : aucune fonction d'administration de 0077 ne le rend.
   * Il n'y a donc rien à ranger derrière « Afficher détails
   * techniques » — la donnée ne franchit jamais la frontière de la
   * base. C'est plus strict que la règle de la spec p.35, et c'est le
   * bon niveau pour un identifiant qui suit une installation.
   */

  /** `'ios'` — la seule valeur que la contrainte de 0077 accepte. `null` si aucune trace. */
  mobile_platform: string | null;
  /**
   * La version de l'installation vue le plus RÉCEMMENT, pas la plus
   * haute : sur deux téléphones, c'est celle du dernier utilisé qui
   * décrit l'utilisateur. `null` pour un compte connu par déduction —
   * une déduction ne porte aucune version.
   */
  mobile_app_version: string | null;
  /**
   * Des INSTALLATIONS déclarées, pas des appareils : `identifierForVendor`
   * est remis à zéro à la désinstallation, donc il compte des
   * installations. `null` — et non 0 — pour un compte déduit : « 0
   * appareil » affirmerait qu'on a regardé et qu'il n'y en a pas.
   */
  mobile_install_count: number | null;
  /**
   * La dernière ANNONCE de l'application, toutes installations
   * déclarées confondues. ISO 8601.
   *
   * `null` POUR UN COMPTE DÉDUIT, et c'est une correction, pas une
   * limite : la ligne déduite porte bien une date, mais c'est celle du
   * dernier geste métier du compte — un arrosage, un appel IA — et
   * l'afficher sous « dernière annonce » aurait présenté une donnée de
   * comportement sous une étiquette de télémétrie. 0077 ne rend donc
   * ici que les dates qui viennent d'une déclaration.
   */
  mobile_last_seen_at: string | null;
  /**
   * `'declared'` si au moins une installation s'est annoncée,
   * `'inferred'` si le compte n'est connu que par la reprise
   * rétroactive. C'est la colonne qui empêche de lire une déduction
   * comme une mesure.
   */
  mobile_presence_source: string | null;

  total_count: number;
};

/** Une ligne de `admin_list_organizations(p_search, p_filter, p_page, p_page_size)`. */
export type AdminOrganizationRow = {
  organization_id: string;
  name: string;
  legal_name: string | null;
  siret: string | null;
  country: string | null;
  business_type: string | null;
  /** Le forfait souscrit. `null` tant que `organization_subscriptions` reste vide. */
  plan: string | null;
  subscription_status: string | null;
  member_count: number;
  /** Membres connectés depuis moins de trente jours — un proxy de connexion, pas d'usage. */
  active_member_count: number;
  /** Le plafond de sièges du forfait. `null` sans abonnement, ou pour un forfait sans plafond. */
  seat_limit: number | null;
  disabled_module_count: number;
  crm_customer_count: number;
  project_count: number;
  quote_count: number;
  invoice_count: number;
  nursery_lot_count: number;
  document_count: number;
  garden_count: number;
  plant_count: number;
  /** Requêtes IA du mois courant (UTC). `null` si l'entreprise n'a pas encore de compteur. */
  ai_requests_this_month: number | null;
  created_at: string;
  /** La dernière action métier JOURNALISÉE. `null` pour une entreprise qui travaille sans écriture auditée. */
  last_audited_action_at: string | null;
  archived_at: string | null;
  total_count: number;
};

/** Une ligne de `admin_global_search(p_query, p_limit)`. */
export type AdminSearchRow = {
  /** `'user'` ou `'organization'` — aucune autre branche n'existe dans 0075. */
  result_type: string;
  result_id: string;
  title: string | null;
  subtitle: string | null;
  /** Ce qui a déclenché la correspondance : `identifiant`, `email`, `nom`, `siret`, `siren`, `tva`. */
  matched_on: string | null;
};
