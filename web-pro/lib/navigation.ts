import type { BusinessType, Permission } from "@/lib/auth/permissions";

/**
 * §"NAVIGATION WEB" — the full desktop navigation, with the rule that
 * follows it: "Masquer intelligemment les modules inutiles selon type
 * d'entreprise, rôle, permissions."
 *
 * A section with no `permission` is visible to any member. A section
 * with no `businessTypes` suits every kind of company.
 *
 * Sections whose module does not exist yet are marked `milestone`, so
 * the sidebar can show them as coming rather than linking to a 404 —
 * see `isAvailable`. Showing the shape of the product early is useful;
 * pretending a page exists is not.
 */
export type NavItem = {
  label: string;
  href: string;
  permission?: Permission;
  businessTypes?: BusinessType[];
  /** Milestone that delivers this section (see the Phase 11 spec). */
  milestone: number;
  children?: NavItem[];
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

export const NAVIGATION: NavItem[] = [
  { label: "Tableau de bord", href: "/", milestone: 1 },
  {
    label: "CRM",
    href: "/crm",
    permission: "clients.read",
    milestone: 2,
    children: [
      { label: "Prospects", href: "/crm/prospects", permission: "clients.read", milestone: 2 },
      { label: "Clients", href: "/crm/clients", permission: "clients.read", milestone: 2 },
      { label: "Opportunités", href: "/crm/opportunites", permission: "clients.read", milestone: 2 },
    ],
  },
  {
    label: "Projets",
    href: "/projets",
    permission: "projects.read",
    businessTypes: LANDSCAPE_TYPES,
    milestone: 6,
    children: [
      { label: "Visites", href: "/projets/visites", permission: "projects.read", milestone: 6 },
      { label: "Conception", href: "/projets/conception", permission: "projects.read", milestone: 6 },
      { label: "Chantiers", href: "/projets/chantiers", permission: "projects.read", milestone: 6 },
      { label: "Interventions", href: "/projets/interventions", permission: "projects.read", milestone: 7 },
    ],
  },
  { label: "Digital Twin", href: "/digital-twin", permission: "digitalTwin.edit", milestone: 3 },
  { label: "Devis", href: "/devis", permission: "quotes.read", milestone: 5 },
  { label: "Planning", href: "/planning", permission: "projects.read", milestone: 7 },
  { label: "Équipes", href: "/equipes", permission: "projects.manage", milestone: 7 },
  {
    label: "Pépinière",
    href: "/pepiniere",
    permission: "nursery.stock.manage",
    businessTypes: NURSERY_TYPES,
    milestone: 8,
    children: [
      { label: "Tableau de bord", href: "/pepiniere", permission: "nursery.stock.manage", milestone: 8 },
      { label: "Lots", href: "/pepiniere/lots", permission: "nursery.stock.manage", milestone: 8 },
      { label: "Production", href: "/pepiniere/production", permission: "nursery.stock.manage", milestone: 8 },
      { label: "Emplacements", href: "/pepiniere/emplacements", permission: "nursery.stock.manage", milestone: 8 },
      { label: "Stock", href: "/pepiniere/stock", permission: "nursery.stock.manage", milestone: 8 },
      { label: "Santé", href: "/pepiniere/sante", permission: "nursery.stock.manage", milestone: 8 },
      { label: "Commandes", href: "/pepiniere/commandes", permission: "nursery.stock.manage", milestone: 9 },
    ],
  },
  { label: "Achats", href: "/achats", permission: "invoice.create", milestone: 9 },
  { label: "Fournisseurs", href: "/fournisseurs", permission: "invoice.create", milestone: 9 },
  { label: "Stocks", href: "/stocks", permission: "nursery.stock.manage", milestone: 8 },
  { label: "Factures", href: "/factures", permission: "invoice.create", milestone: 10 },
  { label: "Contrats", href: "/contrats", permission: "projects.read", milestone: 10 },
  { label: "Matériel", href: "/materiel", permission: "projects.manage", milestone: 10 },
  { label: "Documents", href: "/documents", permission: "projects.read", milestone: 10 },
  { label: "Analytics", href: "/analytics", permission: "projects.read", milestone: 11 },
  { label: "Oasis AI", href: "/oasis-ai", milestone: 12 },
  { label: "Paramètres", href: "/parametres", milestone: 1 },
];

/** Milestones already delivered. Everything above this is shown as coming. */
export const DELIVERED_THROUGH_MILESTONE = 3;

export function isAvailable(item: NavItem): boolean {
  return item.milestone <= DELIVERED_THROUGH_MILESTONE;
}

export function visibleNavigation(
  businessType: BusinessType,
  permissions: Permission[],
): NavItem[] {
  const allowed = (item: NavItem) =>
    (!item.permission || permissions.includes(item.permission)) &&
    (!item.businessTypes || item.businessTypes.includes(businessType));

  return NAVIGATION.filter(allowed).map((item) => ({
    ...item,
    children: item.children?.filter(allowed),
  }));
}
