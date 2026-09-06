// Oasis Care — Chantier courriel. LA MACHINE.
//
// ==================================================================
// POURQUOI CETTE FONCTION EXISTE
// ==================================================================
//
// La migration 0084 § 15.c réserve à `service_role` les fonctions qui
// écrivent le journal : `email_enqueue`, `email_claim_queued`,
// `email_claim_one`, `email_mark_sent`, `email_mark_failed`,
// `email_mark_uncertain`, `email_still_sendable`, `email_record_event`.
// « Mettre un message en file est la porte qu'un navigateur ne doit
// jamais pousser. »
//
// Et `web-pro/.env.example` dit, noir sur blanc, que le site n'a AUCUN
// besoin d'une clé de service et ne doit pas en détenir. Les deux règles
// ensemble ne laissent qu'un seul endroit où l'envoi peut vivre : ici.
//
// ==================================================================
// LES VARIABLES D'ENVIRONNEMENT — À POSER PAR LE DIRIGEANT, PAS ICI
// ==================================================================
//
//   BREVO_API_KEY            la clé du transporteur. En SECRET DE
//                            FONCTION Supabase :
//                              npx supabase secrets set BREVO_API_KEY=…
//                            SURTOUT PAS dans `web-pro/.env.local` :
//                            c'est cette fonction qui l'emploie.
//   BREVO_WEBHOOK_SECRET     ce que le transporteur doit présenter pour
//                            que l'on croie ses notifications.
//   OASIS_EMAIL_EXPEDITEUR   l'adresse technique, sur le domaine déjà
//                            authentifié (SPF, DKIM, DMARC).
//   OASIS_EMAIL_RETOUR       la boîte qui reçoit les rebonds, et que
//                            quelqu'un doit LIRE.
//   OASIS_EMAIL_BASE_URL     racine des liens (désabonnement, portail).
//   SUPABASE_URL             fournies automatiquement par Supabase.
//   SUPABASE_ANON_KEY
//   SUPABASE_SERVICE_ROLE_KEY
//
// AUCUN SECRET N'EST ÉCRIT DANS CE FICHIER, ni en commentaire, ni en
// exemple. Le code lit des variables, point. Aucune ne porte — ni ne
// doit porter — le préfixe `NEXT_PUBLIC_` : ce préfixe est le seul
// mécanisme qui décide ce que Next.js recopie dans le paquet envoyé au
// navigateur, et il est silencieux.
//
// ==================================================================
// LE DÉPLOIEMENT
// ==================================================================
//
//     npx supabase functions deploy envoi-email --no-verify-jwt
//
// `--no-verify-jwt` EST OBLIGATOIRE, et pour une raison précise : le
// transporteur appelle `/evenements` depuis ses propres serveurs, sans
// jeton Supabase, et n'en portera jamais. Déployée avec la vérification
// par défaut, la fonction rendrait 401 à chaque notification, le
// transporteur marquerait le point de terminaison en échec puis le
// désactiverait — et l'on perdrait TOUS les rebonds, silencieusement.
// C'est le piège déjà rencontré avec le webhook Apple puis avec celui de
// Stripe.
//
// EN CONTREPARTIE, CHAQUE CHEMIN PORTE SA PROPRE DÉFENSE, et ce fichier
// ne fait rien avant qu'elle ait dit oui :
//
//   POST /envoi-email/envoyer     un jeton d'utilisateur. Les lectures
//                                 du document, de l'identité et du
//                                 destinataire se font SOUS CE JETON :
//                                 la RLS cache ce qui n'est pas à lui,
//                                 et `email_sender_identity` lève 42501
//                                 si l'appelant n'est pas membre de
//                                 l'entreprise.
//   POST /envoi-email/file        la clé de service en porteur. C'est le
//                                 chemin des campagnes et d'un futur
//                                 ordonnanceur, pas celui d'un humain.
//   POST /envoi-email/evenements  le secret du transporteur, EN EN-TÊTE
//                                 UNIQUEMENT — voir plus bas.
//
// ==================================================================
// LA RÉPARTITION DES RÔLES DANS CE DOSSIER
// ==================================================================
//   bibliotheque.ts   le pont vers les gabarits et le transporteur
//   porte.ts          l'interface vers la base       (pure)
//   traitement.ts     l'orchestration                (pure, éprouvée)
//   index.ts          CE FICHIER — l'HTTP, l'environnement, la base

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { obtenirEnvoyeurCourriel, type MentionsEntreprise } from "./bibliotheque.ts";
import type {
  ArgumentsMiseEnFile,
  DestinataireLu,
  FaitObjet,
  IdentiteLue,
  MessageEnFile,
  MiseEnFile,
  PorteBase,
  VerdictPorte,
} from "./porte.ts";
import { traiterNouvelles, traiterOrdre, viderFile, type OrdreEnvoi } from "./traitement.ts";

