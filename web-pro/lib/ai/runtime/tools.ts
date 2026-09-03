import { z } from "zod";
import type { CleAgentModele, NiveauRisque, Permission } from "./types.ts";

/**
 * §11V — ÉTAPE 8 : `OasisAIToolRegistry` (spec p. 10-11).
 *
 * ══════════════════════════════════════════════════════════════════
 * CE QUE CE FICHIER EST
 * ══════════════════════════════════════════════════════════════════
 *
 * La liste, EXHAUSTIVE ET FERMÉE, de ce que les agents ont le droit de
 * faire. Chaque entrée porte son schéma Zod, la permission qu'elle
 * exige, son niveau de risque, si elle réclame une confirmation, et
 * l'agent à qui elle appartient.
 *
 * « L'IA ne doit JAMAIS accéder directement à Supabase/PostgreSQL »
 * (p. 10). Ici, cela veut dire quelque chose de précis et de
 * vérifiable : il n'y a AUCUN moyen, depuis un agent, de nommer une
 * table, d'écrire un `select`, ou de choisir une fonction absente de
 * ce fichier. Le modèle nomme un OUTIL ; l'exécuteur (`toolsSdk.ts`)
 * cherche cet outil dans le registre ; s'il n'y est pas, il n'y a pas
 * d'appel.
 *
 * ══════════════════════════════════════════════════════════════════
 * LA RÈGLE QUI A ÉTÉ VÉRIFIÉE UNE À UNE, PAR REQUÊTE, SUR LA BASE
 * ══════════════════════════════════════════════════════════════════
 *
 * AUCUN OUTIL N'EST DÉCLARÉ DONT LA FONCTION SQL N'EXISTE PAS.
 *
 * C'est le défaut le plus silencieux de ce travail : un outil déclaré
 * avec un joli nom, un joli schéma, une jolie description — et un
 * `rpc` qui n'existe nulle part. Rien ne le signale au développeur.
 * Rien ne le signale au modèle, qui l'appellera de bonne foi. Ce qui
 * remonte, six semaines plus tard, c'est « Oasis dit qu'il ne peut pas
 * répondre » sur une question qu'il devrait savoir traiter.
 *
 * La spec p. 10-11 nomme dix-huit outils. Neuf d'entre eux n'ont
 * aucune fonction derrière — voir `OUTILS_SPEC_SANS_SERVICE` en bas de
 * fichier, qui les nomme et dit pourquoi. `tools.test.ts` relit les
 * migrations et échoue si un `rpc` déclaré ici n'y est pas défini.
 *
 * ══════════════════════════════════════════════════════════════════
 * L'ORGANISATION N'EST PAS DANS LES SCHÉMAS. C'EST VOULU.
 * ══════════════════════════════════════════════════════════════════
 *
 * Aucun schéma Zod de ce fichier ne contient `p_organization_id`. Le
 * modèle ne peut donc pas nommer une entreprise : c'est l'exécuteur
 * qui injecte celle de la session (`injecteOrganisation: true`).
 * Un paramètre d'organisation exposé au modèle serait une organisation
 * choisie par la question — et la promesse « Organisation A ne peut
 * jamais interroger Organisation B » (p. 22) reposerait alors sur la
 * bonne volonté d'un modèle de langage.
 *
 * Les fonctions qui prennent un identifiant d'entité (`p_quote_id`,
 * `p_project_id`) n'ont volontairement PAS de paramètre d'organisation :
 * elles la relisent sur la ligne (règle n° 1 de la migration 0073). On
 * ne peut pas se tromper d'entreprise sur un paramètre qui n'existe pas.
 */

