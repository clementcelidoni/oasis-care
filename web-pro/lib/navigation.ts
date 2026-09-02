import type { BusinessType, Permission } from "@/lib/auth/permissions";
import type { IconName } from "@/components/shell/Icon";

/**
 * §5 SIDEBAR — la navigation, en SECTIONS.
 *
 * L'ancienne version était une liste plate de quinze entrées, dont
 * certaines portaient des sous-entrées. §5 demande autre chose : des
 * groupes nommés (PRINCIPAL, CRM, PROJETS, NURSERY, GESTION, ANALYSE,
 * ENTREPRISE) qui donnent une carte mentale du produit dès le premier
 * regard. Quinze liens à la file se lisent un par un ; sept groupes se
 * balayent.
 *
 * La règle de masquage ne change pas — §"Masquer intelligemment les
 * modules inutiles selon type d'entreprise, rôle, permissions" — et
 * §43 en ajoute une : l'entreprise peut éteindre elle-même un module
 * dont elle ne se sert pas. Ces trois filtres se cumulent, et aucun
 * n'est une protection : c'est RLS qui refuse les données.
 */

/**
 * Pour un module que la spec DÉCRIT sans le PROGRAMMER.
 *
 * Leur donner un numéro les allumerait le jour où ce milestone sort,
 * sur des pages qui n'existent pas — c'est exactement le 404 rencontré
 * au Milestone 8.
 */
export const UNSCHEDULED = 99;

/**
 * Les écrans livrés par la refonte UX elle-même. Numéro à part des
 * douze milestones du plan initial : ils sont tous sortis, et cette
 * amélioration est un chantier distinct.
 */
export const REFONTE = 13;

/** Les modules qu'une entreprise peut éteindre — §43. */
export const TOGGLEABLE_MODULES = [
  "crm", "projects", "nursery", "biolab", "invoicing", "equipment",
] as const;
export type ModuleKey = (typeof TOGGLEABLE_MODULES)[number];

export const MODULE_LABELS: Record<ModuleKey, string> = {
  crm: "CRM",
  projects: "Chantiers",
  nursery: "Pépinière",
  biolab: "BioLab",
  invoicing: "Facturation",
  equipment: "Matériel",
};

/**
 * LA PERMISSION D'UNE ENTRÉE EST CELLE QUI OUVRE SA TABLE PRINCIPALE.
 *
 * Pas celle qui semble décrire le module. « Commandes » sous
 * « Pépinière » se lit avec `quotes.read`, parce qu'une commande client
 * est une VENTE — même quand ce qu'on vend sort de la serre. Se fier au
 * nom du groupe donnait une entrée visible, une liste vide, aucune
 * erreur, et un numéro de document consommé à chaque essai de création.
 *
 * En cas de doute, la vérité est dans `pg_policies`, pas dans
 * l'intuition :
 *
 *     select tablename, qual from pg_policies
 *      where schemaname = 'public' and tablename = 'suppliers';
 */
export type NavItem = {
  label: string;
  href: string;
  icon: IconName;
  permission?: Permission;
  businessTypes?: BusinessType[];
  /** Le module §43 auquel ce lien appartient, s'il est débrayable. */
  module?: ModuleKey;
  /** Le jalon qui livre cet écran. */
  milestone: number;
};

export type NavGroup = {
  label: string;
  items: NavItem[];
};

const NURSERY_TYPES: BusinessType[] = [
  "nursery",
  "landscaperAndNursery",
  "horticulturalProducer",
];

const LANDSCAPE_TYPES: BusinessType[] = [
  "landscaper",
  "landscaperAndNursery",
  "gardenMaintenance",
  "other",
];

