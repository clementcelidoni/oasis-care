/**
 * ══════════════════════════════════════════════════════════════════
 * LE PARCOURS D'ENTRÉE, SANS ÉCRAN ET SANS RÉSEAU
 * ══════════════════════════════════════════════════════════════════
 *
 * Tout ce que la page de connexion DÉCIDE est ici : la règle du mot de
 * passe, la traduction des refus du serveur, ce qu'on a le droit de
 * dire et à quel moment. La page, elle, ne fait qu'afficher et appeler
 * Supabase.
 *
 * Pourquoi séparer. Ces décisions sont exactement ce qui peut se
 * tromper sans que rien ne casse : un message qui en dit trop, une
 * règle qui refuse ce qu'elle devrait accepter. Un fichier sans React
 * et sans réseau se teste en entier, en une milliseconde, sans
 * navigateur — voir `parcours.test.ts`.
 *
 * ------------------------------------------------------------------
 * CE FICHIER EXISTE EN DOUBLE
 * ------------------------------------------------------------------
 * `web-admin/app/login/parcours.ts` en est le jumeau. Les deux
 * applications sont deux projets Next distincts, sans paquet partagé :
 * il n'y a aujourd'hui aucun endroit où poser un module commun. La
 * copie est donc assumée, et les deux fichiers ne sont PAS identiques —
 * le Control Center ne crée pas de compte, ne transporte pas de `next`
 * et doit distinguer son code d'entrée du code de son second facteur.
 * Toute correction faite ici est à reporter là-bas, et l'inverse.
 */

import { estRefusDeCaptcha, MESSAGE_ECHEC_CAPTCHA } from "./captcha.ts";

/* ==================================================================
   LES NOMBRES QUI VIENNENT DU SERVEUR, ET NON DE NOUS
   ================================================================== */

/**
 * Huit chiffres, parce que le projet est réglé sur `mailer_otp_length = 8`.
 *
 * Ce n'est pas un détail cosmétique : c'est ce qui distingue à l'œil le
 * code d'ENTRÉE (huit chiffres, reçu par courriel, valable une heure)
 * du code de SECOND FACTEUR du Control Center (six chiffres, lu dans
 * une application, valable trente secondes). Deux champs de six
 * chiffres à trois écrans d'écart seraient indiscernables.
 */
export const LONGUEUR_CODE = 8;

/**
 * Une heure — `mailer_otp_exp = 3600` dans la configuration du projet.
 *
 * Sert uniquement à choisir le BON MOT quand un code est refusé (voir
 * `interpreterEchecCode`). Si quelqu'un change ce réglage dans le
 * tableau de bord sans toucher à cette ligne, le pire qui arrive est un
 * message qui dit « vérifiez les chiffres » là où il aurait dû dire
 * « demandez-en un nouveau » — et les deux gestes restent offerts à
 * l'écran de toute façon.
 */
export const DUREE_VIE_CODE_MS = 3600 * 1000;

/**
 * Soixante secondes entre deux envois — `smtp_max_frequency = 60`.
 *
 * Le bouton « renvoyer » reste donc éteint une minute. Ce n'est pas un
 * garde-fou de sécurité (le serveur tient le sien, et il est le seul
 * qui compte) : c'est pour éviter d'offrir un bouton qui refuse.
 */
export const DELAI_RENVOI_S = 60;

/**
 * Douze caractères minimum, et rien d'autre.
 *
 * LA LONGUEUR PRIME SUR LA COMPOSITION. Exiger une majuscule, un
 * chiffre et un symbole produit « Paysage1! » : neuf caractères,
 * devinables, et recopiés sur un carnet. Douze caractères libres
 * laissent écrire « le jardin de ma grand-mère », qui se retient sans
 * carnet et vaut infiniment mieux.
 *
 * Le serveur, lui, n'exige que six (`password_min_length = 6`). C'est
 * donc NOUS qui montons la barre — et c'est pour ça que la règle est
 * affichée AVANT la saisie et non après un refus.
 */
export const LONGUEUR_MOT_DE_PASSE = 12;

