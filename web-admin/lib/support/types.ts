/**
 * ==================================================================
 * LE MIROIR TYPESCRIPT DES TABLES D'ASSISTANCE DE 0081 § 8
 * ==================================================================
 *
 * Les noms de champs sont ceux des COLONNES, en snake_case, sans
 * traduction : ce qui revient de PostgREST n'est pas renommé au vol.
 * Un renommage silencieux fait diverger l'écran et la base au premier
 * ajout de colonne, et le débogage se passe alors entre deux
 * vocabulaires.
 *
 * Les `type` littéraux recopient les contraintes `check` de 0081. Ils
 * ne PROTÈGENT rien — la base est la seule à contraindre — mais ils
 * font échouer la compilation quand un écran oublie un cas, ce qui est
 * exactement ce qu'on veut d'un statut affiché.
 */

// ------------------------------------------------------------------
// Les demandes d'assistance — 0081 § 8.a
// ------------------------------------------------------------------

export const STATUTS_TICKET = ["open", "pending", "resolved", "closed"] as const;
export type StatutTicket = (typeof STATUTS_TICKET)[number];

export const PRIORITES_TICKET = ["low", "normal", "high", "urgent"] as const;
export type PrioriteTicket = (typeof PRIORITES_TICKET)[number];

export const PRODUITS_TICKET = ["mobile", "pro", "controlCenter", "unknown"] as const;
export type ProduitTicket = (typeof PRODUITS_TICKET)[number];

export const CANAUX_TICKET = ["inApp", "email", "admin"] as const;
export type CanalTicket = (typeof CANAUX_TICKET)[number];

export type Ticket = {
  id: string;
  user_id: string | null;
  organization_id: string | null;
  subject: string;
  product: ProduitTicket;
  channel: CanalTicket;
  priority: PrioriteTicket;
  status: StatutTicket;

  /**
   * Le contexte technique, recopié à l'OUVERTURE de la demande.
   *
   * C'est la « version application / plateforme » de la spec p.19, et
   * c'est ce qui manque toujours quand on demande au client de le
   * retrouver. `null` veut dire « le canal d'entrée ne l'a pas
   * transmis », jamais « inconnu de la plateforme » : la valeur du jour
   * se lit ailleurs, sur `mobile_app_installations`, et ce n'est pas la
   * même information — l'une date de l'incident, l'autre d'aujourd'hui.
   */
  app_version: string | null;
  app_build: string | null;
  platform: string | null;
  os_version: string | null;

  assigned_to: string | null;

  created_at: string;
  updated_at: string;
  first_response_at: string | null;
  resolved_at: string | null;
  closed_at: string | null;
};

export type MessageTicket = {
  id: string;
  ticket_id: string;
  author_user_id: string | null;
  author_kind: "customer" | "admin" | "system";
  body: string;
  /**
   * Une note interne ne sort JAMAIS. La politique de lecture de 0081 la
   * réserve aux administrateurs ; ce booléen ne fait que la DESSINER
   * autrement — il ne la protège pas, et l'écran ne doit jamais laisser
   * croire l'inverse.
   */
  is_internal: boolean;
  created_at: string;
};

// ------------------------------------------------------------------
// Les sessions d'assistance — 0081 § 8.b
// ------------------------------------------------------------------

/**
 * Un niveau d'accès N'EST PAS UN MOT : c'est une LISTE DE RESSOURCES
 * nommées, portée par `support_access_level_resources`. Le type ci-
 * dessous ne fige donc aucune clé — la base peut en gagner une sans
 * qu'on recompile — et l'écran affiche la liste, pas l'intitulé seul.
 *
 * `is_grantable = false` avec zéro ressource est l'état de
 * `businessReadOnly` : « on y a pensé, on n'a pas décidé ». Le refus est
 * dans les DONNÉES, et c'est ce que l'écran doit montrer.
 */
export type NiveauAcces = {
  key: string;
  label: string;
  opens_business_data: boolean;
  is_grantable: boolean;
  max_minutes: number;
  requires_consent: boolean;
  note: string | null;
};

export type RessourceNiveau = {
  level_key: string;
  resource: string;
  note: string | null;
};

export type SessionAssistance = {
  id: string;
  admin_user_id: string;
  /** Le rôle AU MOMENT DE L'OUVERTURE, recopié — pas celui d'aujourd'hui. */
  admin_role: string;
  organization_id: string | null;
  customer_user_id: string | null;
  reason: string;
  access_level: string;
  ticket_id: string | null;
  started_at: string;
  /** `not null` en base : une session sans fin n'est pas temporaire. */
  expires_at: string;
  consent_required: boolean;
  consent_given_at: string | null;
  consent_given_by: string | null;
  revoked_at: string | null;
  revoked_by: string | null;
  revoked_reason: string | null;
  audit_event_id: string | null;
  created_at: string;
};

/** Une ligne PAR USAGE, pas une par session. */
export type AccesJournalise = {
  id: string;
  session_id: string;
  admin_user_id: string | null;
  resource: string;
  target_id: string | null;
  detail: unknown;
  occurred_at: string;
};

/**
 * Ce que rend `support_session_mine()` : les chiffres de la bannière de
 * la spec p.21. C'est un AFFICHAGE, pas la sécurité — la sécurité est
 * dans `support_session_record_access()`, qui revérifie l'expiration en
 * SQL à chaque accès.
 */
export type SessionOuverteMienne = {
  id: string;
  organization_id: string | null;
  customer_user_id: string | null;
  access_level: string;
  opens_business_data: boolean;
  reason: string;
  started_at: string;
  expires_at: string;
  seconds_remaining: number;
  consent_required: boolean;
  consent_given_at: string | null;
};
