import "server-only";

import { AdminAccessDenied, AdminReadFailed } from "@/lib/customers/errors";
import { createClient } from "@/lib/supabase/server";

import { composerAudience, type Audience, type LectureEntreprise } from "./audience.ts";
import type {
  EntrepriseDuParc,
  IdentiteExpediteur,
  LigneCampagne,
  LigneConsentement,
  LigneGabarit,
  LigneMessage,
  LigneReglagesEntreprise,
  LigneReputation,
  LigneSuppression,
  VerdictPorte,
} from "./types.ts";

/**
 * ==================================================================
 * TOUT CE QUE CES ÉCRANS LISENT — et RIEN de plus
 * ==================================================================
 *
 * `import "server-only"` : un composant client qui importerait ce
 * module ne compilerait pas, au lieu de fuir dans le navigateur.
 *
 * ------------------------------------------------------------------
 * LA SESSION DE L'ADMINISTRATEUR, JAMAIS LA CLÉ DE SERVICE
 * ------------------------------------------------------------------
 * Toutes les lectures passent par `lib/supabase/server.ts`, donc par le
 * jeton de la personne connectée, donc par la RLS de 0084. Ce n'est pas
 * une préférence de style : les politiques de 0084 sont ÉTROITES à
 * dessein, et les contourner avec `service_role` reviendrait à défaire
 * en TypeScript ce qui a été décidé en SQL.
 *
 * CE QUE LA RLS REFUSE À UN ADMINISTRATEUR D'OASIS, et qu'il faut avoir
 * en tête en lisant ce fichier :
 *
 *   • `email_messages` — il ne voit QUE `nature = 'publicite'`, c'est-à-
 *     dire le courrier qu'Oasis a lui-même expédié. Le devis qu'un
 *     paysagiste envoie à son client est une donnée métier (spec p.36),
 *     et 0075 réserve `customer.data.read` à un mécanisme qui n'existe
 *     pas encore.
 *   • `email_consents` — personne ne la lit : elle porte les jetons de
 *     désabonnement. On passe par la vue `email_consent_state`.
 *   • l'ADRESSE E-MAIL d'une entreprise — aucune fonction du Control
 *     Center ne la rend, et il n'existe aucune politique de lecture sur
 *     `business_organizations` pour un administrateur de plateforme. Le
 *     seul chemin est `email_sender_identity()`, que 0084 autorise
 *     explicitement à `is_platform_admin()`.
 */

// ------------------------------------------------------------------
// Traduire un échec en quelque chose d'affichable
// ------------------------------------------------------------------

type ErreurSupabase = { message: string; code?: string; details?: string | null };

/**
 * `42P01` : la table n'existe pas. `PGRST205` / `PGRST202` : PostgREST
 * ne la trouve pas dans son cache de schéma. Les trois disent la même
 * chose à un exploitant — la migration n'est pas là — et rien d'autre
 * ne le dirait : le message brut de PostgREST parle d'une relation, pas
 * d'un fichier SQL.
 */
function traduire(quoi: string, error: ErreurSupabase): never {
  if (error.code === "42501") {
    throw new AdminAccessDenied(error.message);
  }
  if (
    error.code === "42P01" ||
    error.code === "42883" ||
    error.code === "PGRST202" ||
    error.code === "PGRST205"
  ) {
    throw new AdminReadFailed(
      `${quoi} : la migration 0084_emails.sql n'est pas appliquée sur cette base, ou le cache de ` +
        `schéma de PostgREST n'a pas encore été rechargé. Message de la base : ${error.message}`,
    );
  }
  throw new AdminReadFailed(`${quoi} : ${error.message} (${error.code ?? "sans code"}).`);
}

// ------------------------------------------------------------------
// LES ANNONCES
// ------------------------------------------------------------------

/** Permission `emails.campaigns.read`. */
export async function listerCampagnes(limite = 50): Promise<LigneCampagne[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("email_campaigns")
    .select(
      "id, title, template_key, nature, subject, body_text, status, reason, created_by, created_at, sent_at, queued_count, skipped_count",
    )
    .order("created_at", { ascending: false })
    .limit(limite);

  if (error) traduire("lecture des annonces", error);
  return (data ?? []) as LigneCampagne[];
}

/**
 * Une annonce, relue par son identifiant.
 *
 * ON NE PREND PAS `rows[0]` LES YEUX FERMÉS — règle R4 de l'audit : un
 * identifiant venu de l'URL n'est pas une preuve de portée. Ici le
 * filtre est une égalité stricte, donc la relecture est immédiate ;
 * elle reste écrite pour que le jour où quelqu'un remplace `eq` par une
 * recherche, la ligne rendue soit encore celle qu'on a demandée.
 */
