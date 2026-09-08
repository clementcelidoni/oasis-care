// Oasis Care — Chantier Stripe. CE QU'UN ÉVÉNEMENT VEUT DIRE.
//
// Module PUR : aucune entrée-sortie, aucun `Deno.*`, aucun import. Il
// prend le JSON d'un événement déjà VÉRIFIÉ et rend une intention. Tout
// ce qui décide y est ; `index.ts` ne fait qu'exécuter. C'est ce qui
// rend la décision éprouvable sans base et sans réseau.
//
// ==================================================================
// CE QUE CE WEBHOOK A LE DROIT DE FAIRE, ET RIEN DE PLUS
// ==================================================================
//   • rattacher un client du prestataire à une entreprise ;
//   • enregistrer un ENCAISSEMENT sur une facture que NOUS avons émise ;
//   • journaliser.
//
// IL N'ÉMET AUCUNE FACTURE ET NE TOUCHE À AUCUNE NUMÉROTATION. La
// facture légale est celle de `saas_issue_invoice()`, numérotée sans
// trou par `saas_next_document_number()`. Stripe produit ses propres
// factures pour ses besoins internes ; ce ne sont pas nos documents, et
// l'envoi de ses courriels de facture doit être désactivé dans son
// tableau de bord. Si ce fichier appelait un jour l'API des factures de
// Stripe, il créerait le doublon que toute l'architecture évite.
//
// IL NE FAIT AVANCER AUCUN ABONNEMENT NON PLUS, et ce n'est pas un
// oubli : 0083 § 11 le dit en toutes lettres, il n'existe AUCUN chemin
// machine pour créer ou faire avancer un abonnement.
// `record_subscription_event()` et `admin_create_subscription()`
// exigent un administrateur de plateforme ET un second facteur ; une
// fonction Edge n'a ni l'un ni l'autre. Les événements de cycle de vie
// sont donc CONSTATÉS au journal, avec leur résumé, et rien de plus.
// C'est un trou fonctionnel connu, pas une omission silencieuse — il se
// referme avec le tunnel d'inscription, pas ici.
//
// ==================================================================
// UN ÉCHEC DE PAIEMENT N'EFFACE RIEN
// ==================================================================
// § 26 de l'architecture, catégorique : on ne supprime JAMAIS de
// données à l'expiration. `invoice.payment_failed`,
// `customer.subscription.deleted`, `charge.refunded` sont donc
// journalisés et rien d'autre. Couper un accès est une décision qui se
// lit dans l'état de l'abonnement, elle ne se prend pas dans un
// gestionnaire de webhook qui vient de recevoir un octet de Stripe.

/**
 * LES CLÉS DE MÉTADONNÉES — LE CONTRAT AVEC LE TUNNEL DE PAIEMENT.
 *
 * Le constructeur qui écrit `web-pro/app/api/stripe/checkout/route.ts`
 * doit poser ces clés, sans quoi ce webhook ne saura pas à qui
 * appartient l'argent. Elles sont recopiées ici en constantes pour
 * qu'un `grep` les retrouve des deux côtés.
 *
 * OÙ LES POSER, ET POURQUOI À CES TROIS ENDROITS :
 *   • sur le CLIENT Stripe (`customer.metadata`) — pour qu'un
 *     rapprochement manuel soit possible depuis le tableau de bord ;
 *   • sur l'ABONNEMENT (`subscription_data.metadata` à la création de la
 *     session) — c'est CELUI-LÀ qui compte : Stripe le recopie sur
 *     CHAQUE facture de renouvellement, donc l'entreprise reste
 *     identifiable dans deux ans sans qu'aucun événement antérieur
 *     n'ait besoin d'être arrivé ;
 *   • sur la SESSION (`metadata`) — pour le tout premier paiement.
 */
export const CLE_ORGANISATION = "oasis_organization_id";
export const CLE_FACTURE = "oasis_invoice_id";

