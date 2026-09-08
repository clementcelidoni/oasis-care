// Oasis Care — Chantier Stripe. L'ORCHESTRATION.
//
// Ce module contient TOUTE la logique de traitement, et AUCUNE
// entrée-sortie : il parle à la base à travers `PorteBase`, une
// interface que `index.ts` implémente avec Supabase et que le test
// implémente avec un double simulé. C'est ce qui rend éprouvables les
// trois choses qui font vraiment mal sur un webhook — le rejeu, la
// livraison simultanée, le désordre — sans réseau et sans base.
//
// ==================================================================
// LES TROIS FAITS QU'ON NE DISCUTE PAS
// ==================================================================
//
// 1. UN ÉVÉNEMENT ARRIVE PLUSIEURS FOIS. Ce n'est pas une hypothèse
//    pessimiste : c'est le fonctionnement documenté d'un service qui
//    garantit « au moins une » livraison. L'idempotence passe donc par
//    la CONTRAINTE D'UNICITÉ de la base — on inscrit d'abord, et c'est
//    l'insertion qui dit si on est le premier. Un « select puis if »
//    serait franchi par deux livraisons simultanées.
//
// 2. LES ÉVÉNEMENTS ARRIVENT DANS LE DÉSORDRE. Un `invoice.paid` peut
//    précéder le `checkout.session.completed` qui a créé le client.
//    Chaque traitement est donc écrit pour être juste SEUL, sans rien
//    supposer de ce qui est arrivé avant : l'entreprise se résout par
//    les métadonnées de l'événement lui-même quand elles sont là, et le
//    rattachement manquant se crée au passage.
//
// 3. INSCRIT N'EST PAS TRAITÉ. Si une livraison s'inscrit puis tombe
//    avant d'agir, l'événement reste « pending ». Répondre 200 au rejeu
//    parce qu'« on l'a déjà vu » perdrait l'encaissement en silence, et
//    Stripe ne rejouerait plus jamais. On REJOUE donc l'effet sur un
//    événement inscrit mais non clos — c'est sans danger, parce que
//    chaque effet est lui-même idempotent côté base.

import type { EvenementNormalise, Intention } from "./evenement.ts";
import { rapprocher, type FactureCandidate } from "./rapprochement.ts";

/** Les états terminaux de `billing_provider_events`, tels que 0083 les contraint. */
export type Issue = "applied" | "ignored" | "failed";

export interface EtatEvenement {
  readonly outcome: string;
  readonly closDepuis: string | null;
}

export interface DemandeEncaissement {
  readonly evenementId: string;
  readonly factureId: string;
  readonly montantCentimes: number;
  readonly devise: string;
  readonly reference: string;
}

/** Ce que `saas_start_subscription` (0089 § 4) demande, et rien de plus. */
export interface DemandeAbonnement {
  readonly organisationId: string;
  readonly plan: string;
  readonly cycle: string;
  readonly avecEssai: boolean;
  readonly clientPrestataire: string;
  readonly mode: string;
  readonly finEssaiLe: string | null;
  readonly jourAnniversaire: number | null;
  readonly siegesFacturables: number | null;
}

export interface IssueAbonnement {
  readonly statut: string;
  readonly numeroFacture: string | null;
  readonly message: string;
}

/**
 * LA PORTE VERS LA BASE.
 *
 * Chaque méthode correspond à une fonction de 0083 ou à une lecture
 * simple. Toute méthode peut lever :
 *   • `RefusMetier` — la base a dit non pour une raison qu'elle nomme.
 *     C'est TERMINAL : rejouer donnera le même non.
 *   • n'importe quoi d'autre — une panne. C'est TRANSITOIRE : il faut
 *     laisser l'événement ouvert et faire rejouer Stripe.
 */
export interface PorteBase {
  inscrireEvenement(evenement: EvenementNormalise): Promise<"accepted" | "duplicate">;
  lireEtatEvenement(evenementId: string): Promise<EtatEvenement | null>;
  clore(evenementId: string, issue: Issue, motif: string | null): Promise<"closed" | "alreadyClosed">;

