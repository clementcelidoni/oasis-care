/**
 * PRÉSENCE APPLICATIVE — LE CONTRAT, CÔTÉ WEB PRO.
 *
 * ============================================================
 * POURQUOI CE MODULE EXISTE
 * ============================================================
 *
 * Le Control Center doit afficher « Oasis Care Mobile : N utilisateurs ».
 * La migration 0077 (`supabase/migrations/0077_presence_applicative.sql`)
 * a posé la moitié iPhone : une table `mobile_app_installations` et une
 * fonction `declare_mobile_presence` par laquelle l'application
 * s'annonce elle-même.
 *
 * Ce module est L'AUTRE MOITIÉ, et elle n'est pas décorative : sans
 * elle, « Mobile » ne veut rien dire faute de contraire. Un compte qui
 * n'a jamais déclaré de présence iPhone est-il un utilisateur web, ou un
 * utilisateur iPhone qui n'a pas encore basculé sur la version qui
 * s'annonce ? Tant que le web ne se déclare pas, la question n'a pas de
 * réponse, et les deux chiffres restent des bornes inférieures qu'on ne
 * peut même pas comparer.
 *
 * ============================================================
 * CE QU'ON COLLECTE, ET RIEN D'AUTRE
 * ============================================================
 *
 * Même cadrage que 0077, à la lettre. C'est de la DONNÉE PERSONNELLE :
 *
 *   • plateforme ('web'), version de l'application, révision de build
 *     quand elle existe, dernière présence, et un identifiant
 *     d'INSTALLATION tiré au sort et rangé dans le navigateur.
 *   • PAS d'adresse IP, PAS de position, PAS de `user-agent`, PAS de
 *     nom de navigateur, PAS de version de système. Et surtout AUCUNE
 *     empreinte : ni résolution d'écran, ni liste de polices, ni canvas,
 *     ni `hardwareConcurrency`, ni fuseau horaire. On identifie une
 *     INSTALLATION parce qu'elle a accepté de porter un jeton qu'on lui
 *     a donné ; on ne reconnaît personne à ses caractéristiques.
 *
 * LA DIFFÉRENCE EST DE NATURE, PAS DE DEGRÉ. Un identifiant stocké se
 * voit (`localStorage`), s'efface (« effacer les données du site ») et
 * ne suit pas d'un navigateur à l'autre. Une empreinte se calcule sans
 * rien stocker, ne s'efface pas, et survit à la navigation privée : elle
 * pisterait, là où celui-ci compte. C'est pour cela que la perte de
 * l'identifiant est ici un comportement ACCEPTÉ — voir `install.ts` —
 * et non un problème à contourner.
 *
 * ============================================================
 * ATTENTION — LA MOITIÉ BASE DE DONNÉES N'EXISTE PAS ENCORE
 * ============================================================
 *
 * 0077 ne connaît QUE 'ios' : sa table porte
 * `check (platform in ('ios'))` et `declare_mobile_presence` refuse
 * explicitement toute autre plateforme (« Plateforme « % » inconnue »).
 * Il n'y a donc, à l'heure où ces lignes sont écrites, AUCUNE fonction
 * `declare_web_presence` en base.
 *
 * Ce module l'appelle quand même, et c'est délibéré :
 *   • l'appel est déjà silencieux par construction (voir `report.ts`),
 *     donc tant que la fonction manque, il ne se passe RIEN — pas
 *     d'erreur à l'écran, pas de log rouge, pas de navigation cassée ;
 *   • le jour où la migration est posée, il n'y a rien à redéployer
 *     côté web : les navigateurs déjà ouverts se mettent à compter.
 *
 * Le contrat attendu est décrit ci-dessous, et il est volontairement
 * calqué sur `declare_mobile_presence` — mêmes précautions, mêmes noms
 * de paramètres, même absence d'identifiant d'utilisateur.
 */

/**
 * La seule plateforme que ce client déclare.
 *
 * Écrite en dur, jamais déduite du navigateur : un `navigator.userAgent`
 * lu pour distinguer « web mobile » de « web bureau » serait déjà de
 * l'empreinte, et ne répondrait à aucune question posée.
 */
export const WEB_PLATFORM = "web";

/**
 * La fonction attendue en base.
 *
 * SIGNATURE ATTENDUE (à poser par la migration qui élargira 0077) :
 *
 *     declare_web_presence(
 *       p_install_id  text,
 *       p_platform    text,
 *       p_app_version text,
 *       p_app_build   text   -- peut être NULL, voir `release.ts`
 *     ) returns void
 *     language plpgsql volatile security definer
 *     set search_path = public, pg_temp
 *
 * Les quatre exigences non négociables, reprises de 0077 §4 :
 *   1. AUCUN paramètre d'utilisateur. `auth.uid()` ou rien — sinon
 *      n'importe qui gonfle le KPI depuis un terminal.
 *   2. `security definer`, parce que la table ne doit pas être
 *      écrivable : la RLS dit à qui appartient une ligne, elle ne dit
 *      rien de ce qu'elle contient.
 *   3. La même garde anti-« nom d'appareil » sur `p_install_id`
 *      (8 à 64 caractères, aucun espace) — dupliquée ici dans
 *      `isValidInstallId` pour ne pas envoyer ce qui sera refusé, mais
 *      c'est la base qui fait foi.
 *   4. Une ligne par INSTALLATION, `last_seen_at` écrasé, jamais
 *      empilé. Cette collecte décrit un état présent ; elle n'accumule
 *      pas un historique de navigation.
 */
