import type { EnveloppeCourriel, NouvelleDuTransporteur, ResultatTransport } from "./types.ts";
import { construireEnvoyeurBrevo } from "./brevo.ts";

/**
 * §COURRIEL — L'ABSTRACTION, ET CE QU'ELLE PORTE.
 *
 * ══════════════════════════════════════════════════════════════════
 * CE FICHIER EST LE JUMEAU DE `lib/billing/provider.ts`, EXPRÈS
 * ══════════════════════════════════════════════════════════════════
 *
 * Le dirigeant a tranché l'architecture en une phrase : « on reste sur
 * Brevo, mais derrière une interface, exactement comme BillingProvider a
 * été écrit pour Stripe ». Ce fichier reprend donc la forme du
 * fournisseur de paiement sans y changer une virgule de principe :
 *
 *   • une INTERFACE que tout le reste du dépôt connaît ;
 *   • une `raisonIndisponibilite` qui est `null` quand ça marche, et une
 *     PHRASE sinon ;
 *   • une implémentation de repli qui ne simule rien ;
 *   • un aiguillage — `obtenirEnvoyeurCourriel()` — qui reconstruit à
 *     chaque appel plutôt que de mettre en cache.
 *
 * ══════════════════════════════════════════════════════════════════
 * L'ABSENCE DE CLÉ EST UN ÉTAT NORMAL, PAS UNE PANNE
 * ══════════════════════════════════════════════════════════════════
 *
 * Un déploiement où `BREVO_API_KEY` n'a pas encore été posée n'est pas
 * cassé : il n'expédie pas, il le DIT, et l'écran s'y adapte au lieu
 * d'afficher « une erreur est survenue » là où il n'y a rien de cassé.
 * C'est la leçon d'`unavailableReason`, et elle vaut ici davantage
 * encore : le dirigeant a déjà collé une clé Brevo dans une
 * conversation, et elle a dû être révoquée. Un produit qui plante sans
 * clé pousse à en coller une n'importe où pour le faire taire.
 *
 * ══════════════════════════════════════════════════════════════════
 * POURQUOI BREVO, POUR QUE PERSONNE NE LE REDÉFASSE
 * ══════════════════════════════════════════════════════════════════
 *
 *   1. LE DOMAINE EST DÉJÀ AUTHENTIFIÉ. SPF, DKIM et DMARC sont
 *      vérifiés sur le domaine d'expédition. Un « -all » y avait
 *      silencieusement bloqué tout le courrier pendant des mois : c'est
 *      l'endroit où l'on casse les choses sans le voir, et on n'y
 *      retouche pas pour le confort d'une API plus agréable.
 *   2. PRESTATAIRE FRANÇAIS, données dans l'Union.
 *   3. IL APPORTE D'ORIGINE le registre de consentement, le
 *      désabonnement et la liste de suppression, qui sont une
 *      OBLIGATION LÉGALE et non une fonctionnalité.
 *
 * Un autre transporteur serait plus agréable à programmer : c'est
 * précisément ce que cette interface rend indolore à changer plus tard.
 * Le jour venu, on écrit un second fichier à côté de `brevo.ts`, on
 * change une ligne dans `obtenirEnvoyeurCourriel()`, et RIEN D'AUTRE du
 * dépôt ne bouge — parce que rien d'autre ne nomme le transporteur.
 */

/**
 * L'ENVOYEUR. Il sait faire une seule chose, et c'est voulu.
 *
 * REMARQUER CE QU'IL NE SAIT PAS FAIRE :
 *
 *   • il ne CHOISIT PAS le destinataire. L'enveloppe le lui donne, et
 *     l'enveloppe a été fabriquée à partir de ce que la base a résolu
 *     (`email_recipient_for_customer`). Un envoyeur qui accepterait une
 *     adresse venue d'un paramètre de requête ferait de ce serveur un
 *     relais de courrier indésirable, et le domaine serait sur liste
 *     noire en une journée ;
 *   • il ne CHOISIT PAS le nom affiché. Même raison, en pire : un nom
 *     libre depuis un domaine authentifié, c'est de l'hameçonnage ;
 *   • il n'écrit RIEN en base. Le journal, l'idempotence et la porte du
 *     consentement sont des affaires de `service_role`, et cet objet
 *     tourne parfois sous le jeton d'un humain.
 */
export interface EnvoyeurCourriel {
  /**
   * La clé recopiée dans `email_messages.transporter_key`. La base n'a
   * aucune liste de valeurs pour cette colonne, et c'est délibéré : elle
   * n'a pas à connaître le prestataire du jour.
   */
  readonly cle: string;

  /** Le nom montré à un administrateur dans un écran. */
  readonly libelle: string;

  /**
   * `null` quand l'envoyeur peut réellement expédier. Sinon, la phrase à
   * afficher À LA PLACE — jamais une exception, jamais « une erreur est
   * survenue ».
   */
  readonly raisonIndisponibilite: string | null;

  /** Poster une enveloppe. Rend toujours un résultat, ne lève jamais. */
  expedier(enveloppe: EnveloppeCourriel): Promise<ResultatTransport>;

  /**
   * LE NOM DE LA VARIABLE D'ENVIRONNEMENT qui porte le secret du
   * webhook — pas le secret lui-même, que ce dossier ne lit jamais.
   *
   * POURQUOI CETTE INDIRECTION A L'AIR EXCESSIVE ET NE L'EST PAS : sans
   * elle, la fonction Edge écrirait `Deno.env.get("BREVO_WEBHOOK_SECRET")`
   * et le nom du transporteur serait sorti de son fichier. La promesse
   * « qui transporte est un réglage » se perd exactement comme ça, une
   * chaîne à la fois, et l'on s'en aperçoit le jour où l'on veut
   * changer de prestataire.
   *
   * `undefined` pour un transporteur sans webhook.
   */
  readonly nomSecretWebhook?: string;