const BUCKET_LOGOS = "organization-logos";

/** Le nom du processus qui réserve, pour l'enquête. Jamais pour la logique. */
const NOM_PASSAGE = "envoi-email";

function json(charge: unknown, statut = 200): Response {
  return new Response(JSON.stringify(charge), {
    status: statut,
    headers: { "content-type": "application/json" },
  });
}

/**
 * La porte réelle.
 *
 * DEUX CLIENTS, ET LA SÉPARATION EST LA DÉFENSE :
 *
 *   • `lecteur` porte le jeton de l'appelant. Le devis, la facture,
 *     l'identité et le destinataire se lisent avec lui : la RLS cache
 *     ce qui appartient à une autre entreprise, et
 *     `email_sender_identity` lève 42501 par-dessus. C'est ce qui
 *     empêche un membre d'une entreprise de faire écrire la machine au
 *     nom d'une autre ;
 *   • `service` porte la clé de service et n'écrit QUE par les
 *     fonctions de 0084 § 15.c, qui refusent une adresse, un nom
 *     d'expéditeur ou une nature en paramètre.
 *
 * Pour la file et le webhook, il n'y a pas d'appelant humain : `lecteur`
 * vaut alors `service`, et le chemin est protégé par la clé de service
 * ou par le secret du transporteur.
 *
 * TOUTES LES ÉCRITURES LISENT LEUR `{ error }`, et c'est une correction.
 * Un `await rpc(...)` dont on jette la réponse transforme un délai de
 * requête dépassé en succès apparent : le message est parti, la base
 * croit qu'il attend, et le passage suivant le réexpédie — à chaque
 * passage, indéfiniment.
 */