/**
 * UN SEUL NOM, ÉCRIT DES DEUX CÔTÉS.
 *
 * IL Y A EU UN DÉSACCORD, ET IL EST RÉSOLU. Le tunnel de paiement
 * écrivait `organizationId`, ce lecteur attendait
 * `oasis_organization_id` : les deux moitiés du chantier avaient été
 * écrites en parallèle sans se parler. Rien ne l'aurait signalé avant
 * le premier vrai paiement — signature valide, événement inscrit au
 * journal, puis « Entreprise inconnue » sur CHAQUE encaissement, y
 * compris les renouvellements, pendant que le prestataire recevait ses
 * 200 et ne voyait aucune anomalie.
 *
 * Le nom retenu est le PRÉFIXÉ, et c'est le tunnel qui a été aligné
 * (`web-pro/lib/billing/stripe.ts`). Raison : les métadonnées d'un
 * objet du prestataire sont un espace COMMUN — son tableau de bord, ses
 * intégrations, ses exports y écrivent aussi — et `organizationId` tout
 * court y est un nom que n'importe qui peut employer pour désigner
 * autre chose.
 *
 * L'ALIAS DE TOLÉRANCE A ÉTÉ RETIRÉ, délibérément. Accepter les deux
 * noms faisait marcher les deux côtés, mais rendait le désaccord
 * invisible : un seul nom accepté, et la prochaine divergence tombe
 * tout de suite au lieu de dormir jusqu'au premier paiement.
 */
const ALIAS_ORGANISATION = [CLE_ORGANISATION] as const;
const ALIAS_FACTURE = [CLE_FACTURE] as const;

export interface EvenementNormalise {
  readonly id: string;
  readonly type: string;
  readonly apiVersion: string | null;
  /** L'instant daté par Stripe, en ISO. Distinct de celui où on l'a reçu. */
  readonly dateEvenement: string | null;
  readonly enDirect: boolean;
  /**
   * LE RÉSUMÉ, ET PAS LE CORPS COMPLET. 0083 § 4 l'explique : un
   * webhook de paiement transporte des données personnelles et des
   * empreintes de moyen de paiement ; les recopier dans une table lue
   * par des administrateurs augmenterait la surface sans rien gagner.
   * Le prestataire garde l'original et sait le rejouer.
   */
  readonly resume: Record<string, unknown>;
}

export type Intention =
  /** Journaliser, clore en « ignored », ne rien écrire d'autre. */
  | { readonly genre: "constater"; readonly motif: string }
  /** Rattacher le client du prestataire à l'entreprise. */
  | {
      readonly genre: "rattacherClient";
      readonly clientPrestataire: string;
      readonly organisationDemandee: string | null;
    }
  /**
   * OUVRIR L'ABONNEMENT — ET C'EST CE QUI MANQUAIT À TOUT LE CHANTIER.
   *
   * `saas_start_subscription` (0089 § 4) n'avait AUCUN appelant : six
   * occurrences dans le dépôt, toutes en commentaire. Conséquence
   * mesurée, et elle n'était pas passagère : le prestataire encaissait,
   * le webhook cherchait une facture ÉMISE à rapprocher par le montant,
   * n'en trouvait aucune — puisque personne n'en avait créé — et
   * tombait en rapprochement manuel. À chaque prélèvement, de chaque
   * client.
   *
   * L'abonnement s'ouvre donc ICI, sur `checkout.session.completed`,
   * AVANT que l'`invoice.paid` n'arrive avec l'argent. C'est la règle
   * que 0089 s'était donnée en tête de fichier : « La facture PRÉCÈDE
   * l'encaissement, jamais l'inverse. »
   *
   * TOUT CE QUI SUIT VIENT DES MÉTADONNÉES DE LA SESSION SIGNÉE, et
   * aucun montant n'en fait partie : le prix est allé chercher
   * `organization_plans` côté base. Le navigateur a envoyé une
   * intention, jamais un prix.
   */
  | {
      readonly genre: "ouvrirAbonnement";
      readonly clientPrestataire: string;
      readonly organisationDemandee: string;
      readonly plan: string;
      readonly cycle: string;
      readonly mode: string;
      readonly avecEssai: boolean;
      /** Le `trial_end` que le prestataire tiendra. Fait foi. */
      readonly finEssaiLe: string | null;
      /** Le jour du mois annoncé au client. Fait foi, et ne se déduit pas. */
      readonly jourAnniversaire: number | null;
      /** Les sièges que la CAISSE a facturés, pas un recomptage. */
      readonly siegesFacturables: number | null;
    }
  /** Poser un encaissement sur une de NOS factures. */
  | {
      readonly genre: "encaisser";
      readonly clientPrestataire: string | null;
      readonly organisationDemandee: string | null;
      readonly factureDemandee: string | null;
      readonly montantCentimes: number;
      readonly devise: string;
      /** La référence qui porte l'idempotence côté base. */
      readonly reference: string;
    };