/* ==================================================================
   LE CODE : NETTOYAGE ET COMPLÉTUDE
   ================================================================== */

/**
 * Ne garde que les chiffres, et pas plus qu'il n'en faut.
 *
 * C'est ce qui fait marcher le COLLAGE. Les gens ne collent presque
 * jamais huit chiffres nus : ils collent « 12 34 56 78 », ou
 * « Code : 12345678 », ou la ligne entière du courriel avec un espace
 * insécable au bout. Tout cela doit entrer dans le champ sans que
 * personne n'ait à faire le ménage à la main.
 */
export function nettoyerCode(brut: string): string {
  return brut.replace(/\D+/g, "").slice(0, LONGUEUR_CODE);
}

/** Le compte y est : on peut valider sans attendre un clic. */
export function codeComplet(code: string): boolean {
  return code.length === LONGUEUR_CODE;
}

/* ==================================================================
   LE MOT DE PASSE
   ================================================================== */

/**
 * La phrase affichée AVANT la saisie, jamais après le refus.
 *
 * Une règle qu'on découvre en se faisant refuser est une règle qu'on
 * subit ; une règle qu'on lit avant est une règle qu'on applique.
 */
export const REGLE_MOT_DE_PASSE = `Au moins ${LONGUEUR_MOT_DE_PASSE} caractères. Aucune majuscule, aucun chiffre, aucun symbole n'est imposé — et rien n'est interdit, pas même les espaces ni les accents. Une phrase que vous retenez vaut mieux qu'un mot compliqué.`;

export type VerdictMotDePasse =
  | { ok: true }
  | { ok: false; champ: "premier" | "second"; message: string };

/**
 * Les deux saisies, vérifiées ici et nulle part ailleurs.
 *
 * DEUX PRÉCAUTIONS QUI COMPTENT :
 *
 * 1. Le mot de passe n'apparaît JAMAIS dans la valeur retournée. Un
 *    message d'erreur finit dans un journal, dans une capture d'écran,
 *    dans un rapport de bogue — il ne doit donc rien contenir de
 *    secret, pas même un extrait.
 *
 * 2. On ne rogne PAS les espaces. `trim()` semble aimable et ne l'est
 *    pas : quelqu'un dont la phrase finit par un espace verrait ses
 *    deux saisies acceptées ici et son mot de passe refusé demain, sans
 *    comprendre. Ce qui est tapé est ce qui part.
 *
 * La comparaison des deux champs est un CONFORT, pas une sécurité :
 * elle attrape une faute de frappe. Le serveur n'en reçoit qu'une.
 */
export function verifierNouveauMotDePasse(
  premier: string,
  second: string,
): VerdictMotDePasse {
  // On compte les points de code et non les unités UTF-16 : un émoji
  // vaut un caractère, comme l'utilisateur le voit. Compter autrement
  // reviendrait à récompenser les émojis, ce qui n'a aucun sens.
  const longueur = [...premier].length;

  if (longueur === 0) {
    return { ok: false, champ: "premier", message: "Choisissez un mot de passe." };
  }
  if (longueur < LONGUEUR_MOT_DE_PASSE) {
    const manque = LONGUEUR_MOT_DE_PASSE - longueur;
    return {
      ok: false,
      champ: "premier",
      message:
        manque === 1
          ? "Il manque un caractère."
          : `Il manque ${manque} caractères.`,
    };
  }
  if (premier !== second) {
    return {
      ok: false,
      champ: "second",
      message:
        "Les deux saisies ne sont pas identiques. Affichez ce que vous tapez pour comparer.",
    };
  }
  return { ok: true };
}

/* ==================================================================
   LES REFUS DU SERVEUR, TRADUITS HONNÊTEMENT
   ================================================================== */

