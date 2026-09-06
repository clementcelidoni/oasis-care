"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireOrganization } from "@/lib/auth/organization";
import { flash } from "@/lib/ui/flash";
import { TEXTE_CONSENTEMENT } from "./texte";

/**
 * §EMAILS — LE CONSENTEMENT COMMERCIAL, ENREGISTRÉ PAR L'ENTREPRISE.
 *
 * ══════════════════════════════════════════════════════════════════
 * CE QUI MANQUAIT : LE BOUTON
 * ══════════════════════════════════════════════════════════════════
 *
 * `email_record_consent` existait, était bien protégée, et était
 * strictement exigée par `email_gate` — mais AUCUN écran ne l'appelait.
 * Conséquence : `consented_at` restait vide pour tout le monde, la
 * porte refusait chaque adresse, et toute campagne rendait « 0 mis en
 * file ». Le régime juridique était respecté par accident, parce que
 * rien ne pouvait partir, et le premier essai ressemblait à une panne
 * muette plutôt qu'à un refus compris.
 *
 * ══════════════════════════════════════════════════════════════════
 * LE TEXTE MONTRÉ EST RECOPIÉ, PAS POINTÉ
 * ══════════════════════════════════════════════════════════════════
 *
 * `consent_evidence` reçoit LA PHRASE EXACTE affichée à côté de la
 * case, et non une référence vers elle — voir `texte.ts`, qui la porte
 * pour les deux côtés.
 */


export async function enregistrerConsentementCommercial(formData: FormData) {
  const organization = await requireOrganization();
  // LA CASE COCHÉE OU DÉCOCHÉE, LUE SUR LE FORMULAIRE. Une case non
  // cochée n'est pas envoyée par le navigateur : l'absence VAUT retrait,
  // et c'est le comportement voulu — un formulaire qui ne saurait
  // qu'ajouter un consentement ne saurait pas le retirer.
  const consent = formData.get("consentement") === "oui";

  const supabase = await createClient();
  const { error } = await supabase.rpc("email_record_consent", {
    p_organization_id: organization.organizationId,
    p_consented: consent,
    p_source: "reglagesEntreprise",
    p_evidence: consent ? TEXTE_CONSENTEMENT : null,
  });

  if (error) {
    await flash("error", `Votre choix n'a pas pu être enregistré : ${error.message}`);
  } else if (consent) {
    await flash(
      "success",
      "C'est noté : vous recevrez nos nouveautés. Vous pourrez vous désabonner par le lien de chaque message.",
    );
  } else {
    await flash(
      "success",
      "C'est noté : vous ne recevrez plus nos communications commerciales. Vos documents et les messages de votre compte continueront d'arriver.",
    );
  }

  revalidatePath("/entreprise/courrier");
}
