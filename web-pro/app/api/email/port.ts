/**
 * §EMAILS — LE PORT D'EXPÉDITION, ET RIEN D'AUTRE.
 *
 * ══════════════════════════════════════════════════════════════════
 * CE FICHIER EST LA COPIE FIDÈLE DE `lib/billing/provider.ts`
 * ══════════════════════════════════════════════════════════════════
 *
 * La décision d'architecture est la même, mot pour mot : LE CODE DIT
 * « ENVOIE CE MESSAGE À CE DESTINATAIRE ». QUI LE TRANSPORTE EST UN
 * RÉGLAGE. On retrouve donc ici les trois traits qui font marcher
 * l'abstraction du paiement :
 *
 *   1. UNE INTERFACE, et les appelants ne connaissent qu'elle. AUCUN
 *      NOM DE TRANSPORTEUR n'apparaît dans le CODE de ce dossier — ni
 *      ici, ni dans `declencheurs.ts`, ni dans `relances.ts`, ni dans
 *      les actions de devis et de facture. S'il y apparaissait, c'est
 *      qu'on aurait recommencé à coder en dur le prestataire du jour, et
 *      `frontiere-ia.test.ts` fait rougir cette phrase-là plutôt que de
 *      la croire.
 *
 *   2. `raisonIndisponible` — L'ÉTAT « PAS DE TRANSPORTEUR » EST NORMAL,
 *      PAS UNE PANNE. Un déploiement où la clé n'est pas encore posée
 *      n'est pas cassé : il ne peut simplement pas expédier, et il le
 *      dit avec une phrase que l'écran affiche telle quelle. C'est
 *      exactement `unavailableReason`, et c'est pour cette raison que
 *      la raison est une DONNÉE et non une constante : « aucune couche
 *      d'e-mail n'est branchée » et « la clé n'est pas posée sur CE
 *      serveur » n'appellent pas le même geste.
 *
 *   3. `obtenirPortEmail()` RECONSTRUIT À CHAQUE APPEL. Pas de cache de
 *      module : une variable d'environnement ajoutée sur l'hébergeur
 *      doit prendre effet au déploiement suivant, pas au redémarrage
 *      suivant d'un processus qu'on ne contrôle pas. Le coût est une
 *      lecture de `process.env` — rien.
 *
 * ══════════════════════════════════════════════════════════════════
 * CE QUE CE PORT NE PREND PAS EN PARAMÈTRE, ET C'EST LE SUJET
 * ══════════════════════════════════════════════════════════════════
 *
 * Ni adresse de destinataire, ni nom d'expéditeur, ni nature, ni clé
 * d'idempotence. Les quatre sont lus ou générés EN BASE par
 * `email_enqueue` (migration 0084) :
 *
 *   • le DESTINATAIRE se résout sur le contact principal puis sur la
 *     fiche client. Un formulaire qui accepterait une adresse
 *     arbitraire ferait de ce serveur un relais de courrier
 *     indésirable, et le domaine serait sur liste noire en une journée ;
 *
 *   • le NOM AFFICHÉ se lit sur l'organisation vérifiée. Un nom libre
 *     depuis un domaine authentifié est un outil d'hameçonnage : on
 *     écrirait « Votre banque » avec un SPF valide ;
 *
 *   • la NATURE est recopiée du catalogue par une clé étrangère
 *     composite. Un message publicitaire déguisé en transactionnel est
 *     refusé par la base, pas par une relecture ;
 *
 *   • la CLÉ D'IDEMPOTENCE est une colonne GÉNÉRÉE sous contrainte
 *     d'unicité. L'appelant ne peut pas l'inventer pour envoyer deux
 *     fois.
 *
 * Ce port ne transporte donc qu'une INTENTION : quel gabarit, sur quel
 * objet, pour quelle entreprise, à quel rang.
 */

