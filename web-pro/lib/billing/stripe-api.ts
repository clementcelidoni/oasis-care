/**
 * §STRIPE — LE CLIENT HTTP, ET SA PORTE.
 *
 * ══════════════════════════════════════════════════════════════════
 * POURQUOI UNE INTERFACE, ET UN CLIENT ÉCRIT À LA MAIN
 * ══════════════════════════════════════════════════════════════════
 *
 * `ApiStripe` est une INTERFACE, et c'est ce qui rend la suite de tests
 * jouable : aucun test de ce dépôt ne doit avoir besoin du réseau. Un
 * test qui exigerait un appel à `api.stripe.com` ne tournerait jamais en
 * intégration, et on s'en apercevrait le jour où il aurait quelque chose
 * à dire.
 *
 * Le client réel parle l'API HTTP de Stripe directement, en
 * `application/x-www-form-urlencoded`, plutôt que par la bibliothèque
 * `stripe` du npm. Deux raisons, dans cet ordre :
 *
 *   1. la dépendance n'est PAS dans `web-pro/package.json`, et ce
 *      fichier n'a pas le droit de l'y mettre (trois chantiers écrivent
 *      dans ce dossier en même temps ; toucher au manifeste des paquets,
 *      c'est écraser le travail d'un autre). Le compte rendu la demande
 *      à l'intégration ;
 *   2. la surface employée ici est minuscule — créer un client, créer
 *      une session de paiement — et entièrement stable. Ce qu'il ne faut
 *      SURTOUT PAS réécrire à la main, c'est la vérification de
 *      signature du webhook : ce code-là s'écrit une fois et ne se teste
 *      jamais assez. Il n'est pas dans ce fichier, et il ne doit pas y
 *      arriver.
 *
 * ══════════════════════════════════════════════════════════════════
 * AUCUNE CLÉ N'EST ÉCRITE ICI
 * ══════════════════════════════════════════════════════════════════
 *
 * Le code LIT des variables d'environnement, point. Et il en lit trois,
 * dont deux seulement le concernent :
 *
 *   • STRIPE_SECRET_KEY   — la clé secrète. SANS préfixe NEXT_PUBLIC_,
 *     et c'est vital : Next.js n'inline dans le paquet du navigateur QUE
 *     les variables ainsi préfixées. `NEXT_PUBLIC_STRIPE_SECRET_KEY`
 *     publierait la clé à chaque visiteur du site, en silence.
 *   • STRIPE_MODE         — 'test' ou 'live'. Explicite, et pas déduit
 *     du préfixe de la clé : une déduction se trompe une fois, et cette
 *     fois-là on envoie des identifiants de tarif d'essai à l'API de
 *     production.
 *   • STRIPE_WEBHOOK_SECRET — n'est PAS lu ici. C'est la fonction Edge
 *     qui le lit, et elle seule.
 *
 * L'ABSENCE DE CLÉ EST UN ÉTAT NORMAL, pas une panne : le fournisseur
 * rend alors « unavailable » avec une phrase, l'écran n'affiche pas de
 * bouton, et rien ne ment.
 */

import type { ModePrestataire } from "./composition.ts";

/** La version d'API épinglée. Voir `.agents/skills/stripe-best-practices`. */
export const VERSION_API_STRIPE = "2026-08-26.dahlia";

/**
 * L'ÉTIQUETTE D'INTÉGRATION, exigée depuis `2026-03-25.dahlia`.
 *
 * La documentation officielle demande un libellé suivi de HUIT LETTRES
 * tirées au sort — c'est ce qui distingue deux tunnels de paiement dans
 * le tableau de bord du prestataire. Elles sont tirées UNE FOIS, à
 * l'écriture, et figées ici : les tirer à chaque appel donnerait un
 * tunnel différent à chaque session et le tableau de bord n'aurait plus
 * rien à comparer.
 */
export const ETIQUETTE_INTEGRATION = "oasis-care-pro-souscription-qkzrvbxm";

