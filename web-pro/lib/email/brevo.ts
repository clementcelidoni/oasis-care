import type {
  EnveloppeCourriel,
  EvenementCourriel,
  NouvelleDuTransporteur,
  ResultatTransport,
} from "./types.ts";
import type { EnvoyeurCourriel } from "./envoyeur.ts";
import {
  CODE_SANS_IDENTIFIANT,
  ClientTransporteurHttp,
  ErreurTransporteur,
  configEstComplete,
  lireConfigTransporteur,
  normaliserIdentifiant,
  type ApiTransporteur,
  type ConfigTransporteur,
} from "./brevo-api.ts";

/**
 * §COURRIEL — L'IMPLÉMENTATION, DERRIÈRE L'INTERFACE.
 *
 * ══════════════════════════════════════════════════════════════════
 * LE SEUL ENDROIT, AVEC `brevo-api.ts`, QUI NOMME LE TRANSPORTEUR
 * ══════════════════════════════════════════════════════════════════
 *
 * Le reste du dépôt parle à `EnvoyeurCourriel`. Changer de prestataire
 * un jour, c'est écrire un fichier à côté de celui-ci et changer une
 * ligne dans `obtenirEnvoyeurCourriel()`. Rien d'autre — ni un gabarit,
 * ni un écran, ni une action de devis — n'a à bouger. Si l'un d'eux
 * devait bouger, c'est que le nom aurait fui, et ce serait le défaut.
 *
 * ══════════════════════════════════════════════════════════════════
 * DEUX VÉRIFICATIONS QUI NE SONT PAS DE LA POLITESSE
 * ══════════════════════════════════════════════════════════════════
 *
 * `expedier` refuse deux enveloppes AVANT tout appel sortant :
 *
 *   1. une PUBLICITÉ SANS LIEN DE DÉSABONNEMENT. Elle est illégale, et
 *      elle est aussi la façon la plus efficace de détruire la
 *      réputation du domaine pour tout le parc : privé du bouton « se
 *      désabonner », le destinataire clique sur « indésirable », et la
 *      plainte remplit la liste de blocage TRANSACTIONNELLE du
 *      transporteur — celle qui, ensuite, bloquera sa facture ;
 *   2. un TRANSACTIONNEL AVEC un lien de désabonnement. Il n'en a pas le
 *      droit : proposer à quelqu'un de se désabonner de ses propres
 *      factures est une promesse qu'on ne tiendra pas, et un clic dessus
 *      inscrirait l'adresse dans un registre qui n'a rien à voir.
 *
 * Ces deux refus sont ici plutôt que dans le gabarit parce qu'un gabarit
 * peut être ajouté ; ce point de passage-là, non.
 */

/** La clé recopiée dans `email_messages.transporter_key`. */
export const CLE_TRANSPORTEUR = "brevo";

/**
 * Le nom de la variable qui porte le secret du webhook.
 *
 * Il est ici et pas dans la fonction Edge, pour que le nom du
 * transporteur ne sorte pas de ce fichier. Le SECRET, lui, n'est lu
 * nulle part dans ce dossier : seule la machine le lit, et seulement au
 * moment de comparer.
 */
export const NOM_SECRET_WEBHOOK = "BREVO_WEBHOOK_SECRET";

export class EnvoyeurBrevo implements EnvoyeurCourriel {
  readonly cle = CLE_TRANSPORTEUR;
  readonly libelle = "Brevo";
  readonly raisonIndisponibilite = null;
  readonly nomSecretWebhook = NOM_SECRET_WEBHOOK;
  readonly #api: ApiTransporteur;
  readonly #config: ConfigTransporteur;

  constructor(config: ConfigTransporteur, api: ApiTransporteur) {
    this.#config = config;
    this.#api = api;
  }