function porteSupabase(service: SupabaseClient, lecteur: SupabaseClient): PorteBase {
  return {
    async lireIdentite(organizationId, gabarit): Promise<IdentiteLue> {
      const { data, error } = await lecteur
        .rpc("email_sender_identity", {
          p_organization_id: organizationId,
          p_template_key: gabarit,
        })
        .maybeSingle();
      if (error) {
        return {
          nomAffiche: null,
          repondreA: null,
          cheminLogo: null,
          raisonBloquante: error.message,
          avertissements: [],
        };
      }
      const ligne = (data ?? {}) as Record<string, unknown>;
      return {
        nomAffiche: (ligne.from_name as string | null) ?? null,
        repondreA: (ligne.reply_to_email as string | null) ?? null,
        cheminLogo: (ligne.logo_path as string | null) ?? null,
        raisonBloquante: (ligne.blocking_reason as string | null) ?? null,
        avertissements: (ligne.warnings as string[] | null) ?? [],
      };
    },

    async lireMentions(organizationId, natureOasis = false): Promise<MentionsEntreprise | null> {
      // QUAND OASIS ÉCRIT, LE PIED EST CELUI D'OASIS. Une annonce
      // commerciale imprimait le SIRET, le RCS et l'assurance décennale
      // de l'entreprise qui la RECEVAIT — ce qui est à la fois absurde
      // et un défaut d'identification de l'expéditeur (art. L.34-5
      // CPCE).
      if (natureOasis) {
        const { data } = await service
          .from("email_platform_identity")
          .select(
            "from_name, legal_name, legal_form, siret, vat_number, rcs_city, " +
              "address_line1, address_line2, postal_code, city, phone, reply_to_email, website",
          )
          .maybeSingle();
        if (!data) return null;
        const o = data as Record<string, unknown>;
        return {
          raisonSociale: ((o.legal_name as string | null) ?? (o.from_name as string)) || "Oasis Care",
          formeJuridique: o.legal_form as string | null,
          siret: o.siret as string | null,
          numeroTva: o.vat_number as string | null,
          villeRcs: o.rcs_city as string | null,
          capitalCentimes: null,
          adresse1: o.address_line1 as string | null,
          adresse2: o.address_line2 as string | null,
          codePostal: o.postal_code as string | null,
          ville: o.city as string | null,
          telephone: o.phone as string | null,
          courriel: o.reply_to_email as string | null,
          siteWeb: o.website as string | null,
          numeroDecennale: null,
          assureur: null,
        };
      }

      // LA MÊME SÉLECTION QUE `client_portal_companies` (0056), qui sait
      // déjà quoi montrer sans laisser fuiter `workspace_id` ni
      // `tax_configuration`. On ne la réinvente pas : une colonne
      // ajoutée un jour à `select *` finirait dans un message envoyé à
      // un client.
      const { data } = await service
        .from("business_organizations")
        .select(
          "name, legal_name, legal_form, siret, vat_number, rcs_city, share_capital_cents, " +
            "address_line1, address_line2, postal_code, city, phone, email, website, " +
            "insurer_name, insurance_decennale_number",
        )
        .eq("id", organizationId)
        .maybeSingle();
      if (!data) return null;
      const o = data as Record<string, unknown>;
      return {
        raisonSociale: ((o.legal_name as string | null) ?? (o.name as string)) || "",
        formeJuridique: o.legal_form as string | null,
        siret: o.siret as string | null,
        numeroTva: o.vat_number as string | null,
        villeRcs: o.rcs_city as string | null,
        capitalCentimes: o.share_capital_cents as number | null,
        adresse1: o.address_line1 as string | null,
        adresse2: o.address_line2 as string | null,
        codePostal: o.postal_code as string | null,
        ville: o.city as string | null,
        telephone: o.phone as string | null,
        courriel: o.email as string | null,
        siteWeb: o.website as string | null,
        numeroDecennale: o.insurance_decennale_number as string | null,
        assureur: o.insurer_name as string | null,
      };
    },

    async lireDestinataire(organizationId, customerId): Promise<DestinataireLu> {
      const { data, error } = await lecteur
        .rpc("email_recipient_for_customer", {
          p_organization_id: organizationId,
          p_customer_id: customerId,
        })
        .maybeSingle();
      if (error) {
        return { email: null, nom: null, contactId: null, raisonBloquante: error.message };
      }
      const ligne = (data ?? {}) as Record<string, unknown>;
      return {
        email: (ligne.to_email as string | null) ?? null,
        nom: (ligne.to_name as string | null) ?? null,
        contactId: (ligne.contact_id as string | null) ?? null,
        raisonBloquante: (ligne.blocking_reason as string | null) ?? null,
      };
    },

    /**
     * LE DOCUMENT, RELU SOUS LE JETON DE L'APPELANT.
     *
     * C'est de LUI que viennent le numéro, le montant et l'échéance du
     * message. Avant, ces valeurs arrivaient dans le corps de la
     * requête HTTP : la machine ne relisait rien, et un compte inscrit
     * pouvait donc dicter le texte d'un message expédié depuis le
     * domaine authentifié d'Oasis.
     *
     * Le total vit dans une VUE (`quote_totals`, `invoice_balance`) que
     * PostgREST ne sait pas imbriquer faute de clé étrangère, d'où la
     * seconde requête. Un total illisible reste `null` : un `?? 0`
     * ferait partir un devis à 0,00 €, une erreur silencieuse qui a
     * l'air d'un montant.
     */
    async lireFait(entityType, entityId): Promise<FaitObjet | null> {
      if (entityType === "quote") {
        const { data } = await lecteur
          .from("quotes")
          .select(
            "id, organization_id, customer_id, number, title, status, sent_at, decided_at, valid_until, archived_at",
          )
          .eq("id", entityId)
          .maybeSingle();
        if (!data) return null;
        const q = data as Record<string, unknown>;
        const { data: t } = await lecteur
          .from("quote_totals")
          .select("total_including_vat_cents")
          .eq("quote_id", entityId)
          .maybeSingle();
        return {
          organizationId: q.organization_id as string,
          customerId: (q.customer_id as string | null) ?? null,
          numero: (q.number as string | null) ?? null,
          titre: (q.title as string | null) ?? null,
          dateFait: (q.sent_at as string | null) ?? null,
          dateLimite: (q.valid_until as string | null) ?? null,
          decideLe: (q.decided_at as string | null) ?? null,
          statut: q.status as string,
          archiveLe: (q.archived_at as string | null) ?? null,
          totalTtcCentimes:
            ((t as Record<string, unknown> | null)?.total_including_vat_cents as number | null) ??
            null,
          resteDuCentimes: null,
        };
      }

      const { data } = await lecteur
        .from("invoices")
        .select("id, organization_id, customer_id, number, status, issued_at, due_on, archived_at")
        .eq("id", entityId)
        .maybeSingle();
      if (!data) return null;
      const i = data as Record<string, unknown>;
      const { data: b } = await lecteur
        .from("invoice_balance")
        .select("total_including_vat_cents, outstanding_cents")
        .eq("invoice_id", entityId)
        .maybeSingle();
      const solde = (b ?? {}) as Record<string, unknown>;
      return {
        organizationId: i.organization_id as string,
        customerId: (i.customer_id as string | null) ?? null,
        numero: (i.number as string | null) ?? null,
        titre: null,
        dateFait: (i.issued_at as string | null) ?? null,
        dateLimite: (i.due_on as string | null) ?? null,
        decideLe: null,
        statut: i.status as string,
        archiveLe: (i.archived_at as string | null) ?? null,
        totalTtcCentimes: (solde.total_including_vat_cents as number | null) ?? null,
        resteDuCentimes: (solde.outstanding_cents as number | null) ?? null,
      };
    },

    async lireJetonDesabonnement(organizationId, email): Promise<string | null> {
      // `email_consents` n'est lisible PAR PERSONNE (0084 § 15 : aucune
      // politique de lecture, elle porte les jetons). Seule la clé de
      // service la traverse, et seulement ici.
      const { data } = await service
        .from("email_consents")
        .select("unsubscribe_token, consented_at, unsubscribed_at")
        .eq("organization_id", organizationId)
        .eq("email", email.trim().toLowerCase())
        .eq("nature", "publicite")
        .maybeSingle();
      if (!data) return null;
      const c = data as Record<string, unknown>;
      if (c.consented_at === null || c.unsubscribed_at !== null) return null;
      return (c.unsubscribe_token as string | null) ?? null;
    },

    urlPubliqueLogo(cheminLogo): string | null {
      if (!cheminLogo || cheminLogo.trim() === "") return null;
      // Le bucket est le SEUL des cinq marqué public, et c'est ce qui
      // rend l'image affichable dans un message : un client de
      // messagerie ne présente aucun jeton pour charger une image.
      const { data } = service.storage.from(BUCKET_LOGOS).getPublicUrl(cheminLogo);
      return data?.publicUrl ?? null;
    },

    async mettreEnFile(args: ArgumentsMiseEnFile): Promise<MiseEnFile> {
      const { data, error } = await service
        .rpc("email_enqueue", {
          p_organization_id: args.organizationId,
          p_template_key: args.gabarit,
          p_entity_type: args.entityType,
          p_entity_id: args.entityId,
          p_template_version: args.version,
          // L'ADRESSE TECHNIQUE VIENT DU SERVEUR, jamais de l'appelant.
          // Un administrateur qui pourrait la choisir depuis un
          // formulaire choisirait le domaine d'expédition, ce qui est
          // exactement l'hameçonnage qu'on refuse.
          p_from_email: Deno.env.get("OASIS_EMAIL_EXPEDITEUR") ?? "",
          p_subject: args.objet,
          p_body_text: args.corpsTexte,
          p_body_html_sha256: args.empreinteHtml,
          p_customer_id: args.customerId,
          p_variables: args.variables,
          p_occurrence: args.occurrence,
          p_campaign_id: args.campaignId,
        })
        .maybeSingle();

      if (error) {
        return { messageId: null, cree: false, raisonBloquante: error.message, avertissements: [] };
      }
      const ligne = (data ?? {}) as Record<string, unknown>;
      return {
        messageId: (ligne.message_id as string | null) ?? null,
        cree: (ligne.created as boolean | null) ?? false,
        raisonBloquante: (ligne.blocking_reason as string | null) ?? null,
        avertissements: (ligne.warnings as string[] | null) ?? [],
      };
    },

    async reserverUn(messageId): Promise<boolean> {
      const { data, error } = await service.rpc("email_claim_one", {
        p_message_id: messageId,
        p_worker: NOM_PASSAGE,
      });
      // UNE ERREUR NE VAUT PAS UNE RÉSERVATION. Dans le doute, on
      // n'expédie pas : ne pas envoyer se rattrape au passage suivant,
      // envoyer deux fois ne se rattrape pas.
      if (error) return false;
      return data === true;
    },

    async reserverFile(limite): Promise<MessageEnFile[]> {
      const { data, error } = await service.rpc("email_claim_queued", {
        p_limit: limite,
        p_worker: NOM_PASSAGE,
      });
      if (error) return [];
      return ((data ?? []) as Record<string, unknown>[]).map((ligne) => ({
        id: ligne.id as string,
        organizationId: ligne.organization_id as string,
        gabarit: ligne.template_key as MessageEnFile["gabarit"],
        nature: ligne.nature as MessageEnFile["nature"],
        version: ligne.template_version as string,
        destinataireEmail: ligne.to_email as string,
        destinataireNom: (ligne.to_name as string | null) ?? null,
        objet: ligne.subject as string,
        corpsTexte: ligne.body_text as string,
        variables: (ligne.variables as Record<string, unknown>) ?? {},
        empreinteProvisoire: ligne.body_html_sha256_provisoire === true,
      }));
    },

    async verifierEncoreExpediable(messageId): Promise<VerdictPorte> {
      const { data, error } = await service
        .rpc("email_still_sendable", { p_message_id: messageId })
        .maybeSingle();
      if (error) {
        // On ne sait pas si la porte s'ouvre : on ne force pas.
        return { ok: false, raison: error.message };
      }
      const ligne = (data ?? {}) as Record<string, unknown>;
      return {
        ok: ligne.ok === true,
        raison: (ligne.blocking_reason as string | null) ?? null,
      };
    },

    async marquerEnvoye(messageId, cleTransporteur, identifiantTransporteur, empreinteHtml) {
      const { data, error } = await service.rpc("email_mark_sent", {
        p_message_id: messageId,
        p_transporter_key: cleTransporteur,
        p_transporter_message_id: identifiantTransporteur,
        p_body_html_sha256: empreinteHtml ?? null,
      });
      if (error) return false;
      return data === true;
    },

    async marquerEchec(messageId, raison, code, cleTransporteur, temporaire) {
      const { data, error } = await service.rpc("email_mark_failed", {
        p_message_id: messageId,
        p_failure_reason: raison,
        p_failure_code: code,
        p_transporter_key: cleTransporteur,
        p_temporaire: temporaire,
      });
      if (error) return false;
      return data === true;
    },

    async marquerSortInconnu(messageId, raison, cleTransporteur) {
      const { data, error } = await service.rpc("email_mark_uncertain", {
        p_message_id: messageId,
        p_failure_reason: raison,
        p_transporter_key: cleTransporteur,
      });
      if (error) return false;
      return data === true;
    },

    async enregistrerEvenement(cleTransporteur, identifiant, evenement, instant, raison, charge) {
      await service.rpc("email_record_event", {
        p_transporter_key: cleTransporteur,
        p_transporter_message_id: identifiant,
        p_event: evenement,
        p_occurred_at: instant,
        p_reason: raison,
        p_payload: charge,
      });
    },
  };
}

