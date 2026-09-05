/**
 * §STRIPE — L'IMPLÉMENTATION, DERRIÈRE L'INTERFACE.
 *
 * ══════════════════════════════════════════════════════════════════
 * LA DÉCISION D'ARCHITECTURE QUI COMMANDE TOUT : STRIPE ENCAISSE,
 * OASIS CARE FACTURE.
 * ══════════════════════════════════════════════════════════════════
 *
 * Le prestataire sert à PRENDRE L'ARGENT et à dire QUAND il est pris.
 * La facture française — numérotée séquentiellement, sans trou, avec ses
 * mentions obligatoires — est celle que produit `saas_issue_invoice()`
 * depuis 0081. Aucune ligne de ce fichier n'appelle une API de facture
 * du prestataire, et ce n'est pas un oubli : une seconde numérotation
 * donnerait deux documents pour un seul achat, et le client ne saurait
 * plus lequel remettre à son comptable.
 *
 * ══════════════════════════════════════════════════════════════════
 * CE QUE CE FOURNISSEUR NE FAIT PAS, ET POURQUOI
 * ══════════════════════════════════════════════════════════════════
 *
 *   • IL N'OUVRE AUCUN DROIT. `startCheckout` rend une redirection, pas
 *     un abonnement. Un droit ne s'ouvre que sur un encaissement
 *     CONFIRMÉ — c'est-à-dire sur un événement signé reçu par la
 *     fonction Edge, jamais sur un retour de navigateur que
 *     l'utilisateur peut fabriquer en tapant l'URL de succès.
 *
 *   • IL N'ÉCRIT RIEN EN BASE. 0083 a révoqué `billing_provider_*`
 *     d'`authenticated` et ne les a accordées qu'à `service_role` :
 *     enregistrer le client, journaliser l'événement, poser
 *     l'encaissement sont des gestes de MACHINE, et cette route tourne
 *     sous le jeton d'un humain. La séparation est voulue, on ne la
 *     contourne pas.
 *
 *   • IL NE CALCULE AUCUNE TAXE et ne demande pas au prestataire d'en
 *     calculer. Les tarifs sont posés en `tax_behavior = 'exclusive'`
 *     (0083 le verrouille), et c'est `saas_vat_regime()` qui décide du
 *     régime. Deux moteurs de taxe, ce sont deux vérités.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  composerSouscription,
  phrasePourMotif,
  type Composition,
  type CycleFacturation,
  type SourceFacturation,
} from "./composition";
import { lirePlansActifs, type OrganizationPlan } from "./plans";
import { PRESTATAIRE_STRIPE, SourceFacturationSupabase } from "./source-supabase";
import {
  ClientStripeHttp,
  configEstComplete,
  lireConfigStripe,
  type ApiStripe,
} from "./stripe-api";
import type {
  BillingProvider,
  CheckoutIntent,
  CheckoutOutcome,
  OrganizationSubscription,
} from "./provider";
import { lireAbonnement } from "./abonnement";

/**
 * Les statuts qui interdisent une NOUVELLE souscription en ligne.
 *
 * POURQUOI CE VERROU EST NÉCESSAIRE ICI, et pas ailleurs : cette route
 * ne peut ni lire ni écrire `billing_provider_customers` (0083 réserve
 * cette table aux administrateurs et à la machine). Elle est donc
 * incapable de réutiliser le client déjà créé chez le prestataire — et
 * une seconde session en créerait un second, c'est-à-dire deux
 * historiques de paiement, deux moyens de paiement enregistrés, et un
 * remboursement qui part du mauvais.
 *
 * Tant que le changement d'offre n'a pas son propre chemin (mise à jour
 * de l'abonnement existant, ou portail client), on refuse — avec une
 * phrase qui dit quoi faire — plutôt que d'ouvrir un doublon silencieux.
 */
const STATUTS_DEJA_ABONNE = new Set(["trialing", "active", "pastDue"]);

/**
 * Ce qui ouvre une session de base de données, sous le jeton de
 * l'utilisateur connecté.
 *
 * POURQUOI C'EST INJECTÉ, ET NON IMPORTÉ ICI : `@/lib/supabase/server`
 * tire `next/headers`, qui n'existe qu'à l'intérieur d'une requête
 * Next.js. Un import statique rendrait ce fichier INCHARGEABLE par
 * `node --test` — c'est-à-dire non testé, exactement là où l'argent
 * passe. La fabrique est donc fournie par l'appelant : la vraie par
 * `provider.ts`, une fausse par les tests.
 */
export type FabriqueSupabase = () => Promise<SupabaseClient>;