export type LectureEvenement =
  | { readonly ok: true; readonly evenement: EvenementNormalise; readonly intention: Intention }
  | { readonly ok: false; readonly motif: string };

/**
 * Lit un événement Stripe déjà vérifié et en tire l'intention.
 *
 * NE LÈVE JAMAIS : elle rend `ok: false` avec un motif. Un gestionnaire
 * qui lève sur un corps inattendu rend 500, et Stripe rejoue en boucle
 * un événement qui ne passera jamais.
 */
export function lireEvenement(brut: unknown): LectureEvenement {
  if (!estObjet(brut)) return { ok: false, motif: "Corps d'événement illisible." };

  const id = texte(brut.id);
  if (id === null) return { ok: false, motif: "Événement sans identifiant : impossible à dédoublonner." };

  const type = texte(brut.type);
  if (type === null) return { ok: false, motif: "Événement sans type." };

  const objet = estObjet(brut.data) && estObjet(brut.data.object) ? brut.data.object : null;

  const evenement: EvenementNormalise = {
    id,
    type,
    apiVersion: texte(brut.api_version),
    dateEvenement: instantIso(brut.created),
    // `livemode` ABSENT VAUT « direct ». On ne veut surtout pas qu'un
    // corps tronqué se fasse passer pour un événement d'essai et
    // atterrisse dans le journal du mode d'essai.
    enDirect: brut.livemode !== false,
    resume: resumer(type, objet),
  };

  return { ok: true, evenement, intention: intentionPour(type, objet) };
}