/**
 * Les quatre issues d'un code saisi, et le geste que chacune appelle.
 *
 * ------------------------------------------------------------------
 * CE QUE LE SERVEUR NE NOUS DIT PAS, ET COMMENT ON S'EN SORT
 * ------------------------------------------------------------------
 * La liste exhaustive des codes d'erreur de Supabase
 * (`@supabase/auth-js/dist/main/lib/error-codes.d.ts`) contient
 * `otp_expired` et RIEN qui ressemble à « otp_invalid ». Un code faux
 * et un code périmé rendent donc la MÊME erreur, avec le même message
 * anglais : « Token has expired or is invalid ».
 *
 * On refuse pourtant de s'en tenir à une phrase vague, parce que les
 * deux gestes ne sont pas les mêmes : dans un cas on retape, dans
 * l'autre retaper ne servira jamais à rien.
 *
 * LA SORTIE HONNÊTE : ON N'INVENTE RIEN, ON SE SERT DE CE QU'ON SAIT.
 * Quand c'est CE navigateur qui a demandé le code, il sait l'heure à
 * laquelle il est parti. Un code parti il y a deux minutes ne peut pas
 * être périmé — donc il est mal recopié. Un code parti il y a deux
 * heures ne peut plus être bon — donc retaper est inutile. Et quand on
 * ne sait pas (onglet rechargé, code demandé ailleurs), on le dit et on
 * offre les deux gestes.
 *
 * Ce n'est pas un compteur maison — ce serait interdit, et à raison :
 * un compteur maison se contourne en rechargeant la page. C'est une
 * date d'envoi, qui ne décide de rien et ne fait que choisir un mot.
 */
export type IssueCode =
  /** Mal recopié : le même code, retapé correctement, marchera. */
  | { issue: "faux"; message: string }
  /** Périmé : retaper est inutile, il en faut un neuf. */
  | { issue: "expire"; message: string }
  /** L'un ou l'autre, on ne peut pas trancher : les deux gestes. */
  | { issue: "incertain"; message: string }
  /** Le serveur demande une pause, et il ne dit pas combien de temps. */
  | { issue: "trop_de_tentatives"; message: string }
  /** Tout le reste : ne jamais montrer l'anglais brut. */
  | { issue: "autre"; message: string };

const MESSAGE_FAUX =
  "Ce code n'est pas le bon. Vérifiez les huit chiffres et réessayez.";
const MESSAGE_EXPIRE =
  "Ce code n'est plus valable : un code ne vit qu'une heure. Demandez-en un nouveau.";
const MESSAGE_INCERTAIN =
  "Ce code n'est pas accepté. Il est peut-être mal recopié, ou périmé — un code ne vit qu'une heure. Réessayez, ou demandez-en un nouveau.";
const MESSAGE_TROP =
  "Trop d'essais coup sur coup. Le serveur demande une pause avant de réessayer ; nous ne savons pas combien de temps, alors patientez un moment.";

export function interpreterEchecCode(entree: {
  /** `error.code` du SDK, quand il y en a un. */
  code?: string | null;
  /** `error.message`, seulement pour les cas non répertoriés. */
  message?: string | null;
  /** Quand CE navigateur a demandé le code. `null` s'il ne le sait pas. */
  envoyeLe: number | null;
  maintenant: number;
}): IssueCode {
  const { code, envoyeLe, maintenant } = entree;

  if (code === "over_request_rate_limit" || code === "over_email_send_rate_limit") {
    return { issue: "trop_de_tentatives", message: MESSAGE_TROP };
  }

  // Le serveur refuse une saisie qui n'a pas la forme d'un code avant
  // même de la comparer : c'est toujours une faute de frappe.
  if (code === "validation_failed") {
    return { issue: "faux", message: MESSAGE_FAUX };
  }

  if (code === "otp_expired") {
    if (envoyeLe === null) {
      return { issue: "incertain", message: MESSAGE_INCERTAIN };
    }
    const age = maintenant - envoyeLe;
    if (age >= DUREE_VIE_CODE_MS) {
      return { issue: "expire", message: MESSAGE_EXPIRE };
    }
    return { issue: "faux", message: MESSAGE_FAUX };
  }

  if (code === "user_banned") {
    return {
      issue: "autre",
      message:
        "Ce compte est suspendu. Écrivez à bonjour@oasisrarecare.com pour en connaître la raison.",
    };
  }

  return {
    issue: "autre",
    message:
      "Nous n'avons pas pu vérifier ce code. Réessayez, ou demandez-en un nouveau.",
  };
}