// ==================================================================
// 1. LA FRONTIÈRE DÉTERMINISTE — spec p. 11-12
// ==================================================================
//
// ELLE PASSE EXACTEMENT ICI, entre `fournit` et `description`.
//
// ─── CE QUE LE MODÈLE NE CALCULE JAMAIS ───
//
//   marge · TVA · chiffre d'affaires · stock · prix · total de facture ·
//   quantités · heures
//
// Ces huit grandeurs sortent d'une fonction SQL (`ai_quote_price_analysis`,
// `ai_finance_snapshot`, `ai_billing_candidates`…) ou d'une colonne
// générée (`quote_totals`, `invoice_totals`). Elles arrivent au modèle
// DÉJÀ CALCULÉES, en centimes entiers. Le champ `fournit` de chaque
// outil dit lesquelles il apporte ; `tools.test.ts` vérifie que chacune
// a bien au moins une source.
//
// ─── CE QUE LE MODÈLE FAIT ───
//
//   interpréter · comparer · expliquer · prioriser · recommander
//
// Il met en phrase, il classe, il rapproche, il dit ce qu'il ferait. Il
// ne refait pas l'addition.
//
// ─── POURQUOI CETTE FRONTIÈRE N'EST PAS UNE PRÉFÉRENCE DE STYLE ───
//
// Un modèle qui recalcule une marge produit un nombre PLAUSIBLE. C'est
// pire qu'un nombre absent : personne ne le vérifie. Et le jour où la
// définition de la marge change — 0073 a déjà déplacé la sienne une
// fois — le SQL suit, le modèle non, et les deux chiffres divergent
// sans que rien ne casse.
//
// ─── CE QUE PERSONNE NE CALCULE, ET QUI DOIT SE DIRE ───
//
// La distance et le temps de déplacement (p. 11 : « distance », « temps »)
// n'ont AUCUN service dans ce produit : le distancier n'existe pas.
// `ai_quote_price_analysis` expose le siège, le chantier et les heures
// déjà devisées, et s'arrête là. Un modèle laissé seul devant cette
// absence estimerait « environ 45 minutes » — ce serait une invention
// chiffrée, exactement ce que la page 2 du cahier des charges interdit.
// `CONSIGNE_FRONTIERE_DETERMINISTE` est la phrase que chaque agent doit
// porter dans ses instructions ; `GRANDEURS_SANS_SERVICE` la liste.

export const GRANDEURS_DETERMINISTES = [
  "marge",
  "tva",
  "chiffreAffaires",
  "stock",
  "prix",
  "totalFacture",
  "quantites",
  "heures",
  "distance",
  "tempsDeDeplacement",
] as const;
export type GrandeurDeterministe = (typeof GRANDEURS_DETERMINISTES)[number];

/**
 * Les grandeurs que la spec nomme et qu'AUCUN service ne calcule.
 *
 * Elles restent dans l'énumération — les retirer reviendrait à faire
 * comme si la spec ne les demandait pas — mais aucun outil ne les
 * `fournit`, et la consigne ci-dessous l'annonce au modèle.
 */
export const GRANDEURS_SANS_SERVICE: Readonly<Record<string, string>> = Object.freeze({
  distance:
    "Aucun distancier dans ce produit : la distance siège → chantier n'est calculée nulle part.",
  tempsDeDeplacement:
    "Aucun service de temps de trajet : les heures devisées ne comprennent pas le déplacement.",
});

/**
 * À coller dans les instructions de chaque agent (étapes 9 à 12).
 *
 * Ce n'est PAS la barrière — la barrière est qu'aucun outil ne rend ces
 * grandeurs. C'est ce qui évite qu'un modèle privé de la donnée la
 * fabrique pour rendre service.
 */
export const CONSIGNE_FRONTIERE_DETERMINISTE =
  "Tous les chiffres — marge, TVA, chiffre d'affaires, stock, prix, total de facture, " +
  "quantités, heures — viennent des outils, déjà calculés, en centimes entiers. " +
  "Ne les recalcule jamais, ne les arrondis pas, ne les convertis pas. " +
  "Interprète, compare, explique, priorise, recommande. " +
  "La distance et le temps de déplacement ne sont calculés par aucun service : " +
  "s'ils manquent, dis qu'ils manquent — ne les estime pas.";

// ==================================================================
// 2. LE VOCABULAIRE DU REGISTRE
// ==================================================================

/**
 * Trois familles, et la différence est le sujet — reprise telle quelle
 * de `supabase/functions/oasis-pro-ai/index.ts`, dont ce registre est
 * la migration côté serveur Next.js.
 *
 *   `lecture`     — lit. Une question ne peut RIEN écrire.
 *   `proposition` — PROPOSE. L'exécution passe par un clic humain et
 *                   `lib/ai/proposals.ts`, qui détient seul la
 *                   correspondance vers la fonction d'écriture.
 *   `moteur`      — enregistre une action dans `ai_actions` et une
 *                   demande dans `ai_action_approvals` (0072). Rien
 *                   n'est exécuté dans le tour où l'outil est appelé.
 */