export type OptionsStripeBillingProvider = {
  api: ApiStripe;
  /**
   * L'origine du site pour les URL de retour. Elle vient de
   * l'environnement du SERVEUR, jamais du navigateur : accepter une URL
   * postée par le client ferait de cette route un redirecteur ouvert.
   */
  origine: string;
  supabase: FabriqueSupabase;
  /** Fabrique la source de données. Les tests en fournissent une autre. */
  source?: (supabase: SupabaseClient) => SourceFacturation;
};

export class StripeBillingProvider implements BillingProvider {
  // `web` et non une nouvelle valeur : la colonne `provider` de
  // `organization_subscriptions` (0060) connaît quatre valeurs, et en
  // ajouter une cinquième demanderait une migration hors périmètre pour
  // dire ce que « web » dit déjà.
  readonly id = "web" as const;
  readonly label = "Carte bancaire et prélèvement";
  readonly unavailableReason = null;

  readonly #api: ApiStripe;
  readonly #origine: string;
  readonly #supabase: FabriqueSupabase;
  readonly #source: (supabase: SupabaseClient) => SourceFacturation;

  constructor(options: OptionsStripeBillingProvider) {
    this.#api = options.api;
    this.#origine = options.origine.replace(/\/+$/, "");
    this.#supabase = options.supabase;
    this.#source =
      options.source ?? ((supabase) => new SourceFacturationSupabase(supabase, options.api.mode));
  }

  async listPlans(): Promise<OrganizationPlan[]> {
    const supabase = await this.#supabase();
    return lirePlansActifs(supabase);
  }

  async getSubscription(organizationId: string): Promise<OrganizationSubscription | null> {
    const supabase = await this.#supabase();
    return lireAbonnement(supabase, organizationId);
  }

  /**
   * LE « RÉSUMÉ » DU TUNNEL, sans rien engager.
   *
   * §15 « Choisir → Résumé → Paiement → Confirmation ». Cette méthode
   * est l'étape « Résumé » : elle rend EXACTEMENT ce que `startCheckout`
   * encaissera, calculé par le même code. Un résumé calculé à part
   * finirait par annoncer un montant et en prélever un autre.
   */
  async previewCheckout(intent: CheckoutIntent): Promise<Composition> {
    const supabase = await this.#supabase();
    return this.#composer(supabase, intent);
  }

  async startCheckout(intent: CheckoutIntent): Promise<CheckoutOutcome> {
    const supabase = await this.#supabase();

    // ---- 1. Un abonnement en cours ferme la caisse ----------------
    const abonnement = await lireAbonnement(supabase, intent.organizationId);
    if (abonnement !== null && STATUTS_DEJA_ABONNE.has(abonnement.status)) {
      return {
        kind: "unavailable",
        reason:
          "Cette entreprise a déjà un abonnement en cours. Un changement d'offre se fait sur l'abonnement existant, pas par une nouvelle souscription : ouvrir une seconde souscription créerait un second dossier de paiement chez le prestataire, et un remboursement partirait du mauvais.",
      };
    }

    // ---- 2. Ce qui est dû, relu en base ---------------------------
    const composition = await this.#composer(supabase, intent);
    if (!composition.jouable) {
      return { kind: "unavailable", reason: composition.motif };
    }
    if (composition.lignes.length === 0) {
      // Défense : une souscription sans ligne encaisserait zéro sans
      // lever. Elle ne devrait pas pouvoir se produire — l'offre pose
      // toujours une ligne — mais un encaissement à zéro est le genre
      // de chose qu'on découvre trois mois plus tard.
      return {
        kind: "unavailable",
        reason: "Cette souscription ne comporte aucune ligne à encaisser : elle est refusée.",
      };
    }

    // ---- 3. L'e-mail du payeur ------------------------------------
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return {
        kind: "unavailable",
        reason: "Votre session a expiré. Reconnectez-vous pour souscrire.",
      };
    }

    // ---- 4. La session de paiement --------------------------------
    //
    // LA CLÉ D'IDEMPOTENCE est déduite de l'INTENTION, pas tirée au
    // hasard : deux clics sur « Payer » portent la même intention et
    // doivent rendre la même session. Une clé aléatoire créerait deux
    // sessions, donc deux abonnements possibles pour un seul client.
    const clefIdempotence = clefPourIntention(intent.organizationId, composition);

    const metadonnees: Record<string, string> = {
      organizationId: intent.organizationId,
      planKey: composition.planKey,
      billingCycle: composition.billingCycle,
      mode: this.#api.mode,
      // Le montant HORS TAXES que NOUS avons calculé. Le webhook le
      // recomparera à ce que le prestataire dit avoir encaissé : deux
      // chiffres qui divergent valent mieux qu'un seul qu'on croit.
      totalHtCents: String(composition.totalHtCents),
      siegesFacturables: String(composition.siegesFacturables),
    };
    if (composition.modulesInclusSansFrais.length > 0) {
      metadonnees.modulesInclus = composition.modulesInclusSansFrais.join(",");
    }
    if (composition.remise !== null) {
      // CE QU'IL FAUT POUR SORTIR DE LA REMISE. `ends_on` est NOT NULL
      // en base : la remise a une fin, et le treizième mois repart au
      // tarif public. Ces trois clés sont ce dont l'automate de retour
      // (échéancier d'abonnement, posé par la fonction Edge) a besoin
      // pour le faire sans refaire ce calcul.
      metadonnees.remiseCode = composition.remise.code ?? "";
      metadonnees.remiseFinLe = composition.remise.finLe;
      metadonnees.remisePrixPublicId = composition.remise.providerPricePublicId;
    }

