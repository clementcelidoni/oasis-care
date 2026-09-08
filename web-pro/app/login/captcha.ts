/**
 * ══════════════════════════════════════════════════════════════════
 * LA VÉRIFICATION ANTI-ROBOT, SANS ÉCRAN ET SANS RÉSEAU
 * ══════════════════════════════════════════════════════════════════
 *
 * Ce fichier ne charge rien, n'affiche rien et n'appelle personne. Il
 * ne contient que des CONSTANTES et des DÉCISIONS : quelle clé
 * employer, combien de temps attendre, et surtout — que dit-on à la
 * personne selon l'état du widget. Tout le reste est dans
 * `Turnstile.tsx`, qui parle au navigateur.
 *
 * Pourquoi cette séparation. Un widget ne se teste pas : il exige un
 * navigateur, un réseau, et un serveur de Cloudflare qui répond. Les
 * décisions, elles, se testent en une milliseconde et sans rien
 * simuler — c'est la même discipline que `parcours.ts`, et c'est ce
 * qui rend le cas « le widget ne se charge jamais » vérifiable : c'est
 * un simple argument passé à une fonction.
 *
 * ------------------------------------------------------------------
 * POURQUOI UN CAPTCHA, ET CE QU'IL RÉPARE VRAIMENT
 * ------------------------------------------------------------------
 * Deux défauts qu'AUCUNE ligne d'écran ne peut corriger :
 *
 * 1. ON DEVINE QUI EST CLIENT EN CHRONOMÉTRANT. Le serveur
 *    d'authentification ne calcule l'empreinte du mot de passe que
 *    s'il a trouvé un compte : une adresse connue répond en deux fois
 *    plus de temps qu'une inconnue. Mesuré sur la production, sans le
 *    moindre recouvrement entre les séries. L'écart est chez Supabase,
 *    pas chez nous.
 *
 * 2. N'IMPORTE QUI PEUT FAIRE EXPÉDIER UN COURRIEL À N'IMPORTE QUELLE
 *    ADRESSE. C'est la contrepartie assumée du fait qu'inscription et
 *    connexion soient le même chemin : un formulaire public déclenche
 *    un envoi. Une machine peut donc se servir de notre domaine pour
 *    arroser des inconnus — et c'est la réputation d'envoi de TOUT le
 *    parc qui tombe, codes de connexion des clients qui paient compris.
 *
 * Le CAPTCHA agit sur les deux parce qu'il coupe le VOLUME : sans
 * volume, un oracle de chronométrage ne se moissonne plus, et un
 * formulaire d'envoi ne s'automatise plus. Il ne supprime ni l'un ni
 * l'autre — il les rend trop chers.
 *
 * ------------------------------------------------------------------
 * L'ORDRE DE MISE EN SERVICE, ET IL N'EST PAS NÉGOCIABLE
 * ------------------------------------------------------------------
 * Le réglage du CAPTCHA chez Supabase est GLOBAL : il n'existe pas de
 * « CAPTCHA pour le web seulement ». Dès qu'il est activé, TOUT client
 * qui n'envoie pas de jeton est refusé, y compris l'application iPhone
 * déjà installée sur les téléphones.
 *
 *   a. les trois portes envoient le jeton (web-pro, web-admin, iPhone) ;
 *   b. une nouvelle version iPhone part sur TestFlight ET EST INSTALLÉE ;
 *   c. ALORS SEULEMENT le réglage est activé chez Supabase.
 *
 * Inverser (b) et (c) verrouille dehors tous les téléphones du parc,
 * sans message d'erreur compréhensible.
 *
 * C'est cet ordre qui explique la forme du code : tant qu'aucune clé de
 * site n'est configurée, ce module rend une chaîne vide, aucun widget
 * n'est monté, aucun jeton n'est joint, et l'écran se comporte
 * EXACTEMENT comme avant. Et une fois la clé posée mais le réglage
 * encore éteint, le jeton part et le serveur l'ignore. Les deux étapes
 * intermédiaires sont donc inoffensives, par construction.
 *
 * ------------------------------------------------------------------
 * CE FICHIER EXISTE EN DOUBLE
 * ------------------------------------------------------------------
 * `web-admin/app/login/captcha.ts` en est le jumeau, pour la même
 * raison que `parcours.ts` : deux projets Next distincts, aucun paquet
 * partagé où poser un module commun. Toute correction faite ici est à
 * reporter là-bas, et l'inverse.
 */

