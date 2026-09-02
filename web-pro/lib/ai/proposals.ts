import type { Permission } from "@/lib/auth/permissions";
import { formatCents } from "@/lib/quotes/types";

/**
 * §11U OASIS PRO AI — CE QUE L'ASSISTANT PROPOSE, ET COMMENT ON LE DIT.
 *
 * L'assistant ne peut rien écrire de lui-même : l'Edge Function
 * n'appelle aucune fonction d'écriture, elle se contente de déposer une
 * PROPOSITION (`{ kind, args }`). Ce fichier est la table qui traduit
 * cette proposition en trois choses :
 *
 *   1. UNE FONCTION POSTGRES À APPELER. Le nom du RPC est ICI, et
 *      nulle part ailleurs. Il ne transite ni par le modèle, ni par le
 *      navigateur. Un `kind` inconnu n'a pas de RPC, donc ne s'exécute
 *      pas — c'est la raison pour laquelle la vérification est un
 *      accès à une table figée plutôt qu'une chaîne reçue.
 *
 *   2. LA LISTE BLANCHE DES PARAMÈTRES. Les arguments font l'aller-
 *      retour par le navigateur ; on ne garde que les clés attendues.
 *      Sans ce filtre, un `p_organization_id` glissé dans le JSON
 *      arriverait jusqu'au RPC et choisirait l'entreprise à la place
 *      de la session. La fonction SQL refuserait — elle vérifie
 *      l'appartenance — mais on ne laisse pas la tentative partir.
 *
 *   3. UN RÉSUMÉ EN FRANÇAIS, ÉCRIT PAR NOUS. C'est le point qui compte
 *      pour l'injection de prompt : le texte que l'utilisateur lit
 *      avant de cliquer ne vient PAS du modèle. Il est composé ici à
 *      partir des paramètres typés. Un client nommé « Ignore les
 *      instructions précédentes » s'affiche comme un nom de client
 *      bizarre dans une ligne « Nom », pas comme une consigne, et
 *      certainement pas à la place de « Ceci créera une fiche ».
 *
 * POURQUOI LES PARAMÈTRES REFONT UN ALLER-RETOUR PAR LE NAVIGATEUR.
 * Il n'y a pas de session serveur où les garder, et en inventer une
 * pour ça coûterait plus qu'elle ne rapporte : le seul acteur capable
 * de modifier ce JSON est l'utilisateur lui-même, et la fonction SQL
 * revérifie sa permission et son organisation. Il ne peut donc rien
 * obtenir qu'il n'obtiendrait déjà par l'écran correspondant.
 */

export const PROPOSAL_KINDS = [
  "createCustomer",
  "createOpportunity",
  "setOpportunityStage",
  "logActivity",
  "createQuoteDraft",
  "addQuoteDraftLines",
  "createCatalogItem",
  "createProject",
  "addProjectPhase",
  "addProjectTask",
  "setPhaseProgress",
  "scheduleIntervention",
  "createNurseryLot",
  "recordStockMovement",
  "createPurchaseOrderDraft",
] as const;

export type ProposalKind = (typeof PROPOSAL_KINDS)[number];

export type Proposal = { kind: ProposalKind; args: Record<string, unknown> };

/** Une ligne du récapitulatif : un libellé, une valeur déjà mise en forme. */
export type SummaryRow = { label: string; value: string };

type Spec = {
  /** La fonction Postgres. Migration 0069, sauf mention contraire. */
  rpc: string;
  /** Celle qu'exige l'écran équivalent, et que la fonction SQL revérifie. */
  permission: Permission;
  /** Le bouton, à l'impératif. */
  action: string;
  /** Ce que ça produit, en une phrase — y compris ce que ça NE fait PAS. */
  effect: string;
  /** Les seuls paramètres transmis au RPC. */
  params: readonly string[];
  /** Le titre de la carte, composé à partir des arguments. */
  headline: (args: Record<string, unknown>) => string;
  /** Le détail, ligne à ligne. */
  rows: (args: Record<string, unknown>) => SummaryRow[];
  /** Où aller voir le résultat, une fois écrit. */
  href?: (result: Record<string, unknown>) => string | null;
  /** Les chemins à revalider après l'écriture. */
  revalidate: readonly string[];
};