const BASE_API_STRIPE = "https://api.stripe.com/v1";

export type ConfigStripe = {
  cleSecrete: string;
  mode: ModePrestataire;
};

/** Ce qui empêche d'instancier le client, dit en français. */
export type ConfigStripeManquante = { manque: string };

export type LectureConfigStripe = ConfigStripe | ConfigStripeManquante;

export function configEstComplete(lecture: LectureConfigStripe): lecture is ConfigStripe {
  return "cleSecrete" in lecture;
}

/**
 * La configuration, lue dans l'environnement.
 *
 * `env` est un paramètre pour que les tests puissent la fournir sans
 * toucher au `process.env` du processus — un test qui modifie
 * l'environnement global contamine ceux qui suivent, et le désordre ne
 * se voit qu'à l'ordre d'exécution.
 */
export function lireConfigStripe(
  env: Record<string, string | undefined> = process.env,
): LectureConfigStripe {
  const cleSecrete = env.STRIPE_SECRET_KEY?.trim();
  if (!cleSecrete) {
    return {
      manque:
        "Le paiement en ligne n'est pas encore branché : la clé secrète du prestataire (STRIPE_SECRET_KEY) n'est pas posée sur ce serveur.",
    };
  }

  // LE PRÉFIXE NEXT_PUBLIC_ SERAIT UNE FUITE, pas une commodité. On
  // refuse net plutôt que d'encaisser avec une clé qui est peut-être
  // déjà partie dans le navigateur de tous les visiteurs.
  if (env.NEXT_PUBLIC_STRIPE_SECRET_KEY !== undefined) {
    return {
      manque:
        "Une variable NEXT_PUBLIC_STRIPE_SECRET_KEY existe sur ce serveur. Ce préfixe publie la valeur dans le navigateur : la clé doit être révoquée chez le prestataire, puis reposée sous le nom STRIPE_SECRET_KEY. Aucun encaissement tant que ce n'est pas fait.",
    };
  }

  const mode = env.STRIPE_MODE?.trim();
  if (mode !== "test" && mode !== "live") {
    return {
      manque:
        "Le mode du prestataire n'est pas déclaré (STRIPE_MODE doit valoir « test » ou « live »). Une correspondance de tarif d'essai employée en production n'encaisserait rien : on refuse plutôt que de le déduire de la forme de la clé.",
    };
  }

  return { cleSecrete, mode };
}

// ────────────────────────────────────────────────────────────────
// LA PORTE
// ────────────────────────────────────────────────────────────────

export type LigneSession = {
  /** L'identifiant du tarif chez le prestataire (`price_…`). */
  price: string;
  quantity: number;
};

