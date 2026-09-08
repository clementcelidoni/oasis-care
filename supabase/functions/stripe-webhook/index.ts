// Oasis Care — Chantier Stripe. LE POINT DE TERMINAISON.
//
// ==================================================================
// CE POINT DE TERMINAISON EST PUBLIC, ET C'EST OBLIGATOIRE
// ==================================================================
// Stripe appelle cette URL depuis ses propres serveurs. Il ne porte
// AUCUN jeton Supabase et n'en portera jamais. La fonction doit donc
// être déployée SANS vérification de JWT :
//
//     npx supabase functions deploy stripe-webhook --no-verify-jwt
//
// C'est un piège connu de ce dépôt — le même que celui du webhook
// Apple. Déployée avec la vérification par défaut, la fonction rendra
// 401 à CHAQUE livraison, Stripe marquera le point de terminaison en
// échec puis le désactivera, et plus aucun paiement ne sera constaté :
// silencieusement, sans une ligne dans nos journaux.
//
// EN CONTREPARTIE, SA SEULE DÉFENSE EST LA SIGNATURE. Rien, dans ce
// fichier, ne se produit avant que `signature.ts` ait dit oui. Si cette
// vérification est ratée, n'importe qui sur Internet peut ouvrir un
// abonnement payant.
//
// ==================================================================
// LES VARIABLES D'ENVIRONNEMENT — À POSER PAR LE DIRIGEANT, PAS ICI
// ==================================================================
//   STRIPE_WEBHOOK_SECRET   Le secret de signature du point de
//                           terminaison (préfixe `whsec_`), produit par
//                           Stripe quand on déclare l'URL
//                           (Développeurs › Webhooks › Ajouter un point
//                           de terminaison). À poser en SECRET DE
//                           FONCTION Supabase :
//                             npx supabase secrets set STRIPE_WEBHOOK_SECRET=…
//                           Surtout PAS dans `web-pro/.env.local` : c'est
//                           cette fonction Edge qui le lit, pas le site.
//   STRIPE_MODE             'test' ou 'live'. EXPLICITE, jamais déduite
//                           du préfixe d'une clé : c'est elle qui choisit
//                           la moitié de la base où l'on écrit, et une
//                           déduction silencieuse se trompe en silence.
//   SUPABASE_URL            Fournies automatiquement par Supabase.
//   SUPABASE_SERVICE_ROLE_KEY
//
// AUCUNE DE CES VARIABLES NE PORTE — NI NE DOIT PORTER — LE PRÉFIXE
// `NEXT_PUBLIC_`. Ce préfixe est le seul mécanisme qui décide ce que
// Next.js recopie dans le paquet envoyé au navigateur, et il est
// silencieux : `NEXT_PUBLIC_STRIPE_WEBHOOK_SECRET` publierait le secret
// à chaque visiteur du site. Seule la clé PUBLIABLE y a droit, et elle
// ne sert pas ici.
//
// AUCUN SECRET N'EST ÉCRIT DANS CE FICHIER, ni en commentaire, ni en
// exemple. Le code lit des variables, point.
//
// ==================================================================
// LA RÉPARTITION DES RÔLES DANS CE DOSSIER
// ==================================================================
//   signature.ts      la vérification cryptographique  (pur, éprouvé)
//   evenement.ts      ce qu'un événement veut dire     (pur, éprouvé)
//   rapprochement.ts  sur quelle facture tombe l'argent(pur, éprouvé)
//   traitement.ts     l'orchestration : rejeu, désordre(pur, éprouvé)
//   index.ts          CE FICHIER — les octets, l'environnement, la base
//
// Tout ce qui décide est ailleurs et se teste sans réseau ni base. Ici,
// il ne reste que le câblage : c'est délibéré, parce que c'est la seule
// partie qu'aucun test ne couvre.

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

import { verifierSignatureStripe } from "./signature.ts";
import { lireEvenement } from "./evenement.ts";
import type { FactureCandidate } from "./rapprochement.ts";
import {
  RefusMetier,
  traiter,
  type DemandeAbonnement,
  type DemandeEncaissement,
  type EtatEvenement,
  type Issue,
  type PorteBase,
} from "./traitement.ts";
import type { EvenementNormalise } from "./evenement.ts";

/** La clé du prestataire dans `billing_providers`, semée par 0083. */
const PRESTATAIRE = "stripe";