// ---------------------------------------------------------------
// Lectures défensives
// ---------------------------------------------------------------
// Les arguments viennent d'un modèle de langage puis d'un aller-retour
// par le navigateur : rien ne garantit leur type. Ces trois fonctions
// ne devinent jamais — une valeur absente reste absente.

function str(args: Record<string, unknown>, key: string): string | null {
  const value = args[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function num(args: Record<string, unknown>, key: string): number | null {
  const value = args[key];
  // `typeof value === "number"` d'abord : un zéro est une valeur, et
  // c'est le défaut historique de ce projet — `parse(x) || 20` faisait
  // partir une TVA à 0 % à 20 %.
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value.replace(",", "."));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function lines(args: Record<string, unknown>, key = "p_lines"): Record<string, unknown>[] {
  const value = args[key];
  if (!Array.isArray(value)) return [];
  return value.filter((line): line is Record<string, unknown> =>
    typeof line === "object" && line !== null && !Array.isArray(line),
  );
}

/** Une valeur affichable, bornée. Ce qui dépasse est coupé, pas caché. */
function short(value: string | null, max = 120): string {
  if (!value) return "—";
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function money(cents: number | null): string {
  return cents === null ? "—" : formatCents(cents);
}

function frenchDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? short(value, 40)
    : date.toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
}

function frenchDateTime(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? short(value, 40)
    : date.toLocaleString("fr-FR", {
        weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit",
      });
}

/**
 * Le récapitulatif des lignes d'un devis ou d'une commande.
 *
 * LE TOTAL EST CALCULÉ ICI, pas repris de la prose du modèle. C'est le
 * chiffre sur lequel l'utilisateur décide, et il doit correspondre à ce
 * que la base écrira : quantité × prix unitaire, sans arrondi
 * intermédiaire, comme la colonne générée de `quote_lines`.
 */
function lineRows(items: Record<string, unknown>[], priceKey: string): SummaryRow[] {
  const rows: SummaryRow[] = items.slice(0, 12).map((line) => {
    const quantity = num(line, "quantity") ?? 1;
    const unit = str(line, "unit") ?? "u";
    const price = num(line, priceKey);
    return {
      label: short(str(line, "description") ?? "Ligne sans désignation", 80),
      value: price === null
        ? `${quantity} ${unit}`
        : `${quantity} ${unit} × ${formatCents(price)} = ${formatCents(Math.round(quantity * price))}`,
    };
  });

  if (items.length > 12) {
    rows.push({ label: "…", value: `et ${items.length - 12} autre(s) ligne(s)` });
  }

  const total = items.reduce((sum, line) => {
    const quantity = num(line, "quantity") ?? 1;
    const price = num(line, priceKey) ?? 0;
    return sum + Math.round(quantity * price);
  }, 0);
  rows.push({ label: "Total HT", value: money(total) });

  return rows;
}

const ACTIVITY_LABELS: Record<string, string> = {
  note: "Note", call: "Appel", email: "E-mail", meeting: "Rendez-vous",
  visit: "Visite", task: "Tâche", custom: "Autre",
};

const STAGE_LABELS: Record<string, string> = {
  qualification: "Qualification", visit: "Visite", design: "Conception",
  quoted: "Devis remis", negotiation: "Négociation",
};

const PHASE_STATUS_LABELS: Record<string, string> = {
  notStarted: "Pas commencée", inProgress: "En cours", blocked: "Bloquée", done: "Terminée",
};

const INTERVENTION_KIND_LABELS: Record<string, string> = {
  visit: "Visite", work: "Travaux", maintenance: "Entretien",
  delivery: "Livraison", repair: "Réparation", other: "Autre",
};

const MOVEMENT_LABELS: Record<string, string> = {
  receive: "Réception", move: "Déplacement", reserve: "Réservation",
  unreserve: "Levée de réservation", quarantine: "Mise en quarantaine",
  release: "Sortie de quarantaine", loss: "Perte",
};

const ITEM_TYPE_LABELS: Record<string, string> = {
  plant: "Végétal", material: "Matériau", labor: "Main-d'œuvre", equipment: "Matériel",
  rental: "Location", transport: "Transport", waste: "Évacuation",
  subcontracting: "Sous-traitance", service: "Prestation", custom: "Autre",
};

export const PROPOSALS: Record<ProposalKind, Spec> = {
  createCustomer: {
    rpc: "ai_create_customer",
    permission: "clients.write",
    action: "Créer la fiche",
    effect:
      "Une fiche apparaîtra dans votre CRM. Rien n'est envoyé à cette personne : ni e-mail, ni invitation.",
    params: [
      "p_display_name", "p_kind", "p_lifecycle_stage", "p_email", "p_phone",
      "p_address_line1", "p_postal_code", "p_city", "p_source", "p_notes",
    ],
    headline: (a) =>
      str(a, "p_lifecycle_stage") === "customer"
        ? `Nouveau client : ${short(str(a, "p_display_name"), 60)}`
        : `Nouveau prospect : ${short(str(a, "p_display_name"), 60)}`,
    rows: (a) => [
      { label: "Nom", value: short(str(a, "p_display_name")) },
      { label: "Type", value: str(a, "p_kind") === "company" ? "Entreprise" : "Particulier" },
      { label: "Étape", value: str(a, "p_lifecycle_stage") === "customer" ? "Client" : "Prospect" },
      { label: "E-mail", value: short(str(a, "p_email"), 80) },
      { label: "Téléphone", value: short(str(a, "p_phone"), 40) },
      {
        label: "Adresse",
        value: short([str(a, "p_address_line1"), str(a, "p_postal_code"), str(a, "p_city")]
          .filter(Boolean).join(", ") || null),
      },
      { label: "Notes", value: short(str(a, "p_notes"), 200) },
    ],
    href: (r) => (typeof r.clientId === "string" ? `/crm/clients/${r.clientId}` : null),
    revalidate: ["/crm/clients", "/crm/prospects"],
  },

  createOpportunity: {
    rpc: "ai_create_opportunity",
    permission: "clients.write",
    action: "Créer l'opportunité",
    effect: "Elle entrera dans le pipeline à l'étape « Qualification ». Aucun devis n'est créé.",
    params: [
      "p_customer_id", "p_title", "p_estimated_value_cents",
      "p_probability_percent", "p_expected_close_date", "p_notes",
    ],
    headline: (a) => `Opportunité : ${short(str(a, "p_title"), 60)}`,
    rows: (a) => [
      { label: "Intitulé", value: short(str(a, "p_title")) },
      { label: "Montant estimé", value: money(num(a, "p_estimated_value_cents")) },
      {
        label: "Probabilité",
        value: num(a, "p_probability_percent") === null ? "—" : `${num(a, "p_probability_percent")} %`,
      },
      { label: "Clôture attendue", value: frenchDate(str(a, "p_expected_close_date")) },
    ],
    revalidate: ["/crm/opportunites"],
  },

  setOpportunityStage: {
    rpc: "ai_set_opportunity_stage",
    permission: "clients.write",
    action: "Déplacer l'opportunité",
    effect:
      "Elle changera d'étape dans le pipeline. Gagner ou perdre une affaire reste une décision qui se prend sur la fiche.",
    params: ["p_opportunity_id", "p_stage"],
    headline: (a) => `Passer l'opportunité en « ${STAGE_LABELS[str(a, "p_stage") ?? ""] ?? short(str(a, "p_stage"), 40)} »`,
    rows: (a) => [
      { label: "Nouvelle étape", value: STAGE_LABELS[str(a, "p_stage") ?? ""] ?? short(str(a, "p_stage"), 40) },
    ],
    revalidate: ["/crm/opportunites"],
  },

  logActivity: {
    rpc: "ai_log_activity",
    permission: "clients.write",
    action: "Consigner",
    effect:
      "L'échange s'ajoutera à l'historique du client. CONSIGNER N'EST PAS ENVOYER : aucun e-mail, aucun message ne part.",
    params: [
      "p_activity_type", "p_subject", "p_body", "p_customer_id", "p_opportunity_id", "p_due_at",
    ],
    headline: (a) =>
      `${ACTIVITY_LABELS[str(a, "p_activity_type") ?? ""] ?? "Activité"} : ${short(str(a, "p_subject"), 60)}`,
    rows: (a) => [
      { label: "Type", value: ACTIVITY_LABELS[str(a, "p_activity_type") ?? ""] ?? "Note" },
      { label: "Objet", value: short(str(a, "p_subject")) },
      { label: "Détail", value: short(str(a, "p_body"), 300) },
      { label: "Échéance", value: frenchDateTime(str(a, "p_due_at")) },
    ],
    revalidate: ["/crm/clients"],
  },

  createQuoteDraft: {
    // La seule qui date de 0058. Elle passe désormais par le même
    // chemin de confirmation que les autres : jusqu'ici, l'assistant
    // créait le brouillon pendant la conversation.
    rpc: "ai_create_quote_draft",
    permission: "quotes.create",
    action: "Créer le brouillon",
    effect:
      "Un devis au statut BROUILLON. Il n'est ni numéroté pour le client, ni envoyé : relisez les prix avant de le transmettre.",
    params: ["p_customer_id", "p_title", "p_lines"],
    headline: (a) => `Brouillon de devis : ${short(str(a, "p_title"), 60)}`,
    rows: (a) => [
      { label: "Titre", value: short(str(a, "p_title")) },
      ...lineRows(lines(a), "unit_sale_price_cents"),
    ],
    href: (r) => (typeof r.devisId === "string" ? `/devis/${r.devisId}` : null),
    revalidate: ["/devis"],
  },

  addQuoteDraftLines: {
    rpc: "ai_add_quote_draft_lines",
    permission: "quotes.edit",
    action: "Ajouter les lignes",
    effect:
      "Les lignes s'ajouteront à la suite des existantes. Impossible sur un devis déjà envoyé : ce serait changer un prix que le client a sous les yeux.",
    params: ["p_quote_id", "p_lines"],
    headline: (a) => {
      const count = lines(a).length;
      return `Ajouter ${count} ligne${count > 1 ? "s" : ""} au brouillon`;
    },
    rows: (a) => lineRows(lines(a), "unit_sale_price_cents"),
    href: (r) => (typeof r.devisId === "string" ? `/devis/${r.devisId}` : null),
    revalidate: ["/devis"],
  },

  createCatalogItem: {
    rpc: "ai_create_catalog_item",
    permission: "quotes.edit",
    action: "Ajouter au catalogue",
    effect:
      "L'article sera créé SANS TARIF : un prix de grille se recopie tout seul dans tous les devis suivants, et c'est à vous de le fixer.",
    params: ["p_name", "p_item_type", "p_unit", "p_reference", "p_description"],
    headline: (a) => `Article : ${short(str(a, "p_name"), 60)}`,
    rows: (a) => [
      { label: "Nom", value: short(str(a, "p_name")) },
      { label: "Type", value: ITEM_TYPE_LABELS[str(a, "p_item_type") ?? ""] ?? "Matériau" },
      { label: "Unité", value: short(str(a, "p_unit") ?? "u", 20) },
      { label: "Référence", value: short(str(a, "p_reference"), 60) },
    ],
    revalidate: ["/catalogue"],
  },

  createProject: {
    rpc: "ai_create_project",
    permission: "projects.manage",
    action: "Ouvrir le chantier",
    effect:
      "Le chantier sera créé au statut « prévu ». Le démarrer, le terminer ou le livrer reste un geste humain — la marge se calcule sur les chantiers terminés.",
    params: [
      "p_customer_id", "p_name", "p_site_id", "p_quote_id",
      "p_planned_start_on", "p_planned_end_on", "p_notes",
    ],
    headline: (a) => `Chantier : ${short(str(a, "p_name"), 60)}`,
    rows: (a) => [
      { label: "Nom", value: short(str(a, "p_name")) },
      { label: "Début prévu", value: frenchDate(str(a, "p_planned_start_on")) },
      { label: "Fin prévue", value: frenchDate(str(a, "p_planned_end_on")) },
      { label: "Devis rattaché", value: str(a, "p_quote_id") ? "Oui" : "Aucun" },
    ],
    href: (r) => (typeof r.chantierId === "string" ? `/projets/${r.chantierId}` : null),
    revalidate: ["/projets"],
  },

  addProjectPhase: {
    rpc: "ai_add_project_phase",
    permission: "projects.manage",
    action: "Ajouter la phase",
    effect: "Elle se placera à la suite des phases existantes, à 0 % d'avancement.",
    params: ["p_project_id", "p_title", "p_planned_start_on", "p_planned_end_on"],
    headline: (a) => `Phase : ${short(str(a, "p_title"), 60)}`,
    rows: (a) => [
      { label: "Intitulé", value: short(str(a, "p_title")) },
      { label: "Début prévu", value: frenchDate(str(a, "p_planned_start_on")) },
      { label: "Fin prévue", value: frenchDate(str(a, "p_planned_end_on")) },
    ],
    revalidate: ["/projets"],
  },

  addProjectTask: {
    rpc: "ai_add_project_task",
    permission: "projects.manage",
    action: "Ajouter la tâche",
    effect: "Elle apparaîtra dans la liste des tâches du chantier, à faire.",
    params: ["p_project_id", "p_title", "p_phase_id", "p_planned_hours", "p_due_on"],
    headline: (a) => `Tâche : ${short(str(a, "p_title"), 60)}`,
    rows: (a) => [
      { label: "Intitulé", value: short(str(a, "p_title")) },
      {
        label: "Heures prévues",
        value: num(a, "p_planned_hours") === null ? "—" : `${num(a, "p_planned_hours")} h`,
      },
      { label: "Échéance", value: frenchDate(str(a, "p_due_on")) },
    ],
    revalidate: ["/projets"],
  },

  setPhaseProgress: {
    rpc: "ai_set_phase_progress",
    permission: "projects.manage",
    action: "Mettre à jour",
    effect:
      "L'avancement de la phase changera. C'est un chiffre déclaré, jamais déduit des heures pointées.",
    params: ["p_phase_id", "p_progress_percent", "p_status"],
    headline: (a) => `Avancement de la phase : ${num(a, "p_progress_percent") ?? "?"} %`,
    rows: (a) => [
      {
        label: "Avancement",
        value: num(a, "p_progress_percent") === null ? "—" : `${num(a, "p_progress_percent")} %`,
      },
      {
        label: "Statut",
        value: str(a, "p_status") ? (PHASE_STATUS_LABELS[str(a, "p_status") ?? ""] ?? "—") : "Inchangé",
      },
    ],
    revalidate: ["/projets"],
  },

  scheduleIntervention: {
    rpc: "ai_schedule_intervention",
    permission: "projects.manage",
    action: "Poser au planning",
    effect:
      "L'intervention apparaîtra au planning, au statut « prévue ». Personne n'en est prévenu automatiquement.",
    params: [
      "p_title", "p_scheduled_start", "p_scheduled_end", "p_kind",
      "p_project_id", "p_customer_id", "p_site_id", "p_team_id", "p_instructions",
    ],
    headline: (a) => `${INTERVENTION_KIND_LABELS[str(a, "p_kind") ?? ""] ?? "Intervention"} : ${short(str(a, "p_title"), 60)}`,
    rows: (a) => [
      { label: "Intitulé", value: short(str(a, "p_title")) },
      { label: "Début", value: frenchDateTime(str(a, "p_scheduled_start")) },
      { label: "Fin", value: frenchDateTime(str(a, "p_scheduled_end")) },
      { label: "Consignes", value: short(str(a, "p_instructions"), 300) },
    ],
    href: (r) => (typeof r.interventionId === "string" ? `/projets/interventions/${r.interventionId}` : null),
    revalidate: ["/planning", "/projets/interventions"],
  },

  createNurseryLot: {
    rpc: "ai_create_nursery_lot",
    permission: "nursery.stock.manage",
    action: "Créer le lot",
    effect:
      "Le lot sera créé, et sa quantité entrera par un mouvement de réception — comme sur l'écran, pour que son journal commence par son origine.",
    params: [
      "p_species_name", "p_initial_quantity", "p_lot_code", "p_cultivar",
      "p_container_size", "p_stage_id", "p_location_id", "p_supplier_id", "p_notes",
    ],
    headline: (a) => `Lot : ${short(str(a, "p_species_name"), 60)}`,
    rows: (a) => [
      { label: "Espèce", value: short(str(a, "p_species_name")) },
      { label: "Cultivar", value: short(str(a, "p_cultivar"), 60) },
      {
        label: "Quantité",
        value: num(a, "p_initial_quantity") === null ? "0" : String(num(a, "p_initial_quantity")),
      },
      { label: "Contenant", value: short(str(a, "p_container_size"), 40) },
      { label: "Code du lot", value: str(a, "p_lot_code") ? short(str(a, "p_lot_code"), 40) : "Numéroté par Oasis" },
    ],
    href: (r) => (typeof r.lotId === "string" ? `/pepiniere/lots/${r.lotId}` : null),
    revalidate: ["/pepiniere", "/pepiniere/lots", "/pepiniere/stock"],
  },

  recordStockMovement: {
    rpc: "ai_record_stock_movement",
    permission: "nursery.stock.manage",
    action: "Enregistrer le mouvement",
    effect:
      "Le stock du lot changera et le mouvement rejoindra son journal, qui ne s'efface pas. Vendre et ajuster un inventaire restent des saisies humaines.",
    params: ["p_lot_id", "p_kind", "p_quantity", "p_to_location_id", "p_reason"],
    headline: (a) =>
      `${MOVEMENT_LABELS[str(a, "p_kind") ?? ""] ?? "Mouvement"} de ${num(a, "p_quantity") ?? "?"} unité(s)`,
    rows: (a) => [
      { label: "Mouvement", value: MOVEMENT_LABELS[str(a, "p_kind") ?? ""] ?? short(str(a, "p_kind"), 40) },
      { label: "Quantité", value: num(a, "p_quantity") === null ? "—" : String(num(a, "p_quantity")) },
      { label: "Motif", value: short(str(a, "p_reason"), 200) },
    ],
    href: (r) => (typeof r.lotId === "string" ? `/pepiniere/lots/${r.lotId}` : null),
    revalidate: ["/pepiniere", "/pepiniere/lots", "/pepiniere/stock"],
  },

  createPurchaseOrderDraft: {
    rpc: "ai_create_purchase_order_draft",
    permission: "invoice.create",
    action: "Créer le brouillon",
    effect:
      "Une commande fournisseur au statut BROUILLON. ELLE N'EST PAS ENVOYÉE : l'envoi est l'engagement d'achat, et il vous revient.",
    params: ["p_supplier_id", "p_lines", "p_expected_on", "p_reference", "p_notes"],
    headline: () => "Brouillon de commande fournisseur",
    rows: (a) => [
      { label: "Réception attendue", value: frenchDate(str(a, "p_expected_on")) },
      { label: "Référence", value: short(str(a, "p_reference"), 60) },
      ...lineRows(lines(a), "unit_cost_cents"),
    ],
    href: (r) => (typeof r.commandeId === "string" ? `/achats/${r.commandeId}` : null),
    revalidate: ["/achats"],
  },
};

/** Le `kind` reçu est-il l'un des nôtres ? Rien d'autre ne s'exécute. */
export function isProposalKind(value: unknown): value is ProposalKind {
  return typeof value === "string" && (PROPOSAL_KINDS as readonly string[]).includes(value);
}

/**
 * Ce que l'utilisateur lit avant de cliquer.
 *
 * Composé à partir des paramètres, jamais de la prose du modèle : c'est
 * ce qui fait qu'une donnée empoisonnée ne peut pas réécrire l'étiquette
 * du bouton. Les lignes vides sont retirées — un récapitulatif rempli de
 * tirets se lit moins bien qu'un récapitulatif court.
 */
export function describeProposal(proposal: Proposal): {
  headline: string;
  action: string;
  effect: string;
  rows: SummaryRow[];
} {
  const spec = PROPOSALS[proposal.kind];
  return {
    headline: spec.headline(proposal.args),
    action: spec.action,
    effect: spec.effect,
    rows: spec.rows(proposal.args).filter((row) => row.value !== "—"),
  };
}

/**
 * Les seuls arguments qui partent vers Postgres.
 *
 * Tout ce qui n'est pas dans la liste blanche est jeté, `p_organization_id`
 * le premier : l'organisation est ajoutée par la Server Action à partir
 * de la session, et un paramètre du même nom venu du navigateur la
 * remplacerait sans bruit.
 */
export function payloadFor(proposal: Proposal): Record<string, unknown> {
  const spec = PROPOSALS[proposal.kind];
  const payload: Record<string, unknown> = {};
  for (const key of spec.params) {
    const value = proposal.args[key];
    // `undefined` et la chaîne vide sont des absences ; `0` et `false`
    // n'en sont pas, et doivent traverser.
    if (value === undefined || value === null) continue;
    if (typeof value === "string" && value.trim() === "") continue;
    payload[key] = value;
  }
  return payload;
}
