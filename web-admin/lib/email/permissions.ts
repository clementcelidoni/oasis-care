/**
 * ==================================================================
 * LES SIX PERMISSIONS DU COURRIER SORTANT
 * ==================================================================
 *
 * Elles arrivent avec la migration 0084 (§ 16), qui les insère dans
 * `platform_admin_permissions` PUIS rejoue explicitement le semis du
 * super-administrateur. Ce rejeu n'est pas une précaution de style :
 * 0075 § 1.c sème par JOINTURE, donc une permission ajoutée après elle
 * n'est portée par PERSONNE — et une permission que personne ne porte
 * ne lève aucune erreur, elle fait disparaître l'écran sans un mot. Le
 * piège a mordu trois fois dans ce projet.
 *
 * ------------------------------------------------------------------
 * POURQUOI CES CLÉS SONT DES CHAÎNES ET NON DES `PlatformPermission`
 * ------------------------------------------------------------------
 * `lib/auth/roles.ts` est le miroir TypeScript du catalogue, et il ne
 * connaît pas encore `emails.*` : ce fichier appartient à un autre
 * périmètre, et trois constructeurs travaillent en parallèle sur ce
 * dépôt. L'y ajouter depuis ici, c'est écraser le travail à moitié
 * écrit de quelqu'un d'autre.
 *
 * La conséquence est concrète et il faut la connaître : `requireAdmin(
 * permission)` n'accepte que des `PlatformPermission`, donc ces
 * six clés ne peuvent pas lui être passées. La garde de ce lot
 * (`guard.ts`) vérifie donc `admin.permissions` elle-même et redirige
 * exactement comme `requireAdmin` l'aurait fait. Ce n'est PAS un
 * affaiblissement : `admin.permissions` vient de `admin_me()`, donc de
 * la base, et chaque fonction de 0084 recommence le contrôle en SQL
 * (`if not public.platform_admin_can('emails.…') then raise`). Ce qui
 * est perdu, c'est la vérification à la COMPILATION d'une clé mal
 * orthographiée — d'où `CLES_COURRIER`, une seule source dans ce lot,
 * et le test qui la confronte à ce que les écrans demandent.
 *
 * CE QUE L'INTÉGRATION DEVRA FAIRE, et qui n'est pas de mon ressort :
 * ajouter les six clés à `PLATFORM_PERMISSIONS` et leurs libellés à
 * `PERMISSION_LABELS` dans `web-admin/lib/auth/roles.ts`, puis un
 * groupe « Courrier » dans `web-admin/lib/navigation.ts`. Sans le
 * second, ces écrans existent mais aucune barre latérale n'y mène : ils
 * ne sont atteignables qu'en tapant l'URL, c'est-à-dire jamais.
 */

/** Les six clés de 0084 § 16, mot pour mot. */
export const CLES_COURRIER = {
  /** Lire le courrier expédié par Oasis et la délivrabilité du parc. */
  journal: "emails.log.read",
  /** Voir les annonces commerciales. */
  campagnesLire: "emails.campaigns.read",
  /** Écrire à toutes les entreprises du parc. Second facteur exigé. */
  campagnesEnvoyer: "emails.campaigns.send",
  /** Voir la liste de suppression. */
  suppressionsLire: "emails.suppression.read",
  /** Lever une suppression d'adresse. Second facteur exigé. */
  suppressionsGerer: "emails.suppression.manage",
  /** Suspendre ou rétablir l'expédition d'une entreprise. Second facteur exigé. */
  suspendre: "emails.sending.suspend",
} as const;

export type PermissionCourrier = (typeof CLES_COURRIER)[keyof typeof CLES_COURRIER];

/** Les six, en tableau — pour le diagnostic du socle et pour les tests. */
export const PERMISSIONS_COURRIER: readonly PermissionCourrier[] = Object.values(CLES_COURRIER);