    const session = await this.#api.creerSessionPaiement({
      clefIdempotence,
      emailClient: user.email ?? null,
      lignes: composition.lignes.map((ligne) => ({
        price: ligne.providerPriceId,
        quantity: ligne.quantite,
      })),
      // L'IDENTIFIANT DE SESSION DANS L'URL DE SUCCÈS SERT À AFFICHER,
      // PAS À OUVRIR UN DROIT. La page de confirmation lit l'état de
      // l'abonnement en base ; si le webhook n'est pas encore passé,
      // elle dit « paiement en cours de confirmation » plutôt que
      // d'accorder quoi que ce soit.
      urlSucces: `${this.#origine}/entreprise/abonnement?souscription=confirmee&session={CHECKOUT_SESSION_ID}`,
      urlAbandon: `${this.#origine}/entreprise/abonnement?souscription=abandonnee`,
      metadonnees,
      metadonneesAbonnement: metadonnees,
    });

    if (session.url === null) {
      return {
        kind: "unavailable",
        reason:
          "Le prestataire de paiement n'a pas rendu de page de paiement. Rien n'a été prélevé ; réessayez dans un instant.",
      };
    }

    return { kind: "redirect", url: session.url };
  }

  async #composer(supabase: SupabaseClient, intent: CheckoutIntent): Promise<Composition> {
    return composerSouscription(
      {
        organizationId: intent.organizationId,
        planKey: intent.planKey,
        // Le défaut est le MOIS. C'est le cycle dont tous les prix
        // existent : l'annuel manque au siège supplémentaire et à la
        // remise fondateur, et 0083 bloque explicitement ces deux cas.
        billingCycle: intent.billingCycle ?? "monthly",
        modulesVoulus: intent.moduleKeys,
      },
      this.#source(supabase),
    );
  }
}

/**
 * Une clé d'idempotence STABLE pour une intention donnée.
 *
 * Elle inclut le total et les lignes : si le client change d'avis et
 * demande autre chose, l'intention n'est plus la même et une nouvelle
 * session doit naître. Si en revanche il reclique sur le même bouton, la
 * clé est identique et le prestataire rend la session déjà créée.
 */
export function clefPourIntention(organizationId: string, composition: Composition): string {
  if (!composition.jouable) return `${organizationId}:refus`;
  const empreinte = composition.lignes
    .map((ligne) => `${ligne.providerPriceId}x${ligne.quantite}`)
    .join("|");
  return `oasis:${organizationId}:${composition.planKey}:${composition.billingCycle}:${composition.totalHtCents}:${empreinte}`;
}

/**
 * Le fournisseur Stripe, ou la raison de son absence.
 *
 * L'ABSENCE DE CLÉ EST UN ÉTAT NORMAL. Elle ne lève pas, elle rend une
 * phrase — et `getBillingProvider()` retombe alors sur le fournisseur
 * « aucun encaissement », qui sait tout lire et refuse la seule chose
 * qu'il ne sait pas faire.
 */
export function construireStripeBillingProvider(
  supabase: FabriqueSupabase,
  env: Record<string, string | undefined> = process.env,
): StripeBillingProvider | { indisponible: string } {
  const config = lireConfigStripe(env);
  if (!configEstComplete(config)) return { indisponible: config.manque };

  const origine = env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, "");
  if (!origine || !/^https?:\/\//.test(origine)) {
    // L'URL DE RETOUR NE PEUT PAS VENIR DU NAVIGATEUR. Un `Host` est
    // falsifiable ; une URL postée par le client l'est encore plus, et
    // la route deviendrait un redirecteur ouvert au bout d'un tunnel de
    // paiement — exactement l'endroit où l'on clique sans lire.
    return {
      indisponible:
        "L'adresse publique du site (NEXT_PUBLIC_SITE_URL) n'est pas déclarée sur ce serveur. Sans elle, la page de retour après paiement ne peut pas être construite de façon sûre.",
    };
  }

  return new StripeBillingProvider({
    api: new ClientStripeHttp(config),
    origine,
    supabase,
  });
}

export { PRESTATAIRE_STRIPE, phrasePourMotif };
export type { CycleFacturation };
