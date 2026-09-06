import { z } from "zod";
import type { CleAgentModele, NiveauRisque, Permission } from "./types.ts";

// LES OUTILS ÉCRITS PAR LES AGENTS EUX-MÊMES, IMPORTÉS PLUTÔT QUE
// RECOPIÉS.
//
// Chaque agent outillé a écrit sa déclaration dans `outils/<lui>.ts`, à
// côté de la fonction SQL et de son épreuve — c'est ce qui a permis de
// les écrire en parallèle sans que deux mains se croisent dans ce
// fichier-ci. L'intégration les VERSE au catalogue, et elle le fait par
// un import et non par un copier-coller : une déclaration recopiée ici
// serait une seconde vérité, et le jour où l'un des deux exemplaires
// est corrigé — une permission, une description, une borne — c'est
// l'autre qui part au modèle.
//
// PAS DE CYCLE À L'EXÉCUTION : ces fichiers n'importent de celui-ci
// que le TYPE `OutilOasis`, en `import type`, qui disparaît à la
// compilation. Ils ne dépendent de rien d'autre que de `zod`.
import { OUTIL_OPERATIONS_SNAPSHOT } from "./outils/operations.ts";
import { OUTIL_PLANNING_SUMMARY } from "./outils/planning.ts";
import { OUTIL_FLEET_SNAPSHOT, OUTIL_FLEET_EQUIPMENT } from "./outils/fleet.ts";
import { OUTIL_CUSTOMER_VALUE } from "./outils/customer.ts";
// §11Z — les trois outils des derniers répondeurs. Leurs fonctions SQL
// sont posées par 0088, éprouvées par `supabase/tests/agents_derniers.sql`.
import { OUTIL_SALES_FLOW } from "./outils/sales.ts";
import { OUTIL_INTERNAL_HISTORY } from "./outils/market.ts";
import { OUTIL_RISK_SNAPSHOT } from "./outils/risk.ts";

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

  // ---------- PÉPINIÈRE ----------
  //
  // LES DEUX PORTENT `nursery.stock.manage`, ET CE MOT A ÉTÉ AJOUTÉ
  // APRÈS COUP — VOICI POURQUOI, PARCE QUE LE DÉFAUT EST INVISIBLE.
  //
  // Les deux fonctions sont `security invoker` et n'appellent PAS
  // `ai_guard` : elles finissent par `coalesce(jsonb_agg(...), '[]')`.
  // Or les six tables `nursery_*` sont toutes sous
  // `has_permission(organization_id, 'nursery.stock.manage')`. Un membre
  // sans ce droit ne reçoit donc pas un refus : il reçoit UNE LISTE
  // VIDE, indiscernable d'une pépinière vide. Mesuré en production, à
  // deux comptes, sur le même lot réel : le propriétaire voit
  // 40 rosiers, le membre à droits réduits voit `[]`.
  //
  // Tant que `permission` valait `null`, l'outil était offert à qui ne
  // peut pas le lire, et `refusesPourAgent` ne nommait JAMAIS le droit
  // manquant — la cinquième occurrence de la confusion « zéro / je ne
  // sais pas » que ce produit a déjà corrigée quatre fois, et la
  // première atteignable par une simple question d'utilisateur.
  //
  // Le mot ci-dessous produit deux effets : l'outil n'est plus proposé
  // sans le droit, et `refusesPourAgent` le nomme — donc l'agent dit
  // « il vous manque le droit de stock » au lieu de « vous n'avez rien
  // en pépinière ». `permissionSource: "rls"` reste exact : le filtrage
  // vient bien des politiques, pas d'un `ai_guard`. La ceinture côté
  // base — un `perform public.ai_guard(...)` en tête des deux fonctions
  // — reste souhaitable et n'entre pas dans ce chantier : ces deux
  // fonctions datent de 0058 et sont lues par d'autres appelants.
  {
    nom: "getNurseryStock",
    famille: "lecture",
    agent: "nursery",
    rpc: "ai_find_stock",
    injecteOrganisation: true,
    permission: "nursery.stock.manage",
    permissionSource: "rls",
    risque: "low",
    confirmationRequise: false,
    fournit: ["stock", "quantites"],
    maxElements: 40,
    description:
      "Stock d'une espèce : quantité physique, réservée, disponible, et ce qui est attendu des " +
      "commandes fournisseur. " +
      "« attendu » À ZÉRO NE VEUT PAS DIRE « aucune commande » : cette colonne traverse les " +
      "commandes fournisseur, dont la lecture dépend d'un autre droit que celui du stock. " +
      "Ne conclus jamais qu'il n'y a rien en commande — dis que tu ne le vois pas.",
    parametres: z.object({
      p_query: z.string().describe("Espèce, cultivar ou fragment de nom."),
    }),
  },
  {
    // LA DESCRIPTION A ÉTÉ RÉÉCRITE POUR DÉCRIRE LA SORTIE RÉELLE.
    // L'ancienne annonçait « ce qui sort, ce qui rentre, le déficit ».
    // La fonction rend exactement DEUX clés — `enProduction` et
    // `commandesAttendues` — et ne calcule ni consommation ni déficit.
    // Un modèle qui appelle un outil pour obtenir un déficit et lit une
    // réponse qui n'en contient pas ne se tait pas : il improvise. Le
    // nom lui-même reste celui de la spec p. 11 (« Needs »), et il
    // continue de suggérer un besoin que la fonction ne calcule pas :
    // la description dit donc en toutes lettres ce qu'elle ne fait pas.
    nom: "getProjectedNurseryNeeds",
    famille: "lecture",
    agent: "nursery",
    rpc: "ai_forecast_availability",
    injecteOrganisation: true,
    permission: "nursery.stock.manage",
    permissionSource: "rls",
    risque: "low",
    confirmationRequise: false,
    fournit: ["stock", "quantites"],
    maxElements: 40,
    description:
      "Ce qui est EN PRODUCTION et pas encore vendable pour une espèce (lot, stade, quantité), " +
      "et ce qui est ATTENDU des commandes fournisseur. " +
      "NE CALCULE NI CONSOMMATION PRÉVUE NI DÉFICIT malgré son nom : aucune source ne relie un " +
      "devis ou un chantier au stock de pépinière. Si on te demande ce que les chantiers " +
      "engagés vont consommer, dis que ce produit ne le mesure pas. " +
      "Un lot « vendable: false » n'est PAS du stock disponible : ne l'additionne pas au stock.",
    parametres: z.object({
      p_query: z.string().describe("Espèce, cultivar ou fragment de nom."),
    }),
  },

  // ---------- CHANTIERS · PLANNING · MATÉRIEL · CLIENTS ----------
  //
  // Écrits par leurs agents dans `outils/`, avec leur fonction SQL
  // (posée par 0082) et leur épreuve. Voir l'import en tête de fichier
  // pour la raison de l'import plutôt que de la recopie.
  OUTIL_OPERATIONS_SNAPSHOT,
  OUTIL_PLANNING_SUMMARY,
  OUTIL_FLEET_SNAPSHOT,
  OUTIL_FLEET_EQUIPMENT,
  OUTIL_CUSTOMER_VALUE,

  // ---------- VENTES · HISTORIQUE INTERNE · RISQUES ----------
  //
  // §11Z, mêmes règles et même raison : écrits chez leur agent, versés
  // ici par un import. Ce qui les distingue des cinq précédents est ce
  // qu'ils NE rendent pas, et c'est écrit dans leur description parce
  // que le modèle la lit AVANT de décider d'appeler l'outil :
  //
  //   • `getSalesFlow` ne rend aucun montant qu'il calcule lui-même, et
  //     ne regarde que les devis DÉCIDÉS — les devis encore ouverts
  //     appartiennent au briefing de direction, qui les calcule déjà.
  //   • `getInternalHistory` ne connaît RIEN d'extérieur à
  //     l'entreprise. C'est le seul outil du registre dont la moitié de
  //     la description sert à dire ce qui n'existe pas.
  //   • `getRiskSnapshot` étiquette chacun de ses blocs « mesure », et
  //     lit chez la Facturation ce qu'elle compte déjà.
  OUTIL_SALES_FLOW,
  OUTIL_INTERNAL_HISTORY,
  OUTIL_RISK_SNAPSHOT,
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
      "reste interdit à Oasis. Les prix d'achat sont EN CENTIMES ENTIERS ; le total est " +
      "recalculé par la base. Pour une ligne de VÉGÉTAUX, renseigne « is_plant » et " +
      "« species_name » : sans eux, la ligne ne remontera jamais dans le « attendu » du stock " +
      "de pépinière, et le besoin prévisionnel recommandera de recommander ce qui est déjà " +
      "commandé.",
    parametres: z.object({
      p_supplier_id: z.string().describe("Identifiant du fournisseur (UUID)."),
      p_lines: z.array(
        z.object({
          description: z.string(),
          quantity: z.number(),
          // `unit_cost_cents` ET NON `unit_price_cents` — LE SCHÉMA
          // MENTAIT, ET LE BUG ÉTAIT EN PRODUCTION.
          //
          // `ai_create_purchase_order_draft` lit
          // `coalesce((v_line ->> 'unit_cost_cents')::bigint, 0)`,
          // vérifié dans le corps de la fonction en base. Tant que le
          // schéma nommait le prix `unit_price_cents`, la clé remplie
          // par le modèle n'était lue par PERSONNE, le `coalesce` la
          // remplaçait par zéro, et TOUTES les lignes du brouillon —
          // ainsi que le total de la commande — valaient 0 €. Rien ne
          // le signalait : la proposition s'affichait, complète, à
          // zéro euro.
          //
          // Les quatre champs qui suivent sont dans le même cas à
          // l'envers : la fonction les lit depuis le début, le schéma
          // ne les offrait pas, donc le modèle ne pouvait pas les
          // remplir. `vat_rate` manquant fait une commande sans TVA ;
          // `is_plant` et `species_name` manquants font disparaître une
          // ligne de végétaux de la colonne « attendu » du stock.
          unit_cost_cents: z.number().int().nullable().describe("Prix d'achat unitaire, EN CENTIMES ENTIERS."),
          unit: z.string().nullable(),
          vat_rate: z.number().nullable().describe("Taux de TVA, en pourcentage (20 pour 20 %)."),
          is_plant: z
            .boolean()
            .nullable()
            .describe("Vrai si la ligne est un végétal destiné au stock de pépinière."),
          species_name: z
            .string()
            .nullable()
            .describe("Nom d'espèce, obligatoire pour qu'une ligne de végétaux entre au stock."),
          container_size: z.string().nullable().describe("Conditionnement (C3, motte, racines nues…)."),
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
    // LE MOTIF A ÉTÉ CORRIGÉ : il était faux, et sa fausseté aurait
    // envoyé le prochain lecteur créer une table qui existe déjà.
    // `public.supplier_prices` est posée depuis 0048, avec
    // `supplier_id`, `catalog_item_id`, `price_cents`,
    // `supplier_reference`, `minimum_quantity`, `valid_from`,
    // `valid_until`. La grille consolidée EXISTE. Ce qui manque est
    // ailleurs, et c'est ce qui doit être écrit ici.
    explication:
      "La table existe et PERSONNE NE L'ALIMENTE. `public.supplier_prices` (0048) porte prix, " +
      "quantité minimale et périodes de validité, et compte zéro ligne en production — comme " +
      "`suppliers`. Aucune fonction ne la lit. Un outil de tarifs fournisseurs rendrait une " +
      "liste vide qu'un agent lirait « ce fournisseur n'a pas de tarif ». Ce qu'il faut livrer " +
      "d'abord n'est pas du code : c'est la première ligne saisie.",
  },
  {
    nomSpec: "getFleetCosts",
    etat: "absent",
    // RESTE « absent » MALGRÉ L'ARRIVÉE DES DEUX OUTILS MATÉRIEL, et
    // c'est le point délicat de cette entrée. `getFleetSnapshot` et
    // `getEquipmentRecord` rendent les échéances, la disponibilité et
    // l'entretien SAISI — pas le coût d'usage. Les faire passer à
    // « couvert » laisserait croire que la question « combien me coûte
    // ce camion au kilomètre » a trouvé sa réponse.
    // `outils/fleet.test.ts` échoue si quelqu'un le change.
    explication:
      "Aucune fonction de COÛT D'USAGE, et aucun schéma pour en écrire une : ni carburant, ni " +
      "relevé kilométrique périodique, ni amortissement (0067 l'exclut par écrit), ni " +
      "refacturation au chantier. `getFleetSnapshot` et `getEquipmentRecord` rendent le prix " +
      "d'achat et l'entretien réellement dépensé, ce qui n'est pas un coût au kilomètre : " +
      "l'agent Matériel refuse la question par son nom plutôt que d'en approcher la réponse.",
  },
  {
    nomSpec: "getPlanningSummary",
    // PASSÉ DE « absent » À « couvert » PAR 0082, ET LES DEUX GESTES
    // SONT INDISSOCIABLES : déclaré absent ici ET présent au registre,
    // l'un des deux mentirait, et `tools.test.ts` échoue exprès sur cet
    // écart. La phrase d'origine disait elle-même pourquoi il fallait
    // l'écrire — « agréger côté modèle reviendrait à lui faire compter
    // des heures », or les heures sont l'une des huit grandeurs de la
    // frontière déterministe.
    etat: "couvert",
    explication:
      "Déclaré sous son nom, adossé à `ai_planning_summary` (0082). Il agrège en SQL ce que le " +
      "modèle n'a pas le droit de compter : les heures posées, jour par jour et équipe par " +
      "équipe. Il rend `heuresConnues` et jamais « heures travaillées » — une intervention qui " +
      "court sur plusieurs jours vaut null sur chacun, jamais son amplitude.",
  },
  {
    nomSpec: "createPlanningProposal",
    etat: "couvert",
    explication:
      "Déclaré sous son vrai nom, `scheduleIntervention` : il planifie UNE intervention. Le nom " +
      "de la spec laisserait croire à un planificateur qui réorganise une semaine.",
  },
]);