/**
 * Ce que chaque clé ouvre, en français.
 *
 * Recopié du catalogue SQL de 0084 § 16 plutôt que lu en base : ces
 * phrases s'affichent dans un refus, c'est-à-dire au moment précis où
 * la lecture du catalogue peut avoir échoué. Un libellé qui manque
 * quand tout va mal ne sert à rien.
 */
export const LIBELLES_COURRIER: Record<PermissionCourrier, string> = {
  "emails.log.read": "Lire le courrier expédié par Oasis Care et la délivrabilité du parc",
  "emails.campaigns.read": "Voir les annonces commerciales",
  "emails.campaigns.send": "Écrire à toutes les entreprises du parc",
  "emails.suppression.read": "Voir la liste de suppression",
  "emails.suppression.manage": "Lever une suppression d'adresse",
  "emails.sending.suspend": "Suspendre ou rétablir l'expédition d'une entreprise",
};

/**
 * Qui porte quoi, d'après le SEMIS de 0084 § 16.b.
 *
 * LA SOURCE DE VÉRITÉ RESTE LA BASE : cette carte est datée du semis et
 * ne suit pas les modifications ultérieures de la matrice. Elle sert à
 * une seule chose — dire à quelqu'un « il vous manque cette permission,
 * et voici qui la porte » — parce qu'un refus qui n'explique pas
 * comment obtenir le droit se transforme en ticket.
 *
 * LA SÉPARATION DES POUVOIRS QU'ELLE ENCODE MÉRITE D'ÊTRE LUE : le
 * responsable produit ENVOIE les annonces mais ne peut ni suspendre une
 * entreprise ni réhabiliter une adresse ; le responsable sécurité fait
 * l'inverse. Confier les deux à la même personne reviendrait à la
 * laisser créer le problème et lever le garde-fou. Le déclencheur
 * `platform_admin_matrix_guard()` de 0084 refuse littéralement
 * d'insérer la combinaison interdite.
 */
export const ROLES_PORTEURS: Record<PermissionCourrier, readonly string[]> = {
  "emails.log.read": ["super_admin", "product_admin", "security_admin", "support"],
  "emails.campaigns.read": ["super_admin", "product_admin"],
  "emails.campaigns.send": ["super_admin", "product_admin"],
  "emails.suppression.read": ["super_admin", "security_admin", "support"],
  "emails.suppression.manage": ["super_admin", "security_admin"],
  "emails.sending.suspend": ["super_admin", "security_admin"],
};

/**
 * Les trois clés que 0084 place derrière le SECOND FACTEUR, en plus de
 * la permission : `platform_admin_require_mfa()` est appelée dans
 * chacune des cinq fonctions d'écriture.
 *
 * Affiché à l'écran AVANT le geste, pas découvert au moment du refus :
 * un administrateur qui compose une annonce pendant dix minutes et
 * apprend au clic qu'il lui fallait un second facteur perd son texte.
 */
export const EXIGENT_SECOND_FACTEUR: readonly PermissionCourrier[] = [
  CLES_COURRIER.campagnesEnvoyer,
  CLES_COURRIER.suppressionsGerer,
  CLES_COURRIER.suspendre,
];

export function estPermissionCourrier(valeur: unknown): valeur is PermissionCourrier {
  return typeof valeur === "string" && (PERMISSIONS_COURRIER as readonly string[]).includes(valeur);
}

/**
 * La phrase qu'on affiche à la place d'un bouton refusé.
 *
 * Elle nomme la permission, ce qu'elle ouvre, et les rôles qui la
 * portent au semis.
 */
export function phraseDeRefus(role: string, permission: PermissionCourrier): string {
  const libelle = LIBELLES_COURRIER[permission];
  return (
    `Le rôle « ${role} » ne porte pas la permission ${permission} — ` +
    `${libelle.charAt(0).toLowerCase()}${libelle.slice(1)}. ` +
    `Au semis de 0084, elle appartient à : ${ROLES_PORTEURS[permission].join(", ")}.`
  );
}