export type FamilleOutil = "lecture" | "proposition" | "moteur";

/** D'où vient réellement le refus, quand l'appelant n'a pas le droit. */
export type SourcePermission = "rls" | "aiGuard" | "catalogue";

export type OutilOasis = {
  /** Le nom que le modèle prononce. Unique dans tout le registre. */
  nom: string;
  famille: FamilleOutil;
  /**
   * L'agent propriétaire, ou `null` pour un outil transverse.
   *
   * Un agent ne reçoit QUE ses outils et les transverses (voir
   * `outilsPourAgent`). C'est la moitié « outils » de la minimisation
   * de la p. 20 — l'autre moitié étant le contexte (`context.ts`).
   */
  agent: CleAgentModele | null;
  /**
   * La fonction Postgres appelée, pour la famille `lecture`.
   *
   * VÉRIFIÉE CONTRE LA BASE. Absente pour les deux autres familles :
   * une proposition ne connaît pas le nom de la fonction qui écrit, et
   * ne peut donc pas l'appeler par erreur de programmation.
   */
  rpc?: string;
  /** Pour la famille `moteur` : la clé de `ai_action_catalog` (0072). */
  actionType?: string;
  /** Vrai quand l'exécuteur doit poser `p_organization_id` lui-même. */
  injecteOrganisation: boolean;
  /** Ce que l'appelant doit détenir. `null` = la RLS suffit. */
  permission: Permission | null;
  permissionSource: SourcePermission;
  risque: NiveauRisque;
  confirmationRequise: boolean;
  /** Les grandeurs déterministes que cet outil apporte, déjà calculées. */
  fournit: readonly GrandeurDeterministe[];
  /**
   * Combien d'éléments au plus par tableau dans ce qui part au modèle.
   * Absent = la réponse tient toujours (un objet de totaux, une fiche).
   */
  maxElements?: number;
  description: string;
  /**
   * Le schéma des paramètres que LE MODÈLE choisit. Jamais
   * l'organisation, jamais l'utilisateur, jamais une permission.
   *
   * Les paramètres facultatifs sont écrits `.nullable()` et non
   * `.optional()` : le mode strict des sorties structurées OpenAI exige
   * que toutes les clés soient présentes, et une clé absente y devient
   * une erreur de schéma plutôt qu'un défaut.
   */
  parametres: z.ZodType;
};

// ==================================================================
// 3. LES OUTILS DE LECTURE
// ==================================================================
//
// `frontière déterministe ↑` — tout ce qui suit rend des chiffres
// calculés par le SQL de 0058, 0069 et 0073.

const LIGNE_DEVIS = z.object({
  description: z.string(),
  unit: z.string().nullable(),
  quantity: z.number(),
  unit_sale_price_cents: z.number().int(),
  unit_cost_cents: z.number().int().nullable(),
  vat_rate: z.number().nullable(),
  cost_kind: z.string().nullable(),
});

