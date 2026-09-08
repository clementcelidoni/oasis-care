/**
 * ══════════════════════════════════════════════════════════════════
 * LE PARCOURS D'ENTRÉE DU CONTROL CENTER, SANS ÉCRAN ET SANS RÉSEAU
 * ══════════════════════════════════════════════════════════════════
 *
 * Tout ce que la page de connexion DÉCIDE est ici : la règle du mot de
 * passe, la traduction des refus du serveur, ce qu'on a le droit de
 * dire et à quel moment. La page ne fait qu'afficher et appeler
 * Supabase.
 *
 * Pourquoi séparer. Ces décisions sont exactement ce qui peut se
 * tromper sans que rien ne casse : un message qui en dit trop, une
 * règle qui refuse ce qu'elle devrait accepter. Un fichier sans React
 * et sans réseau se teste en entier, sans navigateur — voir
 * `parcours.test.ts`.
 *
 * ------------------------------------------------------------------
 * CE FICHIER EST LE JUMEAU DE CELUI D'OASIS CARE PRO
 * ------------------------------------------------------------------
 * `web-pro/app/login/parcours.ts` porte la même logique. Les deux
 * applications sont deux projets Next distincts, sans paquet partagé :
 * il n'y a aujourd'hui aucun endroit où poser un module commun. La
 * copie est assumée, et les deux fichiers ne sont pas identiques —
 * TROIS DIFFÉRENCES DE FOND, toutes justifiées ici :
 *
 *   1. Le Control Center NE CRÉE JAMAIS DE COMPTE. Il demande donc ses
 *      codes avec `shouldCreateUser: false`, ce qui fait apparaître un
 *      refus — `otp_disabled` — qui n'existe pas côté Pro et qu'il faut
 *      absolument taire (voir `envoiDoitResterMuet`).
 *   2. Il ne transporte aucun `next` : une seule porte, une seule
 *      destination. Pas de `destinationSure` ici.
 *   3. Il possède un SECOND FACTEUR, qui réclame lui aussi un code.
 *      Les deux codes doivent être impossibles à confondre.
 */

import { estRefusDeCaptcha, MESSAGE_ECHEC_CAPTCHA } from "./captcha.ts";

/* ==================================================================
   LES NOMBRES QUI VIENNENT DU SERVEUR, ET NON DE NOUS
   ================================================================== */

/**
 * Huit chiffres — `mailer_otp_length = 8` dans la configuration du
 * projet.
 *
 * C'EST LA DIFFÉRENCE QUI ÉVITE LA CONFUSION LA PLUS GRAVE DE CET
 * ÉCRAN, et elle est gratuite :
 *
 *   code d'ENTRÉE         → 8 chiffres, reçu par e-mail, valable 1 heure
 *   code de SECOND FACTEUR → 6 chiffres, lu dans une application, 30 s
 *
 * Un administrateur peut voir les deux à trois écrans d'intervalle. S'il
 * s'agissait de deux champs de six chiffres, personne ne saurait lequel
 * est lequel. Ne pas ramener `mailer_otp_length` à 6 : le réglage actuel
 * rend le service.
 */
export const LONGUEUR_CODE = 8;

/** Six chiffres, toujours, pour le TOTP. Sert uniquement à l'écrire. */
export const LONGUEUR_CODE_SECOND_FACTEUR = 6;

/**
 * Une heure — `mailer_otp_exp = 3600`.
 *
 * Sert uniquement à choisir le BON MOT quand un code est refusé (voir
 * `interpreterEchecCode`). Si le réglage change sans qu'on touche à
 * cette ligne, le pire est un message qui dit « vérifiez les chiffres »
 * là où il aurait dû dire « demandez-en un nouveau » — et les deux
 * gestes restent offerts à l'écran de toute façon.
 */
export const DUREE_VIE_CODE_MS = 3600 * 1000;

/**
 * Soixante secondes entre deux envois — `smtp_max_frequency = 60`.
 *
 * Le bouton « renvoyer » reste éteint une minute. Ce n'est pas un
 * garde-fou de sécurité (le serveur tient le sien, et il est le seul
 * qui compte) : c'est pour ne pas offrir un bouton qui refuse.
 */
