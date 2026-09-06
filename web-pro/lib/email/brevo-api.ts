import type { EnveloppeCourriel } from "./types.ts";

/**
 * §COURRIEL — LA PORTE DU TRANSPORTEUR, ET SA CONFIGURATION.
 *
 * ══════════════════════════════════════════════════════════════════
 * CE FICHIER ET SON VOISIN `brevo.ts` SONT LES DEUX SEULS DU DÉPÔT
 * QUI ONT LE DROIT DE NOMMER LE TRANSPORTEUR
 * ══════════════════════════════════════════════════════════════════
 *
 * Si un gabarit, un écran, une action métier ou une fonction Edge
 * prononce ce nom, c'est un défaut : la promesse « qui transporte est un
 * réglage » ne tient qu'aussi longtemps que le nom reste enfermé ici.
 *
 * ══════════════════════════════════════════════════════════════════
 * AUCUNE CLÉ N'EST ÉCRITE ICI, NI EN COMMENTAIRE, NI EN EXEMPLE
 * ══════════════════════════════════════════════════════════════════
 *
 * Le code LIT des variables d'environnement, point. Le dirigeant les
 * pose lui-même ; il a déjà collé une clé dans une conversation par le
 * passé et elle a dû être révoquée — on ne lui en redemande pas, et on
 * n'en fabrique pas d'exemple qui ressemble à la vraie.
 *
 *   BREVO_API_KEY           la clé d'API du transporteur. SANS préfixe
 *                           NEXT_PUBLIC_, et c'est vital : Next.js
 *                           n'inline dans le paquet du navigateur QUE
 *                           les variables ainsi préfixées.
 *   OASIS_EMAIL_EXPEDITEUR  l'adresse technique, sur le domaine déjà
 *                           authentifié. C'est elle qui porte SPF, DKIM
 *                           et DMARC.
 *   OASIS_EMAIL_RETOUR      la boîte qui reçoit les rebonds et les
 *                           réponses égarées, et que QUELQU'UN doit
 *                           lire. Une adresse « ne-pas-repondre » que
 *                           personne n'ouvre transforme chaque erreur
 *                           d'adresse en silence.
 *   OASIS_EMAIL_BASE_URL    la racine des liens fabriqués dans les
 *                           messages (désabonnement, portail).
 *   BREVO_WEBHOOK_SECRET    n'est PAS lu ici. C'est la fonction Edge
 *                           qui le lit, et elle seule.
 *
 * L'ABSENCE DE L'UNE D'ELLES EST UN ÉTAT NORMAL : la lecture rend alors
 * `{ manque: "…" }`, l'envoyeur devient indisponible avec cette phrase,
 * et rien ne plante.
 */

/** L'API transactionnelle. Épinglée sur `v3`, la seule version publiée. */
const BASE_API = "https://api.brevo.com/v3";

/**
 * LE CHEMIN TRANSACTIONNEL, ET LE PIÈGE QU'IL FAUT CONNAÎTRE.
 *
 * Le transporteur tient DEUX suppressions distinctes :
 *
 *   a) le désabonnement marketing, sur le contact, côté campagnes ;
 *   b) la LISTE DE BLOCAGE TRANSACTIONNELLE (`/v3/smtp/blockedContacts`),
 *      alimentée par les rebonds durs ET par les plaintes pour
 *      indésirable — et qui bloque AUSSI le transactionnel.
 *
 * Autrement dit : si un client marque un devis comme indésirable, le
 * transporteur peut ensuite refuser sa FACTURE, sans que notre code ait
 * rien fait de mal. C'est le bogue catastrophique du chantier, produit
 * par l'infrastructure elle-même.
 *
 * CE QUE CE FICHIER FAIT CONTRE ÇA :
 *   • il n'écrit JAMAIS dans `/v3/smtp/blockedContacts`. Aucune méthode
 *     de ce module ne l'appelle, et il ne faut pas en ajouter une : la
 *     liste de suppression d'Oasis (`email_suppressions`, 0084 § 3) est
 *     la nôtre, elle est consultable, elle se lève, et elle ne bloque
 *     jamais un transactionnel ;
 *   • il exige un en-tête `List-Unsubscribe` sur toute publicité (voir
 *     `brevo.ts`), parce que sans lui le bouton « se désabonner » du
 *     client de messagerie devient « signaler comme indésirable », et
 *     c'est la plainte qui remplit la liste (b) ;
 *   • et le compte rendu du chantier demande que le réglage
 *     « ajouter à la liste de blocage au désabonnement » soit surveillé
 *     dans le tableau de bord du transporteur. Ce n'est pas du code.
 */