Deno.serve(async (requete: Request): Promise<Response> => {
  if (requete.method !== "POST") {
    return reponse({ erreur: "Méthode non autorisée." }, 405);
  }

  // ----------------------------------------------------------------
  // LA CONFIGURATION — ON ÉCHOUE FERMÉ, ET DE FAÇON REJOUABLE
  // ----------------------------------------------------------------
  // 503 et non 400 : une variable manquante est notre faute, pas celle
  // de Stripe. Un 5xx le fait rejouer, donc l'événement n'est pas perdu
  // pendant les minutes où le dirigeant pose le secret.
  const secret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  const mode = Deno.env.get("STRIPE_MODE");
  const urlSupabase = Deno.env.get("SUPABASE_URL");
  const cleService = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!secret) {
    console.error("stripe-webhook: STRIPE_WEBHOOK_SECRET absent — aucune signature ne peut être vérifiée.");
    return reponse({ erreur: "Point de terminaison non configuré." }, 503);
  }
  if (mode !== "test" && mode !== "live") {
    console.error(`stripe-webhook: STRIPE_MODE vaut « ${mode ?? "(absent)"} », attendu 'test' ou 'live'.`);
    return reponse({ erreur: "Point de terminaison non configuré." }, 503);
  }
  if (!urlSupabase || !cleService) {
    console.error("stripe-webhook: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY absents.");
    return reponse({ erreur: "Point de terminaison non configuré." }, 503);
  }

  // ----------------------------------------------------------------
  // LE CORPS BRUT, AVANT TOUTE ANALYSE
  // ----------------------------------------------------------------
  // `arrayBuffer()` et surtout pas `json()`. Analyser puis ré-encoder
  // pour vérifier donne une signature qui ne concorde JAMAIS — et la
  // « correction » qui suit ce symptôme est, presque toujours, de
  // désactiver la vérification. On lit donc les octets, une fois, et on
  // ne les touche plus. (`signature.test.ts` fige ce cas.)
  let corpsBrut: Uint8Array;
  try {
    corpsBrut = new Uint8Array(await requete.arrayBuffer());
  } catch {
    return reponse({ erreur: "Corps illisible." }, 400);
  }

  const verdict = await verifierSignatureStripe({
    corpsBrut,
    enteteSignature: requete.headers.get("stripe-signature"),
    secret,
    maintenantSecondes: Math.floor(Date.now() / 1000),
  });

  if (!verdict.valide) {
    // On journalise le MOTIF, jamais le corps ni l'en-tête : un corps
    // non signé est du texte fourni par un inconnu, et le recopier dans
    // nos journaux est une invitation.
    console.error(`stripe-webhook: signature refusée (${verdict.motif}) — ${verdict.detail}`);
    // 400, et aucun indice exploitable dans la réponse.
    return reponse({ erreur: "Signature invalide." }, 400);
  }

  // À partir d'ici, et seulement à partir d'ici, le corps vient de
  // Stripe.
  let brut: unknown;
  try {
    brut = JSON.parse(new TextDecoder().decode(corpsBrut));
  } catch {
    return reponse({ erreur: "Corps signé mais illisible." }, 400);
  }

  const lecture = lireEvenement(brut);
  if (!lecture.ok) {
    console.error(`stripe-webhook: ${lecture.motif}`);
    return reponse({ erreur: lecture.motif }, 400);
  }
  const { evenement, intention } = lecture;

  // ----------------------------------------------------------------
  // LE MODE DOIT CONCORDER, ET ON N'ÉCRIT RIEN AVANT DE L'AVOIR VU
  // ----------------------------------------------------------------
  // Un événement de production livré à un déploiement d'essai serait
  // inscrit au journal comme un événement d'essai : l'encaissement d'un
  // vrai client atterrirait dans la mauvaise moitié de la base, et
  // aucune correspondance de tarif d'essai ne vaut quoi que ce soit en
  // production. On refuse avant la moindre écriture — inscrire sous un
  // mode faux serait déjà le mensonge qu'on cherche à éviter.
  const modeEvenement = evenement.enDirect ? "live" : "test";
  if (modeEvenement !== mode) {
    console.error(
      `stripe-webhook: événement ${evenement.id} en mode « ${modeEvenement} » reçu par un déploiement « ${mode} ».`,
    );
    return reponse({ erreur: "Mode incohérent." }, 400);
  }

  const admin = createClient(urlSupabase, cleService, { auth: { persistSession: false } });
  const resultat = await traiter(porteSupabase(admin, mode), evenement, intention);

  if (resultat.journal !== null) console.error(resultat.journal);
  return reponse(resultat.corps, resultat.statut);
});

