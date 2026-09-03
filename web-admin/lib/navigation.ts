import type { IconName } from "@/components/shell/Icon";
import type { PlatformPermission } from "@/lib/auth/roles";

/**
 * ==================================================================
 * LA BARRE LATÉRALE — spec p.5-6, MOINS TOUT CE QUI N'EXISTE PAS
 * ==================================================================
 *
 * La spec propose neuf sections : OVERVIEW, CUSTOMERS, COMMERCIAL, AI,
 * SUPPORT, PRODUCT, PLATFORM, SECURITY, COMPLIANCE, ADMIN. Le jalon 1
 * en livre DEUX, et les autres ne figurent pas ici.
 *
 * CE N'EST PAS UN OUBLI. Une entrée grisée « à venir » a du sens dans
 * Oasis Care Pro, où elle dessine la forme du produit pour un client
 * qui achète un abonnement. Ici, le public est l'équipe qui exploite la
 * plateforme : lui montrer douze portes fermées ne l'informe de rien
 * qu'elle ne sache déjà, et transforme la barre latérale en liste de
 * courses. Une entrée qui mène à une page vide est pire qu'une entrée
 * absente.
 *
 * Les sections manquantes reviendront avec leurs écrans, pas avant.
 *
 * ------------------------------------------------------------------
 * « Équipes Pro », absente elle aussi
 * ------------------------------------------------------------------
 * La spec la range dans CUSTOMERS (p.5). Elle demande la liste des
 * membres d'une organisation (p.11), qui appartient à la FICHE d'une
 * organisation — jalon 2. Le jalon 1 s'arrête aux listes.
 *
 * ------------------------------------------------------------------
 * LE FILTRE PAR RÔLE N'EST PAS UNE SÉCURITÉ
 * ------------------------------------------------------------------
 * `visibleNavigation()` masque ce que le rôle ne peut pas ouvrir, pour
 * que la barre latérale ne propose pas des portes fermées. Ce qui
 * PROTÈGE, c'est `requireAdmin(permission)` dans chaque page, puis le
 * `raise` de chaque fonction de 0075. Retirer un lien d'un menu est une
 * convention d'affichage, jamais une frontière.
 */

export type AdminNavItem = {
  label: string;
  href: string;
  icon: IconName;
  /** La permission qui ouvre cette page. Elle est vérifiée par la page elle-même. */
  permission: PlatformPermission;
  /** Ce que la page montre, en une phrase — affiché en survol dans la barre repliée. */
  hint?: string;
};

export type AdminNavGroup = {
  label: string;
  items: AdminNavItem[];
};

/**
 * Les six entrées du jalon 1, dans l'ordre de la spec p.5.
 *
 * `/utilisateurs/mobile` mérite un mot : l'audit a établi que RIEN
 * n'enregistre par quelle application un compte est entré, et
 * `admin_list_users` LÈVE sur le filtre « mobile » plutôt que de rendre
 * toute la liste en faisant semblant. L'entrée reste — la spec la
 * demande, et la question « qui utilise l'iPhone ? » est légitime —
 * mais la page qui s'ouvre derrière doit dire pourquoi la réponse est
 * INCONNUE, sans jamais appeler ce filtre.
 */
export const ADMIN_NAVIGATION: AdminNavGroup[] = [
  {
    label: "Vue d'ensemble",
    items: [
      {
        label: "Tableau de bord",
        href: "/",
        icon: "dashboard",
        permission: "platform.dashboard.read",
        hint: "Les grands chiffres de la plateforme",
      },
      {
        label: "Activité",
        href: "/activite",
        icon: "pulse",
        permission: "platform.dashboard.read",
        hint: "Ce qui s'est passé aujourd'hui",
      },
    ],
  },
  {
    label: "Clients",
    items: [
      {
        label: "Tous les utilisateurs",
        href: "/utilisateurs",
        icon: "users",
        permission: "platform.users.read",
        hint: "Comptes, métadonnées et nombres",
      },
      {
        label: "Oasis Care Mobile",
        href: "/utilisateurs/mobile",
        icon: "phone",
        permission: "platform.users.read",
        hint: "L'usage iPhone — non mesuré à ce jour",
      },
      {
        label: "Oasis Care Pro",
        href: "/utilisateurs/pro",
        icon: "briefcase",
        permission: "platform.users.read",
        hint: "Les comptes rattachés à une entreprise",
      },
      {
        label: "Organisations",
        href: "/organisations",
        icon: "building",
        permission: "platform.organizations.read",
        hint: "Les entreprises Pro, en nombres",
      },
    ],
  },
];

/**
 * Ce que ce rôle peut ouvrir.
 *
 * Un groupe dont toutes les entrées sont masquées disparaît avec elles :
 * un intertitre « Clients » suivi de rien du tout est un bug apparent.
 */
export function visibleNavigation(permissions: readonly string[]): AdminNavGroup[] {
  const held = new Set(permissions);

  return ADMIN_NAVIGATION.map((group) => ({
    label: group.label,
    items: group.items.filter((item) => held.has(item.permission)),
  })).filter((group) => group.items.length > 0);
}

/**
 * La recherche globale (spec p.33) a sa propre permission et n'est pas
 * une entrée de menu : elle vit dans l'en-tête, disponible partout.
 */
export const SEARCH_HREF = "/recherche";
export const SEARCH_PERMISSION: PlatformPermission = "platform.search";

/**
 * Toutes les permissions que la navigation nomme, recherche comprise.
 *
 * Existe pour être confrontée au catalogue par `navigation.test.ts`.
 * Une entrée pointant sur une permission inexistante serait invisible
 * pour TOUS les rôles, y compris le super-administrateur — et
 * silencieusement : la page n'apparaîtrait simplement jamais, sans
 * erreur nulle part. Le test transforme cet oubli en échec de suite.
 *
 * Ce module n'importe volontairement AUCUNE valeur — seulement des
 * types, que le compilateur efface. C'est ce qui le rend exécutable
 * directement par `node --test`, sans résolution de l'alias `@/`.
 */
export function navigationPermissions(): string[] {
  return ADMIN_NAVIGATION.flatMap((group) => group.items)
    .map((item) => item.permission)
    .concat(SEARCH_PERMISSION);
}
