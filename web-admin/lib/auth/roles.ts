/**
 * ==================================================================
 * LES RÔLES DE PLATEFORME — le miroir TypeScript de la migration 0075
 * ==================================================================
 *
 * LE PIÈGE NOMINATIF DE CE PROJET, dit une fois pour toutes. Le mot
 * « admin » est DÉJÀ PRIS, et il désigne un rôle CLIENT :
 * `organization_members.role` accepte 'owner' et 'admin' (0043), et
 * `has_permission()` accorde tout à ces deux-là. Un « admin » dans
 * Oasis Care Pro est l'administrateur d'UNE entreprise cliente — un
 * client, donc, pas un membre de l'équipe Oasis Care.
 *
 * La spec p.32 : « Ne pas considérer simplement organization owner
 * comme admin Oasis Care. » Rien de ce fichier ne touche à
 * `organization_members`, à `role_permissions` ni à `has_permission()`.
 * Il n'y a aucun chemin de l'un vers l'autre, ici comme en base.
 *
 * ------------------------------------------------------------------
 * CE FICHIER NE DÉCIDE RIEN
 * ------------------------------------------------------------------
 * La matrice qui fait autorité est en base :
 * `platform_admin_role_permissions`, protégée par le déclencheur
 * `platform_admin_matrix_guard()` qui refuse littéralement d'y insérer
 * une ligne interdite par la spec p.30. Les permissions affichées dans
 * l'application viennent de `admin_me()`, donc de cette table — jamais
 * de la constante ci-dessous.
 *
 * Ce qui suit sert à DEUX choses, et à rien d'autre :
 *   • typer ce que `admin_me()` rend, pour que le compilateur attrape
 *     une permission mal orthographiée dans un appel de garde ;
 *   • donner des libellés français lisibles à l'écran.
 *
 * Si les deux divergent un jour, c'est la base qui a raison, et
 * `assertKnownPermission()` le signalera au lieu de laisser une
 * permission inconnue passer pour un refus silencieux.
 */

/** Les six rôles de la spec p.30, en snake_case comme la contrainte SQL. */
export const PLATFORM_ROLES = [
  "super_admin",
  "support",
  "billing_admin",
  "product_admin",
  "security_admin",
  "read_only_analyst",
] as const;

export type PlatformRole = (typeof PLATFORM_ROLES)[number];

/**
 * Les libellés visibles. En français, et SANS le mot « admin » seul :
 * « Administrateur » tout court se confondrait avec l'administrateur
 * d'une entreprise cliente, qui porte déjà ce nom dans Oasis Care Pro.
 */
export const ROLE_LABELS: Record<PlatformRole, string> = {
  super_admin: "Super-administrateur",
  support: "Support",
  billing_admin: "Facturation",
  product_admin: "Produit",
  security_admin: "Sécurité",
  read_only_analyst: "Analyste (lecture seule)",
};

/** Ce que chaque rôle est censé faire, en une phrase — affiché en survol. */
export const ROLE_DESCRIPTIONS: Record<PlatformRole, string> = {
  super_admin: "Tout le catalogue de permissions.",
  support:
    "Aide les clients : voit les comptes et les nombres, lit les abonnements, n'en modifie aucun (spec p.30).",
  billing_admin:
    "L'argent, et rien que l'argent : n'ouvre pas les données métier d'un client (spec p.30).",
  product_admin: "Les usages du produit ; ne touche pas aux paiements (spec p.30).",
  security_admin: "Le journal des actions administratives et la liste des administrateurs.",
  read_only_analyst: "Les chiffres, point. N'écrit rien, pas même dans le journal.",
};

/**
 * Le catalogue `platform_admin_permissions` de 0075, à l'identique.
 *
 * Toute chaîne passée à `requireAdmin()` doit venir d'ici : une
 * permission inventée ne serait jamais portée par aucun rôle, et
 * refuserait donc tout le monde en silence — le pire mode de
 * défaillance possible pour un contrôle d'accès, parce qu'il ressemble
 * à un fonctionnement normal.
 */