/* ==================================================================
   LE FOURNISSEUR : CLOUDFLARE TURNSTILE
   ================================================================== */

/**
 * Supabase accepte hCaptcha ou Turnstile. C'est Turnstile, et les trois
 * raisons valent d'être écrites une fois pour toutes :
 *
 *   • GRATUIT SANS PLAFOND. Les offres gratuites concurrentes
 *     plafonnent, et un plafond atteint est une porte d'entrée fermée.
 *   • UN MODE « GÉRÉ » SANS ÉNIGME. L'immense majorité des visiteurs ne
 *     voit rien du tout : une case qui se coche toute seule. Un
 *     paysagiste qui se connecte depuis son camion n'a pas à désigner
 *     des feux tricolores.
 *   • AUCUN TRACEUR PUBLICITAIRE, ce qui compte pour un produit
 *     européen.
 *
 * `render=explicit` : nous montons le widget nous-mêmes, au moment et
 * à l'endroit choisis. Sans ce paramètre, le script cherche des
 * éléments `.cf-turnstile` dans la page et les rend tout seul — donc
 * sans que nous sachions quand il a fini, ni comment le réarmer.
 */
export const URL_SCRIPT_TURNSTILE =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

/**
 * Le nom que Cloudflare verra dans ses statistiques. Purement
 * descriptif : il ne change rien au verdict.
 */
export const ACTION_CAPTCHA = "connexion";

/* ==================================================================
   LES DEUX CLÉS, ET ELLES N'ONT PAS LE MÊME STATUT
   ================================================================== */

/**
 * LA CLÉ DE SITE EST PUBLIQUE. Elle vit dans le JavaScript envoyé à
 * chaque visiteur : c'est normal, elle est faite pour être vue. Elle ne
 * prouve rien à elle seule — c'est la clé SECRÈTE, posée par le
 * dirigeant dans le tableau de bord Supabase, qui vérifie le jeton
 * côté serveur. Cette clé secrète n'apparaît nulle part dans le dépôt,
 * ni dans un `.env`, ni dans une conversation.
 *
 * Elle n'est pas écrite en dur pour autant : une clé de site est liée à
 * une LISTE DE DOMAINES, et le développement local, la pré-production
 * et la production n'ont pas les mêmes.
 *
 * UNE VARIABLE `NEXT_PUBLIC_` EST FIGÉE À LA COMPILATION. En changer la
 * valeur impose une reconstruction ET un redéploiement — pas un simple
 * redémarrage. C'est écrit, avec le reste de la marche à suivre, dans
 * `docs/captcha-mise-en-service.md`.
 */
export function cleDeSite(brut?: string | null): string {
  return (brut ?? "").trim();
}

/**
 * La clé effectivement configurée, ou une chaîne vide.
 *
 * `process.env.NEXT_PUBLIC_…` doit être écrit LITTÉRALEMENT ici : Next
 * remplace le texte exact au moment de la compilation. Passer par une
 * variable intermédiaire rendrait `undefined` dans le navigateur.
 *
 * CHAÎNE VIDE = PAS DE CAPTCHA. Aucun widget n'est monté, aucun jeton
 * n'est joint. C'est le comportement voulu en développement local et
 * tant que la clé n'est pas déployée : cet écran doit rester utilisable
 * sans que qui que ce soit ait à toucher à Cloudflare.
 */
export function cleDeSiteTurnstile(): string {
  return cleDeSite(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY);
}

/* ==================================================================
   LES DÉLAIS
   ================================================================== */

/**
 * Combien de temps on laisse au script de Cloudflare pour arriver.
 *
 * Passé ce délai on ne l'attend plus et on le DIT. Sans cette limite,
 * un réseau d'entreprise qui laisse la requête pendre indéfiniment
 * produit un bouton qui tourne pour toujours — l'exact contraire de ce
 * qu'on cherche.
 */
export const DELAI_CHARGEMENT_MS = 12_000;