export async function lireCampagne(campagneId: string): Promise<LigneCampagne | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("email_campaigns")
    .select(
      "id, title, template_key, nature, subject, body_text, status, reason, created_by, created_at, sent_at, queued_count, skipped_count",
    )
    .eq("id", campagneId)
    .limit(1);

  if (error) traduire("lecture de l'annonce", error);
  const lignes = (data ?? []) as LigneCampagne[];
  return lignes.find((ligne) => ligne.id === campagneId) ?? null;
}

/**
 * Ce qui est parti pour une annonce, message par message.
 *
 * Permission `emails.log.read` — c'est elle que la politique de
 * `email_messages` exige, PAS `emails.campaigns.read`. Un rôle qui voit
 * les annonces sans voir le journal lira donc une liste vide : d'où le
 * contrôle explicite dans la page, qui préfère le dire.
 */
export async function listerMessagesDeCampagne(
  campagneId: string,
  limite = 500,
): Promise<LigneMessage[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("email_messages")
    .select(
      "id, organization_id, template_key, nature, template_version, recipient_kind, to_email, to_name, entity_type, entity_id, from_email, from_name, reply_to_email, subject, occurrence, campaign_id, status, transporter_key, transporter_message_id, failure_reason, failure_code, warnings, queued_at, sent_at, last_event_at",
    )
    .eq("campaign_id", campagneId)
    .order("queued_at", { ascending: false })
    .limit(limite);

  if (error) traduire("lecture du journal d'envoi", error);
  return (data ?? []) as LigneMessage[];
}

/** Tout le courrier d'Oasis, annonces confondues. Permission `emails.log.read`. */
export async function listerMessagesDOasis(limite = 200): Promise<LigneMessage[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("email_messages")
    .select(
      "id, organization_id, template_key, nature, template_version, recipient_kind, to_email, to_name, entity_type, entity_id, from_email, from_name, reply_to_email, subject, occurrence, campaign_id, status, transporter_key, transporter_message_id, failure_reason, failure_code, warnings, queued_at, sent_at, last_event_at",
    )
    .order("queued_at", { ascending: false })
    .limit(limite);

  if (error) traduire("lecture du journal d'envoi", error);
  return (data ?? []) as LigneMessage[];
}

// ------------------------------------------------------------------
// LE CATALOGUE, LE CONSENTEMENT, LA SUPPRESSION, LA RÉPUTATION
// ------------------------------------------------------------------

/** Le catalogue des gabarits. Lisible par tout compte connecté (0084 § 14). */
export async function listerGabarits(): Promise<LigneGabarit[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("email_templates")
    .select(
      "key, label, nature, audience, trigger_kind, requires_legal_identity, requires_unsubscribe, description",
    )
    .order("nature", { ascending: true })
    .order("key", { ascending: true });

  if (error) traduire("lecture du catalogue des gabarits", error);
  return (data ?? []) as LigneGabarit[];
}

/** L'état du consentement, SANS les jetons. Permission `emails.campaigns.read`. */
export async function listerConsentements(): Promise<LigneConsentement[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("email_consent_state")
    .select(
      "organization_id, email, nature, consented_at, consent_source, unsubscribed_at, can_receive_marketing",
    );

  if (error) traduire("lecture du registre de consentement", error);
  return (data ?? []) as LigneConsentement[];
}

/**
 * La liste de suppression, MASQUÉE. Permission `emails.suppression.read`.
 *
 * ON PASSE PAR UNE FONCTION, PAS PAR LA TABLE, et c'est le sujet : la
 * table n'a plus AUCUNE politique de lecture. Elle porte les adresses
 * des clients finaux des paysagistes, que 0084 refuse jusqu'au
 * super-administrateur ailleurs dans le même fichier. Le digest rend un
 * masque et un domaine — assez pour répondre à « mon client dit
 * qu'il n'a rien reçu », pas assez pour constituer un carnet
 * d'adresses.
 */
export async function listerSuppressions(seulementActives: boolean): Promise<LigneSuppression[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("email_suppression_digest", {
    p_domain: null,
    p_limit: 500,
  });

  if (error) traduire("lecture de la liste de suppression", error);
  const lignes = (data ?? []) as LigneSuppression[];
  // Le filtre se fait ici plutôt qu'en base : la fonction rend déjà une
  // page bornée, et un second paramètre pour un filtre d'affichage
  // aurait été un paramètre de plus à défendre.
  return seulementActives ? lignes.filter((l) => l.released_at === null) : lignes;
}