  /**
   * Traduire ce que le transporteur nous rapporte plus tard.
   *
   * FACULTATIVE, et c'est ce qui préserve l'interface : un transporteur
   * sans webhook ne la déclare pas, et le récepteur d'événements se
   * contente alors de ne rien savoir. Elle est ici plutôt que dans un
   * module séparé parce que le vocabulaire d'un webhook appartient au
   * transporteur au même titre que celui de son API — les séparer, c'est
   * garantir qu'un jour l'un sera changé sans l'autre.
   *
   * Rend `null` quand la charge n'est pas reconnue : un webhook mal
   * formé n'est pas une raison de rendre 500 et de faire désactiver le
   * point de terminaison par le transporteur.
   */
  lireNouvelle?(charge: unknown): NouvelleDuTransporteur | null;
}

/**
 * L'ÉTAT « RIEN N'EXPÉDIE ».
 *
 * Il ne simule pas un envoi, ne rend pas un faux identifiant, n'écrit
 * rien. Il rend la raison, telle quelle, et l'appelant l'affiche.
 *
 * LA RAISON EST UN PARAMÈTRE DU CONSTRUCTEUR, et ce détail-là compte
 * autant que le reste. « Aucun transporteur n'est branché » et « la clé
 * n'est pas posée sur CE serveur » n'appellent pas le même geste : la
 * première attend une décision, la seconde attend une variable
 * d'environnement. Une phrase générique enverrait chercher au mauvais
 * endroit — c'est la leçon de `UnconfiguredBillingProvider`.
 */
export class EnvoyeurIndisponible implements EnvoyeurCourriel {
  readonly cle = "aucun";
  readonly libelle = "Aucun envoi de courrier configuré";
  readonly raisonIndisponibilite: string;

  constructor(raison: string) {
    this.raisonIndisponibilite = raison;
  }

  async expedier(enveloppe: EnveloppeCourriel): Promise<ResultatTransport> {
    // Pas d'écriture, pas de faux succès, pas d'identifiant inventé. Un
    // identifiant inventé se retrouverait dans `transporter_message_id`
    // et le webhook n'aurait plus rien à rattacher.
    void enveloppe;
    return { etat: "indisponible", raison: this.raisonIndisponibilite };
  }
}

/**
 * L'ENVOYEUR ACTIF.
 *
 * C'est ICI — et nulle part ailleurs — que le transporteur se choisit.
 *
 * POURQUOI LA CONSTRUCTION EST REFAITE À CHAQUE APPEL, et non mise en
 * cache dans une variable de module : une variable d'environnement
 * ajoutée sur l'hébergeur doit prendre effet au déploiement suivant, pas
 * au redémarrage suivant d'un processus qu'on ne contrôle pas. Le coût
 * est une lecture de quelques champs — rien.
 *
 * `env` est un paramètre pour que les tests puissent la fournir sans
 * toucher à l'environnement du processus : un test qui modifie
 * l'environnement global contamine ceux qui suivent, et le désordre ne
 * se voit qu'à l'ordre d'exécution.
 */
export function obtenirEnvoyeurCourriel(
  env: Record<string, string | undefined> = lireEnvironnement(),
  fetchImpl?: typeof fetch,
): EnvoyeurCourriel {
  const brevo = construireEnvoyeurBrevo(env, fetchImpl);
  if ("indisponible" in brevo) return new EnvoyeurIndisponible(brevo.indisponible);
  return brevo;
}

/**
 * LES SEULES VARIABLES QUE CE DOSSIER LIT.
 *
 * Écrites en toutes lettres plutôt que recopiées en bloc : un
 * environnement recopié entier finit un jour dans un journal ou dans un
 * message d'erreur, avec tout ce qu'il contient. Ici, ce qui n'est pas
 * dans cette liste n'est jamais lu.
 */
const NOMS_LUS = [
  "BREVO_API_KEY",
  "NEXT_PUBLIC_BREVO_API_KEY",
  "OASIS_EMAIL_EXPEDITEUR",
  "OASIS_EMAIL_RETOUR",
  "OASIS_EMAIL_BASE_URL",
] as const;

/**
 * L'environnement, lu sans supposer le runtime.
 *
 * Ce dossier tourne dans Next (Node) ET dans la fonction Edge (Deno).
 * `process.env` n'existe pas partout, `Deno.env` non plus. On regarde
 * les deux, et on rend un objet vide si aucun n'est là — ce qui produira
 * une indisponibilité avec une phrase, jamais une exception au
 * chargement du module.
 */
export function lireEnvironnement(): Record<string, string | undefined> {
  const global = globalThis as unknown as {
    process?: { env?: Record<string, string | undefined> };
    Deno?: { env?: { get(nom: string): string | undefined } };
  };
  if (global.process?.env) return global.process.env;

  const deno = global.Deno?.env;
  if (!deno) return {};
  try {
    const lu: Record<string, string | undefined> = {};
    for (const nom of NOMS_LUS) lu[nom] = deno.get(nom);
    return lu;
  } catch {
    // Deno sans la permission `--allow-env` : on ne sait rien, et c'est
    // une indisponibilité avec une phrase, pas une panne.
    return {};
  }
}