/**
 * LES SEULS GABARITS QUE CE MODULE SAIT DÉCLENCHER.
 *
 * Quatre, et pas un de plus. Le catalogue de la migration 0084 en
 * compte huit ; les quatre autres appartiennent à d'autres gestes
 * (l'invitation au portail, la bienvenue, le changement de paramètre,
 * l'annonce commerciale d'Oasis Admin) et n'ont rien à faire sur le
 * chemin d'un devis ou d'une facture.
 *
 * ET L'ABSENCE QUI COMPTE : il n'y a pas de gabarit que l'IA pourrait
 * nommer, parce qu'il n'y a pas de chemin par lequel elle atteindrait
 * cette union. Voir `frontiere-ia.test.ts`, qui le vérifie sur les
 * fichiers plutôt que sur la bonne volonté.
 */
export type CleGabarit =
  | "devisEnvoye"
  | "devisRelance"
  | "factureEmise"
  | "factureRelance";

/** Les objets auxquels un message de ce module peut se rattacher. */
export type TypeObjet = "quote" | "invoice";

/**
 * L'INTENTION, et rien d'autre.
 *
 * `occurrence` est le RANG : 1 pour le premier envoi, 2 pour la
 * première relance, et ainsi de suite. C'est la seule échappatoire à
 * l'idempotence, et elle est délibérée — on ne renvoie pas « le même »
 * message, on envoie le suivant.
 *
 * `variables` ne porte QUE ce qui s'imprime sur le document : un
 * numéro, un montant, une date. Jamais un jeton, jamais une session,
 * jamais une donnée d'une autre organisation.
 */
export type DemandeEnvoi = {
  organizationId: string;
  gabarit: CleGabarit;
  typeObjet: TypeObjet;
  objetId: string;
  occurrence: number;
};

/**
 * CE QUE CETTE DEMANDE NE PORTE PLUS, ET C'EST LA CORRECTION MAJEURE.
 *
 * Elle portait `customerId` et `variables` — c'est-à-dire le
 * destinataire et le TEXTE du message. La machine les recevait et les
 * rendait tels quels : un compte inscrit pouvait donc faire expédier,
 * depuis le domaine authentifié d'Oasis (SPF, DKIM et DMARC alignés),
 * un message au texte de son choix, avec l'objet de son choix et un
 * bouton vers l'URL https de son choix.
 *
 * Les deux se lisent maintenant EN BASE, dans la machine, sous le jeton
 * de l'appelant. Il ne reste ici qu'une INTENTION : quel gabarit, sur
 * quel objet, pour quelle entreprise, à quel rang.
 */

/**
 * CE QUE PRODUIT UNE DEMANDE.
 *
 * Cinq états, et les distinguer est tout le sujet — exactement comme
 * `CheckoutOutcome` distingue « indisponible » d'« échec ». Un écran
 * qui afficherait « une erreur est survenue » sur un `refuse` enverrait
 * le paysagiste chercher une panne là où il n'y a qu'un champ à
 * remplir.
 */
export type ResultatEnvoi =
  /** La ligne est écrite, le message part dès que le transporteur le prend. */
  | { etat: "misEnFile"; messageId: string; avertissements: string[] }
  /**
   * Ce message est déjà parti. Ce n'est PAS une erreur : c'est le
   * fonctionnement normal d'un rejeu — un déploiement qui redémarre,
   * deux onglets ouverts, une relance recalculée.
   */
  | { etat: "dejaParti"; messageId: string | null }
  /**
   * Le paysagiste doit faire quelque chose : renseigner l'adresse de
   * son client, l'e-mail de son entreprise, son SIRET. La phrase est
   * écrite pour lui, en français, et vient de la base.
   */
  | { etat: "refuse"; raison: string; avertissements: string[] }
  /**
   * Rien n'est branché sur CE serveur. État normal d'un déploiement
   * incomplet, pas une panne.
   */
  | { etat: "indisponible"; raison: string }
  /**
   * LE MESSAGE EST PEUT-ÊTRE PARTI, ET ON NE LE SAIT PAS.
   *
   * La connexion au transporteur a cassé après qu'il a accepté le
   * message, ou il a répondu sans identifiant. Affirmer « parti » ou
   * « pas parti » serait choisir la réponse qui arrange : le journal
   * dirait au paysagiste que son client n'a rien reçu alors que le
   * document est peut-être dans sa boîte.
   */
  | { etat: "incertain"; raison: string }
  /** L'imprévu. Jamais propagé à l'appelant : voir `declencheurs.ts`. */
  | { etat: "erreur"; raison: string };