const OUTILS_LECTURE: readonly OutilOasis[] = [
  {
    nom: "searchEntities",
    famille: "lecture",
    agent: null, // transverse : il faut un identifiant avant tout le reste
    rpc: "ai_search_entities",
    injecteOrganisation: true,
    permission: null,
    permissionSource: "rls",
    risque: "low",
    confirmationRequise: false,
    fournit: [],
    maxElements: 25,
    description:
      "Cherche par nom un client, un chantier, un devis, une facture, un jardin, un lot, un " +
      "fournisseur ou un salarié, et rend son identifiant. À utiliser AVANT tout outil qui " +
      "demande un identifiant.",
    parametres: z.object({
      p_query: z.string().min(2).describe("Nom, numéro ou fragment cherché. Deux caractères minimum."),
      p_types: z
        .array(z.string())
        .nullable()
        .describe("Familles à restreindre : client, project, quote, invoice, garden, lot, supplier…"),
    }),
  },

  // ---------- FINANCE (p. 20 : revenus, factures, règlements, dépenses, objectifs) ----------
  {
    nom: "getCompanyMetrics",
    famille: "lecture",
    agent: "finance",
    rpc: "ai_finance_snapshot",
    injecteOrganisation: true,
    permission: "invoice.create",
    permissionSource: "rls",
    risque: "low",
    confirmationRequise: false,
    // Les TROIS chiffres d'affaires, la marge, les créances, la TVA des
    // dépenses et les objectifs. Tous en centimes entiers, tous
    // calculés par 0073 : un droit manquant rend `null` et se nomme,
    // jamais zéro.
    fournit: ["chiffreAffaires", "marge", "tva"],
    description:
      "Photo financière d'une période : CA signé, facturé et encaissé (trois clés distinctes), " +
      "marge chantier et marge brute, dépenses, engagements fournisseurs, créances et retards, " +
      "trésorerie observée, objectifs de l'entreprise et écart à la cible.",
    parametres: z.object({
      p_from: z.string().nullable().describe("Début de période, AAAA-MM-JJ. Null = début du mois."),
      p_to: z.string().nullable().describe("Fin de période, AAAA-MM-JJ. Null = aujourd'hui."),
    }),
  },
  {
    nom: "getMarginBreakdown",
    famille: "lecture",
    agent: "finance",
    rpc: "ai_finance_margin_breakdown",
    injecteOrganisation: true,
    permission: "quotes.read",
    permissionSource: "rls",
    risque: "low",
    confirmationRequise: false,
    fournit: ["marge", "heures"],
    maxElements: 30,
    description:
      "Marge décomposée selon une dimension : client, chantier, type de prestation, commercial, " +
      "service, ville ou équipe. Rend aussi les causes d'écart et les heures. Quatre des sept " +
      "dimensions sont approchées faute de champ dédié, et la réponse le dit.",
    parametres: z.object({
      p_from: z.string().nullable(),
      p_to: z.string().nullable(),
      p_dimension: z
        .string()
        .nullable()
        .describe("client, chantier, prestation, commercial, service, ville ou equipe."),
    }),
  },
  {
    nom: "analyzeProjectMargin",
    famille: "lecture",
    agent: "finance",
    rpc: "ai_analyze_project_margin",
    injecteOrganisation: true,
    permission: "projects.read",
    permissionSource: "rls",
    risque: "low",
    confirmationRequise: false,
    fournit: ["marge", "heures"],
    maxElements: 40,
    description:
      "Marge chantier par chantier : budget vendu, coûts engagés, heures pointées, écart.",
    parametres: z.object({}),
  },

  // ---------- FACTURATION ----------
  {
    nom: "getUnbilledProjects",
    famille: "lecture",
    agent: "billing",
    rpc: "ai_billing_candidates",
    injecteOrganisation: true,
    permission: "invoice.create",
    permissionSource: "rls",
    risque: "low",
    confirmationRequise: false,
    fournit: ["totalFacture", "chiffreAffaires"],
    maxElements: 50,
    description:
      "Ce qui reste à facturer : chantiers terminés, interventions clôturées et devis acceptés " +
      "sans facture, classés prêt / à vérifier / bloqué avec le motif. Rend aussi les factures " +
      "en retard. Les acomptes et situations de travaux sont déclarés « indisponibles », pas " +
      "comptés à zéro.",
    parametres: z.object({}),
  },

  // ---------- DEVIS ET PRIX ----------
  {
    nom: "getQuote",
    famille: "lecture",
    agent: "quotePricing",
    rpc: "ai_quote_price_analysis",
    injecteOrganisation: false, // l'organisation est relue sur la ligne du devis
    permission: "quotes.read",
    permissionSource: "rls",
    risque: "low",
    confirmationRequise: false,
    fournit: ["prix", "marge", "quantites"],
    description:
      "Analyse du prix d'un devis : prix proposé HT, coût estimé, marge et taux de marque, " +
      "objectif d'entreprise, écart à la cible, verdict et comparables internes. Le bloc " +
      "« deplacement » expose le siège, le chantier et les heures devisées SANS les chiffrer : " +
      "aucun distancier n'existe.",
    parametres: z.object({
      p_quote_id: z.string().describe("Identifiant du devis (UUID)."),
    }),
  },
  {
    nom: "getHistoricalProjectComparisons",
    famille: "lecture",
    agent: "quotePricing",
    rpc: "ai_quote_comparables",
    injecteOrganisation: false,
    permission: "quotes.read",
    permissionSource: "rls",
    risque: "low",
    confirmationRequise: false,
    fournit: ["prix", "marge", "heures"],
    maxElements: 20,
    description:
      "Chantiers internes de périmètre équivalent, pour situer un devis. En dessous de cinq " +
      "comparables la fourchette n'est PAS rendue et le verdict est « données insuffisantes ».",
    parametres: z.object({
      p_quote_id: z.string().describe("Identifiant du devis (UUID)."),
    }),
  },
  {
    nom: "getDigitalTwinQuantities",
    famille: "lecture",
    agent: "quotePricing",
    rpc: "ai_get_digital_twin_quantities",
    injecteOrganisation: false,
    permission: "projects.read",
    permissionSource: "rls",
    risque: "low",
    confirmationRequise: false,
    fournit: ["quantites"],
    maxElements: 40,
    description:
      "Quantités MESURÉES sur le plan d'un jardin : surfaces des zones, végétaux, équipements, " +
      "mètres d'irrigation et de câble.",
    parametres: z.object({
      p_garden_id: z.string().describe("Identifiant du jardin (UUID)."),
    }),
  },

  // ---------- DIRECTION ----------
  //
  // L'Executive Agent « ne doit PAS récupérer toute la base directement.
  // Il utilise les résultats structurés des agents spécialisés »
  // (p. 8). Ses trois outils rendent précisément cela : des lignes déjà
  // produites par les autres agents, chacune portant le nom de celui
  // qui l'a calculée.
  {
    nom: "getExecutiveBrief",
    famille: "lecture",
    agent: "executive",
    rpc: "ai_executive_brief",
    injecteOrganisation: true,
    permission: "projects.read",
    permissionSource: "rls",
    risque: "low",
    confirmationRequise: false,
    fournit: [],
    maxElements: 5,
    description:
      "Les cinq actions prioritaires, agrégées depuis les agents spécialisés et pondérées par " +
      "les objectifs de l'entreprise. Chaque ligne porte l'agent qui l'a calculée, son impact " +
      "en centimes (ou null), sa confiance et les tables lues.",
    parametres: z.object({}),
  },
  {
    nom: "getOasisDaily",
    famille: "lecture",
    agent: "executive",
    rpc: "ai_oasis_daily",
    injecteOrganisation: true,
    permission: "projects.read",
    permissionSource: "rls",
    risque: "low",
    confirmationRequise: false,
    fournit: [],
    maxElements: 20,
    description: "Le briefing du matin, regroupé en rubriques.",
    parametres: z.object({}),
  },
  {
    nom: "getDailyPriorities",
    famille: "lecture",
    agent: "executive",
    rpc: "ai_get_daily_priorities",
    injecteOrganisation: true,
    permission: "projects.read",
    permissionSource: "rls",
    risque: "low",
    confirmationRequise: false,
    fournit: [],
    maxElements: 20,
    description: "Ce qui réclame l'attention aujourd'hui : retards, échéances, alertes.",
    parametres: z.object({}),
  },

  // ---------- TRANSVERSES ----------
  {
    nom: "getProjectContext",
    famille: "lecture",
    agent: null,
    rpc: "ai_get_project_context",
    injecteOrganisation: false,
    permission: "projects.read",
    permissionSource: "rls",
    risque: "low",
    confirmationRequise: false,
    fournit: ["heures", "marge"],
    maxElements: 30,
    description:
      "État d'un chantier : phases, avancement, budget vendu, coûts engagés, heures pointées.",
    parametres: z.object({
      p_project_id: z.string().describe("Identifiant du chantier (UUID)."),
    }),
  },
  {
    nom: "getClientContext",
    famille: "lecture",
    agent: null,
    rpc: "ai_get_client_context",
    injecteOrganisation: false,
    permission: "clients.read",
    permissionSource: "rls",
    risque: "low",
    confirmationRequise: false,
    fournit: ["totalFacture"],
    maxElements: 20,
    description:
      "Fiche d'UN client : coordonnées, devis, chantiers, factures impayées, derniers échanges. " +
      "Un client à la fois — jamais la base clients.",
    parametres: z.object({
      p_customer_id: z.string().describe("Identifiant du client (UUID)."),
    }),
  },

  // ---------- PÉPINIÈRE (agent non construit — voir plus bas) ----------
  {
    nom: "getNurseryStock",
    famille: "lecture",
    agent: "nursery",
    rpc: "ai_find_stock",
    injecteOrganisation: true,
    permission: null,
    permissionSource: "rls",
    risque: "low",
    confirmationRequise: false,
    fournit: ["stock", "quantites"],
    maxElements: 40,
    description: "Stock disponible par espèce, cultivar et conditionnement.",
    parametres: z.object({
      p_query: z.string().describe("Espèce, cultivar ou fragment de nom."),
    }),
  },
  {
    nom: "getProjectedNurseryNeeds",
    famille: "lecture",
    agent: "nursery",
    rpc: "ai_forecast_availability",
    injecteOrganisation: true,
    permission: null,
    permissionSource: "rls",
    risque: "low",
    confirmationRequise: false,
    fournit: ["stock", "quantites"],
    maxElements: 40,
    description: "Disponibilité projetée d'une espèce : ce qui sort, ce qui rentre, le déficit.",
    parametres: z.object({
      p_query: z.string().describe("Espèce, cultivar ou fragment de nom."),
    }),
  },
];

