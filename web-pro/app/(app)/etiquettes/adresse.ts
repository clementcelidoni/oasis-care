/**
 * D'OÙ VIENT L'ADRESSE IMPRIMÉE — la décision à dix ans.
 *
 * ══════════════════════════════════════════════════════════════════
 * CE FICHIER LIT L'ENVIRONNEMENT ; IL NE FABRIQUE PAS L'ADRESSE
 * ══════════════════════════════════════════════════════════════════
 *
 * La construction et la validation de l'adresse finale vivent dans
 * `lib/etiquettes/adresse.ts` : c'est lui qui exige le https, qui
 * refuse les domaines réservés par la RFC 2606, et qui vérifie que le
 * jeton ressemble à un jeton plutôt qu'à l'identifiant de la plante.
 * ON NE REFAIT PAS CES CONTRÔLES ICI. Deux validateurs pour une même
 * chaîne, c'est deux verdicts qui finiront par diverger — et le jour
 * où ils divergeront, l'un des deux laissera passer ce que l'autre
 * refusait.
 *
 * Ce qui reste à faire de ce côté-ci, et que la bibliothèque se
 * refuse délibérément à faire, c'est LIRE LA VARIABLE
 * D'ENVIRONNEMENT — elle ne connaît aucun domaine, et c'est ce qui la
 * rend testable et réutilisable.
 *
 * ══════════════════════════════════════════════════════════════════
 * POURQUOI CETTE DISCIPLINE, ET CE QU'ELLE A DÉJÀ COÛTÉ
 * ══════════════════════════════════════════════════════════════════
 *
 * Cinq étiquettes de production portent `oasis-care.example`. Le
 * domaine de premier niveau `.example` est RÉSERVÉ par la RFC 2606 :
 * il ne résout pas, il ne résoudra jamais, aucun enregistrement n'est
 * possible. C'était une constante dans un fichier Swift, relue par
 * personne pendant des mois.
 *
 * ══════════════════════════════════════════════════════════════════
 * REFUSER EST LE COMPORTEMENT CORRECT
 * ══════════════════════════════════════════════════════════════════
 *
 * Sans adresse configurée, on n'imprime pas. Ce n'est pas de la
 * rigidité : une planche de deux cents autocollants sortie avec une
 * mauvaise adresse, ce sont deux cents autocollants à décoller un par
 * un sur des pots déjà en rayon. Un écran qui dit « posez cette
 * variable » coûte trente secondes.
 *
 * C'est la discipline de `NEXT_PUBLIC_SITE_URL` dans
 * `lib/billing/stripe.ts`, qui refuse d'ouvrir la caisse plutôt que
 * d'inventer une adresse de retour.
 */

// Import relatif : `node --test` ne résout pas l'alias `@/`, et ce
// module doit être testable sans bundler ni réseau.
import { adresseEtiquette } from "../../../lib/etiquettes/adresse.ts";

/** La variable qui décide. Une seule, et elle n'a pas de valeur par défaut. */
export const VARIABLE_ADRESSE = "OASIS_ETIQUETTES_BASE_URL";

/** Le repli, et il est assumé comme tel. Voir `analyserAdresse`. */
export const VARIABLE_REPLI = "NEXT_PUBLIC_SITE_URL";

/** Le chemin du résolveur — § 15, et `web-pro/app/x/[jeton]`. */
export const CHEMIN_RESOLVEUR = "x";

export type OrigineAdresse = "dediee" | "repli" | "aucune";

export type Adresse = {
  /** L'origine, sans barre oblique finale. `null` si rien n'est utilisable. */
  readonly base: string | null;
  readonly origine: OrigineAdresse;
  /** Ce qui empêche d'imprimer, en une phrase pour un humain. */
  readonly probleme: string | null;
};

/**
 * Un jeton d'exemple de la LONGUEUR RÉELLE de ceux que tire la base —
 * `encode(gen_random_bytes(16), 'hex')`, trente-deux caractères
 * hexadécimaux.
 *
 * La longueur n'est pas un détail cosmétique : elle décide de la
 * version du QR, donc du nombre de modules, donc de la taille d'un
 * module — c'est-à-dire de la possibilité même de scanner. Un exemple
 * plus court donnerait à l'éditeur un verdict de lisibilité flatteur
 * et faux.
 */