export const PRESENCE_RPC = "declare_web_presence";

/**
 * ==================================================================
 * ET TANT QU'ELLE N'EXISTE PAS, ON NE COLLECTE RIEN. `false`.
 * ==================================================================
 *
 * Le raisonnement d'origine était : « l'appel est silencieux, donc tant
 * que la fonction manque il ne se passe rien, et le jour où la
 * migration est posée les navigateurs déjà ouverts se mettent à
 * compter ». C'est vrai de l'appel. Ce n'est pas vrai de CE QUI LE
 * PRÉCÈDE.
 *
 * Pour envoyer une déclaration, `install.ts` tire un UUID et le RANGE
 * DANS `localStorage` — un identifiant qui suit une installation, donc
 * une donnée personnelle — chez chaque utilisateur de Oasis Care Pro.
 * Aujourd'hui cet identifiant ne sert à RIEN : il n'existe aucune
 * fonction en base pour le recevoir, aucun écran pour l'exploiter,
 * aucune question à laquelle il réponde. Stocker une donnée
 * personnelle sans finalité est précisément ce que la minimisation
 * interdit, et « ça servira plus tard » n'est pas une finalité.
 *
 * S'ajoute une raison plus prosaïque : une Server Action par session
 * d'onglet, garantie d'échouer, pour rien.
 *
 * CE QU'IL FAUT FAIRE POUR L'ALLUMER, dans cet ordre : poser la
 * migration qui crée `declare_web_presence` (le contrat est décrit
 * ci-dessus, et il élargit `platform` — attention, la table s'appelle
 * `mobile_app_installations` et les cinq indicateurs mobiles du Control
 * Center comptent ses lignes SANS filtrer la plateforme : une ligne
 * 'web' y serait comptée comme un utilisateur Mobile, ce qui n'est pas
 * une correction à faire à la légère), puis passer ce drapeau à `true`.
 * Rien d'autre à changer ici.
 */
export const WEB_PRESENCE_ENABLED = false;

/** Ce qu'une installation web annonce d'elle-même. Quatre champs. */
export interface WebPresence {
  /** UUID tiré au premier passage et rangé dans le navigateur. */
  installId: string;
  platform: typeof WEB_PLATFORM;
  /** Version du paquet, ou ce que le déploiement a injecté. */
  appVersion: string;
  /** Révision de build, `null` quand la construction n'en injecte pas. */
  appBuild: string | null;
}

/** Les bornes de `install_id` en base (0077 : `between 8 and 64`). */
export const INSTALL_ID_MIN_LENGTH = 8;
export const INSTALL_ID_MAX_LENGTH = 64;

/** Les bornes de `app_version` / `app_build` en base (0077 : 1 à 32). */
export const VERSION_MAX_LENGTH = 32;

/**
 * La forme exacte que 0077 accepte : chiffres hexadécimaux et tirets.
 *
 * C'EST UNE LISTE BLANCHE, ET LA PREMIÈRE VERSION NE L'ÉTAIT PAS. Elle
 * refusait l'espace, ce qui ne gardait rien : « Chrome-de-Clement »
 * n'en contient aucune, une adresse électronique non plus, et les deux
 * tiennent très largement dans 64 caractères. Interdire un caractère ne
 * ferme que ce caractère ; exiger la forme attendue ferme la question.
 *
 * Tout ce que ce module produit est un UUID — `crypto.randomUUID`, ou
 * 16 octets aléatoires en hexadécimal quand il manque — donc la liste
 * blanche ne coûte rien.
 */
const INSTALL_ID_SHAPE = /^[0-9A-Fa-f-]{8,64}$/;

/**
 * La garde anti-« nom d'appareil », côté client.
 *
 * La base fait foi (`declare_mobile_presence` et la contrainte de table
 * `mobile_app_installations_forme`). On refait le contrôle ici pour deux
 * raisons : ne pas dépenser une requête pour se faire dire non, et
 * surtout REJETER UNE VALEUR ABÎMÉE trouvée dans le stockage plutôt que
 * la réutiliser — un identifiant que quelqu'un a modifié à la main
 * n'identifie plus rien.
 */
export function isValidInstallId(candidate: unknown): candidate is string {
  if (typeof candidate !== "string") return false;
  if (candidate.length < INSTALL_ID_MIN_LENGTH) return false;
  if (candidate.length > INSTALL_ID_MAX_LENGTH) return false;
  return INSTALL_ID_SHAPE.test(candidate);
}

/**
 * Une déclaration est COMPLÈTE ou n'est pas.
 *
 * 0077 pose la même règle en contrainte de table : une ligne à moitié
 * remplie polluerait la distribution des versions de trous qu'on
 * prendrait pour des versions inconnues. `appBuild` fait exception —
 * il est légitimement absent quand la construction n'injecte aucune
 * révision, et `release.ts` explique pourquoi on préfère l'absence à
 * une valeur inventée.
 */
export function isDeclarable(presence: WebPresence): boolean {
  if (!isValidInstallId(presence.installId)) return false;
  if (presence.platform !== WEB_PLATFORM) return false;

  const version = presence.appVersion.trim();
  if (version === "" || version.length > VERSION_MAX_LENGTH) return false;

  if (presence.appBuild !== null) {
    const build = presence.appBuild.trim();
    if (build === "" || build.length > VERSION_MAX_LENGTH) return false;
  }

  return true;
}