// ==================================================================
// 4. LES OUTILS QUI PROPOSENT — ils n'exécutent rien
// ==================================================================
//
// PAS DE CHAMP `rpc`. Ce fichier ne connaît pas le nom des fonctions
// qui écrivent, et ne peut donc pas les appeler même par erreur de
// programmation. La correspondance `nom → RPC` vit dans
// `lib/ai/proposals.ts`, derrière un clic.

const OUTILS_PROPOSITION: readonly OutilOasis[] = [
  {
    nom: "createQuoteDraft",
    famille: "proposition",
    agent: "quotePricing",
    injecteOrganisation: true,
    permission: "quotes.create",
    permissionSource: "aiGuard",
    risque: "medium",
    confirmationRequise: true,
    fournit: [],
    description:
      "PROPOSE un brouillon de devis. N'exécute rien : l'utilisateur relit le récapitulatif et " +
      "clique. Les prix unitaires sont EN CENTIMES ENTIERS ; le total est recalculé par la base.",
    parametres: z.object({
      p_customer_id: z.string().describe("Identifiant du client (UUID)."),
      p_title: z.string(),
      p_lines: z.array(LIGNE_DEVIS),
    }),
  },
  {
    nom: "addQuoteDraftLines",
    famille: "proposition",
    agent: "quotePricing",
    injecteOrganisation: true,
    permission: "quotes.edit",
    permissionSource: "aiGuard",
    risque: "medium",
    confirmationRequise: true,
    fournit: [],
    description:
      "PROPOSE d'ajouter des lignes à un devis encore au brouillon. N'exécute rien.",
    parametres: z.object({
      p_quote_id: z.string().describe("Identifiant du devis (UUID)."),
      p_lines: z.array(LIGNE_DEVIS),
    }),
  },
  {
    nom: "createPurchaseOrderDraft",
    famille: "proposition",
    agent: "procurement",
    injecteOrganisation: true,
    permission: "invoice.create",
    permissionSource: "aiGuard",
    risque: "medium",
    confirmationRequise: true,
    fournit: [],
    description:
      "PROPOSE un brouillon de commande fournisseur. N'ENVOIE RIEN : l'envoi engage l'achat et " +
      "reste interdit à Oasis.",
    parametres: z.object({
      p_supplier_id: z.string().describe("Identifiant du fournisseur (UUID)."),
      p_lines: z.array(
        z.object({
          description: z.string(),
          quantity: z.number(),
          unit_price_cents: z.number().int().nullable(),
          unit: z.string().nullable(),
        }),
      ),
      p_expected_on: z.string().nullable().describe("Date de livraison attendue, AAAA-MM-JJ."),
      p_reference: z.string().nullable(),
      p_notes: z.string().nullable(),
    }),
  },
  {
    // La spec p. 11 l'appelle `createPlanningProposal`. La fonction qui
    // existe s'appelle `ai_schedule_intervention`, et l'outil porte le
    // nom de ce qu'elle fait : elle planifie UNE intervention. Inventer
    // un « createPlanningProposal » qui appellerait discrètement
    // celle-ci ferait croire à un planificateur, qui n'existe pas.
    nom: "scheduleIntervention",
    famille: "proposition",
    agent: "planning",
    injecteOrganisation: true,
    permission: "projects.manage",
    permissionSource: "aiGuard",
    risque: "medium",
    confirmationRequise: true,
    fournit: [],
    description:
      "PROPOSE de planifier UNE intervention à une date et une heure. N'exécute rien, ne " +
      "prévient personne, ne réorganise aucun planning existant.",
    parametres: z.object({
      p_title: z.string(),
      p_scheduled_start: z.string().describe("Début, ISO 8601 avec fuseau."),
      p_scheduled_end: z.string().describe("Fin, ISO 8601 avec fuseau."),
      p_kind: z.string().nullable(),
      p_project_id: z.string().nullable(),
      p_customer_id: z.string().nullable(),
      p_site_id: z.string().nullable(),
      p_team_id: z.string().nullable(),
      p_instructions: z.string().nullable(),
    }),
  },
];

