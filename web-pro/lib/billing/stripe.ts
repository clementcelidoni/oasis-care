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
 *   • IL NE DEMANDE AUCUN CALCUL DE TAXE AU PRESTATAIRE — mais il en
 *     transmet une, et la nuance est tout l'enjeu. Les tarifs sont
 *     posés en `tax_behavior = 'exclusive'` (0083 le verrouille) : ils
 *     sont hors taxes. C'est `saas_vat_regime_compute()` qui décide du
 *     régime et `billing_provider_tax_terms()` qui rend l'objet de taxe
 *     à appliquer ; la session le porte en
 *     `subscription_data[default_tax_rates]`, donc sur l'abonnement et
 *     sur chacune de ses échéances.
 *
 *     Ne rien transmettre du tout, comme c'était le cas au départ,
 *     revenait à encaisser 79,90 € là où la facture en réclame 95,88 :
 *     la TVA française n'était jamais collectée, et Oasis Care en
 *     restait redevable. Le moteur AUTOMATIQUE du prestataire, lui,
 *     reste éteint — deux moteurs de taxe, ce sont deux vérités, et le
 *     sien ne signale rien quand une immatriculation manque.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  composerSouscription,
  jourDeReference,
  phrasePourMotif,
  versResumePublic,
  type Composition,
  type CycleFacturation,
  type ResumeSouscription,
  type SourceFacturation,
} from "./composition.ts";
import {
  annoncerEssai,
  horodatageFinEssai,
  planifierEssai,
  type AnnonceEssai,
  type PlanEssai,
} from "./essai.ts";
import { lirePlansActifs, type OrganizationPlan } from "./plans.ts";
import { PRESTATAIRE_STRIPE, SourceFacturationSupabase } from "./source-supabase.ts";
import {
  ClientStripeHttp,
  configEstComplete,
  lireConfigStripe,
  type ApiStripe,
} from "./stripe-api.ts";
import type {
  BillingProvider,
  CheckoutIntent,
  CheckoutOutcome,
  OrganizationSubscription,
} from "./provider.ts";
import { lireAbonnement } from "./abonnement.ts";
import { lireSituationPeage } from "../peage/situation.ts";
// CHEMIN RELATIF ET EXTENSION EXPLICITE, VOLONTAIREMENT.
//
// L'alias `@/…` est résolu par le compilateur de Next, PAS par Node :
// l'employer ici rendrait ce fichier inchargeable par `node --test`,
// c'est-à-dire non testé, exactement là où l'argent passe. Le fichier
// visé est PUR — aucune importation, aucune dépendance à une requête —
// donc il se charge sans rien tirer derrière lui.
import { manquePourFacturer, type IdentiteSaisie } from "../../app/inscription/identite.ts";

/**
 * L'IDENTITÉ FACTURABLE DE L'ENTREPRISE, lue sous le jeton de
 * l'appelant.
 *
 * Rend `null` quand la lecture échoue — et l'appelant refuse alors,
 * plutôt que de considérer une fiche illisible comme une fiche vide ou
 * comme une fiche complète. Les deux erreurs coûtent : l'une bloque un
 * client en règle, l'autre encaisse une facture qu'on ne pourra pas
 * émettre. On dit « je ne sais pas » et on s'arrête.
 */