/**
 * La réputation par entreprise. Permission `emails.log.read`.
 *
 * ELLE COMPTE MAINTENANT TOUT LE COURRIER, y compris les devis et les
 * factures des paysagistes — voir `LigneReputation`. La vue
 * `email_organization_reputation` reste en base pour l'ENTREPRISE, qui
 * y voit les siens ; côté Oasis, c'est la fonction agrégée qui répond,
 * parce que c'est ici qu'on décide d'une suspension.
 */
export async function listerReputation(): Promise<LigneReputation[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_email_reputation", { p_jours: 30 });

  if (error) traduire("lecture de la réputation par entreprise", error);
  return (data ?? []) as LigneReputation[];
}

/**
 * L'ÉTAT DU SOCLE D'EXPÉDITION, VU DE L'ÉCRAN.
 *
 * `admin_send_email_campaign` lit l'adresse technique dans
 * `current_setting('oasis.email_expediteur')`. Un appel PostgREST ne
 * peut pas la poser lui-même : elle doit être attachée au rôle de
 * connexion de la base, une fois, à la main. Tant qu'elle manque, la
 * fonction REFUSE de partir et la campagne reste un brouillon — mais un
 * administrateur ne doit pas l'apprendre au clic, après avoir rédigé
 * pendant dix minutes.
 *
 * Cette lecture répond donc AVANT le geste. Elle ne rend aucun secret :
 * une adresse d'expédition et un nom d'expéditeur ne sont pas des
 * secrets, ce sont ce que tout destinataire voit.
 */
export type EtatPlateforme = {
  technical_sender: string | null;
  sender_configured: boolean;
  from_name: string | null;
  reply_to_email: string | null;
  legal_complete: boolean;
};

export async function lireEtatPlateforme(): Promise<EtatPlateforme | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("email_platform_status");
  // PAS DE `traduire` ICI : cette lecture est un DIAGNOSTIC. Si elle
  // échoue — migration absente, rôle trop étroit — l'écran doit
  // continuer de s'afficher et dire qu'il ne sait pas, plutôt que de
  // remplacer la campagne par une page d'erreur.
  if (error) return null;
  const ligne = (Array.isArray(data) ? data[0] : data) as EtatPlateforme | undefined;
  return ligne ?? null;
}

/** Les réglages d'expédition, dont la suspension. Permission `emails.log.read`. */
export async function listerReglagesEntreprises(): Promise<LigneReglagesEntreprise[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("email_organization_settings")
    .select(
      "organization_id, suspended_at, suspended_by, suspended_reason, reminders_enabled, reminder_delay_days, reminder_max, updated_at",
    );

  if (error) traduire("lecture des réglages d'expédition", error);
  return (data ?? []) as LigneReglagesEntreprise[];
}

// ------------------------------------------------------------------
// LE PARC
// ------------------------------------------------------------------

/**
 * Combien d'entreprises l'aperçu accepte d'examiner.
 *
 * AU-DELÀ, IL REFUSE PLUTÔT QU'IL N'APPROXIME. L'aperçu coûte deux
 * allers-retours par entreprise — c'est ce prix qui le rend EXACT,
 * puisqu'il pose à la base les mêmes questions que l'envoi. À trois
 * cents entreprises, l'écran mettrait plusieurs secondes à s'afficher ;
 * bien avant, la bonne correction sera une fonction SQL qui rend
 * l'audience en une seule requête (voir le compte rendu). Approximer en
 * silence serait le pire des trois choix : un compte faux affiché sous
 * un bouton irréversible.
 */
export const PLAFOND_APERCU = 300;

/**
 * Toutes les entreprises, archivées comprises.
 *
 * `p_filter: "toutes"` est délibéré : `admin_send_email_campaign` ne
 * visite que les non archivées, mais l'aperçu doit pouvoir DIRE
 * combien sont écartées pour cette raison. Une liste par défaut qui les
 * masque ferait un écart inexpliqué entre le nombre d'entreprises
 * connues et le nombre de destinataires.
 */
export async function listerEntreprisesDuParc(): Promise<{
  entreprises: EntrepriseDuParc[];
  tronquee: boolean;
}> {
  const supabase = await createClient();
  const entreprises: EntrepriseDuParc[] = [];
  const taille = 200; // le maximum accepté par admin_list_organizations
  let page = 1;
  let total = Infinity;

  while (entreprises.length < total && entreprises.length < PLAFOND_APERCU) {
    const { data, error } = await supabase.rpc("admin_list_organizations", {
      p_search: null,
      p_filter: "toutes",
      p_page: page,
      p_page_size: taille,
    });

    if (error) traduire("liste des entreprises", error);

    const lignes = (Array.isArray(data) ? data : []) as (EntrepriseDuParc & {
      total_count: number;
    })[];
    if (lignes.length === 0) break;

    total = Number(lignes[0].total_count ?? lignes.length);
    for (const ligne of lignes) {
      entreprises.push({
        organization_id: ligne.organization_id,
        name: ligne.name,
        plan: ligne.plan,
        subscription_status: ligne.subscription_status,
        archived_at: ligne.archived_at,
      });
    }
    page += 1;
  }

  return { entreprises, tronquee: entreprises.length < total };
}

