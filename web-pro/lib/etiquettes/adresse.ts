/**
 * L'ADRESSE IMPRIMÉE — la seule chose de ce lot qui engage dix ans.
 *
 * ------------------------------------------------------------------
 * LA RÈGLE, ET POURQUOI ELLE EST TENUE ICI
 * ------------------------------------------------------------------
 *
 * UN AUTOCOLLANT COLLÉ SUR UN ARBRE Y RESTE DES ANNÉES. L'adresse qu'il
 * porte ne peut donc pas être une constante dans du code : le jour où
 * elle change, il faudrait décoller les étiquettes une par une.
 *
 * C'est déjà arrivé. Les cinq étiquettes en production portent
 * « oasis-care.example », un domaine de premier niveau RÉSERVÉ par la
 * RFC 2606 : il ne résout pas et ne résoudra jamais. Elles sont mortes
 * pour toute caméra qui n'est pas celle de l'application Oasis Care.
 *
 * D'où deux disciplines, et ce fichier ne sert qu'à les rendre
 * impossibles à contourner :
 *
 *   1. AUCUN DOMAINE N'EST ÉCRIT DANS CETTE BIBLIOTHÈQUE. Cherchez
 *      « oasisrarecare » dans lib/etiquettes : vous ne le trouverez que
 *      dans des commentaires et des fichiers de test. L'adresse de base
 *      arrive en argument, lue par l'appelant dans une variable
 *      d'environnement — sur la discipline de NEXT_PUBLIC_SITE_URL
 *      (lib/billing/stripe.ts : lue, jamais codée en dur, refus
 *      explicite si absente).
 *   2. LE JETON EST OPAQUE ET RÉSOLU PAR LE SERVEUR. C'est ce qui
 *      permet de changer l'adresse un jour SANS RIEN RÉIMPRIMER — à la
 *      seule condition que l'ancien domaine continue de rediriger.
 *
 * ------------------------------------------------------------------
 * CE QUI RESTE À TRANCHER, ET QUI N'EST PAS TECHNIQUE
 * ------------------------------------------------------------------
 *
 * Le § 15 donne l'exemple « oasisrare.app/x/AB98K4 ». Le dirigeant
 * possède oasisrarecare.com et oasisrarecare.fr. Le calcul de densite.ts
 * dit une chose nette et contre-intuitive : LE CHOIX DU DOMAINE NE
 * CHANGE RIEN à la lisibilité du QR, parce que la version d'un QR est
 * un escalier et qu'aucun domaine plausible ne fait descendre une
 * marche avec un jeton de 32 caractères. C'est la LONGUEUR DU JETON qui
 * décide. Le domaine se choisit donc sur des critères de propriété et
 * de stabilité, pas de lisibilité.
 */

/**
 * La forme du jeton posée par la migration 0090 :
 * `encode(gen_random_bytes(16), 'hex')`, et le résolveur refuse tout ce
 * qui n'y ressemble pas (`if v_token !~ '^[0-9a-f]{32}$'`).
 */
export const JETON_0090 = /^[0-9a-f]{32}$/;

/**
 * Ce qu'un jeton d'étiquette a le droit d'être, plus largement : de quoi
 * accepter un futur jeton plus court ou en base32 sans rouvrir ce
 * fichier, mais assez strict pour attraper l'erreur qui coûte cher.
 *
 * NI TIRET NI SOULIGNÉ, ET C'EST VOULU. L'erreur réaliste, celle qu'un
 * test a effectivement attrapée ici, est de passer l'UUID de la plante
 * — « 3f8a1c4e-9b2d-7a60-… » — au lieu du jeton de son étiquette. Un
 * jeu de caractères qui accepte le tiret laisse passer un UUID sans
 * broncher, et on ne s'en aperçoit qu'avec la planche imprimée à la
 * main. Aucun de nos générateurs (hexadécimal aujourd'hui, base32 si le
 * jeton raccourcit un jour) n'a besoin d'un tiret.
 */
const JETON_ACCEPTABLE = /^[A-Za-z0-9]{6,64}$/;