const CHEMIN_ENVOI = "/smtp/email";

export type ConfigTransporteur = {
  cleApi: string;
  /** L'adresse technique sur le domaine authentifié. */
  expediteur: string;
  /** La boîte de retour, lue par un humain. */
  retour: string;
  /** Racine des liens, sans barre oblique finale. */
  baseUrl: string;
};

/** Ce qui empêche d'instancier le client, dit en français. */
export type ConfigManquante = { manque: string };

export type LectureConfig = ConfigTransporteur | ConfigManquante;

export function configEstComplete(lecture: LectureConfig): lecture is ConfigTransporteur {
  return "cleApi" in lecture;
}

/**
 * Une adresse est-elle plausible ?
 *
 * Volontairement grossier — la validation fine est en base
 * (`email_is_addressable`, 0084 § 0). Ce qui est vérifié ici est ce qui
 * casserait un en-tête : une espace, un saut de ligne, une virgule. Un
 * saut de ligne dans un champ d'en-tête permet d'INJECTER un
 * destinataire caché ; c'est la seule vérification de ce fichier qui
 * relève de la sécurité et non du confort.
 */
function adresseUtilisable(valeur: string): boolean {
  if (/[\r\n\t,;<>]/.test(valeur)) return false;
  const parts = valeur.split("@");
  return parts.length === 2 && parts[0].length > 0 && parts[1].includes(".");
}

/**
 * La configuration, lue dans l'environnement.
 *
 * ELLE NE DÉDUIT RIEN. Pas de domaine deviné depuis la clé, pas de
 * racine d'URL construite depuis un en-tête `Host` — un en-tête `Host`
 * est fourni par l'appelant, et un lien de désabonnement fabriqué à
 * partir de lui pointerait où l'appelant veut.
 */
export function lireConfigTransporteur(env: Record<string, string | undefined>): LectureConfig {
  const cleApi = env.BREVO_API_KEY?.trim();
  if (!cleApi) {
    return {
      manque:
        "L'envoi de courrier n'est pas encore branché : la clé du transporteur (BREVO_API_KEY) n'est pas posée sur ce serveur.",
    };
  }

  // LE PRÉFIXE NEXT_PUBLIC_ SERAIT UNE FUITE, pas une commodité. On
  // refuse net plutôt que d'expédier avec une clé qui est peut-être déjà
  // partie dans le navigateur de tous les visiteurs.
  if (env.NEXT_PUBLIC_BREVO_API_KEY !== undefined) {
    return {
      manque:
        "Une variable NEXT_PUBLIC_BREVO_API_KEY existe sur ce serveur. Ce préfixe publie la valeur dans le navigateur : la clé doit être révoquée chez le transporteur, puis reposée sous le nom BREVO_API_KEY. Aucun courrier ne part tant que ce n'est pas fait.",
    };
  }

  const expediteur = env.OASIS_EMAIL_EXPEDITEUR?.trim().toLowerCase();
  if (!expediteur || !adresseUtilisable(expediteur)) {
    return {
      manque:
        "L'adresse technique d'expédition n'est pas configurée sur ce serveur (OASIS_EMAIL_EXPEDITEUR). C'est elle qui porte l'authentification du domaine : sans elle, aucun message n'arriverait.",
    };
  }

  const retour = env.OASIS_EMAIL_RETOUR?.trim().toLowerCase();
  if (!retour || !adresseUtilisable(retour)) {
    return {
      manque:
        "L'adresse de retour n'est pas configurée sur ce serveur (OASIS_EMAIL_RETOUR). C'est la boîte qui reçoit les rebonds : sans quelqu'un pour la lire, une adresse client fausse resterait un silence.",
    };
  }

  const baseUrl = env.OASIS_EMAIL_BASE_URL?.trim().replace(/\/+$/, "");
  if (!baseUrl || !/^https:\/\/[^\s/]+/.test(baseUrl)) {
    return {
      manque:
        "L'adresse du site n'est pas configurée sur ce serveur (OASIS_EMAIL_BASE_URL, en https). Sans elle, le lien de désabonnement des messages commerciaux ne peut pas être fabriqué, et une publicité sans ce lien est illégale.",
    };
  }

  return { cleApi, expediteur, retour, baseUrl };
}