export const DELAI_RENVOI_S = 60;

/**
 * Douze caractères minimum, et rien d'autre.
 *
 * LA LONGUEUR PRIME SUR LA COMPOSITION. Exiger une majuscule, un
 * chiffre et un symbole produit « Paysage1! » : court, devinable, et
 * recopié sur un carnet. Douze caractères libres laissent écrire une
 * phrase, qui se retient sans carnet.
 *
 * Le serveur n'exige que six (`password_min_length = 6`). C'est donc
 * NOUS qui montons la barre — et c'est pourquoi la règle est affichée
 * AVANT la saisie, non après un refus.
 */
export const LONGUEUR_MOT_DE_PASSE = 12;

/* ==================================================================
   LE CODE : NETTOYAGE ET COMPLÉTUDE
   ================================================================== */

/**
 * Ne garde que les chiffres, et pas plus qu'il n'en faut.
 *
 * C'est ce qui fait marcher le COLLAGE. Personne ne colle huit chiffres
 * nus : on colle « 12 34 56 78 », « Code : 12345678 », ou la ligne
 * entière du courriel avec un espace insécable au bout.
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

/** La phrase affichée AVANT la saisie, jamais après le refus. */
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
 *    message d'erreur finit dans un journal ou une capture d'écran.
 *
 * 2. On ne rogne PAS les espaces. `trim()` semble aimable et ne l'est
 *    pas : quelqu'un dont la phrase finit par un espace verrait ses
 *    deux saisies acceptées ici et son mot de passe refusé demain.
 *
 * La comparaison des deux champs est un CONFORT, pas une sécurité :
 * elle attrape une faute de frappe. Le serveur n'en reçoit qu'une.
 */
export function verifierNouveauMotDePasse(
  premier: string,
  second: string,
): VerdictMotDePasse {
  // On compte les points de code et non les unités UTF-16 : un émoji
  // vaut un caractère, comme l'utilisateur le voit.
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
        manque === 1 ? "Il manque un caractère." : `Il manque ${manque} caractères.`,
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
 * La liste exhaustive des codes d'erreur de Supabase contient
 * `otp_expired` et RIEN qui ressemble à « otp_invalid ». Un code faux
 * et un code périmé rendent donc la MÊME erreur, avec le même message
 * anglais : « Token has expired or is invalid ».
 *
 * On refuse pourtant de s'en tenir à une phrase vague, parce que les
 * deux gestes diffèrent : dans un cas on retape, dans l'autre retaper
 * ne servira jamais à rien.
 *
 * LA SORTIE HONNÊTE : ON N'INVENTE RIEN, ON SE SERT DE CE QU'ON SAIT.
 * Quand c'est CE navigateur qui a demandé le code, il connaît l'heure
 * de départ. Un code parti il y a deux minutes ne peut pas être
 * périmé — il est donc mal recopié. Un code parti il y a deux heures ne
 * peut plus être bon — retaper est inutile. Et quand on ne sait pas
 * (onglet rechargé), on le dit et on offre les deux gestes.
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
    if (maintenant - envoyeLe >= DUREE_VIE_CODE_MS) {
      return { issue: "expire", message: MESSAGE_EXPIRE };
    }
    return { issue: "faux", message: MESSAGE_FAUX };
  }

  return {
    issue: "autre",
    message:
      "Nous n'avons pas pu vérifier ce code. Réessayez, ou demandez-en un nouveau.",
  };
}

