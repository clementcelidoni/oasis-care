import { createClient } from "@/lib/supabase/server";
import { readRisk, type CatalogEntry } from "@/lib/ai/types";

/**
 * §11V — BRIQUE N° 1 : L'AI TOOL REGISTRY, côté écran.
 *
 * Le registre vit dans `ai_action_catalog` (0072), pas ici. Ce fichier
 * ne fait que le LIRE et lui ajouter deux choses que la base n'a pas à
 * connaître :
 *
 *   • le nom de l'écran où l'on fait la chose à la main
 *     (`MANUAL_ROUTES`), pour qu'un bouton absent ne soit pas une
 *     impasse ;
 *   • la liste des actions que cette itération sait RÉELLEMENT
 *     exécuter (`EXECUTABLE`).
 *
 * CE DEUXIÈME POINT EST LE PLUS IMPORTANT DU FICHIER. Le catalogue
 * DÉCLARE neuf actions ; l'exécuteur de cette itération n'en sait faire
 * qu'une. Les huit autres ne sont pas « bientôt » : tant qu'elles n'ont
 * pas d'exécuteur, proposer leur bouton produirait un clic qui ne fait
 * rien, ou pire, un « c'est fait » sur un néant. L'écran affiche donc,
 * pour celles-là, ce qu'Oasis a compris et où aller le faire soi-même.
 *
 * Le jour où l'une d'elles reçoit un exécuteur, elle s'ajoute ICI et
 * nulle part ailleurs.
 */

/**
 * Ce que cette itération sait exécuter pour de vrai.
 *
 * `createInvoiceDraft` seul, parce que c'est le critère de validation
 * du MVP (spec p. 50) : « Prépare les factures. → Oasis crée réellement
 * les brouillons après confirmation. » Et parce qu'un brouillon de
 * facture est réversible — il ne porte pas de numéro de séquence
 * légale, il s'annule en le supprimant.
 */
export const EXECUTABLE: readonly string[] = ["createInvoiceDraft"];

export function isExecutable(actionType: string): boolean {
  return EXECUTABLE.includes(actionType);
}

/**
 * Où faire la chose à la main, quand Oasis ne sait pas la faire.
 *
 * §32 : une capacité annoncée sans sa limite laisse découvrir la limite
 * au pire moment. Une limite annoncée sans porte de sortie est presque
 * aussi mauvaise.
 */
export const MANUAL_ROUTES: Record<string, { href: string; label: string; why: string }> = {
  quoteFollowUp: {
    href: "/devis",
    label: "Ouvrir les devis",
    why: "Oasis ne dispose d'aucun canal d'envoi : une relance part de vous, pas de lui.",
  },
  createQuoteDraft: {
    href: "/devis",
    label: "Créer un devis",
    why: "Un brouillon de devis se compose ligne à ligne ; demandez-le à Oasis dans « Demander à Oasis », il le préparera.",
  },
  adjustQuotePricing: {
    href: "/devis",
    label: "Ouvrir les devis",
    why: "Modifier un prix engage la relation commerciale : cela se fait sur le devis, en le relisant.",
  },
  issueInvoice: {
    href: "/factures",
    label: "Ouvrir les factures",
    why: "Émettre attribue le numéro de séquence légale. Irréversible : une facture émise s'annule par avoir.",
  },
  sendInvoice: {
    href: "/factures",
    label: "Ouvrir les factures",
    why: "L'envoi d'une facture engage l'entreprise. Interdit à Oasis (PRINCIPES ABSOLUS, p. 2).",
  },
  purchaseOrderSend: {
    href: "/achats",
    label: "Ouvrir les achats",
    why: "Envoyer une commande engage l'achat. Interdit à Oasis (PRINCIPES ABSOLUS, p. 2).",
  },
  priceBookUpdate: {
    href: "/catalogue",
    label: "Ouvrir la bibliothèque de prix",
    why: "Un prix de grille se recopie seul dans tous les devis suivants. Interdit à Oasis (PRINCIPES ABSOLUS, p. 2).",
  },
  lowStockAlert: {
    href: "/pepiniere/stock",
    label: "Ouvrir le stock",
    why: "C'est une alerte, pas une action : elle n'écrit rien dans le stock.",
  },
};

export type CatalogResult = {
  entries: CatalogEntry[];
  /** Vrai quand le catalogue n'a PAS pu être lu — distinct d'un catalogue vide. */
  failed: boolean;
};

/**
 * Le catalogue entier. Il n'a pas d'organisation : « créer un brouillon
 * de facture » ne dépend pas de l'entreprise. Ce qui en dépend —
 * plafond, activation — vit dans `ai_autopilot_rules`.
 */
export async function getActionCatalog(): Promise<CatalogResult> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ai_action_catalog")
    .select(
      "action_type, agent, label, description, default_risk_level, required_permission, is_write, carries_amount, autopilot_eligible, autopilot_default_on",
    )
    .order("agent")
    .order("action_type");

  if (error) {
    console.error("catalogue des actions IA :", error.message);
    return { entries: [], failed: true };
  }

  return {
    entries: (data ?? []).map((row) => ({
      ...(row as CatalogEntry),
      default_risk_level: readRisk((row as CatalogEntry).default_risk_level),
    })),
    failed: false,
  };
}

/** Un index par type d'action, pour les écrans qui en croisent plusieurs. */
export function catalogIndex(entries: CatalogEntry[]): Map<string, CatalogEntry> {
  return new Map(entries.map((entry) => [entry.action_type, entry]));
}
