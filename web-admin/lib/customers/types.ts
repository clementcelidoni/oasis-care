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
   * `'pro'` ou `null`. Jamais `'mobile'` : rien dans cette base
   * n'enregistre par quelle application un compte est entré, et
   * l'appartenance à une organisation ne prouve que la moitié de la
   * phrase. `null` se lit « inconnu », pas « aucun ».
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