/**
 * L'ÉCHEC D'UNE CONNEXION PAR MOT DE PASSE — UNE SEULE PHRASE, TOUJOURS
 * LA MÊME.
 *
 * ------------------------------------------------------------------
 * POURQUOI L'ÉCRAN NE DOIT JAMAIS DIRE CE QUI A ÉCHOUÉ
 * ------------------------------------------------------------------
 * Ici plus qu'ailleurs : répondre différemment selon l'adresse
 * offrirait à qui veut la LISTE DE L'ÉQUIPE QUI EXPLOITE LA
 * PLATEFORME, une adresse à la fois. C'est déjà la règle affichée en
 * tête de la page depuis le premier jour.
 *
 * Bonne nouvelle : ce n'est pas notre prudence qui la tient, c'est le
 * serveur. La documentation du SDK l'écrit pour `signInWithPassword` —
 * compte inexistant, mauvais mot de passe et compte purement social
 * rendent tous les trois `invalid_credentials`.
 *
 * ------------------------------------------------------------------
 * LE CAS QUI OBLIGE À PESER CHAQUE MOT : `email_not_confirmed`
 * ------------------------------------------------------------------
 * Là, la personne a tapé le BON mot de passe — son adresse n'est
 * simplement jamais passée par un code. « Mot de passe incorrect »
 * serait un mensonge ; « adresse non confirmée » serait l'aveu que le
 * compte existe. D'où une phrase qui n'est fausse dans aucun des cas,
 * et qui mène au seul geste qui débloque les deux.
 */
export function messageEchecIdentifiants(code?: string | null): string {
  // LE REFUS QU'IL NE FAUT SURTOUT PAS FONDRE DANS LA PHRASE UNIQUE.
  //
  // `captcha_failed` veut dire : le jeton anti-robot manquait, avait
  // déjà servi, ou était périmé. Le mot de passe, lui, n'a même pas été
  // regardé — le contrôle est un intercepteur, il refuse avant le
  // traitement. Répondre « nous ne pouvons pas vous connecter avec ces
  // informations » serait donc un mensonge, et un mensonge coûteux :
  // la personne repart chercher un mot de passe qui n'est pas en cause.
  //
  // ET IL NE TRAHIT RIEN, ce qui est la question qu'on se pose pour
  // chaque exception de cette fonction : le contrôle s'exécute AVANT
  // que le serveur ne cherche le compte. Il rend donc exactement la
  // même réponse pour une adresse d'administrateur et pour une adresse
  // inconnue. C'est le seul refus de cette liste qui parle d'autre
  // chose que du compte — et c'est pour cela qu'il peut être dit.
  if (estRefusDeCaptcha(code)) {
    return MESSAGE_ECHEC_CAPTCHA;
  }
  if (code === "over_request_rate_limit") {
    return MESSAGE_TROP;
  }
  // `invalid_credentials`, `email_not_confirmed`, `user_banned`, et
  // tout le reste : une seule et même phrase. Même la suspension d'un
  // compte est une information qu'on ne donne pas ici — elle dirait que
  // le compte existe.
  return "Nous ne pouvons pas vous connecter avec ces informations. Si vous n'avez pas encore de mot de passe, ou si vous l'avez oublié, demandez un code par e-mail.";
}

/**
 * LA FUITE QUE CETTE FONCTION BOUCHE, ET ELLE ÉTAIT BIEN RÉELLE.
 *
 * Le Control Center demande ses codes avec `shouldCreateUser: false` —
 * il le doit : sans cela, taper n'importe quelle adresse créerait un
 * compte de plus dans la vraie base de production. Mais le service
 * d'authentification refuse alors une adresse INCONNUE avec le code
 * `otp_disabled`.
 *
 * L'ancienne page affichait ce refus tel quel. Résultat, visible à
 * l'œil nu et sans aucun outil :
 *   adresse connue   → panneau calme « code envoyé, s'il y a lieu »
 *   adresse inconnue → bandeau rouge
 * Le panneau prudent était là, et le chemin d'erreur le contournait.
 * Toute la précaution de l'en-tête de la page tombait sur cette ligne.
 *
 * Ces deux refus doivent donc être TUS : l'écran continue comme si le
 * code était parti, et affiche exactement la même chose que pour une
 * adresse connue. Celui qui n'a pas de compte attendra un code qui
 * n'arrivera pas — c'est le prix, et il est bien moindre que celui de
 * publier la liste des administrateurs.
 *
 * ------------------------------------------------------------------
 * LA TROISIÈME FUITE, CELLE QU'ON N'AVAIT PAS VUE
 * ------------------------------------------------------------------
 * `over_email_send_rate_limit` est un refus qui, à première vue, ne
 * parle pas du compte : « un courriel est déjà parti il y a moins d'une
 * minute ». Sauf qu'il n'est ATTEIGNABLE QUE SI UN COURRIEL EST
 * RÉELLEMENT PARTI — donc uniquement pour une adresse qui a un compte.
 *
 * Mesuré sur la production : la même adresse inconnue, demandée deux
 * fois de suite sans attendre, rend `otp_disabled` les deux fois et
 * JAMAIS le plafond. Le service cherche l'utilisateur et refuse AVANT
 * de regarder la fréquence d'envoi. D'où, mécaniquement :
 *
 *   adresse inconnue → silence, indéfiniment
 *   adresse connue   → deuxième clic en moins d'une minute → bandeau
 *
 * Deux clics suffisaient donc à savoir qui est administrateur. Ce refus
 * rejoint les deux autres : il est tu, et l'écran affiche le même
 * panneau calme. Il n'y a rien à y perdre — la page tient déjà son
 * propre décompte d'une minute, et c'est lui qui informe la personne.
 */
