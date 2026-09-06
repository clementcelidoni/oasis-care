/**
 * §PORTE ANONYME — LA RÉSISTANCE À L'ÉNUMÉRATION, AU BORD.
 *
 * ══════════════════════════════════════════════════════════════════
 * CE QUE CETTE GARDE APPORTE, ET CE QU'ELLE N'APPORTE PAS
 * ══════════════════════════════════════════════════════════════════
 *
 * Une promesse de sécurité approximative est pire que pas de promesse
 * du tout, alors disons exactement ce qui se passe.
 *
 * LA VRAIE BARRIÈRE N'EST PAS ICI : c'est le tirage. Un jeton fait
 * 32 octets tirés au hasard cryptographique (0089 § 8.a). Il n'existe
 * pas « des milliers de jetons » à essayer, il en faudrait 2^255. Aucune
 * limitation de débit ne protège un secret faible, et aucune n'est
 * nécessaire pour protéger celui-là.
 *
 * CE QUE LA GARDE APPORTE QUAND MÊME, et pourquoi elle existe :
 *
 *   1. ELLE ÉPARGNE LA BASE. Un balayage automatique — et il y en a, en
 *      permanence, sur toute adresse publique — n'a pas à provoquer un
 *      aller-retour SQL par tentative.
 *   2. ELLE LAISSE UNE TRACE. `devis_par_jeton` compte ses échecs par
 *      fenêtre de cinq minutes et pose un drapeau au débordement
 *      (0089 § 8.c). La base, elle, ne sait pas QUI frappe : elle n'a
 *      pas de session. Le bord le sait, et c'est pour ça que le refus
 *      lui revient.
 *   3. ELLE SE RESSERRE QUAND LA BASE DIT QU'ELLE DÉBORDE.
 *
 * ══════════════════════════════════════════════════════════════════
 * TROIS LIMITES ASSUMÉES, ÉCRITES PARCE QU'ELLES SONT RÉELLES
 * ══════════════════════════════════════════════════════════════════
 *
 * • LA MÉMOIRE EST CELLE D'UNE INSTANCE. Un site servi par plusieurs
 *   processus a plusieurs compteurs, et un compteur repart à zéro à
 *   chaque déploiement ou après une période d'inactivité. C'est une
 *   gêne pour un balayeur, pas un mur. Un vrai mur serait un compteur
 *   partagé (base ou cache), et il n'a de sens que le jour où l'on
 *   protège un secret qui, lui, pourrait être deviné.
 * • ON NE COMPTE QUE LES ÉCHECS. Un client qui ouvre son devis vingt
 *   fois n'est jamais ralenti — c'est la règle de 0089 § 8.c : « ce
 *   qu'on ne fait surtout pas, c'est refuser les jetons VALIDES pendant
 *   une saturation ».
 * • L'ADRESSE VIENT D'UN EN-TÊTE, donc de l'hébergeur. Derrière un
 *   hébergeur qui la pose (c'est le cas de tous), elle est fiable ;
 *   servie en direct, elle serait falsifiable. Quand aucune adresse
 *   n'est lisible, cette garde S'EFFACE au lieu de mettre tout le monde
 *   dans le même seau : un seau commun ferait qu'un balayeur bloque les
 *   vrais clients, ce qui est exactement le résultat qu'il cherche.
 *
 * ══════════════════════════════════════════════════════════════════
 * ON REFUSE VITE, ON NE RALENTIT PAS
 * ══════════════════════════════════════════════════════════════════
 *
 * Le réflexe serait d'ajouter une attente d'une seconde à chaque échec.
 * Ce serait une faute : sur une fonction serveur, une attente OCCUPE un
 * emplacement d'exécution. Cent tentatives lentes tiendraient cent
 * emplacements, et c'est le balayeur qui aurait obtenu le déni de
 * service, gratuitement, en nous le faisant fabriquer nous-mêmes. On
 * répond donc immédiatement, et on ne fait rien de coûteux.
 */

/** La fenêtre, alignée sur celle de la base : cinq minutes. */
export const FENETRE_MS = 5 * 60 * 1000;