  rattacherClient(organisationId: string, clientPrestataire: string): Promise<"linked" | "alreadyLinked">;
  organisationDuClient(clientPrestataire: string): Promise<string | null>;

  /**
   * OUVRIR L'ABONNEMENT, ET ÉMETTRE LA FACTURE DU PREMIER MOIS.
   *
   * Elle rend `null` quand l'entreprise a DÉJÀ un abonnement —
   * `saas_start_subscription` lève alors 23505, et ce refus-là n'en est
   * pas un : c'est le rejeu normal d'un événement déjà traité, ou une
   * seconde session pour un client déjà abonné. Le distinguer d'un vrai
   * refus est le travail de l'implémentation, parce qu'elle seule voit
   * le code SQL.
   */
  ouvrirAbonnement(demande: DemandeAbonnement): Promise<IssueAbonnement | null>;

  /**
   * REPRENDRE UN ABONNEMENT FERMÉ — LE CHEMIN DU RETOUR.
   *
   * `saas_start_subscription` lève 23505 dès qu'une ligne existe pour
   * l'entreprise, et la clé primaire de la table (organization_id seul)
   * garantit qu'il y en aura toujours une après la première
   * souscription. Sans ce second appel, une entreprise résiliée ou
   * suspendue voyait son paiement partir, le webhook conclure « elle a
   * déjà un abonnement : rien à ouvrir », et son accès rester fermé.
   * Le péage aurait alors été une prison : une porte sans poignée à
   * l'intérieur.
   *
   * Elle rend `null` quand il n'y avait rien à rouvrir — l'abonnement
   * court toujours, et c'est le rejeu normal d'un événement déjà
   * traité. La base est seule juge : `saas_reopen_subscription` refuse
   * tout ce qui n'est pas « restreint » ou « sursis », et
   * l'implémentation traduit ce refus-là en `null` comme elle le fait
   * déjà pour le 23505 de l'ouverture.
   */
  reprendreAbonnement(demande: DemandeAbonnement): Promise<IssueAbonnement | null>;

  facturesEncaissables(
    organisationId: string | null,
    factureDemandee: string | null,
  ): Promise<readonly FactureCandidate[]>;

  /**
   * CET ENCAISSEMENT EST-IL DÉJÀ POSÉ ?
   *
   * Une lecture de `saas_invoice_payments` sur (method = 'provider',
   * external_reference), c'est-à-dire sur l'index d'unicité de 0083
   * § 5.a. Elle est donc DÉCISIVE et non indicative : si la ligne
   * existe, l'argent est attaché, point.
   *
   * POURQUOI ELLE EXISTE. Le fait n° 3 ci-dessus fait rejouer l'effet
   * sur un événement inscrit mais non clos — et c'est juste. Mais le
   * rejeu repassait par le RAPPROCHEMENT, qui ne voit que les factures
   * `issued` : la facture venant d'être soldée est passée à `paid`,
   * donc plus aucune candidate. Le rejeu échouait AVANT d'atteindre le
   * garde-fou idempotent de la base.
   *
   * L'argent n'était pas doublé — l'index tient — mais le journal
   * consignait « failed » sur un encaissement réussi, avec un motif qui
   * invitait explicitement un humain à poser à la main un paiement qui
   * existait déjà. Et s'il employait sa propre référence, la base
   * l'acceptait.
   */
  encaissementDejaPose(reference: string): Promise<boolean>;

  enregistrerEncaissement(demande: DemandeEncaissement): Promise<"recorded" | "duplicate">;
}

/**
 * Un refus de la base : une règle métier de 0081/0083 a levé.
 *
 * La distinction refus / panne commande tout le reste et n'est pas
 * cosmétique. Un refus est définitif : on le consigne et on répond 200,
 * sans quoi Stripe rejouerait pendant trois jours une erreur qui ne
 * changera pas, jusqu'à désactiver le point de terminaison — c'est-à-dire
 * jusqu'à nous priver de TOUS les événements suivants. Une panne est
 * passagère : on laisse l'événement ouvert et on répond 5xx.
 */
