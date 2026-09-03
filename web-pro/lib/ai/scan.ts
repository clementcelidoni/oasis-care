"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireOrganization } from "@/lib/auth/organization";
import { flash } from "@/lib/ui/flash";
import { readBriefItem, type BriefItem } from "@/lib/ai/types";

/**
 * §11V — LE BALAYAGE : transformer un constat en décision.
 *
 * `ai_executive_brief` (0073) LIT et rend des constats en mémoire.
 * `ai_open_decision` (0072) ÉCRIT une décision. Rien ne les reliait :
 * c'est ce chaînon, et il est délibérément ici plutôt qu'en SQL.
 *
 * ─── POURQUOI ICI, ET PAS DANS UNE FONCTION POSTGRES ───
 *
 * Parce qu'un balayage doit s'exécuter AVEC LES DROITS D'UN UTILISATEUR
 * RÉEL. Une fonction `security definer` qui ouvrirait des décisions
 * toute seule verrait ce que l'utilisateur ne voit pas, et ouvrirait
 * chez lui des décisions fondées sur des données que la RLS lui masque.
 * Ici, `ai_executive_brief` et `ai_open_decision` sont toutes deux
 * appelées en `security invoker` : ce que le compte ne peut pas lire ne
 * produit aucune décision, et le brief le NOMME dans
 * `droitsManquants`.
 *
 * ─── POURQUOI PAS AU RENDU DE LA PAGE ───
 *
 * Ouvrir une décision est une écriture. Une écriture déclenchée par le
 * simple affichage d'un écran se rejoue à chaque rechargement, à chaque
 * onglet ouvert, à chaque robot d'indexation. C'est une Server Action,
 * derrière un bouton — et le jour où un ordonnanceur l'appellera toutes
 * les nuits, il l'appellera au nom d'un utilisateur nommé, avec ses
 * droits, comme ici.
 *
 * ─── CE QUE LE BALAYAGE N'INVENTE PAS ───
 *
 * Chaque champ écrit vient tel quel du brief : le titre, l'impact en
 * centimes (ou `null`, jamais zéro), la confiance, les tables lues, le
 * « pourquoi », le « si rien n'est fait », l'action recommandée, les
 * boutons. Aucun texte n'est composé ici, aucun montant n'est estimé.
 * Le balayage recopie, il ne conclut pas.
 */

export type ScanResult = {
  ouvertes: number;
  rafraichies: number;
  total: number;
};