export function envoiDoitResterMuet(code?: string | null): boolean {
  return (
    code === "otp_disabled" ||
    code === "signup_disabled" ||
    code === "over_email_send_rate_limit"
  );
}

/**
 * L'échec d'un ENVOI de code, une fois écartés les refus qu'on tait.
 *
 * Rien ici ne doit dépendre de l'existence du compte : seule la forme
 * de l'adresse et les plafonds globaux sont mentionnés, et aucun des
 * deux ne dit qui est administrateur.
 *
 * `over_email_send_rate_limit` N'ARRIVE PLUS JUSQU'ICI : il est tu en
 * amont (`envoiDoitResterMuet`), parce qu'il n'existe que pour une
 * adresse qui a un compte. La branche est conservée par prudence — si
 * quelqu'un le retirait de la liste des refus tus, mieux vaut une
 * phrase qui ne suppose rien qu'une phrase qui parle « de cette
 * adresse ».
 */
export function messageEchecEnvoi(code?: string | null): string {
  // Même raisonnement qu'au-dessus : un jeton anti-robot refusé n'a
  // rien à voir avec l'adresse saisie, et « nous n'avons pas pu envoyer
  // le code » enverrait la personne réessayer indéfiniment le même
  // geste avec le même résultat.
  //
  // ET IL NE DOIT SURTOUT PAS REJOINDRE `envoiDoitResterMuet`. Taire ce
  // refus-là afficherait le panneau calme « un code vient d'être
  // envoyé, s'il y a lieu » alors que RIEN n'est parti, pour une
  // adresse dont le compte existe bel et bien. On attendrait un
  // courriel qui ne viendrait jamais. Le taire ne cacherait d'ailleurs
  // rien : le contrôle s'exécute avant la recherche du compte, sa
  // réponse est la même pour tout le monde.
  if (estRefusDeCaptcha(code)) {
    return MESSAGE_ECHEC_CAPTCHA;
  }
  if (code === "over_email_send_rate_limit") {
    return "Patientez une minute avant de redemander un code.";
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
    // est le seul contrôle qui protège vraiment.
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
 * La page ne lisait pas ce paramètre : l'utilisateur revenait sur un
 * écran vierge qui ne disait rien de ce qui venait d'échouer.
 *
 * Ce qu'on ne reconnaît pas est remplacé par une phrase générique
 * plutôt qu'affiché tel quel — la route peut renvoyer un message
 * anglais du serveur.
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
   GOOGLE, ET LA QUESTION QU'ON N'A LE DROIT DE POSER QU'APRÈS
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
 * possède l'adresse.
 *
 * Faux ⇒ compte PUREMENT social. On ne lui propose jamais de mot de
 * passe : ni à l'entrée, ni plus tard, ni dans les réglages.
 */
export function aUneIdentiteEmail(
  identities?: { provider?: string | null }[] | null,
): boolean {
  return identities?.some((identite) => identite.provider === "email") ?? false;
}