// ==================================================================
// LA PORTE VERS LA BASE
// ==================================================================
// Chaque méthode appelle une fonction de 0083 — les quatre portes
// machine, réservées à `service_role` — ou fait une lecture simple.
// Aucune décision ici : elles rendent ce que la base dit, et lèvent
// `RefusMetier` quand la base a dit non pour une raison qu'elle nomme.

function porteSupabase(admin: SupabaseClient, mode: string): PorteBase {
  return {
    async inscrireEvenement(evenement: EvenementNormalise) {
      const { data, error } = await admin.rpc("billing_provider_event_record", {
        p_provider: PRESTATAIRE,
        p_mode: mode,
        p_provider_event_id: evenement.id,
        p_event_type: evenement.type,
        p_api_version: evenement.apiVersion,
        p_occurred_at: evenement.dateEvenement,
        p_summary: evenement.resume,
      });
      if (error) throw traduire(error);
      return data === "duplicate" ? "duplicate" : "accepted";
    },

    async lireEtatEvenement(evenementId: string): Promise<EtatEvenement | null> {
      const { data, error } = await admin
        .from("billing_provider_events")
        .select("outcome, processed_at")
        .eq("provider", PRESTATAIRE)
        .eq("provider_event_id", evenementId)
        .maybeSingle();
      if (error) throw traduire(error);
      if (!data) return null;
      return { outcome: data.outcome, closDepuis: data.processed_at ?? null };
    },

    async clore(evenementId: string, issue: Issue, motif: string | null) {
      const { data, error } = await admin.rpc("billing_provider_event_close", {
        p_provider: PRESTATAIRE,
        p_provider_event_id: evenementId,
        p_outcome: issue,
        p_error: motif,
      });
      if (error) throw traduire(error);
      return data === "alreadyClosed" ? "alreadyClosed" : "closed";
    },

    async rattacherClient(organisationId: string, clientPrestataire: string) {
      const { data, error } = await admin.rpc("billing_provider_link_customer", {
        p_provider: PRESTATAIRE,
        p_mode: mode,
        p_organization_id: organisationId,
        p_provider_customer_id: clientPrestataire,
      });
      if (error) throw traduire(error);
      return data === "alreadyLinked" ? "alreadyLinked" : "linked";
    },

    async organisationDuClient(clientPrestataire: string) {
      const { data, error } = await admin
        .from("billing_provider_customers")
        .select("organization_id")
        .eq("provider", PRESTATAIRE)
        .eq("mode", mode)
        .eq("provider_customer_id", clientPrestataire)
        .maybeSingle();
      if (error) throw traduire(error);
      return data?.organization_id ?? null;
    },

    async ouvrirAbonnement(demande: DemandeAbonnement) {
      // ------------------------------------------------------------
      // AUCUN MONTANT NE TRAVERSE CET APPEL, ET C'EST LE POINT.
      // ------------------------------------------------------------
      // Le prix vient d'`organization_plans`, côté base. Ce webhook
      // transmet une INTENTION — quelle offre, quel cycle, avec ou sans
      // essai — et trois dates ou nombres que le prestataire a déjà
      // opposés au client. Un prix qui viendrait d'ici serait un prix
      // qu'un attaquant pourrait proposer.
      const { data, error } = await admin.rpc("saas_start_subscription", {
        p_organization_id: demande.organisationId,
        p_plan: demande.plan,
        p_billing_cycle: demande.cycle,
        p_with_trial: demande.avecEssai,
        p_provider: PRESTATAIRE,
        p_provider_mode: demande.mode,
        p_provider_customer_id: demande.clientPrestataire,
        // LA CARTE EST ENREGISTRÉE, ET ON PEUT L'AFFIRMER : Stripe
        // Checkout la collecte par défaut, et le tunnel pose en outre
        // `payment_method_collection: 'always'`. Une session `complete`
        // sans carte n'existe pas dans ce montage.
        p_card_registered: true,
        p_reason: "Souscription en ligne (session de paiement confirmée).",
        // LES TROIS VÉRITÉS QUI VIENNENT DU DEHORS. La base ne les
        // recalcule pas : c'est le prestataire qui débite, à la date
        // annoncée au client, et cette base compte en UTC pendant que
        // l'écran compte à Paris.
        p_trial_ends_on: demande.finEssaiLe,
        p_billing_anchor_day: demande.jourAnniversaire,
        p_billable_extra_seats: demande.siegesFacturables,
      });

      if (error) {
        // 23505 = « Cette entreprise a déjà un abonnement. » Ce n'est
        // pas un refus à consigner comme une anomalie : c'est le rejeu
        // d'un événement déjà traité, ou une seconde session. On rend
        // `null` et `traitement.ts` en fait un « ignored ».
        if (error.code === "23505") return null;
        throw traduire(error);
      }

      const ligne = Array.isArray(data) ? data[0] : data;
      if (!ligne) {
        throw new Error("saas_start_subscription n'a rien rendu : abonnement dans un état indéterminé.");
      }
      return {
        statut: String(ligne.subscription_status ?? "inconnu"),
        numeroFacture: ligne.invoice_number ?? null,
        message: String(ligne.message ?? ""),
      };
    },

    async reprendreAbonnement(demande: DemandeAbonnement) {
      // LE CHEMIN DU RETOUR (migration 0092 § 8). Mêmes principes que
      // l'ouverture : aucun montant ne traverse cet appel, et les
      // vérités qui viennent du dehors se limitent à ce que le
      // prestataire a déjà opposé au client.
      //
      // L'ESSAI N'EST PAS UN PARAMÈTRE ICI, et c'est délibéré :
      // `saas_reopen_subscription` n'en accorde jamais. Résilier pour
      // redemander un mois gratuit serait le dernier contournement du
      // péage, et il se ferme du côté de la base plutôt que du côté de
      // l'appelant.
      const { data, error } = await admin.rpc("saas_reopen_subscription", {
        p_organization_id: demande.organisationId,
        p_plan: demande.plan,
        p_billing_cycle: demande.cycle,
        p_provider: PRESTATAIRE,
        p_provider_mode: demande.mode,
        p_provider_customer_id: demande.clientPrestataire,
        p_card_registered: true,
        p_reason: "Réabonnement en ligne (session de paiement confirmée).",
        p_billing_anchor_day: demande.jourAnniversaire,
        p_billable_extra_seats: demande.siegesFacturables,
      });

      if (error) {
        // 23505 = « Cet abonnement est en cours : il n'y a rien à
        // rouvrir. » Ce n'est pas une anomalie : c'est le rejeu d'un
        // événement déjà traité, ou une seconde session pour un client
        // dont l'abonnement court. Comme pour l'ouverture, on rend
        // `null` et `traitement.ts` en fait un « ignored ».
        if (error.code === "23505") return null;
        throw traduire(error);
      }

      const ligne = Array.isArray(data) ? data[0] : data;
      if (!ligne) {
        throw new Error("saas_reopen_subscription n'a rien rendu : abonnement dans un état indéterminé.");
      }
      return {
        statut: String(ligne.subscription_status ?? "inconnu"),
        numeroFacture: ligne.invoice_number ?? null,
        message: String(ligne.message ?? ""),
      };
    },

    facturesEncaissables(organisationId: string | null, factureDemandee: string | null) {
      return lireFactures(admin, organisationId, factureDemandee);
    },

    async encaissementDejaPose(reference: string) {
      // LA LECTURE PORTE EXACTEMENT SUR L'INDEX D'UNICITÉ de 0083
      // § 5.a — `(method, external_reference) where external_reference
      // is not null`. Elle est donc décisive : si la ligne est là, cet
      // argent est attaché à une facture, et le rejeu n'a rien à faire.
      //
      // Une PANNE de lecture lève et vaut 503 : mieux vaut un rejeu de
      // plus qu'un rapprochement refait sur une information manquante.
      const { data, error } = await admin
        .from("saas_invoice_payments")
        .select("id")
        .eq("method", "provider")
        .eq("external_reference", reference)
        .limit(1)
        .maybeSingle();
      if (error) throw traduire(error);
      return data !== null;
    },

    async enregistrerEncaissement(demande: DemandeEncaissement) {
      const { data, error } = await admin.rpc("saas_record_provider_payment", {
        p_provider: PRESTATAIRE,
        p_mode: mode,
        p_provider_event_id: demande.evenementId,
        p_invoice_id: demande.factureId,
        p_amount_cents: demande.montantCentimes,
        p_currency: demande.devise,
        p_payment_reference: demande.reference,
        // La base met `current_date` : c'est le jour où l'encaissement a
        // été CONSTATÉ, et c'est la bonne date. La date Stripe est celle
        // de l'événement, qui peut être un rejeu de trois jours.
        p_received_on: null,
      });
      if (error) throw traduire(error);
      return data === "duplicate" ? "duplicate" : "recorded";
    },
  };
}