function intentionPour(type: string, objet: Record<string, unknown> | null): Intention {
  if (objet === null) return { genre: "constater", motif: "Événement sans objet exploitable." };

  switch (type) {
    // ------------------------------------------------------------
    // LE RATTACHEMENT DU CLIENT
    // ------------------------------------------------------------
    case "checkout.session.completed": {
      // `status: 'complete'` seulement. Une session expirée ou ouverte
      // ne rattache rien : le rattachement n'est pas un droit, mais il
      // n'a pas non plus à être créé pour un tunnel abandonné.
      if (texte(objet.status) !== "complete") {
        return { genre: "constater", motif: `Session non terminée (statut ${texte(objet.status) ?? "inconnu"}).` };
      }
      const client = identifiant(objet.customer);
      if (client === null) {
        return { genre: "constater", motif: "Session terminée sans client Stripe : rien à rattacher." };
      }

      const organisation = chercherOrganisation(objet);
      const plan = chercherMetadonnee(objet, "planKey");
      const cycle = chercherMetadonnee(objet, "billingCycle");
      const mode = chercherMetadonnee(objet, "mode");

      // ------------------------------------------------------------
      // LE CONTRAT DE MÉTADONNÉES, EXIGÉ EN ENTIER OU PAS DU TOUT.
      // ------------------------------------------------------------
      // Quatre clés sont indispensables pour ouvrir un abonnement.
      // Quand l'une manque — une session créée à la main dans le
      // tableau de bord du prestataire, une session d'avant ce
      // chantier — on RETOMBE sur le simple rattachement, qui était le
      // comportement d'hier. On n'invente pas d'abonnement à partir
      // d'une session dont on ne sait pas ce qu'elle vendait.
      if (organisation === null || plan === null || cycle === null || mode === null) {
        return {
          genre: "rattacherClient",
          clientPrestataire: client,
          organisationDemandee: organisation,
        };
      }

      // « true » EXPLICITE, ET RIEN D'AUTRE NE VAUT ESSAI. Une clé
      // absente ou mal orthographiée doit faire payer, pas offrir un
      // mois : c'est le sens de l'erreur qui coûte le moins.
      const avecEssai = chercherMetadonnee(objet, "avecEssai") === "true";
      const finEssai = chercherMetadonnee(objet, "finEssaiLe");
      const ancre = entierDeMetadonnee(objet, "jourAnniversaire");
      const sieges = entierDeMetadonnee(objet, "siegesFacturables");

      return {
        genre: "ouvrirAbonnement",
        clientPrestataire: client,
        organisationDemandee: organisation,
        plan,
        cycle,
        mode,
        avecEssai,
        // La date d'essai n'a de sens que s'il y a un essai. La
        // transmettre sans essai ferait ouvrir un essai en base pendant
        // que le prestataire débite : le pire des deux mondes.
        finEssaiLe: avecEssai ? finEssai : null,
        jourAnniversaire: ancre,
        siegesFacturables: sieges,
      };
    }

    // ------------------------------------------------------------
    // L'ARGENT — UN SEUL TYPE D'ÉVÉNEMENT LE CONSTATE
    // ------------------------------------------------------------
    // Stripe annonce le même encaissement de plusieurs manières :
    // `invoice.paid`, `payment_intent.succeeded`, `charge.succeeded`,
    // et `invoice_payment.paid` sur les versions récentes de l'API. Les
    // traiter tous poserait DEUX encaissements du même argent avec deux
    // références différentes — l'index d'unicité de 0083 § 5.a ne les
    // verrait pas comme des doublons, puisqu'il porte sur la référence.
    //
    // ON N'EN RETIENT DONC QU'UN. `invoice.paid` est le bon : c'est le
    // seul qui porte à la fois le montant réellement encaissé, la
    // devise, le client, et les métadonnées de l'abonnement — donc
    // l'entreprise, y compris sur un renouvellement dans deux ans.
    case "invoice.paid": {
      const montant = entier(objet.amount_paid);
      if (montant === null) {
        return { genre: "constater", motif: "Facture Stripe sans `amount_paid` lisible." };
      }
      if (montant <= 0) {
        // Un essai gratuit, une remise à 100 %, une facture de 0 € :
        // il n'y a rien à encaisser. Ce n'est pas une anomalie.
        return { genre: "constater", motif: "Facture Stripe à 0 : aucun encaissement à constater." };
      }
      const devise = texte(objet.currency);
      if (devise === null) {
        return { genre: "constater", motif: "Facture Stripe sans devise." };
      }
      const reference = texte(objet.id);
      if (reference === null) {
        return { genre: "constater", motif: "Facture Stripe sans identifiant : rien pour porter l'idempotence." };
      }
      return {
        genre: "encaisser",
        clientPrestataire: identifiant(objet.customer),
        organisationDemandee: chercherOrganisation(objet),
        factureDemandee: chercherFacture(objet),
        montantCentimes: montant,
        // Nos factures sont en 'EUR' ; Stripe rend 'eur'. La comparaison
        // est faite par `saas_record_provider_payment`, qui refuse une
        // devise discordante : lui passer la casse de Stripe ferait
        // échouer tous les encaissements.
        devise: devise.toUpperCase(),
        // LA RÉFÉRENCE EST L'IDENTIFIANT STRIPE DE LA FACTURE, tel quel.
        // Il est unique chez Stripe, différent en essai et en
        // production, et un administrateur peut le coller directement
        // dans le tableau de bord du prestataire pour retrouver la
        // transaction. C'est lui qui porte l'unicité (method,
        // external_reference) de 0083 § 5.a.
        reference,
      };
    }

    // ------------------------------------------------------------
    // TOUT LE RESTE : CONSTATÉ, JAMAIS APPLIQUÉ
    // ------------------------------------------------------------
    case "payment_intent.succeeded":
    case "charge.succeeded":
    case "invoice_payment.paid":
      return {
        genre: "constater",
        motif: "L'argent n'est constaté que sur `invoice.paid` : deux constats du même encaissement feraient deux paiements.",
      };

    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
    case "customer.subscription.paused":
    case "customer.subscription.resumed":
    case "customer.subscription.trial_will_end":
      return {
        genre: "constater",
        motif:
          "Cycle de vie d'abonnement : aucun chemin machine n'existe pour le faire avancer (0083 § 11). "
          + "Consigné pour reprise manuelle.",
      };

    case "invoice.payment_failed":
    case "invoice.marked_uncollectible":
    case "charge.refunded":
    case "charge.dispute.created":
      return {
        genre: "constater",
        motif: "Incident de paiement : consigné. On ne supprime rien et on ne coupe rien ici (§ 26).",
      };

    default:
      return { genre: "constater", motif: `Type non traité : ${type}.` };
  }
}