export interface PortEmail {
  /** Le nom du transporteur, pour le journal et pour l'écran. */
  readonly identifiant: string;

  /**
   * `null` quand ce serveur peut réellement mettre un message en file.
   * Sinon, la phrase à afficher À LA PLACE — jamais une exception.
   */
  readonly raisonIndisponible: string | null;

  mettreEnFile(demande: DemandeEnvoi): Promise<ResultatEnvoi>;
}

/**
 * L'ÉTAT « RIEN N'EXPÉDIE ».
 *
 * Il ne simule rien, n'écrit rien, ne prétend rien. Il rend la raison,
 * telle quelle, et l'appelant l'affiche — la contrepartie exacte de
 * `UnconfiguredBillingProvider`.
 *
 * POURQUOI CE FICHIER NE CONTIENT AUCUNE AUTRE IMPLÉMENTATION : la
 * couche qui rend les gabarits et parle au transporteur (`lib/email`)
 * est écrite ailleurs, et elle a besoin d'une clé de service que
 * `web-pro` ne détient pas aujourd'hui — `email_enqueue` n'est
 * exécutable que par `service_role` (0084 § 15.c), et `.env.example`
 * interdit explicitement `SUPABASE_SERVICE_ROLE_KEY` dans cette
 * application. Tant que ce point n'est pas tranché, ce serveur ne peut
 * pas expédier, et il le DIT au lieu de faire semblant.
 */
export class PortEmailNonBranche implements PortEmail {
  readonly identifiant = "aucun";
  readonly raisonIndisponible: string;

  constructor(raison: string) {
    this.raisonIndisponible = raison;
  }

  async mettreEnFile(demande: DemandeEnvoi): Promise<ResultatEnvoi> {
    void demande;
    return { etat: "indisponible", raison: this.raisonIndisponible };
  }
}

/**
 * LE PORT RÉEL : IL PARLE À LA MACHINE, PAS AU TRANSPORTEUR.
 *
 * ══════════════════════════════════════════════════════════════════
 * POURQUOI UN APPEL HTTP PLUTÔT QU'UN APPEL DIRECT
 * ══════════════════════════════════════════════════════════════════
 *
 * `email_enqueue` et les fonctions de marquage sont réservées à
 * `service_role` (0084 § 15.c), et `web-pro/.env.example` interdit
 * nommément `SUPABASE_SERVICE_ROLE_KEY` dans cette application. Ce
 * serveur ne peut donc PAS écrire le journal d'envoi lui-même — et
 * c'est voulu : « mettre un message en file est la porte qu'un
 * navigateur ne doit jamais pousser ».
 *
 * Le seul endroit qui détient cette clé est la fonction Edge
 * `envoi-email`. Ce port lui transmet l'INTENTION, avec le jeton de
 * l'utilisateur : la machine relit le document SOUS CE JETON, donc la
 * RLS continue de cloisonner, et un membre d'une entreprise ne peut pas
 * faire écrire au nom d'une autre.
 *
 * CE QUI PART SUR LE RÉSEAU NE CONTIENT NI ADRESSE NI TEXTE. Quatre
 * identifiants et un rang. Tout le reste se lit en base, de l'autre
 * côté.
 */
class PortEmailMachine implements PortEmail {
  readonly identifiant = "machine";
  readonly raisonIndisponible = null;
  readonly #url: string;
  readonly #jeton: string;
  readonly #fetch: typeof fetch;

  constructor(url: string, jeton: string, fetchImpl: typeof fetch = fetch) {
    this.#url = url;
    this.#jeton = jeton;
    this.#fetch = fetchImpl;
  }