export const PLATFORM_PERMISSIONS = [
  "platform.dashboard.read",
  "platform.users.read",
  "platform.organizations.read",
  "platform.search",
  "platform.audit.read",
  "platform.admins.read",
  "platform.admins.manage",
  "customer.data.read",
  "billing.subscriptions.read",
  "billing.subscriptions.write",
  "billing.payments.write",

  /**
   * ----------------------------------------------------------------
   * LES TROIS CLÉS DE LA MIGRATION 0080 — la gouvernance de l'IA
   * ----------------------------------------------------------------
   * Elles ont déménagé d'Oasis Care Pro vers ici, et c'est le sujet
   * entier de 0080 : le gestionnaire d'une entreprise CLIENTE pouvait
   * basculer ses agents sur le modèle le plus cher ET relever lui-même
   * le plafond de dépense censé l'en empêcher. Un plafond que la partie
   * plafonnée contrôle ne protège de rien, et c'est l'éditeur qui reçoit
   * la facture du fournisseur.
   *
   * POURQUOI TROIS ET PAS UNE. Lire quel modèle tourne chez qui, changer
   * ce modèle, et lever un plafond ne sont pas le même geste et ne
   * coûtent pas la même chose. Une permission unique aurait fait de tout
   * porteur d'un droit de lecture un ordonnateur de dépense.
   *
   * Le produit choisit le modèle, la facturation fixe le plafond, et
   * AUCUN DES DEUX NE TIENT LES DEUX BOUTS — seul le super-administrateur
   * cumule. C'est la leçon du défaut corrigé : celui qui peut faire
   * monter la dépense ne doit pas pouvoir lever la borne qui l'arrête.
   * La règle est écrite deux fois, comme le veut 0075 : par l'absence de
   * la ligne dans la matrice, et par `platform_admin_matrix_guard()` qui
   * refuse de l'y insérer.
   */
  "ai.config.read",
  "ai.models.write",
  "ai.costLimits.write",

  /**
   * ----------------------------------------------------------------
   * LES DOUZE CLÉS DE LA MIGRATION 0081 — l'argent, l'assistance, le
   * produit, et la sécurité de l'équipe
   * ----------------------------------------------------------------
   * Pourquoi autant de clés plutôt qu'une « billing.manage » : lire une
   * grille tarifaire, la changer, émettre un document comptable et
   * encaisser ne sont pas le même geste et n'engagent pas la même
   * responsabilité. Une permission unique ferait de tout lecteur un
   * ordonnateur de dépense.
   *
   * LE PIÈGE DE SEMIS JOUE ENCORE ICI, et c'est la troisième fois. Les
   * permissions du super-administrateur ont été semées PAR JOINTURE au
   * moment où 0075 s'exécutait : une clé ajoutée après coup n'est portée
   * par PERSONNE tant qu'une migration ne rejoue pas la jointure. 0080
   * l'a rejouée, 0081 la rejoue. Tant que 0081 n'est pas appliquée, ces
   * douze clés existent ici et dans aucune fiche d'administrateur — les
   * écrans correspondants disparaissent alors du menu sans un mot.
   */
  "billing.plans.read",
  "billing.plans.write",
  "billing.invoices.read",
  "billing.invoices.write",
  "billing.issuer.write",
  // Les deux dernières viennent de 0083 (le prestataire d'encaissement).
  // Elles sont ici parce que la base les porte : ce fichier recopie le
  // catalogue, et un catalogue à moitié recopié laisse un écran
  // invisible pour tout le monde, sans erreur nulle part.
  "billing.providers.read",
  "billing.providers.write",
  "support.tickets.read",
  "support.tickets.write",
  "support.sessions.read",
  "support.sessions.manage",
  "product.flags.read",
  "product.flags.write",
  "platform.security.write",
] as const;

export type PlatformPermission = (typeof PLATFORM_PERMISSIONS)[number];