/**
 * Une ligne de `saas_invoices`, telle que la sélection ci-dessous la
 * rend. Écrite à la main parce que le client Supabase importé d'un CDN
 * n'apporte aucun type de schéma ici : sans cette déclaration, chaque
 * champ serait `any` et une faute de frappe sur `organization_id`
 * passerait la vérification pour n'échouer qu'en production.
 */
interface LigneFacture {
  readonly id: string;
  readonly organization_id: string;
  readonly currency: string;
  readonly status: string;
}

/**
 * Les factures qu'on peut encaisser, avec leur reste à payer.
 *
 * Quand une facture est DÉSIGNÉE par les métadonnées, on va la chercher
 * SANS filtrer sur l'entreprise : c'est justement pour que
 * `rapprocher()` puisse constater qu'elle appartient à quelqu'un
 * d'autre et refuser. Filtrer ici rendrait ce contrôle impossible — la
 * facture d'autrui reviendrait simplement « introuvable », et on ne
 * saurait pas qu'on vient d'éviter de solder la dette d'un tiers.
 */
async function lireFactures(
  admin: SupabaseClient,
  organisationId: string | null,
  factureDemandee: string | null,
): Promise<FactureCandidate[]> {
  let requete = admin
    .from("saas_invoices")
    .select("id, organization_id, currency, status")
    // Émises et non soldées. `saas_record_provider_payment` refuse de
    // toute façon un brouillon et une facture annulée ; le filtre évite
    // simplement de les proposer au rapprochement.
    .eq("status", "issued");

  if (factureDemandee !== null) {
    requete = requete.eq("id", factureDemandee);
  } else if (organisationId !== null) {
    requete = requete.eq("organization_id", organisationId);
  } else {
    return [];
  }

  const { data: factures, error } = await requete;
  if (error) throw traduire(error);
  if (!factures || factures.length === 0) return [];

  const { data: soldes, error: erreurSolde } = await admin
    .from("saas_invoice_balance")
    .select("invoice_id, outstanding_cents")
    .in("invoice_id", factures.map((f: LigneFacture) => f.id));
  if (erreurSolde) throw traduire(erreurSolde);

  const parFacture = new Map<string, number | null>();
  for (const solde of soldes ?? []) {
    // `outstanding_cents` peut être NUL — la vue le rend ainsi quand un
    // prix reste indécidé. On propage le NUL tel quel, et
    // `rapprocher()` écarte ces factures. Un `?? 0` ici ferait croire à
    // une facture soldée.
    parFacture.set(solde.invoice_id, solde.outstanding_cents ?? null);
  }

  return factures.map((f: LigneFacture) => ({
    id: f.id,
    organizationId: f.organization_id,
    devise: f.currency,
    statut: f.status,
    resteCentimes: parFacture.has(f.id) ? parFacture.get(f.id) ?? null : null,
  }));
}

/**
 * Distingue un REFUS de la base d'une PANNE, et le traduit en une
 * erreur que `traitement.ts` sait lire.
 *
 * Classe 23 : violation d'intégrité. C'est l'`errcode` que 0081 et 0083
 * emploient systématiquement pour leurs refus — '23514' pour une règle
 * ('un encaissement se compte en centimes strictement positifs'),
 * '23503' pour une référence absente ('l'événement n'est pas au
 * journal'), '23505' pour un doublon ('l'entreprise est déjà rattachée
 * à un autre client'). Tout le reste — connexion coupée, délai dépassé,
 * '57014' — est une panne, et se rejoue.
 */
function traduire(erreur: { code?: string | null; message?: string }): Error {
  const code = typeof erreur.code === "string" ? erreur.code : "";
  const message = erreur.message ?? "erreur sans message";
  if (code.startsWith("23")) return new RefusMetier(`${message} (${code})`);
  return new Error(`${message}${code === "" ? "" : ` (${code})`}`);
}

function reponse(corps: unknown, statut = 200): Response {
  return new Response(JSON.stringify(corps), {
    status: statut,
    headers: { "Content-Type": "application/json" },
  });
}