export class RefusMetier extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RefusMetier";
  }
}

export interface ReponseWebhook {
  readonly statut: number;
  readonly corps: Record<string, unknown>;
  /** Ce qu'il faut écrire dans les journaux du serveur, s'il y a lieu. */
  readonly journal: string | null;
}

export interface Resultat {
  readonly issue: Issue;
  readonly detail: string;
}

/**
 * Le traitement complet d'un événement DÉJÀ VÉRIFIÉ et dont le mode a
 * déjà été confronté à celui du déploiement.
 */
export async function traiter(
  porte: PorteBase,
  evenement: EvenementNormalise,
  intention: Intention,
): Promise<ReponseWebhook> {
  // ----------------------------------------------------------------
  // 1. ON INSCRIT D'ABORD — c'est la base qui arbitre
  // ----------------------------------------------------------------
  let inscription: "accepted" | "duplicate";
  try {
    inscription = await porte.inscrireEvenement(evenement);
  } catch (erreur) {
    // Rien n'a été écrit. 503 : Stripe rejouera, l'événement n'est pas
    // perdu.
    return panne("Journalisation impossible.", erreur, evenement);
  }

  if (inscription === "duplicate") {
    let etat: EtatEvenement | null;
    try {
      etat = await porte.lireEtatEvenement(evenement.id);
    } catch (erreur) {
      return panne("Relecture du journal impossible.", erreur, evenement);
    }

    if (etat !== null && etat.closDepuis !== null) {
      // Déjà traité, et clos. Il n'y a rien à refaire, et c'est le
      // chemin normal d'un rejeu : ce n'est pas une erreur du
      // prestataire, c'est son fonctionnement.
      return {
        statut: 200,
        corps: { recu: true, deja: etat.outcome },
        journal: null,
      };
    }

    // Inscrit mais pas clos : soit une livraison simultanée est en
    // cours (l'effet sera joué deux fois et la base n'en gardera qu'un),
    // soit une livraison précédente est tombée en route. Dans les deux
    // cas on rejoue.
    // (`etat === null` ne devrait pas arriver — l'insertion vient de
    // dire « doublon » — mais si la lecture ne rend rien, rejouer reste
    // la conduite sûre : l'effet est idempotent.)
  }

  // ----------------------------------------------------------------
  // 2. L'EFFET
  // ----------------------------------------------------------------
  let resultat: Resultat;
  try {
    resultat = await appliquer(porte, evenement, intention);
  } catch (erreur) {
    if (erreur instanceof RefusMetier) {
      resultat = { issue: "failed", detail: erreur.message };
    } else {
      // ON NE CLÔT PAS. L'événement reste « pending », Stripe rejoue,
      // et le rejeu repassera par la branche « duplicate » ci-dessus
      // pour reprendre l'effet. Clore en « failed » ici gèlerait
      // l'événement dans un état terminal pour une panne d'une seconde.
      return panne("Traitement différé.", erreur, evenement);
    }
  }

  // ----------------------------------------------------------------
  // 3. LA CLÔTURE
  // ----------------------------------------------------------------
  try {
    await porte.clore(evenement.id, resultat.issue, resultat.issue === "failed" ? resultat.detail : null);
  } catch (erreur) {
    // L'effet a eu lieu, la clôture non. 503 : Stripe rejoue, l'effet
    // est rejoué sans dommage (la base rendra « duplicate »), et la
    // clôture est retentée. Mieux vaut un rejeu inutile qu'un journal
    // qui ment sur ce qui a été fait.
    return panne("Clôture impossible.", erreur, evenement);
  }

  return {
    statut: 200,
    corps: { recu: true, issue: resultat.issue },
    // 200 MÊME SUR « failed » : voir `RefusMetier`. Le problème est
    // consigné au journal, avec son motif, pour qu'un humain le
    // reprenne — il n'est pas noyé dans une boucle de rejeu.
    journal: resultat.issue === "failed" ? `${evenement.type} ${evenement.id} — ${resultat.detail}` : null,
  };
}