export const PERMISSION_LABELS: Record<PlatformPermission, string> = {
  "platform.dashboard.read": "Voir le tableau de bord et l'activité",
  "platform.users.read": "Lister les utilisateurs (métadonnées)",
  "platform.organizations.read": "Lister les entreprises Pro (nombres)",
  "platform.search": "Recherche administrative globale",
  "platform.audit.read": "Lire le journal des actions admin",
  "platform.admins.read": "Voir la liste des administrateurs",
  "platform.admins.manage": "Créer, modifier, révoquer un admin",
  // AUCUN RÔLE DE TRAVAIL NE LA PORTE dans ce jalon, et aucun écran ne
  // la consulte : par défaut, aucun accès aux données métier d'un
  // client. Elle figure au catalogue parce que « Billing : ne peut pas
  // ouvrir les données client » (spec p.30) n'a de sens que si la
  // permission existe, et un déclencheur en base refuse de l'accorder à
  // quatre des six rôles. Elle se rajoutera avec le mécanisme qui
  // l'encadre — consentement, session d'assistance bornée, journal
  // (milestone Admin 4).
  "customer.data.read": "Ouvrir les données métier d'un client",
  "billing.subscriptions.read": "Voir les abonnements",
  "billing.subscriptions.write": "Modifier un abonnement",
  "billing.payments.write": "Agir sur les paiements",

  // Les libellés recopient ceux que 0080 insère dans
  // `platform_admin_permissions`. Ce n'est pas de la coquetterie : un
  // administrateur qui lit « Voir l'aiguillage » sur un écran et
  // « Consulter la configuration IA » sur un autre croit à deux droits.
  "ai.config.read":
    "Voir l'aiguillage des modèles et les plafonds IA de toutes les entreprises",
  "ai.models.write": "Changer le modèle d'un agent chez une entreprise",
  "ai.costLimits.write": "Poser, relever ou lever un plafond de dépense IA",

  // Recopiés MOT POUR MOT de ce que 0081 § 1.a insère dans
  // `platform_admin_permissions`. Un administrateur qui lit deux
  // libellés différents pour la même clé croit à deux droits.
  "billing.plans.read": "Voir la grille tarifaire et la matrice des modules",
  "billing.plans.write": "Fixer les prix, les remises et la matrice des modules",
  "billing.invoices.read": "Lire les factures d'abonnement émises par Oasis Care",
  "billing.invoices.write": "Créer, émettre, encaisser, annuler une facture SaaS",
  "billing.issuer.write": "Modifier l'identité légale et le RIB de l'émetteur",
  "billing.providers.read": "Voir la correspondance des tarifs et le journal du prestataire",
  "billing.providers.write":
    "Enregistrer une correspondance de tarif et régler le mode d'encaissement",
  "support.tickets.read": "Lire les demandes d'assistance",
  "support.tickets.write": "Répondre, assigner, clore une demande d'assistance",
  "support.sessions.read": "Voir les sessions d'assistance et leur journal d'accès",
  "support.sessions.manage": "Ouvrir et révoquer une session d'assistance",
  "product.flags.read": "Voir les drapeaux de fonctionnalité",
  "product.flags.write": "Basculer un drapeau de fonctionnalité",
  "platform.security.write": "Régler la politique de second facteur des administrateurs",
};

/**
 * ==================================================================
 * LES FAMILLES DE PERMISSIONS — pour l'écran « Rôles et permissions »
 * ==================================================================
 *
 * Le préfixe n'est pas décoratif : c'est sur lui que
 * `platform_admin_matrix_guard()` raisonne en base. Les regrouper à
 * l'écran par la même clé de lecture que celle du garde-fou évite qu'un
 * lecteur se fabrique une carte mentale différente de celle qui
 * s'applique réellement.
 */
export const PERMISSION_FAMILIES = [
  {
    prefix: "platform.",
    label: "Plateforme",
    note: "Ce que l'équipe voit de la plateforme, et qui l'administre. Depuis 0081, aucune écriture en platform.* n'est accordable en dehors du super-administrateur et du responsable sécurité — et nommer un administrateur, au seul super-administrateur.",
  },
  {
    prefix: "customer.",
    label: "Données client",
    note: "Fermée par défaut à quatre rôles sur six. Ouvrir les données métier d'une entreprise cliente n'est pas une lecture d'administration : c'est un accès encadré par une session d'assistance, motivée, bornée dans le temps et journalisée.",
  },
  {
    prefix: "billing.",
    label: "Facturation",
    note: "L'argent d'Oasis Care Pro : la grille, les abonnements, les factures. Depuis 0081, l'écriture est en LISTE BLANCHE — personne n'y écrit sauf ceux dont c'est le métier — et l'identité légale de l'émetteur est réservée au super-administrateur.",
  },
  {
    prefix: "ai.",
    label: "IA de l'éditeur",
    note: "Le produit choisit le modèle, la facturation fixe le plafond, et aucun des deux ne tient les deux bouts : celui qui peut faire monter la dépense ne doit pas pouvoir lever la borne qui l'arrête.",
  },
  {
    prefix: "support.",
    label: "Assistance",
    note: "Les demandes des clients et les sessions d'accès encadrées. Le responsable sécurité SURVEILLE les sessions sans pouvoir en ouvrir : surveiller et faire ne sont pas le même rôle.",
  },
  { prefix: "product.", label: "Produit", note: "Les drapeaux de fonctionnalité." },
] as const;