// ==================================================================
// 5. LES OUTILS DE MOTEUR — ils enregistrent une demande, pas un acte
// ==================================================================

const OUTILS_MOTEUR: readonly OutilOasis[] = [
  {
    nom: "createInvoiceDraft",
    famille: "moteur",
    agent: "billing",
    // `actionType` est une clé étrangère vers `ai_action_catalog`
    // (0072) : un nom fantaisiste échoue à l'insertion plutôt que de
    // créer une action que personne ne sait exécuter.
    actionType: "createInvoiceDraft",
    injecteOrganisation: true,
    permission: "invoice.create",
    permissionSource: "catalogue",
    risque: "medium",
    confirmationRequise: true,
    fournit: [],
    description:
      "Enregistre une demande de création de brouillons de facture pour les dossiers PRÊTS, et " +
      "demande une validation. RIEN N'EST CRÉÉ dans ce tour. À la validation, les candidats " +
      "sont RELUS — la liste que le modèle croit avoir retenue n'est jamais utilisée.",
    parametres: z.object({}),
  },
];

// ==================================================================
// 6. LE REGISTRE
// ==================================================================

const TOUS: readonly OutilOasis[] = Object.freeze([
  ...OUTILS_LECTURE,
  ...OUTILS_PROPOSITION,
  ...OUTILS_MOTEUR,
]);