// ────────────────────────────────────────────────────────────────
// LA PORTE
// ────────────────────────────────────────────────────────────────

export type ReponseEnvoi = {
  identifiantTransporteur: string;
};

/**
 * UNE SEULE MÉTHODE, ET C'EST VOULU.
 *
 * Ce client ne crée pas de contact, ne lit pas de liste, n'ajoute
 * personne à une liste de blocage et ne consulte aucune suppression chez
 * le transporteur. Il POSTE UNE ENVELOPPE. Toutes les décisions — qui a
 * consenti, qui est suspendu, qui a rebondi — sont prises en base, où
 * elles sont visibles, testables et réversibles.
 *
 * `ApiTransporteur` est une INTERFACE, et c'est ce qui rend la suite de
 * tests jouable : aucun test de ce chantier ne doit avoir besoin du
 * réseau. Un test qui exigerait un appel sortant ne tournerait jamais en
 * intégration, et on s'en apercevrait le jour où il aurait quelque chose
 * à dire.
 */
export interface ApiTransporteur {
  envoyer(enveloppe: EnveloppeCourriel, config: ConfigTransporteur): Promise<ReponseEnvoi>;
}

/**
 * Le code que porte « accepté, mais sans identifiant ».
 *
 * Une constante plutôt qu'une chaîne recopiée : c'est sur elle que
 * l'aiguillage décide de rendre « sort inconnu » au lieu de « refusé »,
 * et une faute de frappe dans la comparaison ferait silencieusement
 * réapparaître le mensonge qu'on vient de retirer du journal.
 */
export const CODE_SANS_IDENTIFIANT = "sansIdentifiant";

/** Une réponse d'erreur du transporteur, telle qu'on veut la voir remonter. */
export class ErreurTransporteur extends Error {
  readonly statut: number;
  readonly code: string | null;

  constructor(statut: number, code: string | null, message: string) {
    super(message);
    this.name = "ErreurTransporteur";
    this.statut = statut;
    this.code = code;
  }
}

/**
 * L'IDENTIFIANT DE MESSAGE, NORMALISÉ.
 *
 * Le transporteur rend `<202603051200.12345@smtp-relay.example>` à
 * l'envoi, et renvoie parfois la même valeur SANS les chevrons dans son
 * webhook. Si on enregistre l'une et qu'on cherche l'autre,
 * `email_record_event` ne rattache rien : les rebonds s'accumulent en
 * événements orphelins et l'écran du paysagiste reste vide alors que
 * tout est là. Les chevrons sautent des deux côtés, une fois pour
 * toutes.
 */
export function normaliserIdentifiant(valeur: string): string {
  return valeur.trim().replace(/^</, "").replace(/>$/, "");
}

/**
 * Le corps JSON réellement posté.
 *
 * EXTRAIT DE LA CLASSE POUR ÊTRE ÉPROUVÉ SEUL. C'est la fonction qui
 * décide ce que le client verra dans sa boîte : le nom affiché, l'adresse
 * de réponse, la présence du désabonnement. Une erreur ici ne lève
 * aucune exception — elle envoie simplement le mauvais message, et
 * personne ne le voit avant le client.
 */