async function lireIdentiteFacturable(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<IdentiteSaisie | null> {
  const { data, error } = await supabase
    .from("business_organizations")
    .select("legal_name, legal_form, siren, siret, vat_number, address_line1, postal_code, city, country")
    .eq("id", organizationId)
    .maybeSingle();

  if (error || !data) return null;

  const ligne = data as Record<string, string | null>;
  return {
    legalName: ligne.legal_name,
    legalForm: ligne.legal_form,
    siren: ligne.siren,
    siret: ligne.siret,
    vatNumber: ligne.vat_number,
    addressLine1: ligne.address_line1,
    postalCode: ligne.postal_code,
    city: ligne.city,
    // `country` est NOT NULL en base avec 'FR' par défaut. On ne
    // coalesce pas pour autant : si la colonne devenait nulle, la zone
    // fiscale serait « France » par accident, et un client suisse se
    // verrait réclamer 20 % de TVA.
    country: ligne.country,
  };
}

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
  async previewCheckout(intent: CheckoutIntent): Promise<ResumeSouscription> {
    const supabase = await this.#supabase();

    // LE RÉSUMÉ DIT LA MÊME CHOSE QUE LA CAISSE, Y COMPRIS QUAND ELLE
    // EST FERMÉE.
    //
    // Sans ce contrôle, le résumé chiffrait entièrement une
    // souscription que le bouton de paiement allait refuser — et c'est
    // le chemin OFFICIEL de montée en gamme : l'écran d'abonnement
    // propose « Changer d'offre » et renvoie ici. Le client voyait un
    // total, une remise, des modules, un bouton « Payer », puis un
    // refus. Un écran qui chiffre ce qu'il ne vendra pas use la
    // confiance plus vite qu'un refus annoncé d'emblée.
    const ferme = await this.#caisseFermeePour(supabase, intent.organizationId);
    if (ferme !== null) {
      return { jouable: false, code: ferme.code, motif: ferme.motif };
    }

    // `versResumePublic` retire l'identifiant de tarif du prestataire :
    // ce qui part au navigateur est ce qu'il doit AFFICHER, pas ce qui
    // sert à encaisser.
    //
    // LE CALENDRIER VOYAGE AVEC LE MONTANT, et c'est le point de tout
    // ce paragraphe : « un mois gratuit, puis 79,90 € HT par mois,
    // votre carte est débitée le 6 octobre » se dit d'un seul tenant,
    // depuis un seul calcul. Une date affichée par un écran et une date
    // envoyée au prestataire par un autre chemin finiraient par
    // diverger, et le client ne le verrait qu'au relevé.
    const composition = await this.#composer(supabase, intent);
    return versResumePublic(composition, this.#annoncerEssai(intent, composition));
  }

  /**
   * LE CALENDRIER DE CETTE SOUSCRIPTION.
   *
   * ══════════════════════════════════════════════════════════════
   * POURQUOI L'ESSAI EST LE DÉFAUT, ET POURQUOI C'EST SÛR ICI
   * ══════════════════════════════════════════════════════════════
   *
   * `intent.avecEssai` non renseigné vaut VRAI : c'est la lecture
   * retenue de la décision du dirigeant — « tout nouveau client entre
   * par l'essai ». Un appelant qui ne dit rien (une intégration tierce,
   * la route de résumé) obtient donc le parcours nominal, pas un
   * prélèvement immédiat qu'il n'a pas demandé.
   *
   * ET L'ÉLIGIBILITÉ N'A PAS À ÊTRE REVÉRIFIÉE ICI, parce que la caisse
   * s'en est déjà chargée : `#caisseFermeePour` refuse toute entreprise
   * qui porte une ligne d'abonnement, en cours OU résiliée. Quand on
   * arrive jusqu'ici, l'entreprise n'en a aucune — c'est un premier
   * abonnement, donc l'essai lui est dû. Le jour où le réabonnement
   * s'ouvrira, c'est CE commentaire qu'il faudra relire : l'essai ne
   * devra pas repartir avec lui.
   */
  #planEssai(intent: CheckoutIntent, cycle: CycleFacturation): PlanEssai {
    return planifierEssai({
      // Le jour de PARIS, pas celui d'UTC : à 23 h 30 en France l'UTC
      // est déjà le lendemain l'été, et l'écran annoncerait un
      // prélèvement le 7 à quelqu'un qui souscrit le 6.
      souscritLe: jourDeReference(),
      avecEssai: intent.avecEssai ?? true,
      cycle,
    });
  }

  #annoncerEssai(intent: CheckoutIntent, composition: Composition): AnnonceEssai | null {
    // Une souscription refusée n'a pas de calendrier : annoncer une
    // date de prélèvement sous un motif de refus laisserait croire que
    // quelque chose partira quand même.
    if (!composition.jouable) return null;
    return annoncerEssai(this.#planEssai(intent, composition.billingCycle), {
      totalHtCents: composition.totalHtCents,
      totalTtcCents: composition.taxe.totalTtcCents,
    });
  }

  /**
   * CE QUI FERME LA CAISSE AVANT MÊME DE CALCULER UN PRIX.
   *
   * Extrait pour que le RÉSUMÉ et le PAIEMENT posent exactement les
   * mêmes questions. Deux listes de contrôles séparées finissent
   * toujours par diverger, et l'écart se voit au pire moment : après
   * que le client a cliqué.
   */
  async #caisseFermeePour(
    supabase: SupabaseClient,
    organizationId: string,
  ): Promise<{ code: string; motif: string } | null> {
    // ══════════════════════════════════════════════════════════════
    // 1. CE N'EST PLUS LE STATUT QUI FERME LA CAISSE, C'EST LE PÉAGE
    // ══════════════════════════════════════════════════════════════
    //
    // La question à poser n'est pas « y a-t-il une ligne
    // d'abonnement ? » — il y en a toujours une après la première
    // souscription, la clé primaire de la table y veille — mais
    // « CET ABONNEMENT OUVRE-T-IL ENCORE QUELQUE CHOSE ? ». C'est
    // exactement ce que rend `peage_etat_organisation` (migration
    // 0092), et c'est la même réponse que celle qui garde les tables :
    // une seule règle, un seul juge.
    //
    // La caisse est OUVERTE dans deux états, et fermée dans deux
    // autres :
    //
    //   transit    aucune ligne → première souscription. Le webhook
    //              appellera saas_start_subscription.
    //   restreint  la ligne existe mais n'ouvre plus rien → le client
    //              revient payer. Le webhook appellera
    //              saas_reopen_subscription, qui REPREND la ligne au
    //              lieu de buter sur son unicité.
    //   ouvert     le contrat court : une seconde souscription
    //              créerait un second dossier chez le prestataire.
    //   sursis     il doit de l'argent sur le contrat EN COURS. Ce
    //              n'est pas un réabonnement qu'il lui faut, c'est un
    //              règlement — lui ouvrir un second contrat lui ferait
    //              payer deux fois et ne solderait pas le premier.
    const situation = await lireSituationPeage(supabase, organizationId);
    const abonnement = await lireAbonnement(supabase, organizationId);

    if (situation !== null && situation.etat === "sursis") {
      return {
        code: "reglementEnAttente",
        motif:
          "Votre abonnement est bien en cours, mais un règlement nous manque. Ce n'est pas une nouvelle "
          + "souscription qu'il faut — elle ouvrirait un second contrat et vous feriez payer deux fois — "
          + "c'est cette facture-là qu'il faut régler. Vous la trouvez dans Entreprise › Abonnement.",
      };
    }

    if (situation !== null && situation.etat === "ouvert") {
      return {
        code: "dejaAbonne",
        motif:
          "Cette entreprise a déjà un abonnement en cours. Un changement d'offre se fait sur l'abonnement existant, pas par une nouvelle souscription : ouvrir une seconde souscription créerait un second dossier de paiement chez le prestataire, et un remboursement partirait du mauvais. Écrivez-nous, nous le faisons avec vous.",
      };
    }

    // ---- 1 bis. TANT QUE 0092 N'EST PAS PASSÉE ---------------------
    //
    // `lireSituationPeage` rend `null` quand la fonction n'existe pas
    // encore — le code peut être déployé avant la migration. On
    // retombe alors sur l'ancien contrôle, qui n'a qu'un défaut : il
    // ferme aussi la caisse aux entreprises fermées. C'est le
    // comportement d'avant, il est prudent, et il disparaît dès que la
    // migration est passée.
    if (situation === null && abonnement !== null && STATUTS_DEJA_ABONNE.has(abonnement.status)) {
      return {
        code: "dejaAbonne",
        motif:
          "Cette entreprise a déjà un abonnement en cours. Un changement d'offre se fait sur l'abonnement existant, pas par une nouvelle souscription : ouvrir une seconde souscription créerait un second dossier de paiement chez le prestataire, et un remboursement partirait du mauvais. Écrivez-nous, nous le faisons avec vous.",
      };
    }

    // ---- 1 ter. LE VERROU DU RÉABONNEMENT A SAUTÉ -----------------
    //
    // Il y avait ici un refus net de toute entreprise portant DÉJÀ une
    // ligne d'abonnement, même résiliée. Son motif était juste :
    // `saas_start_subscription()` lève 23505 dans ce cas, si bien
    // qu'encaisser aurait pris l'argent sans pouvoir rouvrir les
    // droits. Son commentaire l'annonçait : « CE VERROU DOIT SAUTER le
    // jour où le réabonnement aura son chemin ». C'est ce jour-là.
    //
    // Le chemin existe : `saas_reopen_subscription` (0092 § 8) REPREND
    // la ligne existante au lieu de buter dessus, et le webhook
    // l'appelle dès que l'ouverture rend « déjà un abonnement ». Le
    // garder aurait été bien pire qu'un oubli : le péage ferme les
    // comptes impayés, et la seule porte pour les rouvrir est
    // justement celle-ci. On aurait enfermé des clients dehors avec
    // leurs données à l'intérieur.
    //
    // Ce qui reste vrai, et qui est traité plus haut : on ne rouvre
    // pas un contrat qui court (« ouvert »), et on ne fait pas
    // souscrire deux fois celui qui doit simplement régler
    // (« sursis »).
    if (situation === null && abonnement !== null) {
      // Sans le péage — migration pas encore passée — on ne sait pas
      // distinguer « résilié » de « en cours ». On garde donc l'ancien
      // refus prudent plutôt que d'encaisser à l'aveugle.
      return {
        code: "abonnementResilie",
        motif:
          "Cette entreprise a déjà été abonnée par le passé. Un réabonnement reprend le dossier existant, et cette reprise n'est pas encore en service sur cette installation. Écrivez-nous : nous la remettons en route avec vous, et rien n'a été prélevé.",
      };
    }

    // ---- 2. L'IDENTITÉ FACTURABLE, EXIGÉE PAR LE SERVEUR ----------
    //
    // Elle ne l'était que par le rendu : `manquePourFacturer()` servait
    // à masquer un bouton, et rien d'autre. Un `fetch` fabriqué à la
    // main — ou simplement un compte dont l'étape « société » a été
    // passée, puisqu'elle est facultative — encaissait quand même.
    //
    // On se retrouvait alors avec de l'argent pris et une facture
    // INÉMETTABLE : `saas_issue_invoice()` refuse une entreprise
    // française sans dénomination sociale, sans SIRET ou sans adresse.
    // Encaisser ce qu'on ne pourra pas facturer est pire que perdre le
    // client : il faut rembourser, et on n'a rien à lui remettre.
    //
    // On appelle `manquePourFacturer`, on ne la réécrit pas : la règle
    // est déjà écrite et testée, la dupliquer la ferait diverger.
    const identite = await lireIdentiteFacturable(supabase, organizationId);
    if (identite === null) {
      return {
        code: "identiteIllisible",
        motif:
          "La fiche de votre société n'a pas pu être lue, et nous n'encaissons pas sans savoir à qui adresser la facture. Rechargez la page ; rien n'a été prélevé.",
      };
    }

    const manques = manquePourFacturer(identite);
    if (manques.length > 0) {
      return {
        code: "identiteIncomplete",
        motif:
          "Avant de pouvoir encaisser, il nous faut de quoi établir votre facture : "
          + `${manques.map((m) => m.libelle.toLowerCase()).join(", ")}. `
          + "Complétez la fiche de votre société, puis revenez — rien n'a été prélevé.",
      };
    }

    return null;
  }

  async startCheckout(intent: CheckoutIntent): Promise<CheckoutOutcome> {
    const supabase = await this.#supabase();

    // ---- 1. Les mêmes verrous que le résumé, dans le même ordre ----
    const ferme = await this.#caisseFermeePour(supabase, intent.organizationId);
    if (ferme !== null) {
      return { kind: "unavailable", reason: ferme.motif };
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
    //
    // ET LE CALENDRIER EN FAIT PARTIE. « Avec essai » et « je paie tout
    // de suite » sont deux intentions différentes : sans le calendrier
    // dans la clé, le client qui renonce à l'essai après l'avoir
    // regardé se verrait rendre la session d'essai déjà créée — un mois
    // gratuit accordé à quelqu'un qui venait d'y renoncer, et pas un
    // centime encaissé aujourd'hui.
    const plan = this.#planEssai(intent, composition.billingCycle);
    const clefIdempotence = clefPourIntention(intent.organizationId, composition, plan);

    const metadonnees: Record<string, string> = {
      // LE NOM EST PRÉFIXÉ, ET LES DEUX CÔTÉS EMPLOIENT LE MÊME.
      //
      // Le tunnel écrivait `organizationId`, le webhook lisait
      // `oasis_organization_id` : signature valide, événement journalisé,
      // puis « Entreprise inconnue » sur CHAQUE encaissement — premier
      // paiement comme renouvellement — pendant que le prestataire
      // recevait ses 200 et ne signalait rien. Un seul nom désormais,
      // et il est préfixé parce que les métadonnées d'un objet du
      // prestataire sont un espace partagé avec ses propres outils.
      oasis_organization_id: intent.organizationId,
      planKey: composition.planKey,
      billingCycle: composition.billingCycle,
      mode: this.#api.mode,
      // Le montant HORS TAXES que NOUS avons calculé, et le montant
      // TOUTES TAXES que nous attendons au débit. Les deux voyagent
      // parce qu'ils ne disent pas la même chose : le premier est ce
      // qui sera facturé, le second ce qui sera prélevé, et ils ne
      // coïncident qu'en autoliquidation et hors Union.
      //
      // CE QUE LE WEBHOOK EN FAIT AUJOURD'HUI : rien. Il ne les compare
      // pas encore à ce que le prestataire dit avoir encaissé. La phrase
      // qui figurait ici affirmait le contraire, et un commentaire qui
      // décrit une intention au présent finit par être lu comme une
      // garantie.
      totalHtCents: String(composition.totalHtCents),
      totalTtcCents: String(composition.taxe.totalTtcCents),
      regimeTva: composition.taxe.regime,
      siegesFacturables: String(composition.siegesFacturables),
      // LE CALENDRIER VOYAGE AVEC L'ENCAISSEMENT, et il est destiné à
      // UNE lectrice précise : la fonction Edge qui appellera
      // `saas_start_subscription(…, p_with_trial => …)` quand
      // l'événement signé arrivera. Sans ces clés, elle devrait deviner
      // si le client entre par l'essai — et une base qui devine finit
      // par offrir un mois à qui a payé, ou par facturer qui ne devait
      // rien.
      //
      // Les noms sont ceux du compte rendu, et ils ne changent pas sans
      // que l'autre moitié du chantier le sache : le tunnel et le
      // webhook ont déjà employé deux noms différents une fois, et
      // chaque encaissement tombait alors en « entreprise inconnue ».
      avecEssai: plan.avecEssai ? "true" : "false",
      premierPrelevementLe: plan.premierPrelevementLe,
      jourAnniversaire: String(plan.jourAnniversaire),
    };
    if (plan.finEssaiLe !== null) metadonnees.finEssaiLe = plan.finEssaiLe;
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
      // LA TAXE QUE NOUS AVONS CALCULÉE, transmise explicitement. Une
      // liste VIDE veut dire « aucune taxe due » — autoliquidation ou
      // hors Union — et non « on n'a pas regardé » : le cas « on ne sait
      // pas » a déjà fermé la caisse dans `composerSouscription`.
      tauxTaxe:
        composition.taxe.providerTaxRateId === null
          ? []
          : [composition.taxe.providerTaxRateId],
      // L'ESSAI, TEL QUE L'ÉCRAN VIENT DE L'ANNONCER — la même date,
      // issue du même calcul. C'est le prestataire qui tiendra
      // l'échéance : il enregistre la carte aujourd'hui et ne la débite
      // que ce jour-là.
      essai:
        plan.finEssaiLe === null
          ? null
          : {
              finLeIso: plan.finEssaiLe,
              finLeHorodatage: horodatageFinEssai(plan.finEssaiLe),
            },
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
export function clefPourIntention(
  organizationId: string,
  composition: Composition,
  /**
   * LE CALENDRIER FAIT PARTIE DE L'INTENTION, et le paramètre est
   * OBLIGATOIRE pour cette raison. Le rendre facultatif laisserait un
   * appelant l'oublier, et l'oubli ne se verrait pas : la session
   * d'essai déjà créée serait rendue à qui vient d'y renoncer.
   */
  plan: PlanEssai,
): string {
  if (!composition.jouable) return `${organizationId}:refus`;
  const empreinte = composition.lignes
    .map((ligne) => `${ligne.providerPriceId}x${ligne.quantite}`)
    .join("|");
  const calendrier = plan.finEssaiLe === null ? "sansEssai" : `essai:${plan.finEssaiLe}`;
  return `oasis:${organizationId}:${composition.planKey}:${composition.billingCycle}:${composition.totalHtCents}:${empreinte}:${calendrier}`;
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