  async expedier(enveloppe: EnveloppeCourriel): Promise<ResultatTransport> {
    const refus = verifierDesabonnement(enveloppe);
    if (refus) {
      // DÉFINITIF : rejouer une enveloppe mal formée la refera refuser.
      return { etat: "refuse", raison: refus, code: "desabonnement", temporaire: false };
    }

    try {
      const reponse = await this.#api.envoyer(enveloppe, this.#config);
      return { etat: "remis", identifiantTransporteur: reponse.identifiantTransporteur };
    } catch (erreur) {
      // ON NE LAISSE JAMAIS L'EXCEPTION REMONTER. L'appelant écrit la
      // raison dans `email_messages.failure_reason`, que le paysagiste
      // lira dans son écran ; une exception non attrapée y écrirait une
      // trace d'appels, ce qui est une façon de ne rien dire.
      if (erreur instanceof ErreurTransporteur) {
        // LE 2xx SANS IDENTIFIANT EST UN SORT INCONNU, PAS UN REFUS. Le
        // transporteur a accepté le message ; c'est seulement le moyen
        // de le SUIVRE qui manque. Le compter comme « pas parti »
        // faisait mentir le journal au moment précis où on le consulte.
        if (erreur.code === CODE_SANS_IDENTIFIANT) {
          return {
            etat: "incertain",
            raison:
              "Le transporteur a accepté ce message mais n'a rendu aucun identifiant : nous ne pourrons pas suivre ce qu'il en fait. Vérifiez auprès de votre client avant de le renvoyer.",
          };
        }
        return {
          etat: "refuse",
          raison: traduireRefus(erreur),
          code: erreur.code,
          temporaire: refusTemporaire(erreur),
        };
      }
      // LE REJET DE `fetch` EST LE CAS LE PLUS TROMPEUR DU FICHIER. Il
      // survient aussi — et surtout — APRÈS que le transporteur a
      // accepté le message : la réponse s'est perdue, pas la requête.
      // Affirmer « le message n'est pas parti » était donc faux dans le
      // cas le plus fréquent, et c'était affirmé dans le journal que le
      // paysagiste consulte quand son client dit n'avoir rien reçu.
      return {
        etat: "incertain",
        raison:
          "Nous n'avons pas eu de réponse du transporteur : ce message est peut-être parti. Vérifiez auprès de votre client avant de le renvoyer.",
      };
    }
  }

  lireNouvelle(charge: unknown): NouvelleDuTransporteur | null {
    return lireNouvelleTransporteur(charge);
  }
}

/**
 * LES DEUX REFUS STRUCTURELS. Rend `null` quand l'enveloppe est correcte.
 *
 * Exportée pour être éprouvée seule : c'est la garantie qu'un
 * transactionnel n'aura jamais de lien de désabonnement, et une
 * publicité jamais l'inverse.
 */
export function verifierDesabonnement(enveloppe: EnveloppeCourriel): string | null {
  const porteEntete = Object.keys(enveloppe.entetes).some(
    (nom) => nom.toLowerCase() === "list-unsubscribe",
  );

  if (enveloppe.nature === "publicite") {
    if (!porteEntete) {
      return "Ce message commercial n'a pas de lien de désabonnement : il ne part pas. Un envoi commercial doit en porter un dans chaque message.";
    }
    return null;
  }

  if (porteEntete) {
    return "Ce message est un document (devis, facture, invitation) : il ne peut pas porter de lien de désabonnement. On ne se désabonne pas de ses propres factures.";
  }
  return null;
}

/**
 * Le refus du transporteur, traduit pour un paysagiste.
 *
 * Le code brut est conservé à côté, dans `email_messages.failure_code`,
 * pour nous. La phrase, elle, est celle que lira quelqu'un qui ne sait
 * pas ce qu'est un code HTTP — un code technique dans une interface
 * client est une façon de ne rien dire.
 */
