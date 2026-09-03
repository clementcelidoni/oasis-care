/**
 * Les trois façons dont une lecture de cette section peut échouer.
 *
 * Elles sont distinguées parce qu'elles n'appellent pas la même
 * réponse à l'écran. Un `catch` unique qui afficherait « une erreur est
 * survenue » ferait passer un contrôle d'accès qui fonctionne, et un
 * refus parfaitement documenté, pour des pannes.
 *
 * ------------------------------------------------------------------
 * POURQUOI CES CLASSES NE SONT PAS CELLES DE `lib/dashboard/errors.ts`
 * ------------------------------------------------------------------
 * Elles leur ressemblent, et c'est assumé. Ce module et le tableau de
 * bord sont écrits en parallèle par deux agents ; se partager un
 * fichier ferait dépendre chacun du rythme de l'autre, et un
 * déplacement de `lib/dashboard/` casserait cette section sans que rien
 * ne l'annonce. Deux fichiers de trente lignes coûtent moins cher que
 * ce couplage. Le jour où les deux sections seront stables, les
 * fusionner sera un remaniement d'une minute.
 */

/**
 * La base a refusé l'appelant : pas administrateur de plateforme, ou
 * rôle ne portant pas la permission. SQLSTATE 42501.
 *
 * Ce refus est la barrière de DERNIER recours. `requireAdmin()` a déjà
 * dû détourner l'administrateur au rôle trop étroit ; si celui-ci
 * apparaît malgré tout, c'est que la garde de la page et la barrière
 * SQL de 0075 ne sont pas d'accord entre elles. C'est une information,
 * pas un incident à masquer.
 */
export class AdminAccessDenied extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdminAccessDenied";
  }
}

/**
 * La base a refusé le FILTRE, pas l'appelant.
 *
 * `admin_list_users` lève sur `mobile`, `trial` et `cancelled`
 * (SQLSTATE 0A000) parce qu'aucune donnée ne les porte, et sur un
 * filtre hors catalogue (SQLSTATE 22023). Elle lève au lieu de rendre
 * toute la liste : une liste complète sous le titre « utilisateurs
 * Mobile » serait un mensonge, et une liste vide se confondrait avec
 * « aucun ».
 *
 * L'interface n'envoie jamais ces filtres — elle les dessine éteints.
 * On arrive donc ici par une URL tapée ou copiée à la main, et la bonne
 * réponse est d'expliquer, pas de planter.
 */
export class AdminFilterRefused extends Error {
  /** Le filtre tel qu'il a été demandé, pour pouvoir le nommer à l'écran. */
  readonly filter: string;

  constructor(filter: string, message: string) {
    super(message);
    this.name = "AdminFilterRefused";
    this.filter = filter;
  }
}

/** La lecture a échoué pour toute autre raison : réseau, SQL, fonction absente. */
export class AdminReadFailed extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdminReadFailed";
  }
}
