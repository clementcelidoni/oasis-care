import { createClient } from "@/lib/supabase/server";

/**
 * §AUDIT LOG — « who, organization, what, entity, oldValue, newValue,
 * timestamp, source », et §SECURITY « audit actions critiques ».
 *
 * Une seule porte d'entrée, et elle passe par `record_audit_event` :
 * la table n'a aucune politique d'écriture, et la fonction impose
 * `auth.uid()` comme auteur. Une ligne d'audit ne peut donc pas mentir
 * sur qui l'a écrite.
 *
 * NE JETTE JAMAIS. Un journal qui casse le geste qu'il observe est pire
 * que pas de journal : personne ne veut qu'une facture refuse de
 * s'émettre parce que sa trace n'a pas pu s'écrire. L'échec est
 * enregistré dans les logs serveur, et l'action continue.
 */
export type AuditAction =
  | "quoteSent"
  | "quoteAccepted"
  | "quoteRejected"
  | "invoiceIssued"
  | "invoiceCancelled"
  | "creditNoteIssued"
  | "paymentRecorded"
  | "gardenDelivered"
  | "portalInvited"
  | "portalRevoked"
  // §14 ÉQUIPE. Donner à quelqu'un le rôle d'administrateur, ou lui
  // couper l'accès, change ce qu'il peut lire et écrire dans toute
  // l'entreprise. C'est une « action critique » au même titre qu'une
  // facture émise — et c'est celle dont on voudra la date et l'auteur
  // le jour où quelqu'un demandera « qui lui a donné ce droit ».
  | "memberInvited"
  | "memberRoleChanged"
  | "memberAccessChanged";

export async function recordAudit(
  organizationId: string,
  action: AuditAction,
  entityType: string,
  entityId: string | null,
  newValue?: Record<string, unknown>,
  oldValue?: Record<string, unknown>,
) {
  try {
    const supabase = await createClient();
    const { error } = await supabase.rpc("record_audit_event", {
      p_organization_id: organizationId,
      p_action: action,
      p_entity_type: entityType,
      p_entity_id: entityId,
      p_old_value: oldValue ?? null,
      p_new_value: newValue ?? null,
      p_source: "web",
    });
    if (error) console.error("audit", action, error.message);
  } catch (error) {
    console.error("audit", action, error);
  }
}