/**
 * Combien de temps un appel attend son jeton avant de partir sans lui.
 *
 * Le cas courant est de l'ordre de la seconde : le widget se résout
 * pendant que la personne tape son mot de passe, et le jeton est déjà
 * là au moment du clic. Ce délai ne sert qu'aux réseaux lents.
 */
export const DELAI_JETON_MS = 20_000;

/**
 * La rallonge accordée quand une ÉNIGME est affichée.
 *
 * Là, ce n'est plus le réseau qu'on attend, c'est une personne en train
 * de cliquer sur des images. Vingt secondes seraient une insulte ; deux
 * minutes et demie laissent finir sans jamais bloquer pour toujours.
 */
export const DELAI_DEFI_MS = 150_000;

/** Le pas du guet pendant l'attente. Assez court pour ne pas se voir. */
export const INTERVALLE_ATTENTE_MS = 150;

/* ==================================================================
   L'ÉTAT DU WIDGET, ET CE QU'ON EN DIT
   ================================================================== */

/**
 * Les cinq états possibles, et pas un de plus.
 *
 *   inactif       aucune clé de site : le CAPTCHA n'existe pas ici.
 *   chargement    le script arrive, ou le widget travaille.
 *   pret          un jeton est en main, prêt à partir.
 *   defi          une énigme est affichée : la personne doit agir.
 *   indisponible  le script n'est jamais arrivé, ou le widget a renoncé.
 */
export type EtatCaptcha =
  | "inactif"
  | "chargement"
  | "pret"
  | "defi"
  | "indisponible";

export type VerdictCaptcha = {
  /** Ce qu'on affiche. `null` : on se tait, et c'est le cas courant. */
  message: string | null;
  /** Faut-il offrir un bouton qui relance le widget ? */
  reessayable: boolean;
};

/**
 * LE MESSAGE DE L'ÉNIGME.
 *
 * Il ne décrit pas l'énigme — Cloudflare s'en charge, dans la langue du
 * navigateur — il dit OÙ ELLE EST. C'est tout l'enjeu : le widget est
 * posé en bas de la carte pour ne rien recouvrir, et quelqu'un qui
 * vient de cliquer sur « Se connecter » regarde son bouton, pas le bas
 * de l'écran.
 */
const MESSAGE_DEFI =
  "Une vérification anti-robot s'affiche juste en dessous. Validez-la pour continuer.";

/**
 * LE MESSAGE QUE TOUT LE MONDE OUBLIE D'ÉCRIRE, ET QUI PRODUIT LES
 * APPELS AU SUPPORT.
 *
 * Le widget NE SE CHARGERA PAS parfois, et ce n'est pas une hypothèse :
 * réseau coupé, bloqueur de publicité un peu zélé, réseau d'entreprise
 * qui filtre Cloudflare. Sans cette phrase, la personne a devant elle
 * un formulaire d'apparence normale qui refuse de la laisser entrer
 * sans jamais dire pourquoi.
 *
 * Trois choses y sont, et les trois comptent :
 *   • CE QUI MANQUE, nommé (une vérification, fournie par Cloudflare) ;
 *   • POURQUOI, avec les causes réelles et non « une erreur est
 *     survenue » ;
 *   • QUOI FAIRE, dans l'ordre du moins coûteux au plus coûteux.
 *
 * Et le bouton « Réessayer » qui l'accompagne n'est pas décoratif : la
 * cause la plus fréquente est passagère.
 */
const MESSAGE_INDISPONIBLE =
  "La vérification anti-robot n'a pas pu se charger. Elle est fournie par Cloudflare : une coupure de connexion, un bloqueur de publicités ou un réseau d'entreprise qui filtre suffisent à l'empêcher. Réessayez ci-dessous — sinon, changez de réseau ou de navigateur.";

/**
 * CE QUE LE SERVEUR RÉPOND QUAND LE JETON MANQUE, EST REJOUÉ OU EST
 * PÉRIMÉ — et pourquoi cette phrase-là est la plus importante du
 * chantier.
 *
 * Sans elle, `captcha_failed` tombe dans la branche par défaut de
 * `messageEchecIdentifiants` : « Nous ne pouvons pas vous connecter
 * avec ces informations. » C'est un MENSONGE. La personne a tapé le
 * bon mot de passe ; on l'envoie en chercher un autre, elle retape, se
 * fait refuser encore, et finit par appeler. L'échec le plus coûteux
 * de cette intégration est silencieux, et il se répare par une chaîne
 * de caractères.
 *
 * La phrase dit d'attendre parce que c'est vrai : le widget se réarme
 * tout seul dès qu'il a cédé son jeton, et le suivant arrive en une à
 * deux secondes.
 */