/**
 * L'ÉCHEC D'UNE CONNEXION PAR MOT DE PASSE — UNE SEULE PHRASE, TOUJOURS
 * LA MÊME, ET C'EST TOUT L'ENJEU.
 *
 * ------------------------------------------------------------------
 * POURQUOI L'ÉCRAN NE DOIT JAMAIS DIRE CE QUI A ÉCHOUÉ
 * ------------------------------------------------------------------
 * Répondre « cette adresse n'existe pas » d'un côté et « mot de passe
 * incorrect » de l'autre, c'est offrir à qui veut la liste de nos
 * clients, une adresse à la fois : il suffit d'essayer.
 *
 * Bonne nouvelle : ce n'est pas notre prudence qui tient cette règle,
 * c'est le serveur. La documentation du SDK l'écrit noir sur blanc pour
 * `signInWithPassword` — l'erreur ne distingue pas le compte inexistant
 * du mauvais mot de passe ni du compte purement social. Les trois
 * rendent `invalid_credentials`.
 *
 * ------------------------------------------------------------------
 * LE CAS QUI OBLIGE À PESER CHAQUE MOT : `email_not_confirmed`
 * ------------------------------------------------------------------
 * Là, la personne a tapé le BON mot de passe — son adresse n'est
 * simplement jamais passée par un code. Lui répondre « mot de passe
 * incorrect » serait un mensonge ; lui répondre « votre adresse n'est
 * pas confirmée » serait l'aveu que le compte existe.
 *
 * D'où une phrase qui n'est fausse dans AUCUN des cas — elle ne dit pas
 * ce qui cloche, elle dit ce qu'il reste à faire — et qui mène au seul
 * geste qui débloque les deux : demander un code.
 */
export function messageEchecIdentifiants(code?: string | null): string {
  // LE REFUS QU'IL NE FAUT SURTOUT PAS FONDRE DANS LA PHRASE GÉNÉRIQUE.
  //
  // `captcha_failed` veut dire : le jeton anti-robot manquait, avait
  // déjà servi, ou était périmé. Le mot de passe, lui, n'a même pas été
  // regardé — le contrôle est un intercepteur, il refuse avant le
  // traitement. Répondre « nous ne pouvons pas vous connecter avec ces
  // informations » serait donc un mensonge, et un mensonge coûteux :
  // la personne repart chercher un mot de passe qui n'est pas en cause,
  // retape, se fait refuser encore, et appelle.
  //
  // C'est le seul refus de cette liste qui parle d'AUTRE CHOSE que du
  // compte, et c'est aussi pour cela qu'il ne trahit rien : le serveur
  // le rend à l'identique pour une adresse connue et pour une inconnue.
  if (estRefusDeCaptcha(code)) {
    return MESSAGE_ECHEC_CAPTCHA;
  }
  if (code === "user_banned") {
    return "Ce compte est suspendu. Écrivez à bonjour@oasisrarecare.com pour en connaître la raison.";
  }
  if (code === "over_request_rate_limit") {
    return MESSAGE_TROP;
  }
  // `invalid_credentials`, `email_not_confirmed`, et tout le reste.
  return "Nous ne pouvons pas vous connecter avec ces informations. Si vous n'avez pas encore de mot de passe, ou si vous l'avez oublié, demandez un code par e-mail.";
}

/** L'échec d'un ENVOI de code. Là non plus, rien qui trahisse un compte. */
export function messageEchecEnvoi(code?: string | null): string {
  // Même raisonnement qu'au-dessus : un jeton anti-robot refusé n'a
  // rien à voir avec l'adresse saisie, et « nous n'avons pas pu envoyer
  // le code » enverrait la personne réessayer indéfiniment le même
  // geste avec le même résultat.
  if (estRefusDeCaptcha(code)) {
    return MESSAGE_ECHEC_CAPTCHA;
  }
  if (code === "over_email_send_rate_limit") {
    return "Un code est déjà parti vers cette adresse il y a moins d'une minute. Attendez un instant avant d'en redemander un.";
  }
  if (code === "over_request_rate_limit") {
    return MESSAGE_TROP;
  }
  if (code === "email_address_invalid" || code === "validation_failed") {
    return "Cette adresse e-mail n'a pas une forme valide. Vérifiez-la.";
  }
  return "Nous n'avons pas pu envoyer le code. Réessayez dans un moment.";
}