// ==================================================================
// LE RÉSUMÉ
// ==================================================================
function resumer(type: string, objet: Record<string, unknown> | null): Record<string, unknown> {
  const resume: Record<string, unknown> = { type };
  if (objet === null) return resume;

  const champs: Record<string, unknown> = {
    objet: texte(objet.object),
    id: texte(objet.id),
    client: identifiant(objet.customer),
    abonnement: identifiant(objet.subscription) ?? abonnementParent(objet),
    statut: texte(objet.status),
    devise: texte(objet.currency)?.toUpperCase() ?? null,
    montantPayeCentimes: entier(objet.amount_paid),
    montantDuCentimes: entier(objet.amount_due),
    montantCentimes: entier(objet.amount),
    organisationAnnoncee: chercherOrganisation(objet),
    factureAnnoncee: chercherFacture(objet),
  };

  // On n'écrit que ce qui existe : une colonne jsonb pleine de `null`
  // se relit mal, et le journal est fait pour être relu par un humain
  // qui cherche pourquoi un paiement n'est pas passé.
  for (const [cle, valeur] of Object.entries(champs)) {
    if (valeur !== null && valeur !== undefined) resume[cle] = valeur;
  }
  return resume;
}

// ==================================================================
// LES PETITES LECTURES SÛRES
// ==================================================================
// Rien ici n'emploie `?? 0` ni `|| 0` derrière un nombre : un montant
// inconnu ne devient pas zéro parce qu'on l'a lu. Il reste `null`, et
// l'appelant décide.

function estObjet(valeur: unknown): valeur is Record<string, unknown> {
  return typeof valeur === "object" && valeur !== null && !Array.isArray(valeur);
}

function texte(valeur: unknown): string | null {
  if (typeof valeur !== "string") return null;
  const propre = valeur.trim();
  return propre === "" ? null : propre;
}

function entier(valeur: unknown): number | null {
  return typeof valeur === "number" && Number.isSafeInteger(valeur) ? valeur : null;
}

/**
 * Un champ de référence Stripe est soit une chaîne (`cus_…`), soit
 * l'objet complet quand l'appelant l'a « développé ». Les deux formes
 * arrivent réellement, selon la configuration du point de terminaison.
 */
function identifiant(valeur: unknown): string | null {
  if (typeof valeur === "string") return texte(valeur);
  if (estObjet(valeur)) return texte(valeur.id);
  return null;
}