// ------------------------------------------------------------------
// LES DEUX QUESTIONS QUE L'ENVOI POSERA
// ------------------------------------------------------------------

/**
 * L'identité d'expéditeur d'une entreprise — et, pour un message qui
 * lui est adressé, SON ADRESSE.
 *
 * `email_sender_identity` est `security definer` et autorise
 * explicitement `is_platform_admin()`. C'est le SEUL chemin par lequel
 * le Control Center apprend l'adresse e-mail d'une entreprise, et il
 * est étroit à dessein : il ne rend ni le SIRET, ni la TVA, ni rien du
 * CRM.
 *
 * Rend `null` quand l'appel lui-même échoue — l'audience écarte alors
 * l'entreprise en le disant, plutôt que de la retenir par défaut.
 */
export async function lireIdentiteExpediteur(
  organizationId: string,
  gabarit: string,
): Promise<IdentiteExpediteur | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("email_sender_identity", {
    p_organization_id: organizationId,
    p_template_key: gabarit,
  });

  if (error) {
    // 42501 signalerait que la base et la garde ne sont pas d'accord :
    // on le relaie, il n'a rien à faire dans un « écartée ».
    if (error.code === "42501") throw new AdminAccessDenied(error.message);
    return null;
  }

  const ligne = (Array.isArray(data) ? data[0] : data) as IdentiteExpediteur | undefined;
  if (!ligne) return null;
  return { ...ligne, warnings: ligne.warnings ?? [] };
}

/** La porte, posée exactement comme `email_enqueue` la posera. */
export async function interrogerPorte(
  organizationId: string,
  gabarit: string,
  email: string,
): Promise<VerdictPorte | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("email_gate", {
    p_organization_id: organizationId,
    p_template_key: gabarit,
    p_email: email,
  });

  if (error) {
    if (error.code === "42501") throw new AdminAccessDenied(error.message);
    return null;
  }

  const ligne = (Array.isArray(data) ? data[0] : data) as VerdictPorte | undefined;
  if (!ligne) return null;
  return { ...ligne, warnings: ligne.warnings ?? [] };
}

/**
 * Exécute des travaux par petits paquets.
 *
 * Sans limite de front, trois cents entreprises ouvriraient six cents
 * requêtes simultanées : PostgREST en refuserait une partie, et
 * l'aperçu afficherait des « écartée : lecture impossible » qui ne
 * seraient qu'un embouteillage. Huit à la fois est lent et vrai plutôt
 * que rapide et faux.
 */
async function parPaquets<T, R>(
  elements: readonly T[],
  taille: number,
  travail: (element: T) => Promise<R>,
): Promise<R[]> {
  const resultats: R[] = [];
  for (let i = 0; i < elements.length; i += taille) {
    const paquet = elements.slice(i, i + taille);
    resultats.push(...(await Promise.all(paquet.map(travail))));
  }
  return resultats;
}

/**
 * L'AUDIENCE EXACTE d'une annonce.
 *
 * Pour chaque entreprise non archivée, les deux mêmes questions que
 * `email_enqueue()`, dans le même ordre. Les archivées ne coûtent
 * aucune requête : la boucle d'envoi ne les visite pas, l'aperçu se
 * contente de les compter.
 */
export async function apercuAudience(
  gabarit: string,
): Promise<{ audience: Audience; tronquee: boolean }> {
  const { entreprises, tronquee } = await listerEntreprisesDuParc();

  const lectures = await parPaquets(entreprises, 8, async (entreprise): Promise<LectureEntreprise> => {
    if (entreprise.archived_at !== null) {
      return { entreprise, identite: null, porte: null };
    }

    const identite = await lireIdentiteExpediteur(entreprise.organization_id, gabarit);
    if (identite === null || identite.blocking_reason !== null || identite.reply_to_email === null) {
      return { entreprise, identite, porte: null };
    }

    const porte = await interrogerPorte(
      entreprise.organization_id,
      gabarit,
      identite.reply_to_email,
    );
    return { entreprise, identite, porte };
  });

  return { audience: composerAudience(lectures), tronquee };
}