export const NAVIGATION: NavGroup[] = [
  {
    label: "Principal",
    items: [{ label: "Tableau de bord", href: "/", icon: "dashboard", milestone: 1 }],
  },
  {
    label: "CRM",
    items: [
      { label: "Clients", href: "/crm/clients", icon: "clients", permission: "clients.read", module: "crm", milestone: 2 },
      { label: "Prospects", href: "/crm/prospects", icon: "prospects", permission: "clients.read", module: "crm", milestone: 2 },
      { label: "Opportunités", href: "/crm/opportunites", icon: "analytics", permission: "clients.read", module: "crm", milestone: 2 },
    ],
  },
  {
    label: "Projets",
    items: [
      { label: "Chantiers", href: "/projets", icon: "projects", permission: "projects.read", businessTypes: LANDSCAPE_TYPES, module: "projects", milestone: 6 },
      { label: "Digital Twin", href: "/digital-twin", icon: "twin", permission: "digitalTwin.edit", milestone: 3 },
      { label: "Devis", href: "/devis", icon: "quote", permission: "quotes.read", milestone: 5 },
      { label: "Bibliothèque de prix", href: "/catalogue", icon: "lots", permission: "quotes.read", milestone: 5 },
      { label: "Planning", href: "/planning", icon: "planning", permission: "projects.read", module: "projects", milestone: 7 },
      { label: "Interventions", href: "/projets/interventions", icon: "interventions", permission: "projects.read", module: "projects", milestone: 7 },
      { label: "Visites", href: "/projets/visites", icon: "locations", permission: "projects.read", module: "projects", milestone: 7 },
      { label: "Équipes terrain", href: "/equipes", icon: "team", permission: "projects.manage", module: "projects", milestone: 7 },
    ],
  },
  {
    label: "Pépinière",
    items: [
      { label: "Tableau de bord", href: "/pepiniere", icon: "nursery", permission: "nursery.stock.manage", businessTypes: NURSERY_TYPES, module: "nursery", milestone: 8 },
      { label: "Production", href: "/pepiniere/production", icon: "production", permission: "nursery.stock.manage", businessTypes: NURSERY_TYPES, module: "nursery", milestone: 8 },
      { label: "Lots", href: "/pepiniere/lots", icon: "lots", permission: "nursery.stock.manage", businessTypes: NURSERY_TYPES, module: "nursery", milestone: REFONTE },
      { label: "Stocks", href: "/pepiniere/stock", icon: "stock", permission: "nursery.stock.manage", businessTypes: NURSERY_TYPES, module: "nursery", milestone: 8 },
      { label: "Emplacements", href: "/pepiniere/emplacements", icon: "locations", permission: "nursery.stock.manage", businessTypes: NURSERY_TYPES, module: "nursery", milestone: 8 },
      { label: "Santé", href: "/pepiniere/sante", icon: "help", permission: "nursery.stock.manage", businessTypes: NURSERY_TYPES, module: "nursery", milestone: 8 },
      // `sales_orders` est protégée par `quotes.read`, pas par
      // `nursery.stock.manage` : c'est une VENTE, même quand ce qu'on
      // vend sort de la pépinière. Avec l'ancienne permission, un
      // responsable pépinière voyait l'entrée, ouvrait une liste vide
      // sans message, et brûlait un numéro de commande à chaque
      // tentative de création — le compteur s'incrémente avant que
      // l'insertion échoue.
      { label: "Commandes", href: "/pepiniere/commandes", icon: "orders", permission: "quotes.read", businessTypes: NURSERY_TYPES, module: "nursery", milestone: 9 },
    ],
  },
  {
    label: "Gestion",
    items: [
      { label: "Factures", href: "/factures", icon: "invoice", permission: "invoice.create", module: "invoicing", milestone: 10 },
      { label: "Achats", href: "/achats", icon: "purchase", permission: "invoice.create", milestone: 9 },
      // Même correction : `suppliers` se lit avec `quotes.read` et
      // s'écrit avec `quotes.edit`. La comptabilité, qui a
      // `invoice.create` sans les droits sur les devis, voyait un
      // annuaire fournisseurs vide.
      { label: "Fournisseurs", href: "/fournisseurs", icon: "supplier", permission: "quotes.read", milestone: 9 },
      // §5 les liste, aucun milestone ne les programme. UNSCHEDULED les
      // laisse visibles comme « à venir » plutôt que de leur inventer
      // une date qu'aucune ligne de la spec ne donne.
      { label: "Matériel", href: "/materiel", icon: "equipment", permission: "projects.manage", module: "equipment", milestone: UNSCHEDULED },
      { label: "Documents", href: "/documents", icon: "document", permission: "projects.read", milestone: UNSCHEDULED },
    ],
  },
  {
    label: "Analyse",
    items: [
      { label: "Analytics", href: "/analytics", icon: "analytics", permission: "projects.read", milestone: 12 },
      { label: "Oasis AI", href: "/oasis-ai", icon: "ai", milestone: 12 },
    ],
  },
  {
    label: "Entreprise",
    items: [
      { label: "Ma société", href: "/entreprise", icon: "company", milestone: REFONTE },
      { label: "Équipe", href: "/entreprise/equipe", icon: "team", milestone: REFONTE },
      { label: "Abonnement", href: "/entreprise/abonnement", icon: "subscription", milestone: REFONTE },
      { label: "Paramètres", href: "/parametres", icon: "settings", milestone: 1 },
    ],
  },
];

/** Milestones already delivered. Everything above this is shown as coming. */
export const DELIVERED_THROUGH_MILESTONE = REFONTE;

export function isAvailable(item: NavItem): boolean {
  return item.milestone <= DELIVERED_THROUGH_MILESTONE;
}

/** Tous les liens, groupes aplatis — pour les contrôles et la recherche. */
export function allNavItems(groups: NavGroup[] = NAVIGATION): NavItem[] {
  return groups.flatMap((group) => group.items);
}

/**
 * Ce que CE compte voit.
 *
 * Trois filtres qui se cumulent, et un groupe vidé de tous ses liens
 * disparaît — une section « PÉPINIÈRE » sans rien dessous ferait
 * croire à un écran cassé.
 *
 * `disabledModules` vient de §43 : l'entreprise éteint ce dont elle ne
 * se sert pas. Ça ne remplace pas les entitlements, et ça ne protège
 * rien : c'est du rangement.
 */
export function visibleNavigation(
  businessType: BusinessType,
  permissions: Permission[],
  disabledModules: ModuleKey[] = [],
): NavGroup[] {
  const allowed = (item: NavItem) =>
    (!item.permission || permissions.includes(item.permission)) &&
    (!item.businessTypes || item.businessTypes.includes(businessType)) &&
    (!item.module || !disabledModules.includes(item.module));

  return NAVIGATION.map((group) => ({ ...group, items: group.items.filter(allowed) })).filter(
    (group) => group.items.length > 0,
  );
}