function instantIso(valeur: unknown): string | null {
  const secondes = entier(valeur);
  if (secondes === null || secondes <= 0) return null;
  const date = new Date(secondes * 1000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * Cherche une métadonnée à tous les endroits où Stripe la dépose, dans
 * l'ordre du plus précis au plus général.
 *
 * POURQUOI PLUSIEURS ENDROITS. Stripe a déplacé le rattachement
 * facture → abonnement au fil des versions d'API : `invoice.subscription`
 * puis `invoice.parent.subscription_details`. Une intégration qui ne
 * regarde qu'une seule forme cesse de fonctionner le jour où le compte
 * change de version d'API — silencieusement, en cessant simplement de
 * reconnaître l'entreprise. On regarde donc partout, et l'ordre tranche
 * les rares cas où deux valeurs coexistent : le plus précis gagne.
 */
export function chercherOrganisation(objet: Record<string, unknown>): string | null {
  return chercherParmi(objet, ALIAS_ORGANISATION);
}

export function chercherFacture(objet: Record<string, unknown>): string | null {
  return chercherParmi(objet, ALIAS_FACTURE);
}

/**
 * Essaie plusieurs noms de clé, dans l'ordre.
 *
 * L'ordre est celui des NOMS, pas celui des emplacements : le nom
 * officiel l'emporte même s'il est trouvé à un endroit moins précis que
 * l'alias. C'est voulu — un nom que nous avons choisi vaut mieux qu'un
 * nom générique que n'importe quel outil peut avoir posé.
 */
function chercherParmi(objet: Record<string, unknown>, cles: readonly string[]): string | null {
  for (const cle of cles) {
    const valeur = chercherMetadonnee(objet, cle);
    if (valeur !== null) return valeur;
  }
  return null;
}

/**
 * Une métadonnée qui doit être un entier positif ou nul.
 *
 * Les métadonnées de Stripe sont TOUJOURS des chaînes, même quand on y
 * a écrit un nombre. Et une chaîne qui n'est pas un entier ne vaut PAS
 * zéro : « zéro siège supplémentaire » et « je n'ai pas su lire » sont
 * deux réponses différentes, et la seconde doit laisser la base
 * recompter plutôt que de facturer un chiffre inventé. D'où `null`, et
 * jamais de `|| 0`.
 */
function entierDeMetadonnee(objet: Record<string, unknown>, cle: string): number | null {
  const brut = chercherMetadonnee(objet, cle);
  if (brut === null) return null;
  if (!/^\d{1,9}$/.test(brut.trim())) return null;
  return Number.parseInt(brut.trim(), 10);
}

export function chercherMetadonnee(objet: Record<string, unknown>, cle: string): string | null {
  const sources: unknown[] = [
    objet.metadata,
    estObjet(objet.subscription_details) ? objet.subscription_details.metadata : null,
    estObjet(objet.parent) && estObjet(objet.parent.subscription_details)
      ? objet.parent.subscription_details.metadata
      : null,
    estObjet(objet.subscription) ? objet.subscription.metadata : null,
  ];

  for (const source of sources) {
    if (!estObjet(source)) continue;
    const valeur = texte(source[cle]);
    if (valeur !== null) return valeur;
  }

  // Dernier recours : les lignes de la facture. Stripe y recopie les
  // métadonnées de l'élément d'abonnement.
  const lignes = estObjet(objet.lines) ? objet.lines.data : null;
  if (Array.isArray(lignes)) {
    for (const ligne of lignes) {
      if (!estObjet(ligne)) continue;
      const direct = estObjet(ligne.metadata) ? texte(ligne.metadata[cle]) : null;
      if (direct !== null) return direct;
    }
  }

  return null;
}

function abonnementParent(objet: Record<string, unknown>): string | null {
  if (!estObjet(objet.parent)) return null;
  const details = objet.parent.subscription_details;
  if (!estObjet(details)) return null;
  return identifiant(details.subscription);
}