export const JETON_EXEMPLE = "0123456789abcdef0123456789abcdef";

/**
 * L'ADRESSE D'ÉTALONNAGE, quand rien n'est encore configuré.
 *
 * L'éditeur doit montrer un QR même sans adresse en environnement,
 * sinon on compose une étiquette en ignorant la place que le carré
 * prendra — exactement ce que le § 18 demande d'éviter.
 *
 * TROIS PROPRIÉTÉS, ET CHACUNE COMPTE :
 *
 *   • ELLE NE PEUT JAMAIS ÊTRE IMPRIMÉE. Sans adresse configurée,
 *     `analyserAdresse` rend `base: null` et la planche refuse de se
 *     composer. Cette chaîne ne sert qu'à MESURER une densité à
 *     l'écran ; elle ne traverse aucun chemin d'impression.
 *   • ELLE FAIT EXACTEMENT LA BONNE LONGUEUR. « https://longueur.invalid/x/ »
 *     fait vingt-sept caractères, comme « https://oasisrarecare.fr/x/ » :
 *     le verdict de lisibilité affiché sans configuration est donc
 *     celui qu'on aura avec le domaine proposé, et non une estimation.
 *   • ELLE EST MORTE PAR CONSTRUCTION. `.invalid` est réservé par la
 *     RFC 2606 au même titre que `.example` : si elle fuyait malgré
 *     tout sur du papier, elle ne pourrait tromper personne — et la
 *     bibliothèque la refuserait au passage.
 *
 * Ce n'est donc pas un domaine codé en dur au sens de la règle : c'est
 * un étalon de mesure, nommé comme tel, qui ne peut pas atteindre une
 * imprimante.
 */
export const BASE_ETALON = "https://longueur.invalid";

/**
 * Vérifie qu'une variable contient bien une ORIGINE, et rien de plus.
 *
 * CE CONTRÔLE-CI N'EST PAS UN DOUBLON DE LA BIBLIOTHÈQUE : il porte sur
 * un autre objet. `adresseEtiquette` reçoit une base et n'en garde que
 * l'origine — un chemin en trop y est SILENCIEUSEMENT ignoré. Or dans
 * une variable d'environnement, « https://exemple.fr/app » est une
 * erreur de configuration qu'il vaut mieux signaler tout de suite que
 * corriger en douce : celui qui l'a écrite croit que ses étiquettes
 * pointeront vers /app.
 *
 * Le reste — https, RFC 2606, forme du jeton — est laissé à la
 * bibliothèque, dont on rend le message tel quel.
 */
export function analyserOrigine(brut: string | undefined | null): {
  base: string | null;
  probleme: string | null;
} {
  const texte = (brut ?? "").trim();
  if (texte === "") return { base: null, probleme: null };

  let url: URL;
  try {
    url = new URL(texte);
  } catch {
    return {
      base: null,
      probleme: `« ${texte} » n'est pas une adresse valide : il faut une origine complète, par exemple https://exemple.fr`,
    };
  }

  // `pathname` vaut « / » pour une origine nue : c'est le seul chemin
  // accepté.
  if (url.pathname !== "/" || url.search !== "" || url.hash !== "") {
    return {
      base: null,
      probleme: `« ${texte} » doit être une origine seule, sans chemin ni paramètre : le résolveur ajoute déjà /${CHEMIN_RESOLVEUR}/…`,
    };
  }

  // LE VERDICT FINAL APPARTIENT À LA BIBLIOTHÈQUE. On lui fait
  // fabriquer une adresse d'essai : si elle refuse, sa phrase est la
  // bonne, et c'est la même que celle qui protégerait l'impression.
  try {
    adresseEtiquette(url.origin, JETON_EXEMPLE, { chemin: CHEMIN_RESOLVEUR });
  } catch (erreur) {
    return {
      base: null,
      probleme:
        erreur instanceof Error
          ? erreur.message
          : `« ${texte} » n'est pas utilisable comme adresse d'étiquette.`,
    };
  }

  return { base: url.origin, probleme: null };
}