/**
 * LA COMPARAISON DE SECRETS EN TEMPS CONSTANT.
 *
 * `a === b` sur des chaînes s'arrête au premier caractère différent : le
 * temps de réponse dit alors combien de caractères sont justes, et un
 * secret se devine caractère par caractère. Le coût de la version
 * constante est nul ; l'absence de version constante est une faille
 * qu'on ne voit jamais dans un journal.
 */
function memeSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let ecart = 0;
  for (let i = 0; i < a.length; i += 1) ecart |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return ecart === 0;
}

Deno.serve(async (requete: Request): Promise<Response> => {
  if (requete.method !== "POST") return json({ erreur: "Méthode non autorisée." }, 405);

  const url = new URL(requete.url);
  const chemin = url.pathname.replace(/^.*\/envoi-email/, "").replace(/\/+$/, "") || "/envoyer";

  const urlSupabase = Deno.env.get("SUPABASE_URL") ?? "";
  const cleService = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const cleAnon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  if (urlSupabase === "" || cleService === "") {
    return json({ erreur: "La machine n'est pas configurée sur ce serveur." }, 503);
  }

  const service = createClient(urlSupabase, cleService, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const envoyeur = obtenirEnvoyeurCourriel();
  const reglages = {
    baseUrl: Deno.env.get("OASIS_EMAIL_BASE_URL") ?? "",
    adresseTechnique: Deno.env.get("OASIS_EMAIL_EXPEDITEUR") ?? "",
  };

  // ---- LE WEBHOOK -------------------------------------------------
  if (chemin === "/evenements") {
    // LE NOM DE LA VARIABLE VIENT DU TRANSPORTEUR, pas de ce fichier :
    // le nom du prestataire ne doit pas sortir de son implémentation.
    const attendu = Deno.env.get(envoyeur.nomSecretWebhook ?? "") ?? "";
    // PAS DE SECRET POSÉ, PAS DE WEBHOOK. On refuse plutôt que
    // d'accepter n'importe qui : un point de terminaison qui écrit des
    // rebonds sans vérifier son appelant laisse marquer n'importe quelle
    // adresse comme injoignable.
    if (attendu === "") return json({ erreur: "Webhook non configuré." }, 503);
    // EN-TÊTE UNIQUEMENT, ET PLUS EN PARAMÈTRE D'URL. Une URL complète
    // s'écrit dans les journaux de l'hébergeur, dans ceux des
    // intermédiaires, et dans le tableau de bord du transporteur qui la
    // conserve en clair : le secret cessait d'être un secret. Et il
    // ouvre l'ÉCRITURE d'événements — quiconque le lit peut faire
    // marquer n'importe quel message comme rebondi, ce qui inscrit son
    // destinataire dans la liste de suppression.
    const presente = requete.headers.get("x-oasis-webhook") ?? "";
    if (!memeSecret(attendu, presente)) return json({ erreur: "Refusé." }, 401);

    const charge = await requete.json().catch(() => null);
    const bilan = await traiterNouvelles(charge, porteSupabase(service, service), envoyeur);
    // TOUJOURS 200, même pour une charge ignorée. Un transporteur qui
    // reçoit des erreurs finit par désactiver le point de terminaison.
    return json(bilan, 200);
  }

  // ---- LA FILE ----------------------------------------------------
  if (chemin === "/file") {
    const porteur = (requete.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!memeSecret(cleService, porteur)) return json({ erreur: "Refusé." }, 401);
    const bilan = await viderFile(porteSupabase(service, service), envoyeur, reglages);
    return json(bilan, 200);
  }

  // ---- UN ORDRE D'ENVOI -------------------------------------------
  const autorisation = requete.headers.get("authorization") ?? "";
  if (!/^Bearer\s+\S+/i.test(autorisation)) return json({ erreur: "Refusé." }, 401);

  // ON REFUSE DE SERVIR PLUTÔT QUE DE SE REPLIER SUR LA CLÉ DE SERVICE.
  //
  // La version précédente écrivait `SUPABASE_ANON_KEY ?? cleService`.
  // Le rôle appliqué restait celui du jeton porté par l'en-tête, donc
  // aucune élévation n'était constatée — mais toute la défense de ce
  // chemin tient à ce que la clé passée à `createClient` ne devienne
  // jamais l'identité effective. Un changement de préséance d'en-têtes
  // dans la bibliothèque aurait transformé ce confort en contournement
  // complet du cloisonnement, sans qu'une ligne de ce fichier change.
  if (cleAnon === "") {
    return json(
      { erreur: "La machine n'est pas complètement configurée sur ce serveur (clé publique absente)." },
      503,
    );
  }

  // LE LECTEUR PORTE LE JETON DE L'APPELANT. C'est lui qui vérifie
  // l'appartenance : la RLS cache le devis d'une autre entreprise, et
  // `email_sender_identity` lève 42501 par-dessus. Sans cette ligne, un
  // membre d'une entreprise pourrait faire écrire la machine au nom
  // d'une autre.
  const lecteur = createClient(urlSupabase, cleAnon, {
    global: { headers: { Authorization: autorisation } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const corps = (await requete.json().catch(() => null)) as { ordre?: OrdreEnvoi } | null;
  if (!corps?.ordre?.organizationId || !corps.ordre.gabarit
      || !corps.ordre.entityType || !corps.ordre.entityId) {
    return json({ erreur: "Ordre incomplet." }, 400);
  }

  const issue = await traiterOrdre(corps.ordre, porteSupabase(service, lecteur), envoyeur, reglages);
  // 200 MÊME POUR UN REFUS. Un refus motivé — « renseignez le SIRET » —
  // n'est pas une panne : l'appelant l'affiche tel quel. Réserver les
  // codes d'erreur HTTP à ce qui est réellement cassé permet de les
  // distinguer dans les journaux.
  return json(issue, 200);
});