/** L'échec de l'enregistrement du nouveau mot de passe. */
export function messageEchecMotDePasse(code?: string | null): string {
  if (code === "weak_password") {
    // Le serveur ne rend ce code que si la vérification des mots de
    // passe éventés est activée (`password_hibp_enabled`), ou si la
    // longueur minimale du projet n'est pas atteinte. Le premier cas
    // est le seul contrôle qui protège vraiment : il mérite un vrai
    // message, pas un « erreur ».
    return "Ce mot de passe figure dans des listes de mots de passe volés, ou il est trop court pour le serveur. Choisissez-en un autre.";
  }
  if (code === "same_password") {
    return "C'est déjà votre mot de passe actuel. Vous pouvez continuer sans le changer.";
  }
  if (code === "reauthentication_needed") {
    return "Cette session est trop ancienne pour changer le mot de passe. Demandez un nouveau code, puis recommencez.";
  }
  return "Nous n'avons pas pu enregistrer ce mot de passe. Réessayez.";
}

/* ==================================================================
   LE RETOUR D'UN LIEN DE COURRIEL
   ================================================================== */

/**
 * `/auth/callback` renvoie ici avec `?error=…` quand un lien échoue.
 *
 * Ces messages tombaient jusqu'ici dans le vide : la page ne lisait pas
 * le paramètre, et l'utilisateur revenait sur un écran de connexion
 * vierge qui ne disait rien de ce qui venait d'échouer. C'est réparé —
 * et comme la route peut aussi renvoyer un message anglais du serveur,
 * ce qu'on ne reconnaît pas est remplacé par une phrase générique
 * plutôt qu'affiché tel quel.
 */
export function messageRetourDeLien(brut: string): string {
  const motif = brut.toLowerCase();

  if (motif === "lien_incomplet") {
    return "Ce lien est incomplet — il a sans doute été coupé par votre messagerie. Le plus sûr est le code à huit chiffres du même e-mail.";
  }
  if (motif === "type_de_lien_inconnu") {
    return "Ce lien n'a pas une forme que nous savons lire. Utilisez plutôt le code à huit chiffres du même e-mail.";
  }
  if (motif.includes("expired") || motif.includes("invalid")) {
    return "Ce lien n'est plus valable : il a déjà servi, ou il a plus d'une heure. Demandez un nouveau code ci-dessous.";
  }
  return "La connexion par ce lien n'a pas abouti. Reprenez ci-dessous — le code à huit chiffres fonctionne depuis n'importe quel appareil.";
}

/* ==================================================================
   GOOGLE, APPLE, ET LA QUESTION QU'ON N'A LE DROIT DE POSER QU'APRÈS
   ================================================================== */

/**
 * Ce compte a-t-il une identité « e-mail » ?
 *
 * ------------------------------------------------------------------
 * LA SEULE SOURCE FIABLE, ET LE SEUL MOMENT OÙ ON A LE DROIT DE LIRE
 * ------------------------------------------------------------------
 * `user.identities` porte une ligne par façon d'entrer : `apple`,
 * `google`, `email`. C'est la seule source qui vaille — surtout pas
 * `auth.users.encrypted_password`, qui est un faux ami : le service
 * d'authentification y pose une empreinte aléatoire pour les comptes
 * créés par lien de courriel, si bien que trois des quatre comptes
 * existants portent une empreinte sans avoir de mot de passe
 * utilisable.
 *
 * ET LE MOMENT COMPTE AUTANT QUE LA SOURCE. Cette question ne se pose
 * qu'APRÈS la vérification du code, jamais avant : avant, on n'a qu'une
 * adresse tapée par un inconnu, et toute réponse renseignerait sur
 * l'existence du compte. Après, la personne vient de prouver qu'elle
 * possède l'adresse — lui parler de son propre compte n'apprend rien à
 * personne d'autre.
 *
 * Faux ⇒ compte PUREMENT social. On ne lui propose jamais de mot de
 * passe : ni à l'entrée, ni plus tard, ni dans les réglages. Il entre
 * par Google ou par Apple, et c'est très bien ainsi.
 */