/**
 * Combien d'échecs on tolère d'une même adresse par fenêtre.
 *
 * Dix, parce qu'un lien recopié de travers, un devis expiré rouvert
 * plusieurs fois depuis un fil de messages, un client qui insiste : ce
 * sont des échecs légitimes, et une garde qui punirait le troisième
 * ferait plus de mal qu'un balayeur.
 */
export const ECHECS_TOLERES = 10;

/**
 * Et deux seulement quand la base signale qu'elle déborde.
 *
 * `document_share_sous_attaque()` est vrai lorsqu'une fenêtre récente a
 * dépassé son seuil d'échecs, tous visiteurs confondus. On resserre
 * alors sur les adresses qui échouent — jamais sur celles qui
 * réussissent.
 */
export const ECHECS_TOLERES_SOUS_ATTAQUE = 2;

/**
 * Le nombre d'adresses suivies simultanément.
 *
 * Un plafond, parce qu'une table qui grandit sans limite est le levier
 * par lequel on remplit la mémoire — le même défaut que la base évite
 * en arrêtant son compteur au seuil (0089 § 8.c).
 */
export const ADRESSES_SUIVIES_MAX = 10_000;

type Compteur = { fenetre: number; echecs: number };

/**
 * TROIS RÉPONSES, PARCE QUE LA TROISIÈME ÉVITE UN ALLER-RETOUR.
 *
 * Le signal global de saturation vient de la base
 * (`document_share_sous_attaque()`), donc d'une requête. Or il ne change
 * la décision QUE dans une bande étroite : entre le seuil resserré et le
 * seuil ordinaire.
 *
 *   • en dessous du seuil resserré → autorisé dans TOUS les cas, sous
 *     attaque ou non. Inutile de demander.
 *   • au-dessus du seuil ordinaire → refusé dans tous les cas. Inutile
 *     de demander.
 *   • entre les deux → là seulement, la réponse dépend du signal.
 *
 * L'intérêt n'est pas la microseconde : c'est que le CAS NORMAL — un
 * client qui ouvre son devis et n'a jamais échoué — ne coûte plus qu'un
 * seul aller-retour à la base au lieu de deux. Et cela rend visible ce
 * que le signal global veut vraiment dire : il ne concerne jamais que
 * les visiteurs qui échouent déjà de façon répétée.
 */
export type Verdict = "libre" | "aVerifier" | "bloque";

export type Garde = {
  /**
   * Ce que le compteur local sait dire seul. « aVerifier » veut dire
   * « demandez à la base si elle déborde, et refusez si oui ».
   */
  verdict(empreinte: string | null, maintenant?: number): Verdict;
  /** À appeler UNIQUEMENT après un refus, jamais après une ouverture réussie. */
  noterEchec(empreinte: string | null, maintenant?: number): void;
  /** Pour les tests, et pour l'écran d'administration le jour où il existera. */
  adressesSuivies(): number;
};

export function creerGarde(): Garde {
  const compteurs = new Map<string, Compteur>();

  function debutFenetre(maintenant: number): number {
    return Math.floor(maintenant / FENETRE_MS) * FENETRE_MS;
  }

  function elaguer(maintenant: number): void {
    const courante = debutFenetre(maintenant);
    for (const [cle, compteur] of compteurs) {
      if (compteur.fenetre < courante) compteurs.delete(cle);
    }
    // ÉLAGUER NE SUFFIT PAS TOUJOURS : dix mille adresses distinctes
    // dans la MÊME fenêtre ne sont pas périmées, et rien ne les
    // retirerait. On vide alors tout, et on l'assume — repartir de zéro
    // laisse passer une salve, tandis que garder la table ferait tomber
    // le serveur, ce qui refuse le devis à TOUT LE MONDE.
    if (compteurs.size > ADRESSES_SUIVIES_MAX) compteurs.clear();
  }

  return {
    verdict(empreinte, maintenant = Date.now()) {
      // Pas d'adresse lisible : la garde s'efface. Voir l'en-tête.
      if (empreinte === null) return "libre";
      const compteur = compteurs.get(empreinte);
      if (compteur === undefined) return "libre";
      if (compteur.fenetre !== debutFenetre(maintenant)) return "libre";
      if (compteur.echecs < ECHECS_TOLERES_SOUS_ATTAQUE) return "libre";
      if (compteur.echecs >= ECHECS_TOLERES) return "bloque";
      return "aVerifier";
    },

    noterEchec(empreinte, maintenant = Date.now()) {
      if (empreinte === null) return;
      elaguer(maintenant);
      const fenetre = debutFenetre(maintenant);
      const compteur = compteurs.get(empreinte);
      if (compteur === undefined || compteur.fenetre !== fenetre) {
        compteurs.set(empreinte, { fenetre, echecs: 1 });
        return;
      }
      // LE COMPTEUR S'ARRÊTE AU SEUIL LE PLUS HAUT. Au-delà, il ne sert
      // plus à rien de compter : la décision est déjà prise, et un
      // entier qui grandit indéfiniment est un entier qui déborde.
      if (compteur.echecs < ECHECS_TOLERES) compteur.echecs += 1;
    },

    adressesSuivies() {
      return compteurs.size;
    },
  };
}