export async function runExecutiveScan() {
  const organization = await requireOrganization();
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("ai_executive_brief", {
    p_organization_id: organization.organizationId,
  });

  if (error || !data) {
    await flash(
      "error",
      error?.message?.includes("does not exist")
        ? "Les analyses d'Oasis ne sont pas encore installées sur cette base."
        : (error?.message ?? "L'analyse n'a pas pu être menée."),
    );
    revalidatePath("/oasis-ai/decisions");
    return;
  }

  const payload = data as Record<string, unknown>;
  const items: BriefItem[] = Array.isArray(payload.actionsPrioritaires)
    ? payload.actionsPrioritaires
        .map(readBriefItem)
        .filter((item): item is BriefItem => item !== null)
    : [];

  if (items.length === 0) {
    const manquants = Array.isArray(payload.droitsManquants) ? payload.droitsManquants : [];
    await flash(
      "info",
      manquants.length > 0
        ? `Aucune recommandation : les droits ${manquants.join(", ")} manquent à ce compte. Ce n'est pas « rien à signaler ».`
        : "Analyse terminée : rien ne réclame de décision aujourd'hui.",
    );
    revalidatePath("/oasis-ai/decisions");
    revalidatePath("/oasis-ai");
    return;
  }

  let ouvertes = 0;
  let rafraichies = 0;

  for (const item of items) {
    const dedupeKey = dedupeKeyFor(item);

    const { data: decisionId, error: openError } = await supabase.rpc("ai_open_decision", {
      p_organization_id: organization.organizationId,
      p_agent: item.agent,
      p_category: item.categorie,
      p_title: item.titre,
      p_confidence: item.confiance,
      // LE SEUL CHAMP DONT LE NOM MENT UN PEU, ET C'EST DOCUMENTÉ.
      // La spec p. 6 exige d'afficher « Que se passe-t-il si je ne fais
      // rien ? » ; `ai_decisions` (0072) n'a pas de colonne pour cela,
      // et `description` est le seul texte libre disponible. Le
      // Decision Center lit donc `description` sous ce libellé. La
      // bonne correction est une colonne `no_action_consequence` dans
      // une migration ultérieure — pas un contournement de plus ici.
      p_description: item.siRienNestFait,
      // L'impact chiffré COMMANDE le classement du brief ; on ne le
      // recalcule pas, et on ne le remplace pas par zéro quand il est
      // absent.
      p_priority: priorityFor(item),
      p_estimated_impact: item.impactTexte,
      // LE GARDE-FOU DE LA PAGE 2, CÔTÉ APPELANT. Une conclusion tirée
      // de données insuffisantes ne peut pas porter de montant :
      // `ai_open_decision` lève, et une décision qui lève est une
      // décision invisible. Aucun agent de cette itération ne produit
      // cette combinaison ; si l'un le fait un jour, mieux vaut ouvrir
      // la décision SANS le chiffre que la perdre en silence — le
      // chiffre, lui, serait une estimation déguisée.
      p_financial_impact_cents:
        item.confiance === "insufficient_data" ? null : item.impactCents,
      p_data_sources: item.donneesUtilisees,
      p_reasoning_summary: item.pourquoi,
      p_recommended_action: item.actionRecommandee,
      p_available_actions: item.actionsDisponibles.map((actionType) => ({ actionType })),
      p_dedupe_key: dedupeKey,
    });

    if (openError) {
      console.error("ouverture de décision :", openError.message);
      continue;
    }
    if (!decisionId) continue;

    // A-t-elle été créée, ou retrouvée ? `ai_open_decision` rend
    // l'existante sans le dire. On le déduit de son statut : une
    // décision qu'un humain a déjà vue, reportée ou tranchée ne doit
    // PAS être réécrite — ce serait effacer son geste. Une décision
    // encore « new » n'a été lue par personne, et un montant périmé y
    // serait un mensonge : on la rafraîchit.
    const refreshed = await refreshIfUntouched(
      organization.organizationId,
      String(decisionId),
      item,
    );
    if (refreshed === "created") {
      ouvertes += 1;
      await notifyIfCritical(organization.organizationId, String(decisionId), item);
    } else if (refreshed === "refreshed") {
      rafraichies += 1;
    }
  }

  await flash(
    "success",
    summarize({ ouvertes, rafraichies, total: items.length }),
  );
  revalidatePath("/oasis-ai/decisions");
  revalidatePath("/oasis-ai");
}

/**
 * Spec p. 40 : « Les recommandations critiques apparaissent dans
 * notifications. »
 *
 * SEULEMENT LES « URGENT », ET SEULEMENT À L'OUVERTURE. Notifier à
 * chaque passage du balayage transformerait la cloche en bruit de
 * fond, et une cloche qu'on n'écoute plus ne prévient de rien. La
 * notification naît avec la décision et ne se répète pas : le
 * `dedupe_key` de `ai_decisions` (0072) fait donc aussi office de
 * garde-fou ici, sans qu'aucun index supplémentaire soit nécessaire.
 *
 * `user_id` est NULL — toute l'entreprise. La destinataire d'une
 * facture à émettre n'est pas connue de l'agent, et deviner le
 * responsable serait le mauvais endroit pour deviner.
 *
 * L'échec est SILENCIEUX et volontairement sans conséquence : une
 * notification manquée ne doit pas faire échouer l'analyse qui, elle,
 * a bien ouvert la décision. Elle reste visible dans le centre de
 * décision.
 */
async function notifyIfCritical(
  organizationId: string,
  decisionId: string,
  item: BriefItem,
): Promise<void> {
  if (item.categorie !== "urgent") return;

  const supabase = await createClient();
  const { error } = await supabase.from("notifications").insert({
    organization_id: organizationId,
    user_id: null,
    kind: "critical",
    category: "oasisAi",
    title: item.titre,
    // Le montant s'écrit ici seulement s'il existe. « 0,00 € » sur une
    // notification critique ferait passer une alerte pour une broutille.
    body:
      item.impactCents === null
        ? (item.pourquoi ?? "Oasis a ouvert une décision urgente.")
        : `${(item.impactCents / 100).toLocaleString("fr-FR", {
            style: "currency",
            currency: "EUR",
          })} — ${item.impactTexte ?? item.pourquoi ?? "impact estimé"}`,
    href: "/oasis-ai/decisions",
    entity_type: "ai_decision",
    entity_id: decisionId,
  });

  if (error) console.error("notification Oasis :", error.message);
}

