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
/**
 * Pour un module que la spec DÉCRIT sans le PROGRAMMER.
 *
 * Le plan du document s'arrête à douze milestones ; §11P (matériel),
 * §11Q (contrats) et §11R (documents) n'y figurent dans aucun. Leur
 * donner un numéro les allumerait le jour où ce milestone sort, sur des
 * pages qui n'existent pas — c'est exactement le 404 rencontré au
 * Milestone 8.
 */
export const UNSCHEDULED = 99;

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
      // « Chantiers » n'est pas une sous-page : c'est /projets lui-même.
      // Deux adresses pour la même liste ne feraient qu'égarer.
      { label: "Visites", href: "/projets/visites", permission: "projects.read", milestone: 7 },
      { label: "Interventions", href: "/projets/interventions", permission: "projects.read", milestone: 7 },
      // La conception, c'est le Digital Twin, livré au Milestone 3.
      // Une page « Conception » vide à côté serait une fausse promesse.
      { label: "Conception", href: "/digital-twin", permission: "digitalTwin.edit", milestone: 3 },
    ],
  },
  { label: "Digital Twin", href: "/digital-twin", permission: "digitalTwin.edit", milestone: 3 },
  {
    label: "Devis",
    href: "/devis",
    permission: "quotes.read",
    milestone: 5,
    children: [
      { label: "Devis", href: "/devis", permission: "quotes.read", milestone: 5 },
      { label: "Bibliothèque de prix", href: "/catalogue", permission: "quotes.read", milestone: 5 },
    ],
  },
  { label: "Planning", href: "/planning", permission: "projects.read", milestone: 7 },
  { label: "Équipes", href: "/equipes", permission: "projects.manage", milestone: 7 },
  {
    label: "Pépinière",
    href: "/pepiniere",
    permission: "nursery.stock.manage",
    businessTypes: NURSERY_TYPES,
    milestone: 8,
    children: [
      // « Lots » n'est pas une sous-page : c'est /pepiniere lui-même,
      // comme « Chantiers » est /projets. Deux adresses pour la même
      // liste ne font qu'égarer.
      { label: "Tableau de bord", href: "/pepiniere", permission: "nursery.stock.manage", milestone: 8 },
      { label: "Production", href: "/pepiniere/production", permission: "nursery.stock.manage", milestone: 8 },
      { label: "Emplacements", href: "/pepiniere/emplacements", permission: "nursery.stock.manage", milestone: 8 },
      { label: "Stock", href: "/pepiniere/stock", permission: "nursery.stock.manage", milestone: 8 },
      { label: "Santé", href: "/pepiniere/sante", permission: "nursery.stock.manage", milestone: 8 },
      { label: "Commandes", href: "/pepiniere/commandes", permission: "nursery.stock.manage", milestone: 9 },
    ],
  },
  { label: "Achats", href: "/achats", permission: "invoice.create", milestone: 9 },
  { label: "Fournisseurs", href: "/fournisseurs", permission: "invoice.create", milestone: 9 },
  // Le stock VIVANT est celui de la pépinière, et il a sa propre page.
  // Celui-ci est l'autre : pots, substrat, paillage, consommables —
  // ce qui entre par une commande fournisseur, donc au Milestone 9.
  // Deux entrées nommées « Stocks » se seraient confondues.
  // Repoussé encore : le Milestone 9 livre les COMMANDES de fournitures,
  // pas un inventaire des consommables. La liste du milestone ne le
  // demande pas, et une page vide vaudrait moins qu’une promesse datée.
  { label: "Stock matériaux", href: "/stocks", permission: "nursery.stock.manage", milestone: UNSCHEDULED },
  { label: "Factures", href: "/factures", permission: "invoice.create", milestone: 10 },
  // §11P, §11Q et §11R décrivent ces modules, mais le plan de
  // milestones du document ne les programme nulle part. UNSCHEDULED les
  // laisse visibles comme « à venir » plutôt que de leur inventer une
  // date qu'aucune ligne de la spec ne donne.
  { label: "Contrats", href: "/contrats", permission: "projects.read", milestone: UNSCHEDULED },
  { label: "Matériel", href: "/materiel", permission: "projects.manage", milestone: UNSCHEDULED },
  { label: "Documents", href: "/documents", permission: "projects.read", milestone: UNSCHEDULED },
  // §11T porte les deux d'un seul tenant — « tableaux de bord
  // analytiques » et « outils IA sur des données structurées
  // stables » — et le plan les livre ensemble au douzième milestone.
  // Analytics portait 11 par anticipation ; le onzième s'est révélé
  // être le portail client.
  { label: "Analytics", href: "/analytics", permission: "projects.read", milestone: 12 },
  { label: "Oasis AI", href: "/oasis-ai", milestone: 12 },
  { label: "Paramètres", href: "/parametres", milestone: 1 },
];

/** Milestones already delivered. Everything above this is shown as coming. */
export const DELIVERED_THROUGH_MILESTONE = 11;

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
