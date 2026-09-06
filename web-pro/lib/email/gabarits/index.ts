import type { AudienceCourriel, CleGabarit, NatureCourriel } from "../types.ts";
import { empreinteSha256 } from "../empreinte.ts";
import { CATALOGUE, type VariablesParGabarit } from "./catalogue.ts";
import { habiller, type ContexteRendu } from "./enveloppe.ts";

export { CATALOGUE } from "./catalogue.ts";
export type {
  Gabarit,
  VariablesParGabarit,
  VariablesAnnonce,
  VariablesBienvenue,
  VariablesDevis,
  VariablesDevisRelance,
  VariablesFacture,
  VariablesFactureRelance,
  VariablesInvitation,
  VariablesParametre,
} from "./catalogue.ts";
export type { ContexteRendu, MessageHabille } from "./enveloppe.ts";
export {
  habiller, lienDesabonnement, lienDesabonnementUnClic, identiteEnUneLigne,
} from "./enveloppe.ts";
export type { Bloc, LigneEncadre } from "./blocs.ts";
export { formaterDate, formaterMontant, echapperHtml, urlSure } from "./blocs.ts";

/**
 * §COURRIEL — LE RENDU : UNE CLÉ, DES VARIABLES, UN MESSAGE.
 *
 * ══════════════════════════════════════════════════════════════════
 * LE GARDE-FOU EST DANS LE TYPE, PAS DANS UNE VÉRIFICATION
 * ══════════════════════════════════════════════════════════════════
 *
 * `ContextePour<K>` lie la clé du gabarit à la nature du contexte :
 *
 *   • rendre `annonceCommerciale` exige un contexte « publicite », donc
 *     un jeton de désabonnement. Sans lui, ÇA NE COMPILE PAS ;
 *   • rendre `factureEmise` exige un contexte « transactionnel », qui
 *     n'a pas de champ où mettre un jeton. Une facture ne peut donc pas
 *     porter de lien de désabonnement, même en s'y efforçant.
 *
 * C'est la traduction en types de la distinction la plus importante du
 * chantier. Une vérification écrite à la main se retire un jour « parce
 * qu'elle bloque » ; une forme, non.
 *
 * Les vérifications d'exécution qui suivent ne sont pas un doublon
 * inutile : la file d'attente d'une campagne rend du JSON, et du JSON
 * n'a pas de type.
 */

export type MessageRendu = {
  cle: CleGabarit;
  version: string;
  nature: NatureCourriel;
  audience: AudienceCourriel;
  objet: string;
  texte: string;
  html: string;
  /** L'empreinte de `html`, pour `email_messages.body_html_sha256`. */
  empreinteHtml: string;
  /** `List-Unsubscribe` et son compagnon — publicité uniquement. */
  entetes: Record<string, string>;
};

/** La nature qu'un gabarit impose, au niveau des types. */
type NatureDe<K extends CleGabarit> = K extends "annonceCommerciale"
  ? "publicite"
  : "transactionnel";

export type ContextePour<K extends CleGabarit> = Extract<ContexteRendu, { nature: NatureDe<K> }>;

/**
 * L'OBJET, NETTOYÉ.
 *
 * `email_messages.subject` refuse un objet vide, au-delà de 300
 * caractères, ou contenant un retour à la ligne
 * (`email_is_header_safe`). Un retour à la ligne dans un objet n'est pas
 * un défaut d'esthétique : c'est une INJECTION D'EN-TÊTE — la ligne
 * suivante devient un en-tête, et l'on peut y glisser un second
 * destinataire. La valeur vient de la base, mais le numéro d'un devis
 * est de la donnée saisie, et de la donnée saisie n'est jamais sûre.
 *
 * On coupe à 250 plutôt qu'à 300 : le journal accepte 300, mais un objet
 * plus long que ça est tronqué par les clients de messagerie de toute
 * façon, et un objet tronqué au milieu d'un mot a l'air d'une panne.
 */
export function nettoyerObjet(valeur: string): string {
  const propre = valeur.replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim();
  if (propre === "") {
    // Un objet vide ferait échouer l'insertion au moment d'envoyer une
    // facture. Mieux vaut un objet générique qu'un envoi perdu.
    return "Message de votre paysagiste";
  }
  return propre.length > 250 ? `${propre.slice(0, 249).trimEnd()}…` : propre;
}

/**
 * Rendre un message complet : objet, texte, HTML, empreinte, en-têtes.
 *
 * NE LÈVE QUE SUR UN DÉFAUT DE PROGRAMMATION — une clé inconnue, une
 * nature incohérente, un jeton vide. Ce sont des situations qui ne
 * peuvent pas arriver à un appelant typé, et que l'appelant non typé (la
 * file d'attente) doit attraper pour en faire un échec journalisé plutôt
 * qu'une panne de la fonction.
 */
export async function rendreMessage<K extends CleGabarit>(
  cle: K,
  variables: VariablesParGabarit[K],
  ctx: ContextePour<K>,
): Promise<MessageRendu> {
  const gabarit = CATALOGUE[cle];
  if (!gabarit) {
    throw new Error(`Gabarit inconnu : « ${String(cle)} ». Aucun message ne part sur un gabarit qui n'est pas au catalogue.`);
  }

  // LA VÉRIFICATION D'EXÉCUTION, pour l'appelant qui vient du JSON.
  if (gabarit.nature !== (ctx as ContexteRendu).nature) {
    throw new Error(
      `Le gabarit « ${gabarit.cle} » est de nature « ${gabarit.nature} » : il ne peut pas être rendu dans un contexte « ${(ctx as ContexteRendu).nature} ».`,
    );
  }

  const blocs = gabarit.corps(variables);
  const habille = habiller(blocs, ctx as ContexteRendu);
  const objet = nettoyerObjet(gabarit.objet(variables));

  return {
    cle: gabarit.cle,
    version: gabarit.version,
    nature: gabarit.nature,
    audience: gabarit.audience,
    objet,
    texte: habille.texte,
    html: habille.html,
    empreinteHtml: await empreinteSha256(habille.html),
    entetes: habille.entetes,
  };
}

/**
 * LA MÊME CHOSE, SANS LA GARANTIE DES TYPES — ET C'EST ASSUMÉ.
 *
 * La file d'attente d'une campagne rend du JSON, et du JSON n'a pas de
 * type : la clé du gabarit et ses variables arrivent en `unknown`. Cette
 * porte existe pour ce cas-là, et pour lui seul.
 *
 * Elle ne relâche RIEN : la vérification de nature qui, dans
 * `rendreMessage`, est faite par le compilateur, est ici faite à
 * l'exécution et lève. Un appelant TYPÉ ne doit pas l'employer — il
 * perdrait la seule garantie qui empêche une facture de porter un lien
 * de désabonnement.
 */
export function rendreMessageBrut(
  cle: CleGabarit,
  variables: unknown,
  ctx: ContexteRendu,
): Promise<MessageRendu> {
  return rendreMessage(
    cle as "devisEnvoye",
    variables as VariablesParGabarit["devisEnvoye"],
    ctx as ContextePour<"devisEnvoye">,
  );
}