/**
 * Rafraîchir une décision que personne n'a encore touchée.
 *
 * Rend « created » quand la ligne venait de naître (rien à corriger),
 * « refreshed » quand elle existait et a été remise à jour, et
 * « untouched » quand un humain s'en est déjà occupé.
 */
async function refreshIfUntouched(
  organizationId: string,
  decisionId: string,
  item: BriefItem,
): Promise<"created" | "refreshed" | "untouched"> {
  const supabase = await createClient();

  const { data: row } = await supabase
    .from("ai_decisions")
    .select("status, created_at, title, financial_impact_cents")
    .eq("organization_id", organizationId)
    .eq("id", decisionId)
    .maybeSingle();

  if (!row) return "created";

  // Née dans les dix dernières secondes : c'est notre insertion.
  const age = Date.now() - new Date(String(row.created_at)).getTime();
  if (age < 10_000) return "created";

  if (row.status !== "new") return "untouched";

  const sameTitle = row.title === item.titre;
  const sameAmount = (row.financial_impact_cents ?? null) === item.impactCents;
  if (sameTitle && sameAmount) return "untouched";

  await supabase
    .from("ai_decisions")
    .update({
      title: item.titre,
      description: item.siRienNestFait,
      estimated_impact: item.impactTexte,
      // Même garde-fou qu'à l'ouverture : la contrainte
      // `ai_decisions_no_amount_without_data` rejetterait la mise à
      // jour, et la décision resterait affichée avec des chiffres
      // périmés — le pire des deux mondes.
      financial_impact_cents:
        item.confiance === "insufficient_data" ? null : item.impactCents,
      confidence: item.confiance,
      reasoning_summary: item.pourquoi,
      recommended_action: item.actionRecommandee,
      priority: priorityFor(item),
      updated_at: new Date().toISOString(),
    })
    .eq("organization_id", organizationId)
    .eq("id", decisionId)
    .eq("status", "new");

  return "refreshed";
}

/**
 * La clé de déduplication.
 *
 * LES CHIFFRES SONT NEUTRALISÉS. « Facturer 10 dossiers » et
 * « Facturer 9 dossiers » sont la même préoccupation, pas deux : sans
 * cela, le tableau se remplirait d'une ligne par passage. La clé porte
 * donc le motif — agent, catégorie, titre sans ses nombres — et
 * l'index partiel de 0072 la rend unique parmi les décisions VIVANTES,
 * ce qui laisse la même préoccupation se rouvrir trois mois plus tard.
 */
function dedupeKeyFor(item: BriefItem): string {
  const motif = item.titre.replace(/\d+/g, "#").trim().toLowerCase();
  return `brief:${item.agent}:${item.categorie}:${motif}`.slice(0, 200);
}

/**
 * La priorité, dérivée de la catégorie.
 *
 * Le classement fin est déjà fait par `ai_executive_brief`, qui pondère
 * l'impact par la catégorie et par les objectifs de l'entreprise, et
 * qui ne rend que les cinq premières lignes. Ici on ne fait que refléter
 * l'urgence dans une colonne que l'écran sait trier — recalculer un
 * score serait en inventer un second, différent du premier.
 */
function priorityFor(item: BriefItem): number {
  switch (item.categorie) {
    case "urgent":
      return 90;
    case "important":
      return 75;
    case "opportunite":
      return 60;
    case "optimisation":
      return 45;
    default:
      return 20;
  }
}

function summarize(result: ScanResult): string {
  const parts: string[] = [];
  if (result.ouvertes > 0) parts.push(`${result.ouvertes} nouvelle(s) décision(s)`);
  if (result.rafraichies > 0) parts.push(`${result.rafraichies} mise(s) à jour`);
  if (parts.length === 0) {
    return `Analyse terminée : ${result.total} constat(s), tous déjà dans votre centre de décision.`;
  }
  return `Analyse terminée : ${parts.join(", ")}.`;
}
