import type { IconName } from "@/components/shell/Icon";

/**
 * §31 ARCHITECTURE SEARCH — `SearchResult`, tel que la spec le décrit.
 *
 * La forme vient telle quelle de `global_search` (migration 0061) : le
 * web ne recompose ni l'URL ni l'icône. Un résultat sait où il mène ;
 * c'est ce qui permet à §23 « OUVERTURE DIRECTE » de marcher pour vingt
 * familles d'objets sans vingt branches dans l'interface.
 */
export type SearchResult = {
  entity_type: EntityType;
  entity_id: string;
  title: string;
  subtitle: string | null;
  icon: IconName;
  url: string;
  score: number;
};

export const ENTITY_TYPES = [
  "client", "prospect", "contact", "site",
  "project", "intervention", "task",
  "quote", "quote_line", "invoice",
  "garden", "garden_area", "garden_object", "plant",
  "lot", "location",
  "supplier", "purchase_order", "sales_order",
  "employee", "catalog_item",
] as const;

export type EntityType = (typeof ENTITY_TYPES)[number];

/**
 * §22 GROUPES — « Clients, Projets, Devis, Factures, Digital Twin,
 * Nursery, Documents ».
 *
 * Plusieurs types tombent dans le même groupe : un contact et une
 * propriété se rangent sous « Clients », parce que c'est là que
 * l'utilisateur ira les chercher. L'ordre du tableau est l'ordre
 * d'affichage — le plus fréquemment cherché en premier.
 */
export const SEARCH_GROUPS: { key: string; label: string; types: EntityType[] }[] = [
  { key: "clients", label: "Clients", types: ["client", "prospect", "contact", "site"] },
  { key: "projets", label: "Chantiers", types: ["project", "intervention", "task"] },
  { key: "devis", label: "Devis", types: ["quote", "quote_line"] },
  { key: "factures", label: "Factures", types: ["invoice"] },
  { key: "twin", label: "Digital Twin", types: ["garden", "garden_area", "garden_object", "plant"] },
  { key: "pepiniere", label: "Pépinière", types: ["lot", "location"] },
  { key: "achats", label: "Achats et commandes", types: ["supplier", "purchase_order", "sales_order"] },
  { key: "entreprise", label: "Équipe et catalogue", types: ["employee", "catalog_item"] },
];

/** Le libellé d'un type, au singulier — il s'affiche à côté d'un résultat. */
export const ENTITY_LABELS: Record<EntityType, string> = {
  client: "Client",
  prospect: "Prospect",
  contact: "Contact",
  site: "Propriété",
  project: "Chantier",
  intervention: "Intervention",
  task: "Tâche",
  quote: "Devis",
  quote_line: "Devis",
  invoice: "Facture",
  garden: "Jardin",
  garden_area: "Zone",
  garden_object: "Objet du plan",
  plant: "Végétal",
  lot: "Lot",
  location: "Emplacement",
  supplier: "Fournisseur",
  purchase_order: "Commande fournisseur",
  sales_order: "Commande client",
  employee: "Salarié",
  catalog_item: "Article",
};

/**
 * §25 FILTRES RECHERCHE — « Tout, Clients, Projets, Devis, Factures,
 * Nursery, Documents ».
 */
export const SEARCH_FILTERS: { key: string; label: string; types: EntityType[] | null }[] = [
  { key: "tout", label: "Tout", types: null },
  ...SEARCH_GROUPS.map((group) => ({ key: group.key, label: group.label, types: group.types })),
];

// ---------------------------------------------------------------
// §26 RECHERCHE AVANCÉE
// ---------------------------------------------------------------

/**
 * Les mots-clés de la syntaxe facultative — `type:devis Martin`.
 *
 * §"Ne pas obliger l'utilisateur à connaître cette syntaxe." Elle est
 * donc un RACCOURCI, jamais un préalable : une requête sans mot-clé
 * cherche partout, et un mot-clé inconnu est traité comme du texte
 * ordinaire plutôt que rejeté. Personne ne doit voir « syntaxe
 * invalide » pour avoir tapé « type de sol ».
 */
const TYPE_KEYWORDS: Record<string, EntityType[]> = {
  client: ["client"],
  clients: ["client"],
  prospect: ["prospect"],
  prospects: ["prospect"],
  contact: ["contact"],
  contacts: ["contact"],
  propriete: ["site"],
  chantier: ["project"],
  chantiers: ["project"],
  projet: ["project"],
  projets: ["project"],
  intervention: ["intervention"],
  interventions: ["intervention"],
  tache: ["task"],
  taches: ["task"],
  devis: ["quote", "quote_line"],
  facture: ["invoice"],
  factures: ["invoice"],
  jardin: ["garden", "garden_area", "garden_object", "plant"],
  jardins: ["garden", "garden_area", "garden_object", "plant"],
  plan: ["garden", "garden_area", "garden_object"],
  vegetal: ["plant", "garden_object"],
  lot: ["lot"],
  lots: ["lot"],
  emplacement: ["location"],
  fournisseur: ["supplier"],
  fournisseurs: ["supplier"],
  commande: ["purchase_order", "sales_order"],
  commandes: ["purchase_order", "sales_order"],
  salarie: ["employee"],
  equipe: ["employee"],
  article: ["catalog_item"],
  articles: ["catalog_item"],
  catalogue: ["catalog_item"],
};

