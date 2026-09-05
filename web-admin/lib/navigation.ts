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
  /**
   * La permission qui ouvre cette page. Elle est vérifiée par la page
   * elle-même.
   *
   * `null` signifie « tout administrateur de plateforme », et c'est une
   * valeur rare et volontaire, pas un raccourci. Elle n'existe que pour
   * `/parametres`, qui porte ce qui n'appartient à aucun rôle en
   * particulier : sa propre fiche, et son propre second facteur.
   * Y accrocher `platform.dashboard.read` — que les six rôles portent
   * aujourd'hui — aurait donné le même résultat à l'écran en énonçant
   * quelque chose de faux : régler son second facteur n'a rien à voir
   * avec le droit de lire le tableau de bord, et le jour où un septième
   * rôle arriverait sans cette permission, il perdrait aussi l'accès à
   * son propre compte. La page appelle `requireAdmin()` SANS argument,
   * ce qui est exactement la même règle, écrite là où elle protège.
   */
  permission: PlatformPermission | null;
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
 * `/utilisateurs/mobile` mérite un mot, et ce n'est plus le même
 * qu'avant. L'audit avait établi que RIEN n'enregistrait par quelle
 * application un compte était entré : la page ne pouvait qu'expliquer
 * l'absence, et `admin_list_users` LEVAIT sur le filtre « mobile »
 * plutôt que de rendre toute la liste en faisant semblant. La migration
 * 0077 a posé la collecte, la reprise rétroactive et le filtre : la
 * page liste désormais, et ce qu'elle doit continuer de dire à l'écran
 * est autre chose — que son chiffre est une BORNE INFÉRIEURE tant que
 * le parc n'a pas basculé.
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
        hint: "L'usage iPhone : qui, quelle version, depuis quand",
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
  /**
   * ------------------------------------------------------------------
   * COMMERCIAL — la section que la migration 0081 rend enfin possible
   * ------------------------------------------------------------------
   * La spec p.5 en annonce six entrées : Abonnements, Plans, Essais,
   * Paiements, Facturation SaaS, Promotions. DEUX sont livrées, et les
   * quatre autres n'ont pas d'écran : les promotions n'ont ni table ni
   * mécanisme d'application, les essais et les paiements sont des vues
   * de l'abonnement plutôt que des pages, et la facturation SaaS arrive
   * avec son propre lot.
   *
   * L'ORDRE COMPTE, et il n'est pas celui de la spec. « Plans et prix »
   * vient AVANT « Abonnements » parce que les quatre offres avaient
   * `monthly_price_cents` à NULL : sans prix, un abonnement ne vaut
   * rien, le MRR reste incalculable, et deux garde-fous de 0075
   * (`0075:866-886`) rendent délibérément le tableau de bord muet. Poser
   * les prix est ce qui rallume le reste ; la barre latérale le dit dans
   * son ordre de lecture.
   *
   * LES DEUX ENTRÉES PORTENT UNE PERMISSION DE LECTURE, jamais
   * d'écriture. `billing.plans.read` est portée par la facturation, le
   * support et le produit ; `billing.subscriptions.read` par la
   * facturation et le support. Exiger la permission d'écriture dans le
   * menu aurait caché la grille au support, qui doit précisément
   * pouvoir l'expliquer à un client sans pouvoir la changer.
   */
  {
    label: "Commercial",
    items: [
      {
        label: "Plans et prix",
        href: "/plans",
        icon: "coins",
        permission: "billing.plans.read",
        hint: "La grille tarifaire, et la matrice offre × module",
      },
      {
        label: "Abonnements",
        href: "/abonnements",
        icon: "briefcase",
        permission: "billing.subscriptions.read",
        hint: "Qui est abonné à quoi, et depuis quand",
      },
      {
        label: "Facturation SaaS",
        href: "/abonnements/factures",
        icon: "receipt",
        permission: "billing.invoices.read",
        hint: "Les factures qu'Oasis Care émet à ses entreprises clientes",
      },
    ],
  },
  /**
   * ------------------------------------------------------------------
   * ASSISTANCE — et pourquoi elle a une entrée alors qu'elle est vide
   * ------------------------------------------------------------------
   * La liste des demandes est à zéro et le restera tant qu'aucun
   * formulaire client n'existe : `open_support_ticket()` est appelable
   * par tout compte connecté, mais RIEN ne l'appelle encore, et les deux
   * applications qui devraient le faire — l'iPhone et Oasis Care Pro —
   * sont hors du périmètre de ce lot. L'écran le dit en haut de page
   * plutôt que de présenter ce zéro comme un calme.
   *
   * Les SESSIONS D'ASSISTANCE, elles, sont dans un cas tout différent :
   * un administrateur peut réellement en ouvrir une aujourd'hui, et la
   * spec p.19-21 en fait la partie la plus sensible du Control Center.
   * Sans entrée dans ce menu, la surveillance de ces sessions n'était
   * atteignable qu'en tapant l'URL — c'est-à-dire jamais.
   */
  {
    label: "Assistance",
    items: [
      {
        label: "Demandes",
        href: "/support",
        icon: "lifebuoy",
        permission: "support.tickets.read",
        hint: "Les demandes d'assistance, et ce qui manque pour qu'il y en ait",
      },
      {
        label: "Sessions d'accès",
        href: "/support/sessions",
        icon: "shield",
        permission: "support.sessions.read",
        hint: "Qui a ouvert un dossier client, pourquoi, et jusqu'à quand",
      },
    ],
  },
  /**
   * ------------------------------------------------------------------
   * SÉCURITÉ — le journal, qui est une exigence et non un confort
   * ------------------------------------------------------------------
   * « Toute action administrative importante est tracée » (spec p.31).
   * Une trace qu'on ne sait pas atteindre ne trace rien : le journal
   * n'existe qu'au moment où quelqu'un l'ouvre après coup, et il faut
   * donc qu'il soit à un clic.
   *
   * Ces deux écrans sont SÉPARÉS des Paramètres à dessein. Les
   * Paramètres regardent son propre compte ; la Sécurité regarde ce que
   * les AUTRES ont fait. Les mélanger inviterait à relire son propre
   * journal plutôt que celui de l'équipe.
   */
  {
    label: "Sécurité",
    items: [
      {
        label: "Vue de sécurité",
        href: "/securite",
        icon: "shield",
        permission: "platform.audit.read",
        hint: "Les gestes sensibles récents, et les accès clients ouverts",
      },
      {
        label: "Journal des actions",
        href: "/securite/journal",
        icon: "list",
        permission: "platform.audit.read",
        hint: "Qui a fait quoi, quand, et pour quel motif (spec p.31)",
      },
    ],
  },
  /**
   * ------------------------------------------------------------------
   * IA — la section que la spec p.5 annonçait, et qui arrive avec 0080
   * ------------------------------------------------------------------
   * Ces trois écrans EXISTAIENT, du mauvais côté : dans Oasis Care Pro,
   * ouverts au gestionnaire d'une entreprise cliente. Il pouvait y
   * choisir le modèle que l'éditeur paie, et relever le plafond de
   * dépense censé l'en empêcher. La spec p.16 le disait déjà : « Ne pas
   * exposer cette configuration aux clients ordinaires. »
   *
   * Les trois entrées portent la MÊME permission de lecture,
   * `ai.config.read`. Les droits d'ÉCRITURE, eux, sont séparés
   * (`ai.models.write` au produit, `ai.costLimits.write` à la
   * facturation) et ne se vérifient pas ici : un menu ne protège rien,
   * et les formulaires de chaque page s'effacent d'eux-mêmes pour un
   * rôle qui ne peut pas écrire.
   *
   * ATTENTION AU PIÈGE DE SEMIS, qui joue précisément ici : tant que la
   * migration 0080 n'est pas appliquée, `ai.config.read` n'est portée
   * par PERSONNE — pas même par le super-administrateur, dont les
   * permissions ont été semées par jointure au moment de 0075. Ces
   * trois entrées disparaîtraient alors du menu sans un mot. C'est
   * pourquoi les pages, elles, ne se contentent pas de refuser : elles
   * distinguent « migration absente » de « rôle trop étroit » et le
   * disent (voir `lib/ia/source.ts`, `diagnostiquerSocleIa`).
   */
  {
    label: "IA",
    items: [
      {
        label: "Routeur de modèles",
        href: "/ia",
        icon: "circuit",
        permission: "ai.config.read",
        hint: "Quel modèle pour quel agent, et chez qui",
      },
      {
        label: "Coûts IA",
        href: "/ia/couts",
        icon: "gauge",
        permission: "ai.config.read",
        hint: "Ce que l'IA consomme, toutes organisations",
      },
      {
        label: "Plafonds et quotas",
        href: "/ia/plafonds",
        icon: "coins",
        permission: "ai.config.read",
        hint: "Les bornes de dépense, par entreprise",
      },
    ],
  },
  /**
   * ------------------------------------------------------------------
   * PARAMÈTRES — ce qui concerne la plateforme elle-même, pas ses clients
   * ------------------------------------------------------------------
   * La spec p.6 éparpille ces écrans entre SECURITY (« Admins »,
   * « Permissions ») et ADMIN (« Configuration »). On les rassemble, et
   * la raison n'est pas cosmétique : tout le reste du Control Center
   * regarde DEHORS — des comptes, des entreprises, de l'argent, de
   * l'assistance. Ces trois écrans-là regardent DEDANS. Un exploitant
   * qui vient changer son second facteur ou nommer un collègue ne
   * cherche pas ces gestes dans « Sécurité » à côté des événements de
   * connexion suspecte : il cherche « Paramètres », comme partout
   * ailleurs.
   *
   * L'ordre est celui de la fréquence : on règle son compte tous les
   * jours, on nomme un collègue quelques fois par an, on relit la
   * matrice des rôles quand on doute.
   *
   * `/parametres/securite` (la politique de second facteur de l'équipe)
   * n'a PAS d'entrée à lui : c'est un onglet de `/parametres`, réservé à
   * `platform.security.write`. Une entrée de barre latérale pour un
   * réglage qu'on touche une fois par an aurait plus coûté en place
   * qu'elle n'aurait rapporté en clics.
   */
  {
    label: "Paramètres",
    items: [
      {
        label: "Paramètres",
        href: "/parametres",
        icon: "settings",
        // Voir `AdminNavItem.permission` : « tout administrateur ».
        permission: null,
        hint: "Votre compte, votre second facteur, les réglages de la plateforme",
      },
      {
        label: "Équipe Oasis Care",
        href: "/equipe",
        icon: "team",
        // La LECTURE de la liste. Nommer, changer de rôle et révoquer
        // exigent `platform.admins.manage`, que le garde-fou de 0081
        // réserve au seul super-administrateur — et l'écran désactive
        // ces gestes plutôt que de les laisser échouer.
        permission: "platform.admins.read",
        hint: "Qui administre la plateforme, avec quel rôle, depuis quand",
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
    items: group.items.filter(
      // `permission: null` = ouvert à tout administrateur de plateforme.
      // Cette fonction ne reçoit QUE les permissions d'un administrateur
      // déjà résolu par `requireAdmin()` : il n'y a pas de cas « visiteur
      // anonyme » à couvrir ici.
      (item) => item.permission === null || held.has(item.permission),
    ),
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
    .filter((permission): permission is PlatformPermission => permission !== null)
    .concat(SEARCH_PERMISSION);
}
