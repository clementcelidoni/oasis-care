/**
 * ==================================================================
 * CE QUE LA BASE REND — les lignes de 0084, telles quelles
 * ==================================================================
 *
 * Aucun de ces types n'invente de champ. Quand une colonne est
 * `nullable` en base, elle l'est ici : c'est le seul moyen que le
 * compilateur nous force à traiter le cas plutôt qu'à afficher
 * « undefined » à un exploitant.
 *
 * LES NOMS RESTENT CEUX DES COLONNES, en anglais et en snake_case,
 * délibérément. Renommer en français à la frontière donnerait deux
 * vocabulaires pour la même chose, et il faudrait retraduire dans
 * l'autre sens à chaque fois qu'on relit une requête. Les textes vus
 * par un exploitant, eux, sont en français : ils vivent dans
 * `libelles.ts`.
 */

/** Une ligne de `public.email_campaigns` (0084 § 5). */
export type LigneCampagne = {
  id: string;
  title: string;
  template_key: string;
  /** Verrouillée sur 'publicite' par une contrainte : une campagne ne peut pas être autre chose. */
  nature: string;
  subject: string;
  body_text: string;
  /** 'draft' | 'sending' | 'sent' | 'cancelled'. */
  status: string;
  /** Non vide, contrainte de table : écrire à tout le parc se justifie au moment où on le fait. */
  reason: string;
  created_by: string | null;
  created_at: string;
  sent_at: string | null;
  /** Le nombre de messages réellement mis en file. `null` tant que la campagne n'est pas partie. */
  queued_count: number | null;
  /**
   * Le nombre d'entreprises entrées dans la boucle d'envoi et écartées
   * par la porte. ATTENTION : les entreprises SANS adresse e-mail ne
   * sont comptées NI ici NI dans `queued_count` — la boucle de
   * `admin_send_email_campaign` ne les visite pas. La somme des deux
   * n'est donc pas le nombre d'entreprises du parc, et l'écran le dit.
   */
  skipped_count: number | null;
};

/** Une ligne de `public.email_messages` (0084 § 6), telle qu'un administrateur d'Oasis peut la lire. */
export type LigneMessage = {
  id: string;
  organization_id: string;
  template_key: string;
  nature: string;
  template_version: string;
  recipient_kind: string;
  to_email: string;
  to_name: string | null;
  entity_type: string;
  entity_id: string;
  from_email: string;
  from_name: string;
  reply_to_email: string;
  subject: string;
  occurrence: number;
  campaign_id: string | null;
  /** 'queued' | 'sent' | 'deferred' | 'delivered' | 'bounced' | 'complained' | 'blocked' | 'failed' | 'cancelled'. */
  status: string;
  /** Le nom que l'implémentation a déclaré. `null` tant que rien n'a pris le message. */
  transporter_key: string | null;
  transporter_message_id: string | null;
  /** En français : c'est le paysagiste qui le lit dans SON écran. */
  failure_reason: string | null;
  failure_code: string | null;
  warnings: string[];
  queued_at: string;
  sent_at: string | null;
  last_event_at: string | null;
};

/**
 * Une ligne de la vue `public.email_consent_state` (0084 § 14.a).
 *
 * LA TABLE `email_consents` N'EST LISIBLE PAR PERSONNE : elle porte les
 * jetons de désabonnement, et un jeton qui circule est un jeton qui
 * fuit. Cette vue est le seul chemin, et elle ne rend pas le jeton.
 */
export type LigneConsentement = {
  organization_id: string;
  /**
   * L'adresse TELLE QU'ELLE ÉTAIT au moment du consentement :
   * `email_record_consent()` la recopie depuis
   * `business_organizations.email`. Si l'entreprise change d'adresse
   * ensuite, cette ligne ne suit pas — et la porte ne trouvera plus de
   * consentement pour la nouvelle adresse. C'est correct (un
   * consentement porte sur une adresse), et c'est un cas que l'aperçu
   * d'audience doit savoir montrer plutôt que subir.
   */
  email: string;
  nature: string;
  consented_at: string | null;
  consent_source: string | null;
  unsubscribed_at: string | null;
  can_receive_marketing: boolean;
};

/**
 * Une ligne de `public.email_suppression_digest()` (0084 § 13.d).
 *
 * ELLE NE PORTE PLUS L'ADRESSE EN CLAIR, ET C'EST UNE CORRECTION. La
 * liste de suppression est alimentée depuis `to_email` de tout message
 * qui rebondit : elle contient donc, en très grande majorité, les
 * adresses des CLIENTS FINAUX des paysagistes — des gens qui n'ont rien
 * signé avec Oasis Care. Le même fichier de migration refuse pourtant
 * cette donnée jusqu'au super-administrateur dans
 * `email_recipient_for_customer`.
 *
 * Un masque et un domaine suffisent à répondre à la seule question
 * qu'on pose vraiment — « mon client dit qu'il n'a rien reçu, est-il
 * sur la liste ? » — et ce n'est pas un carnet d'adresses.
 */