export const MESSAGE_ECHEC_CAPTCHA =
  "La vérification anti-robot n'a pas abouti — votre mot de passe n'est pas en cause. Elle se refait toute seule : patientez deux secondes, puis réessayez. Si ce message revient, un bloqueur ou votre réseau empêche Cloudflare de se charger.";

/**
 * Le code que rend le serveur d'authentification quand sa vérification
 * du jeton échoue. Un seul, et il couvre les trois cas : jeton absent,
 * jeton déjà dépensé, jeton périmé. Le serveur ne les distingue pas —
 * et c'est pourquoi le message ci-dessus ne les distingue pas non plus.
 */
export function estRefusDeCaptcha(code?: string | null): boolean {
  return code === "captcha_failed";
}

/**
 * CE QU'ON AFFICHE, ÉTAT PAR ÉTAT. La fonction entière du chantier
 * tient ici, et elle se teste sans navigateur.
 *
 * LA RÈGLE, C'EST LE SILENCE. Trois états sur cinq ne disent rien :
 *   • `inactif`     — il n'y a rien à dire, le CAPTCHA n'existe pas ;
 *   • `chargement`  — annoncer une attente d'une seconde la rend
 *                     visible alors qu'elle ne l'était pas ;
 *   • `pret`        — « vérification réussie » est du bruit : personne
 *                     n'a rien demandé, et personne n'a rien à en faire.
 *
 * On ne parle que dans les deux cas où la personne DOIT agir.
 */
export function verdictCaptcha(etat: EtatCaptcha): VerdictCaptcha {
  if (etat === "defi") {
    return { message: MESSAGE_DEFI, reessayable: false };
  }
  if (etat === "indisponible") {
    return { message: MESSAGE_INDISPONIBLE, reessayable: true };
  }
  return { message: null, reessayable: false };
}

/**
 * FAUT-IL EMPÊCHER LA PERSONNE DE CONTINUER ? NON. JAMAIS.
 *
 * C'est la décision la plus discutable du chantier, alors elle est
 * écrite noir sur blanc plutôt que cachée dans une absence de code.
 *
 * Quand le widget est indisponible, deux conduites étaient possibles :
 *
 *   A. ÉTEINDRE LE BOUTON. Cohérent — sans jeton, le serveur refusera.
 *      Mais quelqu'un dont le réseau filtre Cloudflare se retrouve
 *      enfermé dehors de son propre logiciel, y compris pendant toute
 *      la période où le réglage Supabase n'est PAS encore activé et où
 *      sa connexion aurait parfaitement fonctionné. On lui interdirait
 *      d'entrer au nom d'un contrôle qui n'existe pas encore.
 *
 *   B. LAISSER PARTIR L'APPEL SANS JETON. Si le réglage est éteint, la
 *      personne entre normalement — rien n'a changé pour elle. S'il est
 *      allumé, le serveur répond `captcha_failed`, et cette réponse est
 *      traduite par `MESSAGE_ECHEC_CAPTCHA`, c'est-à-dire par le MÊME
 *      diagnostic et le MÊME geste que le bouton éteint aurait
 *      affichés. Coût : un aller-retour réseau perdu.
 *
 * B est retenue. Elle n'est jamais plus fermée que A, elle dit la même
 * chose, et surtout elle préserve la propriété sur laquelle repose tout
 * le déploiement en trois temps : DÉPLOYER LA CLÉ NE FERME AUCUNE
 * PORTE. Tant que le dirigeant n'a pas activé le réglage, ce chantier
 * est rigoureusement inoffensif.
 *
 * Cette fonction existe pour que la règle soit testée, et non seulement
 * commentée.
 */
export function peutContinuerSansJeton(etat: EtatCaptcha): boolean {
  // `etat` n'est pas lu, et c'est précisément ce qu'affirme la
  // fonction : aucun état du widget ne ferme la porte. Le paramètre
  // reste là pour que le test parcoure les cinq et le prouve.
  void etat;
  return true;
}