/**
 * L'adresse à imprimer, à partir des deux variables.
 *
 * LE REPLI SUR `NEXT_PUBLIC_SITE_URL` EST DÉLIBÉRÉ ET IL EST DIT À
 * L'ÉCRAN. Sans lui, personne ne pourrait imprimer avant qu'une
 * variable de plus soit posée en production. Avec lui, l'impression
 * marche tout de suite — mais l'écran affiche l'adresse ET d'où elle
 * vient, parce que graver le domaine du site sur dix ans
 * d'autocollants est une décision, pas un défaut de configuration.
 *
 * UNE VARIABLE DÉDIÉE FAUSSE NE SE REPLIE PAS. C'est le piège
 * classique : quelqu'un pose l'adresse avec un chemin en trop, la
 * validation la rejette, et un repli silencieux enverrait la planche
 * vers l'autre domaine sans que personne ne s'en aperçoive.
 */
export function analyserAdresse(env: Record<string, string | undefined>): Adresse {
  const dediee = analyserOrigine(env[VARIABLE_ADRESSE]);
  if (dediee.base) return { base: dediee.base, origine: "dediee", probleme: null };
  if (dediee.probleme) return { base: null, origine: "aucune", probleme: dediee.probleme };

  const repli = analyserOrigine(env[VARIABLE_REPLI]);
  if (repli.base) return { base: repli.base, origine: "repli", probleme: null };
  if (repli.probleme) return { base: null, origine: "aucune", probleme: repli.probleme };

  return {
    base: null,
    origine: "aucune",
    probleme:
      `Aucune adresse d'étiquette n'est configurée. Posez ${VARIABLE_ADRESSE} ` +
      `(par exemple https://oasisrarecare.fr) dans l'environnement du serveur, puis redémarrez-le. ` +
      `Tant qu'elle manque, rien n'est imprimé : une planche partie avec la mauvaise adresse, ` +
      `c'est autant d'autocollants à décoller un par un.`,
  };
}

/** L'adresse du serveur qui tourne. Le seul endroit qui lit `process.env`. */
export function adresseEtiquettes(): Adresse {
  return analyserAdresse(process.env);
}

/**
 * L'adresse complète que porte un QR.
 *
 * Elle est CALCULÉE, jamais stockée — comme du côté de l'iPhone, où
 * `SmartTag.url` se recompose depuis le jeton. C'est ce qui permettra
 * de changer de domaine un jour : le jeton reste, le serveur le
 * résout, et les étiquettes déjà collées continuent de fonctionner
 * tant que l'ancien domaine redirige.
 *
 * LÈVE si la base ou le jeton ne conviennent pas : mieux vaut une
 * planche qui refuse de se composer qu'une planche d'autocollants
 * muets. Les appelants qui imprimment en lot attrapent, écartent
 * l'élément fautif, et le NOMMENT.
 */
export function urlEtiquette(base: string, jeton: string): string {
  return adresseEtiquette(base, jeton, { chemin: CHEMIN_RESOLVEUR });
}

/**
 * Une adresse pour MESURER, à l'écran seulement.
 *
 * Avec une base configurée, c'est la vraie adresse d'un jeton
 * d'exemple. Sans base, c'est l'étalon — voir `BASE_ETALON`.
 */
export function urlExemple(base: string | null): string {
  if (base) return urlEtiquette(base, JETON_EXEMPLE);
  // L'ÉTALON CONTOURNE DÉLIBÉRÉMENT LE VALIDATEUR, et ce contournement
  // est la preuve que l'étalon ne peut pas être imprimé : la
  // bibliothèque refuse `.invalid` au titre de la RFC 2606, comme elle
  // refuserait le `.example` qui a tué les cinq premières étiquettes.
  // On assemble donc la chaîne à la main pour MESURER une densité, et
  // aucun chemin d'impression ne passe par ici.
  return `${BASE_ETALON}/${CHEMIN_RESOLVEUR}/${JETON_EXEMPLE}`;
}