/** La famille d'une permission, ou `null` si son préfixe est inconnu de l'interface. */
export function permissionFamily(
  permission: string,
): (typeof PERMISSION_FAMILIES)[number] | null {
  return PERMISSION_FAMILIES.find((family) => permission.startsWith(family.prefix)) ?? null;
}

/**
 * Les permissions d'ÉCRITURE, telles que ce fichier les connaît.
 *
 * C'est un miroir de la colonne `is_write` de `platform_admin_permissions`
 * — la base fait foi, et l'écran « Rôles et permissions » lit la vraie
 * colonne. Cette liste ne sert qu'aux endroits où l'on doit prévenir
 * sans aller-retour supplémentaire (« ce rôle pourra écrire ceci »).
 */
export const WRITE_PERMISSIONS: readonly PlatformPermission[] = [
  "platform.admins.manage",
  "platform.security.write",
  "billing.subscriptions.write",
  "billing.payments.write",
  "billing.plans.write",
  "billing.invoices.write",
  "billing.issuer.write",
  "billing.providers.write",
  "ai.models.write",
  "ai.costLimits.write",
  "support.tickets.write",
  "support.sessions.manage",
  "product.flags.write",
];

/**
 * ==================================================================
 * CE QUE NOMMER QUELQU'UN À CE RÔLE OUVRE, EN UNE PHRASE
 * ==================================================================
 *
 * Affiché À CÔTÉ DU CHOIX, sur l'écran « Équipe », et pas dans une
 * documentation qu'on ira lire un autre jour. Quelqu'un qui nomme un
 * « billing_admin » doit savoir, au moment où il clique, qu'il vient de
 * confier les prix de tout le catalogue et l'émission de documents
 * comptables.
 *
 * Ces phrases décrivent l'INTENTION de la matrice de 0075 et 0081. La
 * liste exacte des permissions vient de la base, sur
 * `/parametres/roles` — et c'est elle qui fait foi si les deux
 * divergent.
 */
export const ROLE_SCOPE: Record<PlatformRole, string> = {
  super_admin:
    "Tout. Y compris nommer et révoquer des administrateurs, et modifier l'identité légale de l'émetteur des factures. C'est le seul rôle qui puisse fabriquer un autre administrateur — ne le donnez qu'à quelqu'un dont le départ de l'équipe serait une décision, pas une surprise.",
  support:
    "Les comptes, les entreprises, les demandes d'assistance, et les sessions d'accès encadrées. Lit la grille tarifaire et les factures pour pouvoir les expliquer à un client ; n'en modifie aucune. Ne modifie aucun abonnement (spec p.30).",
  billing_admin:
    "L'argent d'Oasis Care Pro : la grille tarifaire, les abonnements, les factures, l'encaissement, et les plafonds de dépense IA. N'ouvre PAS les données métier d'un client (spec p.30), et ne choisit pas le modèle des agents.",
  product_admin:
    "Les usages du produit, les drapeaux de fonctionnalité, et le choix du modèle des agents IA. Ne touche à aucun paiement (spec p.30), et ne lève aucun plafond de dépense.",
  security_admin:
    "Le journal des actions administratives, la liste des administrateurs, la politique de second facteur, et la SURVEILLANCE des sessions d'assistance. Il n'en ouvre aucune, et il ne nomme personne : surveiller et faire ne sont pas le même rôle.",
  read_only_analyst:
    "Les chiffres et les listes, rien d'autre. N'écrit rien, pas même une ligne de journal — `record_admin_event()` le refuse nommément, donc aucun geste administratif ne lui est possible même si une permission lui était accordée par erreur.",
};

export function isPlatformRole(value: unknown): value is PlatformRole {
  return typeof value === "string" && (PLATFORM_ROLES as readonly string[]).includes(value);
}

export function isPlatformPermission(value: unknown): value is PlatformPermission {
  return (
    typeof value === "string" && (PLATFORM_PERMISSIONS as readonly string[]).includes(value)
  );
}

/**
 * Le libellé d'un rôle qu'on ne connaît pas encore.
 *
 * Ce cas est réel : la base peut gagner un septième rôle avant que ce
 * fichier ne soit mis à jour. On affiche alors la valeur brute plutôt
 * que « inconnu » — un administrateur doit pouvoir lire sa propre
 * casquette même quand l'interface a un train de retard.
 */
export function roleLabel(role: string): string {
  return isPlatformRole(role) ? ROLE_LABELS[role] : role;
}

export function permissionLabel(permission: string): string {
  return isPlatformPermission(permission) ? PERMISSION_LABELS[permission] : permission;
}