export function composerCorps(
  enveloppe: EnveloppeCourriel,
  config: ConfigTransporteur,
): Record<string, unknown> {
  const corps: Record<string, unknown> = {
    // LE MOTIF CRM, EN TROIS LIGNES.
    //   `sender.email`  — le domaine authentifié. Jamais celui du
    //                     paysagiste : il n'a pas de SPF, pas de DKIM,
    //                     et les grands fournisseurs de messagerie
    //                     refusent désormais franchement ce montage.
    //   `sender.name`   — son entreprise. Le client voit « Jardins
    //                     Dupont » dans sa boîte. L'alignement DMARC
    //                     porte sur le DOMAINE, pas sur le nom affiché.
    //   `replyTo`       — lui. Sans ce champ, le client répond
    //                     « d'accord pour le devis » et sa réponse tombe
    //                     dans une boîte d'Oasis que personne ne lit :
    //                     la fonctionnalité serait pire qu'inutile.
    sender: { name: enveloppe.expediteur.nom, email: config.expediteur },
    replyTo: { name: enveloppe.repondreA.nom, email: enveloppe.repondreA.email },
    to: [
      enveloppe.destinataire.nom
        ? { email: enveloppe.destinataire.email, name: enveloppe.destinataire.nom }
        : { email: enveloppe.destinataire.email },
    ],
    subject: enveloppe.objet,
    htmlContent: enveloppe.html,
    // TOUJOURS LES DEUX. Un message sans partie texte est classé
    // indésirable plus souvent, et certains clients de messagerie
    // n'affichent que celle-là.
    textContent: enveloppe.texte,
  };

  if (enveloppe.pieces.length > 0) {
    corps.attachment = enveloppe.pieces.map((piece) => ({
      name: piece.nom,
      content: piece.contenuBase64,
    }));
  }

  const entetes: Record<string, string> = { ...enveloppe.entetes };
  // LA BOÎTE DE RETOUR. Elle n'est pas l'adresse de réponse du
  // paysagiste : c'est l'infrastructure d'Oasis qui apprend qu'une
  // adresse est fausse, parce que c'est son domaine qui expédie. Ce
  // déséquilibre est le prix du motif CRM, et il est assumé : le
  // paysagiste, lui, lit l'échec dans son écran (0084 § 6).
  entetes["X-Oasis-Retour"] = config.retour;
  if (Object.keys(entetes).length > 0) corps.headers = entetes;

  if (enveloppe.etiquettes.length > 0) corps.tags = enveloppe.etiquettes;

  return corps;
}

/**
 * Le client réel.
 *
 * Il ne s'instancie qu'avec une configuration complète — voir
 * `lireConfigTransporteur`. Rien dans ce fichier ne fabrique de clé,
 * n'en enregistre une, ni n'en écrit une dans un journal : l'en-tête
 * `api-key` n'apparaît jamais dans un message d'erreur.
 */
export class ClientTransporteurHttp implements ApiTransporteur {
  readonly #fetch: typeof fetch;

  constructor(fetchImpl: typeof fetch = fetch) {
    this.#fetch = fetchImpl;
  }

  async envoyer(
    enveloppe: EnveloppeCourriel,
    config: ConfigTransporteur,
  ): Promise<ReponseEnvoi> {
    const reponse = await this.#fetch(`${BASE_API}${CHEMIN_ENVOI}`, {
      method: "POST",
      headers: {
        "api-key": config.cleApi,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(composerCorps(enveloppe, config)),
    });

    const charge = (await reponse.json().catch(() => ({}))) as Record<string, unknown>;

    if (!reponse.ok) {
      const code = typeof charge.code === "string" ? charge.code : null;
      const message =
        typeof charge.message === "string"
          ? charge.message
          : "Le transporteur a refusé le message sans en dire la raison.";
      throw new ErreurTransporteur(reponse.status, code, message);
    }

    const identifiant = charge.messageId;
    if (typeof identifiant !== "string" || identifiant.trim() === "") {
      // SANS IDENTIFIANT, LE MESSAGE EST PARTI SANS LAISSE. Aucun
      // événement du webhook ne pourra plus s'y rattacher : ni la
      // remise, ni le rebond.
      //
      // MAIS CE N'EST PAS UN REFUS, et le confondre avec un refus
      // faisait mentir le journal : le transporteur a répondu 2xx,
      // c'est-à-dire qu'il a ACCEPTÉ le message. Ce qui manque est le
      // moyen de le suivre, pas l'envoi. Le code ci-dessous permet à
      // l'appelant de le traiter comme un SORT INCONNU plutôt que
      // d'écrire au paysagiste que son client n'a rien reçu.
      throw new ErreurTransporteur(
        502,
        CODE_SANS_IDENTIFIANT,
        "Le transporteur n'a pas rendu d'identifiant de message : impossible de suivre ce qu'il en fera.",
      );
    }

    return { identifiantTransporteur: normaliserIdentifiant(identifiant) };
  }
}