/**
 * L'EMPREINTE DU VISITEUR — ET POURQUOI CE N'EST PAS SON ADRESSE.
 *
 * Une adresse IP est une donnée personnelle. Elle est nécessaire une
 * fraction de seconde pour compter des échecs, elle ne l'est pas pour
 * les CONSERVER : une table en mémoire finit dans un vidage de tas, dans
 * un rapport d'incident, dans une capture de débogage. On en garde donc
 * une empreinte courte et non réversible, qui suffit à compter et ne
 * dit rien à qui la lirait.
 *
 * FNV-1a plutôt qu'un hachage cryptographique : c'est un compteur en
 * mémoire vive dont la durée de vie est de cinq minutes, pas un secret
 * stocké. Un hachage lent coûterait à chaque requête pour une garantie
 * dont personne n'a besoin ici — et le mélange d'un sel de processus
 * suffit à interdire le dictionnaire d'adresses préparé à l'avance.
 */
const SEL_DU_PROCESSUS = Math.random().toString(36).slice(2);

export function empreinteVisiteur(adresse: string | null): string | null {
  if (adresse === null) return null;
  const propre = adresse.trim();
  if (propre === "") return null;
  let empreinte = 0x811c9dc5;
  const entree = SEL_DU_PROCESSUS + "|" + propre;
  for (let i = 0; i < entree.length; i += 1) {
    empreinte ^= entree.charCodeAt(i);
    empreinte = Math.imul(empreinte, 0x01000193);
  }
  return (empreinte >>> 0).toString(36);
}

/**
 * L'ADRESSE DU VISITEUR, LUE DANS LES EN-TÊTES DE L'HÉBERGEUR.
 *
 * `x-forwarded-for` porte la chaîne des relais traversés, du client vers
 * nous. LE PREMIER ÉLÉMENT est celui du visiteur — les suivants sont les
 * relais. On ne prend donc pas le dernier, qui serait toujours le même.
 *
 * ATTENTION À CE QUE CET EN-TÊTE VAUT. Derrière un hébergeur qui le
 * RÉÉCRIT — c'est ce que font Vercel, Cloudflare et les autres — il est
 * digne de foi. Servi en direct, sans relais devant, il serait posé par
 * le client lui-même et un balayeur en changerait à chaque requête. Dans
 * ce cas la garde ne gêne personne, ce qui est le comportement voulu :
 * elle ne prétend pas être un mur, et la vraie barrière reste les
 * 256 bits du jeton.
 */
export function adresseVisiteur(entetes: {
  get(nom: string): string | null;
}): string | null {
  const transmise = entetes.get("x-forwarded-for");
  if (transmise !== null && transmise.trim() !== "") {
    const premier = transmise.split(",")[0]?.trim() ?? "";
    if (premier !== "") return premier;
  }
  const reelle = entetes.get("x-real-ip");
  if (reelle !== null && reelle.trim() !== "") return reelle.trim();
  return null;
}
