/**
 * Les deux façons dont une lecture d'administration peut échouer.
 *
 * On les distingue parce qu'elles n'appellent pas la même réponse à
 * l'écran : un refus se dit calmement à un administrateur qui n'a pas
 * la permission, une panne se dit à l'équipe qui exploite la
 * plateforme, avec le message de la base. Un `catch` unique qui
 * afficherait « une erreur est survenue » dans les deux cas
 * transformerait un contrôle d'accès qui fonctionne en incident
 * apparent.
 */

/**
 * La base a refusé l'appelant : soit il n'est pas administrateur de
 * plateforme, soit son rôle ne couvre pas `platform.dashboard.read`.
 * Les fonctions de 0075 lèvent avec le code SQLSTATE 42501.
 *
 * Ce refus est la barrière de DERNIER recours, pas la première : le
 * shell d'administration doit déjà avoir écarté le visiteur. S'il
 * apparaît, c'est soit un administrateur au rôle trop étroit — cas
 * normal, la spec p.30 le veut — soit un trou dans le shell.
 */
export class AdminAccessDenied extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdminAccessDenied";
  }
}

/** La lecture a échoué pour toute autre raison : réseau, SQL, fonction absente. */
export class AdminReadFailed extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdminReadFailed";
  }
}