export function traduireRefus(erreur: ErreurTransporteur): string {
  if (erreur.statut === 401 || erreur.statut === 403) {
    return "Le transporteur a refusé nos identifiants. Le message n'est pas parti : la clé posée sur ce serveur est invalide ou révoquée.";
  }
  if (erreur.statut === 429) {
    return "Le transporteur a atteint son plafond d'envois pour aujourd'hui. Le message n'est pas parti ; il repartira tout seul dès que le plafond sera levé.";
  }
  if (erreur.code === "invalid_parameter") {
    return `Le transporteur a refusé le message : ${erreur.message}`;
  }
  if (erreur.statut >= 500) {
    return "Le transporteur est momentanément en panne. Le message n'est pas parti ; il repartira tout seul au prochain essai.";
  }
  return `Le transporteur a refusé le message : ${erreur.message}`;
}

/**
 * TEMPORAIRE OU DÉFINITIF ? LA QUESTION QUE PERSONNE NE POSAIT.
 *
 * Cette fonction et `traduireRefus` doivent rester d'accord : chaque
 * phrase qui PROMET un nouvel essai doit tomber dans un cas où
 * `refusTemporaire` rend vrai. Une phrase qui promet ce que le code ne
 * fait pas est pire qu'une phrase sèche — le paysagiste attend un
 * message qui ne repartira jamais.
 *
 *   • 429 — le plafond journalier. C'est LE cas du chantier : les
 *     relances se groupent le lundi matin, l'offre du transporteur
 *     plafonne par jour, et la pointe se fait refuser. Ces messages
 *     doivent repartir seuls.
 *   • 5xx — une panne chez lui. Elle passe.
 *   • 401/403 — la clé est invalide ou révoquée. Réessayer ne la
 *     réparera pas, mais la reposer, oui : on réessaie, et le plafond
 *     de tentatives finit par trancher.
 *   • tout le reste — un refus sur le CONTENU (adresse invalide,
 *     paramètre refusé). Rejouer ne fera que le refaire.
 */
export function refusTemporaire(erreur: ErreurTransporteur): boolean {
  if (erreur.statut === 429) return true;
  if (erreur.statut >= 500) return true;
  if (erreur.statut === 401 || erreur.statut === 403) return true;
  return false;
}

/**
 * L'AIGUILLAGE. Rend l'envoyeur, ou la raison de son absence.
 *
 * Même forme que `construireStripeBillingProvider` : un objet
 * `{ indisponible }` plutôt qu'une exception, parce que « pas de clé »
 * est un état normal et non une panne.
 */
export function construireEnvoyeurBrevo(
  env: Record<string, string | undefined>,
  fetchImpl?: typeof fetch,
  api?: ApiTransporteur,
): EnvoyeurBrevo | { indisponible: string } {
  const config = lireConfigTransporteur(env);
  if (!configEstComplete(config)) return { indisponible: config.manque };
  return new EnvoyeurBrevo(config, api ?? new ClientTransporteurHttp(fetchImpl));
}

// ────────────────────────────────────────────────────────────────
// LE WEBHOOK
// ────────────────────────────────────────────────────────────────
//
// LA TRADUCTION DU VOCABULAIRE DU TRANSPORTEUR VIT ICI, avec son API, et
// pas dans la fonction Edge qui reçoit la requête. Les séparer, c'est
// garantir qu'un jour on changera de prestataire et que la moitié
// « webhook » restera derrière, à traduire les mots de l'ancien.
//
// À QUOI SERT VRAIMENT CE WEBHOOK : les rebonds reviennent chez Oasis,
// pas chez le paysagiste, parce que c'est le domaine d'Oasis qui
// expédie. Sans lui, le paysagiste attendrait la réponse à un devis
// jamais arrivé, et le produit mentirait par omission. C'est la
// contrepartie du motif CRM, et elle n'est pas facultative.

/**
 * Le vocabulaire du transporteur vers celui d'`email_events.event`.
 *
 * Les deux orthographes de chaque rebond figurent : le transporteur
 * envoie `hard_bounce` dans son webhook transactionnel et `hardBounce`
 * dans certains autres flux. Ne reconnaître qu'une seule des deux, c'est
 * jeter la moitié des rebonds — et n'en rien savoir, puisqu'on jetterait
 * en silence.
 */