export type DemandeSessionPaiement = {
  /**
   * LA CLÉ D'IDEMPOTENCE. Deux clics sur « Payer » ne doivent pas créer
   * deux abonnements. Stripe rend la MÊME session pour la même clé
   * pendant 24 h ; sans elle, un double-clic ou un `retry` du réseau
   * facture deux fois.
   */
  clefIdempotence: string;
  /**
   * Le client déjà rattaché à l'entreprise. Absent aujourd'hui : la
   * table qui le porte n'est pas lisible sous un jeton d'utilisateur
   * (0083). Le champ existe pour le jour où une lecture lui sera
   * ouverte — réutiliser le client évite deux historiques de paiement.
   */
  clientId?: string | null;
  /** Employé quand aucun client n'est connu, c'est-à-dire toujours pour l'instant. */
  emailClient: string | null;
  lignes: LigneSession[];
  urlSucces: string;
  urlAbandon: string;
  /** Retrouvé tel quel dans l'événement du webhook. */
  metadonnees: Record<string, string>;
  /** Posé sur l'ABONNEMENT créé, et non sur la session. */
  metadonneesAbonnement: Record<string, string>;
  /**
   * LES OBJETS DE TAXE À APPLIQUER, décidés par NOUS.
   *
   * Vide quand le taux vaut zéro — autoliquidation, hors Union — et
   * c'est un état normal : il n'y a alors rien à ajouter au hors taxes.
   * Jamais vide « par défaut » en revanche : un client français dont la
   * liste serait vide paierait 79,90 € au lieu de 95,88, et les 15,98 €
   * de TVA ne seraient jamais collectés.
   */
  tauxTaxe: string[];
  /**
   * L'ESSAI GRATUIT, OU SON ABSENCE.
   *
   * ══════════════════════════════════════════════════════════════
   * POURQUOI UN INSTANT ET NON UN NOMBRE DE JOURS
   * ══════════════════════════════════════════════════════════════
   *
   * Le prestataire accepte les deux : `trial_period_days` (un nombre)
   * ou `trial_end` (un horodatage). On emploie le SECOND, et c'est une
   * décision.
   *
   * « Un mois » n'est pas « trente jours ». Un essai ouvert le
   * 31 janvier finit le 28 février — vingt-huit jours — et l'écran
   * l'annonce ainsi. Envoyer « 30 jours » ferait débiter le 2 mars une
   * carte dont le titulaire a lu « 28 février » : la date affichée et
   * la date prélevée doivent être LE MÊME jour, calculé une seule fois.
   *
   * `null` veut dire « pas d'essai », donc premier prélèvement à la
   * souscription. Ce n'est pas un défaut d'absence : c'est un des deux
   * chemins, et l'appelant l'a choisi explicitement.
   */
  essai: EssaiSession | null;
};

/**
 * CE QU'IL FAUT AU PRESTATAIRE POUR TENIR UN ESSAI SANS DÉBITER.
 */
export type EssaiSession = {
  /** L'instant exact de fin d'essai, en secondes. */
  finLeHorodatage: number;
  /** Le même jour, en ISO — pour les métadonnées et les journaux. */
  finLeIso: string;
};

export type SessionPaiement = {
  id: string;
  /** Null si le prestataire n'a pas rendu d'URL : l'appelant refuse alors. */
  url: string | null;
  clientId: string | null;
};

/**
 * UNE SEULE MÉTHODE, ET C'EST VOULU.
 *
 * Ce client ne crée PAS de client chez le prestataire, et ne l'écrit
 * nulle part. 0083 a réservé `billing_provider_customers` aux
 * administrateurs (lecture) et à `service_role` (écriture) : rattacher
 * une entreprise à son client est un geste de MACHINE, fait par la
 * fonction Edge quand l'encaissement est confirmé. Le faire ici, sous le
 * jeton d'un humain, demanderait soit une clé de service dans le serveur
 * web, soit un assouplissement de la RLS — deux façons d'abîmer ce que
 * 0083 protège.
 *
 * La session est donc ouverte avec l'e-mail du payeur ; le prestataire
 * crée le client, et le webhook le rattache.
 */
export interface ApiStripe {
  readonly mode: ModePrestataire;
  creerSessionPaiement(demande: DemandeSessionPaiement): Promise<SessionPaiement>;
}

/** Une réponse d'erreur du prestataire, telle qu'on veut la voir remonter. */
export class ErreurStripe extends Error {
  readonly statut: number;
  readonly codeStripe: string | null;

  constructor(statut: number, codeStripe: string | null, message: string) {
    super(message);
    this.name = "ErreurStripe";
    this.statut = statut;
    this.codeStripe = codeStripe;
  }
}

/**
 * L'ENCODAGE DE FORMULAIRE DE STRIPE, et il n'est pas anodin.
 *
 * L'API attend `line_items[0][price]=price_123`, pas du JSON. Une
 * imbrication mal encodée ne produit pas une erreur claire : elle
 * produit une session sans lignes, donc un paiement à zéro. D'où un test
 * dédié à cette fonction seule.
 *
 * Les valeurs `null` et `undefined` sont OMISES plutôt qu'envoyées
 * vides : Stripe traite `customer=` (vide) comme une valeur invalide, et
 * non comme une absence.
 */