export function aUneIdentiteEmail(
  identities?: { provider?: string | null }[] | null,
): boolean {
  return identities?.some((identite) => identite.provider === "email") ?? false;
}

/* ==================================================================
   LA DESTINATION
   ================================================================== */

/**
 * Une base qui n'existe pas, et qui ne peut pas exister.
 *
 * `.invalid` est réservé par la norme : aucun nom de domaine ne s'y
 * terminera jamais. Résoudre contre elle est donc sans danger, et toute
 * adresse qui parvient à en SORTIR est, par définition, une adresse qui
 * quitte notre site.
 */
const BASE_FICTIVE = "https://oasis.invalid";

/**
 * Un chemin de ce site, et rien d'autre.
 *
 * `proxy.ts` pose `?next=` en renvoyant ici, et il faut y retourner —
 * mais une URL absolue fournie par un tiers ferait de la connexion un
 * tremplin vers n'importe où, depuis un lien reçu par courriel,
 * c'est-à-dire depuis un endroit où l'on clique sans réfléchir.
 *
 * ------------------------------------------------------------------
 * POURQUOI UNE LISTE DE DÉBUTS INTERDITS NE SUFFIT PAS
 * ------------------------------------------------------------------
 * La première version de cette fonction refusait `//`, `/\` et tout ce
 * qui ne commençait pas par `/`. C'ÉTAIT UNE PASSOIRE, et le trou était
 * exploitable :
 *
 *     ?next=/<TABULATION>/ailleurs.example
 *
 * commence bien par une seule barre oblique, donc les trois gardes le
 * laissaient passer. Sauf que le navigateur, lui, RETIRE tabulations et
 * retours à la ligne AVANT d'interpréter l'adresse : ce qu'il exécute
 * est `//ailleurs.example`, c'est-à-dire une adresse absolue vers un
 * autre site. La vérification et l'exécution ne regardaient pas la même
 * chaîne — mesuré dans un vrai navigateur, pas supposé.
 *
 * ON NE VÉRIFIE DONC PLUS LA CHAÎNE : ON LA FAIT LIRE PAR LE MÊME
 * ANALYSEUR QUE CELUI QUI L'EXÉCUTERA. On la résout contre une base
 * fictive ; si le résultat a changé de domaine, c'est qu'elle sortait
 * du site, et on la refuse. Et l'on ne rend pas la chaîne d'origine
 * mais celle que l'analyseur a reconstruite — donc débarrassée de tout
 * caractère invisible.
 *
 * Le même raisonnement vaut pour toute forme qu'on n'a pas prévue :
 * il n'y a plus de liste à tenir à jour.
 */
export function destinationSure(next: string | null | undefined): string {
  if (!next) return "/";
  // Un chemin, jamais un schéma (`https:`, `javascript:`…). L'analyseur
  // le dirait aussi, mais autant écarter tout de suite ce qui n'a même
  // pas la forme attendue.
  if (!next.startsWith("/")) return "/";

  let adresse: URL;
  try {
    adresse = new URL(next, BASE_FICTIVE);
  } catch {
    return "/";
  }

  // Sortie du site : refusée. C'est ici que tombent `//ailleurs`,
  // `/\ailleurs`, et toutes les variantes à caractères invisibles.
  if (adresse.origin !== BASE_FICTIVE) return "/";

  const chemin = `${adresse.pathname}${adresse.search}${adresse.hash}`;
  // Ceinture et bretelles : l'analyseur rend toujours un `pathname` qui
  // commence par une seule barre, mais cette ligne coûte trois mots et
  // ferme la porte si cette garantie changeait un jour.
  if (!chemin.startsWith("/") || chemin.startsWith("//")) return "/";
  return chemin;
}