const TRADUCTION: Record<string, EvenementCourriel> = {
  request: "sent",
  sent: "sent",
  delivered: "delivered",
  opened: "opened",
  unique_opened: "opened",
  uniqueOpened: "opened",
  click: "clicked",
  clicked: "clicked",
  soft_bounce: "softBounce",
  softBounce: "softBounce",
  hard_bounce: "hardBounce",
  hardBounce: "hardBounce",
  // UNE ADRESSE INVALIDE EST UN REBOND DUR, pas un incident à part :
  // dans les deux cas l'adresse ne marchera jamais, et c'est cela que
  // le paysagiste doit lire dans son écran.
  invalid_email: "hardBounce",
  invalidEmail: "hardBounce",
  spam: "complaint",
  complaint: "complaint",
  blocked: "blocked",
  unsubscribed: "unsubscribed",
  deferred: "deferred",
  error: "error",
};

/**
 * Lire une notification du transporteur, ou rendre `null`.
 *
 * `null` PLUTÔT QU'UNE EXCEPTION, et c'est délibéré : une charge
 * inconnue — un événement de campagne, un format qui change — ne doit
 * pas faire rendre 500 au point de terminaison. Un transporteur qui
 * reçoit des 500 finit par désactiver le point de terminaison, et l'on
 * perd alors TOUS les rebonds, silencieusement.
 */
export function lireNouvelleTransporteur(charge: unknown): NouvelleDuTransporteur | null {
  if (typeof charge !== "object" || charge === null) return null;
  const brut = charge as Record<string, unknown>;

  const nomEvenement = typeof brut.event === "string" ? brut.event : null;
  if (!nomEvenement) return null;
  const evenement = TRADUCTION[nomEvenement];
  if (!evenement) return null;

  // Le transporteur nomme ce champ `message-id`, avec un tiret. La
  // variante sans tiret existe dans ses exemples : on regarde les deux.
  const identifiantBrut =
    (typeof brut["message-id"] === "string" ? (brut["message-id"] as string) : null) ??
    (typeof brut.messageId === "string" ? (brut.messageId as string) : null);
  if (!identifiantBrut) return null;

  return {
    identifiantTransporteur: normaliserIdentifiant(identifiantBrut),
    evenement,
    instant: lireInstant(brut),
    raison: lireRaison(brut),
    charge: brut,
  };
}

/**
 * L'INSTANT DE L'ÉVÉNEMENT, ET POURQUOI CE N'EST PAS `now()`.
 *
 * `email_events` déduplique sur (identifiant, événement, instant). Si
 * l'on posait l'heure de réception, un rejeu — que le transporteur fait
 * volontiers quand il n'a pas eu son 200 — porterait un instant
 * différent et entrerait une seconde fois. Le compteur de rebonds de
 * l'écran doublerait sans qu'aucun rebond de plus n'ait eu lieu.
 *
 * `ts_event` est en secondes, `ts` aussi ; `date` est une chaîne. On
 * prend le plus précis disponible, et l'heure de réception seulement en
 * dernier recours.
 */
function lireInstant(brut: Record<string, unknown>): string {
  const secondes = brut.ts_event ?? brut.ts;
  if (typeof secondes === "number" && Number.isFinite(secondes) && secondes > 0) {
    return new Date(secondes * 1000).toISOString();
  }
  if (typeof brut.date === "string") {
    const lu = new Date(brut.date);
    if (!Number.isNaN(lu.getTime())) return lu.toISOString();
  }
  return new Date().toISOString();
}

function lireRaison(brut: Record<string, unknown>): string | null {
  const valeur = brut.reason;
  if (typeof valeur !== "string") return null;
  const propre = valeur.trim();
  return propre === "" ? null : propre.slice(0, 500);
}