export function encoderFormulaire(valeur: unknown, prefixe = ""): string[] {
  if (valeur === null || valeur === undefined) return [];

  if (Array.isArray(valeur)) {
    return valeur.flatMap((element, index) => encoderFormulaire(element, `${prefixe}[${index}]`));
  }

  if (typeof valeur === "object") {
    return Object.entries(valeur as Record<string, unknown>).flatMap(([clef, sousValeur]) =>
      encoderFormulaire(sousValeur, prefixe === "" ? clef : `${prefixe}[${clef}]`),
    );
  }

  return [`${encodeURIComponent(prefixe)}=${encodeURIComponent(String(valeur))}`];
}

/**
 * Le client réel.
 *
 * Il ne s'instancie qu'avec une configuration complète — voir
 * `lireConfigStripe`. Rien dans ce fichier ne fabrique de clé, n'en
 * enregistre une, ni n'en écrit une dans un journal : `Authorization`
 * n'apparaît jamais dans un message d'erreur.
 */
export class ClientStripeHttp implements ApiStripe {
  readonly mode: ModePrestataire;
  readonly #cleSecrete: string;
  readonly #fetch: typeof fetch;

  constructor(config: ConfigStripe, fetchImpl: typeof fetch = fetch) {
    this.mode = config.mode;
    this.#cleSecrete = config.cleSecrete;
    this.#fetch = fetchImpl;
  }