export type OptionsAdresse = {
  /** Le segment de chemin. « x » est celui du § 15. */
  readonly chemin?: string;
};

/**
 * Fabrique l'adresse à encoder dans un QR ou à écrire dans un tag NFC.
 *
 * @param baseUrl l'origine, lue par l'appelant dans son environnement
 *   (par exemple OASIS_ETIQUETTES_BASE_URL). JAMAIS une constante.
 * @param jeton le `public_token` rendu par `etiquette_creer`.
 */
export function adresseEtiquette(baseUrl: string, jeton: string, options: OptionsAdresse = {}): string {
  const base = (baseUrl ?? "").trim();
  if (!base) {
    throw new Error(
      "L'adresse de base des étiquettes est vide. Elle se règle par variable d'environnement " +
        "(OASIS_ETIQUETTES_BASE_URL) et n'est jamais codée en dur : une étiquette imprimée avec une " +
        "mauvaise adresse est une étiquette à décoller.",
    );
  }

  let origine: URL;
  try {
    origine = new URL(base);
  } catch {
    throw new Error(`L'adresse de base des étiquettes n'est pas une URL valide : « ${base} ».`);
  }

  // HTTPS OBLIGATOIRE. Un QR imprimé sur dix ans qui pointe en clair,
  // c'est un jeton lisible par n'importe quel réseau traversé — et
  // aucun navigateur récent n'aime plus ouvrir du http.
  if (origine.protocol !== "https:") {
    throw new Error(
      `L'adresse des étiquettes doit être en https, pas en ${origine.protocol.replace(":", "")} : ` +
        `un jeton d'étiquette voyage en clair sinon, et pendant des années.`,
    );
  }

  // LE DOMAINE RÉSERVÉ DE LA RFC 2606, refusé explicitement. C'est
  // exactement l'erreur qui a tué les cinq étiquettes déjà collées ;
  // qu'elle ne puisse pas se reproduire vaut bien quatre lignes.
  const nom = origine.hostname.toLowerCase();
  if (
    nom === "example" ||
    nom.endsWith(".example") ||
    nom.endsWith(".invalid") ||
    nom.endsWith(".test") ||
    nom.endsWith(".localhost")
  ) {
    throw new Error(
      `« ${origine.hostname} » est un domaine réservé par la RFC 2606 : il ne résout pas et ne résoudra ` +
        `jamais. Une étiquette imprimée avec cette adresse est morte le jour où on la colle.`,
    );
  }

  const chemin = (options.chemin ?? "x").replace(/^\/+|\/+$/g, "");
  if (!/^[A-Za-z0-9_-]{1,16}$/.test(chemin)) {
    throw new Error(`Le segment de chemin « ${chemin} » n'est pas utilisable dans une adresse d'étiquette.`);
  }

  const propre = (jeton ?? "").trim();
  if (!JETON_ACCEPTABLE.test(propre)) {
    throw new Error(
      `« ${propre} » n'a pas la forme d'un jeton d'étiquette. Le jeton vient de etiquette_creer() ; ` +
        `un identifiant d'élément à sa place enverrait le scanneur nulle part, et le tirage papier avec.`,
    );
  }

  // On reconstruit l'origine à la main plutôt que d'utiliser `new URL()`
  // : une base terminée par un chemin (« https://x.fr/app/ ») donnerait
  // sinon un résultat surprenant, et un caractère de trop dans un QR se
  // paye en modules.
  return `${origine.origin}/${chemin}/${propre}`;
}

/**
 * Les adresses d'une liste de jetons, dans l'ordre.
 * C'est la porte d'entrée du § 16 : « générer les QR d'un lot, d'un
 * jardin, d'une zone, d'un rack, d'une sélection ». Ce que ces cinq
 * gestes ont en commun, c'est qu'ils rendent une LISTE DE JETONS —
 * `etiquettes_creer_lot()` s'en charge côté base. Ici, on n'en fait que
 * des adresses.
 */
export function adressesEtiquettes(
  baseUrl: string,
  jetons: readonly string[],
  options: OptionsAdresse = {},
): string[] {
  return jetons.map((jeton) => adresseEtiquette(baseUrl, jeton, options));
}