export class OasisAIToolRegistry {
  readonly #parNom: ReadonlyMap<string, OutilOasis>;

  constructor(outils: readonly OutilOasis[] = TOUS) {
    const index = new Map<string, OutilOasis>();
    for (const outil of outils) {
      if (index.has(outil.nom)) {
        // Deux outils du même nom, c'est un outil qui en masque un
        // autre : le second gagnerait en silence, et la permission
        // appliquée ne serait plus celle qu'on croit lire.
        throw new Error(`Outil déclaré deux fois : « ${outil.nom} ».`);
      }
      index.set(outil.nom, outil);
    }
    this.#parNom = index;
  }

  /** Tous les outils, dans l'ordre de déclaration. */
  tous(): readonly OutilOasis[] {
    return [...this.#parNom.values()];
  }

  /**
   * Un outil par son nom, ou `null`.
   *
   * `null` et non une exception : un modèle qui invente un nom d'outil
   * est un cas ordinaire, pas une panne. L'exécuteur répond « outil
   * inconnu » et le tour continue.
   */
  chercher(nom: string): OutilOasis | null {
    return this.#parNom.get(nom) ?? null;
  }

  /**
   * Ce qu'un agent a le droit d'appeler, ET RIEN D'AUTRE.
   *
   * Deux filtres, dans cet ordre :
   *
   *   1. LA PROPRIÉTÉ. Ses outils, plus les transverses (`agent: null`).
   *      Le Finance Agent n'a aucun moyen de lire un jardin.
   *
   *   2. LES DROITS DE L'UTILISATEUR. Un outil dont la permission
   *      manque n'est PAS proposé au modèle. Ce n'est pas la barrière
   *      — la barrière est `ai_guard` et la RLS — mais un outil offert
   *      puis refusé fait dépenser un aller-retour de jetons pour
   *      obtenir « permission denied », et le modèle, poliment,
   *      réessaie.
   */
  pourAgent(agent: CleAgentModele, permissions: readonly Permission[]): readonly OutilOasis[] {
    return this.tous().filter(
      (outil) =>
        (outil.agent === agent || outil.agent === null) &&
        (outil.permission === null || permissions.includes(outil.permission)),
    );
  }

  /** Les outils que cet agent possède mais que l'utilisateur ne peut pas ouvrir. */
  refusesPourAgent(
    agent: CleAgentModele,
    permissions: readonly Permission[],
  ): readonly { outil: string; permission: Permission }[] {
    return this.tous()
      .filter((outil) => outil.agent === agent || outil.agent === null)
      .filter((outil) => outil.permission !== null && !permissions.includes(outil.permission))
      .map((outil) => ({ outil: outil.nom, permission: outil.permission as Permission }));
  }

  /** Les grandeurs déterministes qu'un outil apporte déjà calculées. */
  grandeursFournies(): ReadonlySet<GrandeurDeterministe> {
    const set = new Set<GrandeurDeterministe>();
    for (const outil of this.tous()) for (const g of outil.fournit) set.add(g);
    return set;
  }
}

let registreMemorise: OasisAIToolRegistry | null = null;

/** Le registre du processus. */
export function registreOutils(): OasisAIToolRegistry {
  registreMemorise ??= new OasisAIToolRegistry();
  return registreMemorise;
}

/** Oublie l'instance partagée. Pour les tests, et pour eux seuls. */
export function reinitialiserRegistreOutils(): void {
  registreMemorise = null;
}

// ==================================================================
// 7. CE QUE LA SPEC DEMANDE ET QUI N'EXISTE PAS
// ==================================================================
//
// Neuf des dix-huit outils de la p. 10-11 n'ont aucune fonction
// derrière. Les déclarer quand même aurait produit exactement le défaut
// que l'en-tête de ce fichier décrit. Ils sont nommés ici, avec ce qui
// les remplace ou ce qui manque, pour deux raisons : la prochaine
// personne qui relit la spec ne se demandera pas s'ils ont été oubliés,
// et le jour où la fonction arrive, il n'y a qu'un endroit à consulter.

export const OUTILS_SPEC_SANS_SERVICE: readonly {
  nomSpec: string;
  etat: "couvert" | "absent";
  explication: string;
}[] = Object.freeze([
  {
    nomSpec: "getRevenueSummary",
    etat: "couvert",
    explication:
      "Les trois chiffres d'affaires sont déjà dans `getCompanyMetrics.chiffreAffaires`. Un " +
      "second outil qui rendrait un sous-ensemble du premier ferait deux réponses possibles à " +
      "la même question — et un jour, deux réponses différentes.",
  },
  {
    nomSpec: "getUnpaidInvoices",
    etat: "couvert",
    explication:
      "`getCompanyMetrics.creances` (reste dû, en retard, ancienneté) et " +
      "`getUnbilledProjects.facturesEnRetard` (le détail facture par facture) le rendent déjà.",
  },
  {
    nomSpec: "getCompletedProjects",
    etat: "couvert",
    explication:
      "`getUnbilledProjects` part précisément des chantiers terminés. Un outil « chantiers " +
      "terminés » sans lien avec la facturation n'aurait aucun appelant.",
  },
  {
    nomSpec: "getQuoteMargin",
    etat: "couvert",
    explication:
      "`getQuote` rend `margeCents`, `tauxMarquePct`, `margeCiblePct` et `ecartALaCiblePoints`. " +
      "Séparer la marge du prix ferait payer deux appels pour une seule analyse.",
  },
  {
    nomSpec: "getTravelEstimate",
    etat: "absent",
    explication:
      "AUCUN DISTANCIER. `ai_quote_price_analysis.deplacement` expose le siège, le chantier et " +
      "les heures devisées sans les chiffrer. Déclarer l'outil ferait estimer le trajet par le " +
      "modèle — l'invention chiffrée que la page 2 interdit.",
  },
  {
    nomSpec: "getSupplierPrices",
    etat: "absent",
    explication:
      "Aucune fonction de tarifs fournisseurs. Les prix d'achat existent ligne à ligne sur les " +
      "commandes ; il n'existe aucune grille consolidée à interroger.",
  },
  {
    nomSpec: "getFleetCosts",
    etat: "absent",
    explication:
      "Aucune fonction de coûts de flotte. Le matériel est suivi, son coût d'usage ne l'est pas.",
  },
  {
    nomSpec: "getPlanningSummary",
    etat: "absent",
    explication:
      "Aucune fonction de synthèse de planning. Les interventions se lisent une à une ; " +
      "agréger côté modèle reviendrait à lui faire compter des heures.",
  },
  {
    nomSpec: "createPlanningProposal",
    etat: "couvert",
    explication:
      "Déclaré sous son vrai nom, `scheduleIntervention` : il planifie UNE intervention. Le nom " +
      "de la spec laisserait croire à un planificateur qui réorganise une semaine.",
  },
]);