  async #poster(
    chemin: string,
    corps: Record<string, unknown>,
    clefIdempotence: string,
  ): Promise<Record<string, unknown>> {
    const reponse = await this.#fetch(`${BASE_API_STRIPE}${chemin}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.#cleSecrete}`,
        "Content-Type": "application/x-www-form-urlencoded",
        // ÉPINGLÉE. Sans elle, la version d'API suit celle du compte, et
        // une mise à jour faite dans le tableau de bord changerait la
        // forme des réponses de ce code sans qu'aucun déploiement ait eu
        // lieu.
        "Stripe-Version": VERSION_API_STRIPE,
        "Idempotency-Key": clefIdempotence,
      },
      body: encoderFormulaire(corps).join("&"),
    });

    const charge = (await reponse.json()) as Record<string, unknown>;

    if (!reponse.ok) {
      const erreur = (charge.error ?? {}) as { code?: string; message?: string };
      throw new ErreurStripe(
        reponse.status,
        erreur.code ?? null,
        erreur.message ?? "Le prestataire de paiement a refusé la demande.",
      );
    }

    return charge;
  }

  async creerSessionPaiement(demande: DemandeSessionPaiement): Promise<SessionPaiement> {
    const corps: Record<string, unknown> = {
      mode: "subscription",
      // AUCUN `payment_method_types` : Stripe choisit dynamiquement les
      // moyens éligibles d'après les réglages du compte. Le figer sur
      // « card » exclurait le prélèvement SEPA, qui est le moyen que
      // choisit une entreprise française sur un abonnement mensuel.
      line_items: demande.lignes,
      success_url: demande.urlSucces,
      cancel_url: demande.urlAbandon,
      metadata: demande.metadonnees,
      subscription_data: { metadata: demande.metadonneesAbonnement },
      // AUCUN `automatic_tax`, ET C'EST UNE DÉCISION. La documentation
      // du prestataire est formelle : son moteur automatique ne peut pas
      // coexister avec des objets de taxe explicites, et surtout il
      // n'émet AUCUNE erreur quand une immatriculation manque — il
      // calcule zéro, et l'intégration croit collecter. C'est
      // `saas_vat_regime_compute()` qui décide, et elle sait refuser.
      // LES FACTURES DE STRIPE NE SONT PAS NOS FACTURES. La facture
      // française — numérotée sans trou, avec ses mentions obligatoires —
      // est celle que produit `saas_issue_invoice()`. On ne demande donc
      // aucune création de facture au prestataire, et l'envoi de ses
      // e-mails de facture doit rester désactivé dans son tableau de
      // bord : deux documents numérotés pour un seul achat, c'est un
      // client qui ne sait plus lequel présenter à son comptable.
      // La MÊME clé que celle des métadonnées, et le nom est préfixé
      // des deux côtés. Cette valeur est ce que le tableau de bord du
      // prestataire affiche en tête de session : c'est ce qui permet à
      // un humain de relier un paiement à une entreprise sans requête.
      client_reference_id: demande.metadonnees.oasis_organization_id ?? null,
      integration_identifier: ETIQUETTE_INTEGRATION,
      // LA CARTE EST OBLIGATOIRE, ESSAI COMPRIS, ET ON LE DIT PLUTÔT
      // QUE DE S'EN REMETTRE AU DÉFAUT.
      //
      // La documentation du prestataire est explicite : « par défaut,
      // les sessions Checkout collectent un moyen de paiement à
      // utiliser à la fin de la période d'essai », et
      // `payment_method_collection = 'if_required'` est ce qui
      // DÉSACTIVE cette collecte. Le défaut nous convient donc — mais
      // c'est la décision du dirigeant (« essai gratuit un mois avec
      // carte OBLIGATOIREMENT »), et une décision ne se confie pas à un
      // défaut : un défaut peut changer, et il changerait en silence.
      //
      // Un essai sans carte se termine par un client qui disparaît le
      // trentième jour ; c'est aussi la raison pour laquelle
      // `saas_start_subscription()` refuse une souscription dont la
      // carte n'est pas enregistrée.
      payment_method_collection: "always",
    };

    // L'ESSAI, POSÉ SUR L'ABONNEMENT.
    //
    // `trial_end` porte la date exacte de fin — celle-là même que
    // l'écran a annoncée et que la base recalculera. Voir
    // `DemandeSessionPaiement.essai` pour la raison de ce choix.
    //
    // ET LE GARDE-FOU : `missing_payment_method = 'cancel'`. Il ne
    // devrait jamais servir, puisque la carte est exigée à l'entrée —
    // mais un moyen de paiement peut être retiré, expirer ou être
    // refusé pendant le mois d'essai. Sans cette consigne, l'abonnement
    // basculerait en impayé et le droit resterait ouvert sans
    // contrepartie. « Annuler » plutôt que « suspendre » : un
    // abonnement suspendu peut le rester indéfiniment, sans facture et
    // sans fin, et personne ne va voir.
    if (demande.essai !== null) {
      const abonnement = corps.subscription_data as Record<string, unknown>;
      abonnement.trial_end = demande.essai.finLeHorodatage;
      abonnement.trial_settings = { end_behavior: { missing_payment_method: "cancel" } };
    }

    // LA TAXE SE POSE SUR L'ABONNEMENT, PAS SUR LES LIGNES DE LA
    // SESSION, ET LA DIFFÉRENCE EST TOUT L'ENJEU.
    //
    // `line_items[n][tax_rates]` ne taxerait que la PREMIÈRE facture.
    // `subscription_data[default_tax_rates]` devient le taux par défaut
    // de l'abonnement, donc de CHAQUE facture qu'il produira. Or les
    // renouvellements sont justement ceux que personne ne regarde :
    // une taxe posée seulement sur la première échéance se serait vue
    // le premier mois et oubliée les onze suivants.
    if (demande.tauxTaxe.length > 0) {
      (corps.subscription_data as Record<string, unknown>).default_tax_rates = demande.tauxTaxe;
    }

    if (demande.clientId !== null && demande.clientId !== undefined) {
      corps.customer = demande.clientId;
    } else if (demande.emailClient !== null) {
      corps.customer_email = demande.emailClient;
    }

    const charge = await this.#poster("/checkout/sessions", corps, demande.clefIdempotence);
    const id = charge.id;
    if (typeof id !== "string") {
      throw new ErreurStripe(502, null, "Le prestataire n'a pas rendu d'identifiant de session.");
    }

    return {
      id,
      url: typeof charge.url === "string" ? charge.url : null,
      clientId: typeof charge.customer === "string" ? charge.customer : null,
    };
  }
}