export type ParsedQuery = {
  /** Le texte à chercher, mots-clés retirés. */
  text: string;
  /** Les types demandés, ou null pour « partout ». */
  types: EntityType[] | null;
  /** Les mots-clés effectivement reconnus — pour les montrer à l'écran. */
  keywords: string[];
};

/** `type:devis` et `status:overdue` s'écrivent sans accent ; on compare pareil. */
function fold(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export function parseQuery(raw: string): ParsedQuery {
  const words = raw.trim().split(/\s+/).filter(Boolean);
  const kept: string[] = [];
  const keywords: string[] = [];
  let types: EntityType[] | null = null;

  for (const word of words) {
    const separator = word.indexOf(":");
    // Un `:` en fin de mot n'est pas un mot-clé : c'est quelqu'un en
    // train de taper. On le laisse au texte plutôt que de le manger.
    if (separator > 0 && separator < word.length - 1) {
      const key = fold(word.slice(0, separator));
      const value = fold(word.slice(separator + 1));

      if (key === "type" && TYPE_KEYWORDS[value]) {
        types = [...(types ?? []), ...TYPE_KEYWORDS[value]];
        keywords.push(word);
        continue;
      }
      // Un mot-clé inconnu retombe dans le texte : §« Ne pas obliger
      // l'utilisateur à connaître cette syntaxe » vaut aussi pour ne pas
      // le punir de l'avoir mal devinée.
    }
    kept.push(word);
  }

  return {
    text: kept.join(" "),
    types: types === null ? null : [...new Set(types)],
    keywords,
  };
}

// ---------------------------------------------------------------
// §29 COMMAND PALETTE
// ---------------------------------------------------------------

/**
 * « La recherche globale sert aussi de palette de commandes. »
 *
 * Une commande n'est pas un résultat : elle CRÉE au lieu d'ouvrir. Elle
 * s'affiche donc en tête, dans son propre groupe, et jamais mélangée
 * aux clients trouvés — cliquer « Villa Martin » en croyant ouvrir la
 * fiche et créer un devis à la place serait le pire cas.
 */
export type Command = {
  id: string;
  label: string;
  hint?: string;
  url: string;
  icon: IconName;
  /** Les mots qui la déclenchent, sans accent. */
  triggers: string[];
};

export const COMMANDS: Command[] = [
  {
    id: "nouveau-devis",
    label: "Créer un devis",
    hint: "Nouveau devis",
    url: "/devis?nouveau=1",
    icon: "quote",
    triggers: ["nouveau devis", "creer devis", "devis", "ajouter devis"],
  },
  {
    id: "nouveau-client",
    label: "Ajouter un client",
    url: "/crm/clients/nouveau",
    icon: "clients",
    triggers: ["nouveau client", "ajouter client", "creer client", "client"],
  },
  {
    id: "nouveau-chantier",
    label: "Créer un chantier",
    url: "/projets?nouveau=1",
    icon: "projects",
    triggers: ["nouveau chantier", "creer chantier", "nouveau projet", "chantier"],
  },
  {
    id: "digital-twin",
    label: "Ouvrir le Digital Twin",
    url: "/digital-twin",
    icon: "twin",
    triggers: ["digital twin", "plan", "jardin", "modeliser"],
  },
  {
    id: "ma-societe",
    label: "Gérer ma société",
    hint: "SIRET, logo, assurances",
    url: "/entreprise",
    icon: "company",
    triggers: ["ma societe", "societe", "entreprise", "siret", "logo", "assurance"],
  },
  {
    id: "equipe",
    label: "Gérer l'équipe",
    url: "/entreprise/equipe",
    icon: "team",
    triggers: ["equipe", "membres", "inviter", "salaries"],
  },
  {
    id: "abonnement",
    label: "Voir mon abonnement",
    url: "/entreprise/abonnement",
    icon: "subscription",
    triggers: ["abonnement", "forfait", "plan", "facturation abonnement"],
  },
  {
    id: "analytics",
    label: "Ouvrir Analytics",
    url: "/analytics",
    icon: "analytics",
    triggers: ["analytics", "statistiques", "kpi", "tableau de bord analytique"],
  },
  {
    id: "oasis-ai",
    label: "Demander à Oasis AI",
    url: "/oasis-ai",
    icon: "ai",
    triggers: ["oasis ai", "ia", "assistant", "demander"],
  },
  {
    id: "parametres",
    label: "Ouvrir les paramètres",
    url: "/parametres",
    icon: "settings",
    triggers: ["parametres", "reglages", "configuration", "modules"],
  },
];

/**
 * Les commandes qui correspondent à ce qu'on tape.
 *
 * Un déclencheur doit COMMENCER par la saisie, ou la contenir comme
 * mot entier. « devis » propose « Créer un devis » ; « adevis » ne
 * propose rien, parce que ce n'est pas ce que la personne écrit.
 */
export function matchCommands(raw: string): Command[] {
  const query = fold(raw.trim());
  if (query.length < 2) return [];

  return COMMANDS.filter((command) =>
    command.triggers.some(
      (trigger) => trigger.startsWith(query) || trigger.split(" ").includes(query),
    ),
  ).slice(0, 4);
}
