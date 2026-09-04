import { createClient } from "@/lib/supabase/server";
import { isProposalKind, type Proposal } from "@/lib/ai/proposals";

/**
 * §11W — LA PROPOSITION QUI SURVIT À UN RECHARGEMENT.
 *
 * Avant cette phase, une proposition vivait dans l'état React d'un seul
 * échange : fermer l'onglet entre la réponse et le clic la faisait
 * disparaître. Elle est désormais une colonne du message
 * (`ai_conversation_messages.proposal`), donc elle se retrouve.
 *
 * ─── POURQUOI LA BASE NE CONTRAINT PAS LE `kind`, ET POURQUOI C'EST ICI ───
 *
 * 0079 le dit en toutes lettres : le catalogue des `kind` vit dans
 * `lib/ai/proposals.ts`, et le recopier en contrainte SQL ferait deux
 * listes qui divergeraient au premier ajout — avec la base en tort, en
 * silence. La colonne est donc un `jsonb` libre, et la vérification
 * appartient à ce fichier, du côté où la liste est vraie.
 *
 * Ce qui traverse est un `{kind, args}` — une entrée de RPC, jamais une
 * phrase d'interface. Le texte que l'humain lit avant de cliquer est
 * recomposé par `describeProposal` à partir des paramètres typés.
 */

export function lireProposition(valeur: unknown): Proposal | null {
  if (typeof valeur !== "object" || valeur === null || Array.isArray(valeur)) return null;
  const { kind, args } = valeur as { kind?: unknown; args?: unknown };
  if (!isProposalKind(kind)) return null;
  if (typeof args !== "object" || args === null || Array.isArray(args)) return null;
  return { kind, args: args as Record<string, unknown> };
}

/**
 * Consigne ce que le bouton est devenu.
 *
 * `proposal_status` n'avance QUE dans un sens — le déclencheur de 0079
 * refuse le retour en arrière — parce qu'un historique qui se réécrit
 * après coup n'est plus un historique. Le filtre `eq("pending")` fait
 * la même chose côté client : deux clics simultanés ne produisent
 * qu'une transition.
 *
 * ══════════════════════════════════════════════════════════════════
 * ON MARQUE LA LIGNE QU'ON A EXÉCUTÉE, PAS CELLE QUE LE FORMULAIRE DIT
 * ══════════════════════════════════════════════════════════════════
 *
 * `messageId`, `conversationId`, `kind` et `args` refont tous
 * l'aller-retour par le navigateur. `confirmProposal` ne fait déjà
 * confiance qu'à sa liste blanche et à la session pour l'exécution —
 * mais le MARQUAGE, lui, ne visait qu'un identifiant de message, sans
 * jamais le relier à la proposition confirmée. Un POST fabriqué pouvait
 * donc exécuter la proposition A et faire afficher « Fait » sur la
 * carte B du même fil. Aucune fuite entre comptes (la RLS borne l'effet
 * au fil de l'auteur), mais l'historique d'un fil mentait sur ce qui
 * avait été fait — précisément la promesse que cet écran met en avant.
 *
 * On relit donc la ligne AVANT de la marquer, et on refuse si elle
 * n'appartient pas au fil annoncé ou si elle ne porte pas la
 * proposition qu'on vient de traiter. `attendu` est le `kind` réel,
 * relu du côté où la liste des `kind` est vraie.
 *
 * L'ÉCHEC RESTE SILENCIEUX, ET C'EST DÉLIBÉRÉ : l'écriture métier a
 * déjà eu lieu. Faire échouer la confirmation parce que la ligne
 * d'historique n'a pas pu être marquée dirait à l'utilisateur que rien
 * n'a été créé, alors que tout l'a été.
 */
export async function marquerProposition(
  messageId: string,
  conversationId: string,
  attendu: string,
  statut: "executed" | "declined",
): Promise<void> {
  const supabase = await createClient();

  const { data: ligne, error: erreurLecture } = await supabase
    .from("ai_conversation_messages")
    .select("id, conversation_id, proposal, proposal_status")
    .eq("id", messageId)
    .maybeSingle();

  if (erreurLecture) {
    console.error("statut de proposition :", erreurLecture.message);
    return;
  }
  if (!ligne) return;
  if (String(ligne.conversation_id) !== conversationId) return;

  const proposition = lireProposition(ligne.proposal);
  if (proposition === null || proposition.kind !== attendu) return;

  const { error } = await supabase
    .from("ai_conversation_messages")
    .update({ proposal_status: statut })
    .eq("id", messageId)
    .eq("conversation_id", conversationId)
    .eq("proposal_status", "pending");
  if (error) console.error("statut de proposition :", error.message);
}