// ==================================================================
// L'INTENTION, EXÉCUTÉE
// ==================================================================

async function appliquer(
  porte: PorteBase,
  evenement: EvenementNormalise,
  intention: Intention,
): Promise<Resultat> {
  if (intention.genre === "constater") {
    return { issue: "ignored", detail: intention.motif };
  }

  if (intention.genre === "rattacherClient") {
    if (intention.organisationDemandee === null) {
      // RIEN N'EST INVENTÉ POUR UN CLIENT INCONNU — la règle du webhook
      // Apple, reprise telle quelle. Sans l'entreprise, on ne devine pas
      // à qui rattacher ce client.
      return { issue: "ignored", detail: "Session sans métadonnée d'organisation : aucun rattachement possible." };
    }
    const issue = await porte.rattacherClient(intention.organisationDemandee, intention.clientPrestataire);
    return {
      issue: "applied",
      detail: issue === "alreadyLinked"
        ? `Client ${intention.clientPrestataire} déjà rattaché à ${intention.organisationDemandee}.`
        : `Client ${intention.clientPrestataire} rattaché à ${intention.organisationDemandee}.`,
    };
  }

  // ----------------------------------------------------------------
  // L'OUVERTURE DE L'ABONNEMENT
  // ----------------------------------------------------------------
  //
  // ELLE PRÉCÈDE L'ARGENT, ET C'EST TOUT L'INTÉRÊT. `checkout.session
  // .completed` arrive avant `invoice.paid` : la facture existe donc,
  // ÉMISE, quand l'encaissement se présente, et le rapprochement par
  // montant trouve enfin une candidate.
  //
  // Sans ce chemin, `saas_start_subscription` n'avait aucun appelant et
  // chaque prélèvement — le premier comme les suivants — tombait en
  // « à rapprocher à la main ».
  if (intention.genre === "ouvrirAbonnement") {
    const issue = await porte.ouvrirAbonnement({
      organisationId: intention.organisationDemandee,
      plan: intention.plan,
      cycle: intention.cycle,
      avecEssai: intention.avecEssai,
      clientPrestataire: intention.clientPrestataire,
      mode: intention.mode,
      finEssaiLe: intention.finEssaiLe,
      jourAnniversaire: intention.jourAnniversaire,
      siegesFacturables: intention.siegesFacturables,
    });

    if (issue === null) {
      // ════════════════════════════════════════════════════════════
      // DÉJÀ UNE LIGNE. DEUX CAS TRÈS DIFFÉRENTS, ET ON LES CONFONDAIT.
      // ════════════════════════════════════════════════════════════
      //
      // Avant, tout finissait ici en « rien à ouvrir ». C'était juste
      // pour le rejeu d'un événement, et FAUX pour le cas qui compte :
      // une entreprise dont l'abonnement est FERMÉ — résiliée, ou
      // suspendue pour impayé — qui vient de repasser à la caisse. Son
      // paiement partait, et son accès restait clos. Le péage se
      // serait refermé sur des clients sans leur laisser de sortie.
      //
      // On demande donc à la base de REPRENDRE la ligne existante.
      // C'est elle qui tranche : `saas_reopen_subscription` ne reprend
      // qu'un abonnement « restreint » ou « en sursis », n'offre jamais
      // un second essai, et lève la résiliation. Si l'abonnement court
      // toujours, elle refuse et l'on retombe sur l'ancien chemin.
      //
      // POURQUOI ESSAYER D'OUVRIR D'ABORD, PUIS REPRENDRE. Parce que
      // c'est l'ordre qui ne peut pas se tromper : l'ouverture échoue
      // sur la contrainte d'unicité, c'est-à-dire sur un fait de la
      // base, jamais sur une lecture qu'une livraison simultanée
      // pourrait démentir entre-temps.
      let reprise: IssueAbonnement | null = null;
      try {
        reprise = await porte.reprendreAbonnement({
          organisationId: intention.organisationDemandee,
          plan: intention.plan,
          cycle: intention.cycle,
          // UNE REPRISE N'OFFRE JAMAIS UN SECOND ESSAI. La base le
          // refuserait de toute façon ; on ne le lui demande même pas.
          avecEssai: false,
          clientPrestataire: intention.clientPrestataire,
          mode: intention.mode,
          finEssaiLe: null,
          jourAnniversaire: intention.jourAnniversaire,
          siegesFacturables: intention.siegesFacturables,
        });
      } catch (erreur) {
        // UN REFUS DE REPRISE NE FAIT PAS PERDRE LE RATTACHEMENT. Même
        // raison qu'au rattachement plus bas : on consigne et on
        // continue, plutôt que de rendre un 5xx qui ferait rejouer
        // Stripe sur un refus qui ne changera pas.
        if (!(erreur instanceof RefusMetier)) throw erreur;
      }

      // Dans les deux cas, on s'assure que le client du prestataire est
      // bien rattaché — un tunnel repris depuis le début en crée un
      // second, et l'encaissement à venir devra le reconnaître.
      try {
        await porte.rattacherClient(intention.organisationDemandee, intention.clientPrestataire);
      } catch (erreur) {
        if (!(erreur instanceof RefusMetier)) throw erreur;
      }

      if (reprise !== null) {
        return {
          issue: "applied",
          detail:
            `Abonnement REPRIS pour ${intention.organisationDemandee} `
            + `(${intention.plan}, ${intention.cycle}) — statut ${reprise.statut}`
            + (reprise.numeroFacture === null
              ? ", facture à émettre à la main."
              : `, facture ${reprise.numeroFacture}.`),
        };
      }

      return {
        issue: "ignored",
        detail: `L'entreprise ${intention.organisationDemandee} a déjà un abonnement en cours : rien à ouvrir ni à reprendre.`,
      };
    }

    return {
      issue: "applied",
      detail:
        `Abonnement ouvert pour ${intention.organisationDemandee} `
        + `(${intention.plan}, ${intention.cycle}, ${intention.avecEssai ? "avec essai" : "sans essai"}) `
        + `— statut ${issue.statut}`
        + (issue.numeroFacture === null ? ", aucune facture (essai en cours)." : `, facture ${issue.numeroFacture}.`),
    };
  }

  // ----------------------------------------------------------------
  // L'ENCAISSEMENT
  // ----------------------------------------------------------------
  let organisation = intention.organisationDemandee;

  // LE DÉSORDRE, TRAITÉ ICI. Si l'événement porte lui-même
  // l'entreprise, on crée le rattachement au passage : un `invoice.paid`
  // arrivé AVANT le `checkout.session.completed` se suffit alors à
  // lui-même, et l'ordre d'arrivée ne change rien au résultat final.
  //
  // UN RATTACHEMENT QUI ÉCHOUE NE FAIT PAS PERDRE L'ARGENT, et c'est
  // pour cela que ce `try` est là. `billing_provider_link_customer`
  // REFUSE (23505) quand l'entreprise est déjà rattachée à un AUTRE
  // client du prestataire — ce qui arrive pour de bon : un tunnel de
  // paiement repris depuis le début crée un second client chez Stripe.
  // Laisser ce refus remonter ferait échouer tout l'encaissement, donc
  // laisserait un vrai paiement attaché à aucune facture, à cause d'un
  // problème d'annuaire. On consigne l'anomalie et on continue :
  // l'entreprise, elle, est connue — elle vient des métadonnées de
  // l'événement signé, pas de cet annuaire. Une PANNE, en revanche,
  // remonte normalement : elle vaut 503 et un rejeu.
  let anomalieRattachement: string | null = null;
  if (organisation !== null && intention.clientPrestataire !== null) {
    try {
      await porte.rattacherClient(organisation, intention.clientPrestataire);
    } catch (erreur) {
      if (!(erreur instanceof RefusMetier)) throw erreur;
      anomalieRattachement = `Rattachement du client ${intention.clientPrestataire} refusé : ${erreur.message}`;
    }
  }

  // Et s'il ne la porte pas — le cas d'un renouvellement dont
  // l'abonnement n'aurait pas de métadonnées — on la retrouve par le
  // rattachement fait plus tôt.
  if (organisation === null && intention.clientPrestataire !== null) {
    organisation = await porte.organisationDuClient(intention.clientPrestataire);
  }

  // ----------------------------------------------------------------
  // ON DEMANDE À LA BASE AVANT DE REFAIRE LE RAISONNEMENT
  // ----------------------------------------------------------------
  //
  // L'ORDRE EST LE CORRECTIF. Le rejeu d'un événement dont la clôture
  // était tombée repassait par le rapprochement, qui ne considère que
  // les factures `issued` — or celle-ci vient d'être soldée et est
  // passée à `paid`. Zéro candidate, donc « failed » consigné sur un
  // encaissement parfaitement réussi, avec un motif invitant un humain
  // à poser à la main un paiement qui existait déjà.
  //
  // Le principe que ce fichier énonce lui-même en tête — « chaque effet
  // est idempotent côté base » — ne vaut que si le code va JUSQU'À la
  // base. Il s'arrêtait avant.
  if (await porte.encaissementDejaPose(intention.reference)) {
    return {
      issue: "applied",
      detail:
        `Encaissement déjà posé (${intention.reference}) : rejeu sans effet.`
        + (anomalieRattachement === null ? "" : ` [${anomalieRattachement}]`),
    };
  }

  const candidates = await porte.facturesEncaissables(organisation, intention.factureDemandee);

  const choix = rapprocher({
    organisationResolue: organisation,
    factureDemandee: intention.factureDemandee,
    montantCentimes: intention.montantCentimes,
    devise: intention.devise,
    candidates,
  });

  if (!choix.trouve) {
    // « failed » et non « ignored » : de l'argent a été encaissé chez le
    // prestataire et n'est attaché à aucune de nos factures. Ce n'est
    // pas un non-événement, c'est un écart de trésorerie qu'un humain
    // doit voir. La référence Stripe figure dans le motif : un
    // administrateur peut poser l'encaissement à la main, et l'index
    // d'unicité (method, external_reference) de 0083 § 5.a empêchera le
    // doublon si le webhook y parvient plus tard.
    return {
      issue: "failed",
      detail:
        `${choix.motif} Référence ${intention.reference}, ${intention.montantCentimes} centimes ${intention.devise}.`
        + (anomalieRattachement === null ? "" : ` [${anomalieRattachement}]`),
    };
  }

  const issue = await porte.enregistrerEncaissement({
    evenementId: evenement.id,
    factureId: choix.factureId,
    montantCentimes: intention.montantCentimes,
    devise: intention.devise,
    reference: intention.reference,
  });

  // L'anomalie d'annuaire, s'il y en a eu une, voyage avec le succès :
  // l'argent est posé, ET quelqu'un doit regarder pourquoi ce client
  // n'a pas pu être rattaché.
  const suffixe = anomalieRattachement === null ? "" : ` [${anomalieRattachement}]`;

  if (issue === "duplicate") {
    // L'index (method, external_reference) a fait son travail : ce
    // paiement était déjà posé. C'est un succès, pas un incident.
    return { issue: "applied", detail: `Encaissement déjà posé (${intention.reference}).${suffixe}` };
  }

  return {
    issue: "applied",
    detail:
      `Encaissement de ${intention.montantCentimes} centimes ${intention.devise} `
      + `sur la facture ${choix.factureId} (voie ${choix.voie}).${suffixe}`,
  };
}

function panne(message: string, erreur: unknown, evenement: EvenementNormalise): ReponseWebhook {
  return {
    statut: 503,
    corps: { erreur: message },
    journal: `stripe-webhook: ${message} (événement ${evenement.id}) — ${decrire(erreur)}`,
  };
}

function decrire(erreur: unknown): string {
  if (erreur instanceof Error) return `${erreur.name}: ${erreur.message}`;
  return String(erreur);
}