export type LigneSuppression = {
  id: string;
  /** « m***@exemple.fr ». Jamais l'adresse entière. */
  masked_email: string;
  /** Le domaine seul, qui sert à enquêter sans identifier personne. */
  domain: string;
  /** 'rebondDur' | 'plainte' | 'desabonnement' | 'bloqueTransporteur' | 'manuel'. */
  kind: string;
  reason: string | null;
  transporter_key: string | null;
  first_seen_at: string;
  last_seen_at: string;
  occurrences: number;
  released_at: string | null;
  released_reason: string | null;
};

/** Une ligne de `public.email_organization_settings` (0084 § 4). */
export type LigneReglagesEntreprise = {
  organization_id: string;
  suspended_at: string | null;
  suspended_by: string | null;
  suspended_reason: string | null;
  reminders_enabled: boolean;
  reminder_delay_days: number;
  reminder_max: number;
  updated_at: string;
};

/**
 * Une ligne de `public.admin_email_reputation()` (0084 § 13.e).
 *
 * ELLE REMPLACE LA VUE `email_organization_reputation`, ET LA RAISON
 * EST LE RISQUE NUMÉRO UN DU CHANTIER. La vue est
 * `security_invoker = true` : elle lit `email_messages` sous la RLS de
 * l'appelant, et la seule politique ouverte à un administrateur d'Oasis
 * est « nature = 'publicite' ». Un paysagiste qui venait de faire
 * rebondir deux cents devis n'apparaissait donc NULLE PART côté Oasis —
 * autrement dit, la personne qui peut suspendre une entreprise ne
 * voyait pas ce qui justifierait de la suspendre.
 *
 * La fonction, elle, est `security definer` et compte TOUS les
 * messages sans en montrer AUCUN : ni adresse, ni objet, ni corps. Des
 * nombres, un niveau d'alerte, un nom d'entreprise — de quoi décider,
 * rien de plus.
 */
export type LigneReputation = {
  organization_id: string;
  organization_name: string;
  suspended_at: string | null;
  suspended_reason: string | null;
  sent_count: number;
  bounced_count: number;
  complained_count: number;
  blocked_count: number;
  failed_count: number;
  bounce_rate_percent: number | null;
  complaint_rate_percent: number | null;
  /** 'insuffisant' | 'ok' | 'surveillance' | 'critique'. */
  alert_level: string;
};

/** Une ligne du catalogue `public.email_templates` (0084 § 1). */
export type LigneGabarit = {
  key: string;
  label: string;
  nature: string;
  audience: string;
  /** 'humain' | 'changementEtat' | 'periodique'. Il n'existe PAS de valeur 'ia'. */
  trigger_kind: string;
  requires_legal_identity: boolean;
  requires_unsubscribe: boolean;
  description: string | null;
};

/**
 * Ce que rend `public.email_sender_identity(organisation, gabarit)`.
 *
 * `blocking_reason` n'est PAS une erreur : c'est l'état normal d'une
 * entreprise dont l'identité est incomplète, et l'écran s'y adapte —
 * exactement la forme d'`unavailableReason` du côté paiement.
 */
export type IdentiteExpediteur = {
  from_name: string | null;
  /** L'adresse de réponse, et — pour un message adressé à l'entreprise — le DESTINATAIRE. */
  reply_to_email: string | null;
  logo_path: string | null;
  blocking_reason: string | null;
  warnings: string[];
};

/** Ce que rend `public.email_gate(organisation, gabarit, adresse)`. */
export type VerdictPorte = {
  allowed: boolean;
  blocking_reason: string | null;
  warnings: string[];
};

/**
 * Une entreprise du parc, réduite à ce dont ces écrans ont besoin.
 *
 * Elle vient de `admin_list_organizations()`, qui ne rend NI l'adresse
 * e-mail NI le logo : le Control Center n'a aucun chemin de lecture
 * vers `business_organizations`. L'adresse arrive séparément, par
 * `email_sender_identity()`, qui est la seule fonction de 0084 qu'un
 * administrateur de plateforme a le droit d'appeler sur une entreprise
 * qui n'est pas la sienne.
 */
export type EntrepriseDuParc = {
  organization_id: string;
  name: string;
  plan: string | null;
  subscription_status: string | null;
  archived_at: string | null;
};