  async mettreEnFile(demande: DemandeEnvoi): Promise<ResultatEnvoi> {
    let reponse: Response;
    try {
      reponse = await this.#fetch(`${this.#url}/envoyer`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.#jeton}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          ordre: {
            organizationId: demande.organizationId,
            gabarit: demande.gabarit,
            entityType: demande.typeObjet,
            entityId: demande.objetId,
            occurrence: demande.occurrence,
          },
        }),
      });
    } catch (erreur) {
      // ON NE LÈVE PAS. L'appelant est une action métier — émettre une
      // facture — et une facture qui refuserait de s'émettre parce
      // qu'un courriel n'a pas pu partir serait un défaut grave.
      return {
        etat: "erreur",
        raison: erreur instanceof Error ? erreur.message : "La machine d'envoi est injoignable.",
      };
    }

    if (!reponse.ok) {
      return {
        etat: "erreur",
        raison: `La machine d'envoi a répondu ${reponse.status}.`,
      };
    }

    const charge = (await reponse.json().catch(() => null)) as
      | { etat?: string; messageId?: string; raison?: string; avertissements?: string[] }
      | null;
    if (charge === null || typeof charge.etat !== "string") {
      return { etat: "erreur", raison: "La machine d'envoi a répondu quelque chose d'illisible." };
    }

    // LA TRADUCTION DU VOCABULAIRE DE LA MACHINE VERS CELUI DE L'ÉCRAN.
    // Les deux jeux de mots restent séparés parce qu'ils ne s'adressent
    // pas aux mêmes lecteurs : l'un décrit un acheminement, l'autre ce
    // qu'un paysagiste doit comprendre.
    switch (charge.etat) {
      case "envoye":
        return {
          etat: "misEnFile",
          messageId: charge.messageId ?? "",
          avertissements: charge.avertissements ?? [],
        };
      case "deja":
        return { etat: "dejaParti", messageId: charge.messageId ?? null };
      case "refuse":
        return {
          etat: "refuse",
          raison: charge.raison ?? "Le message n'est pas parti.",
          avertissements: [],
        };
      case "incertain":
        return {
          etat: "incertain",
          raison: charge.raison ?? "Nous ne savons pas si ce message est parti.",
        };
      case "indisponible":
        return {
          etat: "indisponible",
          raison: charge.raison ?? "L'envoi de courrier n'est pas branché sur ce serveur.",
        };
      default:
        return { etat: "erreur", raison: `Réponse inattendue de la machine : ${charge.etat}.` };
    }
  }
}

/**
 * L'ADRESSE DE LA MACHINE.
 *
 * Elle se déduit de l'URL du projet Supabase, qui est déjà là.
 * `OASIS_EMAIL_MACHINE_URL` permet d'en changer sans toucher au code —
 * un environnement de recette, une fonction déployée ailleurs — et
 * n'est pas préfixée `NEXT_PUBLIC_` : le navigateur n'a rien à faire de
 * cette adresse.
 */
export function urlMachine(env: Record<string, string | undefined>): string | null {
  const explicite = env.OASIS_EMAIL_MACHINE_URL?.trim().replace(/\/+$/, "");
  if (explicite) return explicite;
  const projet = env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/+$/, "");
  if (!projet) return null;
  return `${projet}/functions/v1/envoi-email`;
}

/**
 * LE POINT D'INTÉGRATION.
 *
 * C'est ICI — et nulle part ailleurs — que se choisit le chemin
 * d'envoi, exactement comme `getBillingProvider()`. Il RECONSTRUIT à
 * chaque appel : une variable d'environnement posée sur l'hébergeur
 * doit prendre effet au déploiement suivant, pas au redémarrage suivant
 * d'un processus qu'on ne contrôle pas.
 *
 * `jeton` est celui de la session de l'utilisateur. Sans lui, la
 * machine ne pourrait pas relire le document sous RLS, et l'on
 * retomberait sur un service qui écrit au nom de n'importe qui.
 */
export function obtenirPortEmail(
  jeton: string | null,
  env: Record<string, string | undefined> = process.env,
): PortEmail {
  if (!jeton) {
    return new PortEmailNonBranche(
      "Votre session n'a pas pu être vérifiée : le message est préparé, il ne part pas. Reconnectez-vous puis réessayez.",
    );
  }
  const url = urlMachine(env);
  if (url === null) {
    return new PortEmailNonBranche(
      "L'envoi de courrier n'est pas branché sur ce serveur : l'adresse de la machine d'envoi n'est pas configurée. Le message est préparé, il ne part pas.",
    );
  }
  return new PortEmailMachine(url, jeton);
}
