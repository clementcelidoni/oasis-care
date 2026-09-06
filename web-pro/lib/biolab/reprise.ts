"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { flash } from "@/lib/ui/flash";
import { perimetreBioLab } from "./cultures.ts";

/**
 * §3 DE LA MIGRATION 0087 — LE GESTE DE REPRISE, ET LUI SEUL.
 *
 * CE FICHIER NE CONTIENT QU'UNE ÉCRITURE, DÉLIBÉRÉMENT. Tout module
 * marqué `use server` expose CHACUN de ses exports comme un point
 * d'entrée appelable depuis le navigateur. Y laisser la lecture
 * — celle de repriseLecture.ts — aurait ouvert une adresse de plus
 * sans aucun besoin : elle est appelée par un composant serveur, qui
 * n'a pas à passer par le réseau pour cela.
 */

/**
 * Verse un laboratoire personnel dans l'espace de l'entreprise active.
 *
 * ELLE NE SUPPRIME RIEN — §26. La fonction de base ne fait que des
 * `update` de `workspace_id`, tracés ligne à ligne dans
 * `biolab_transfert_lignes` pour que le retour arrière soit exact. Et
 * elle ne touche PAS `updated_at` : cette colonne est ce que l'écran de
 * supervision affiche comme date de l'état d'un appareil, et une
 * écriture d'administration n'a pas à se faire passer pour un relevé.
 *
 * CE QUI NE SUIT PAS, ET QUI EST DIT À L'UTILISATEUR : les PLANTES
 * MÈRES. Elles appartiennent au monde du jardin — elles portent
 * `garden_id` — et les emporter viderait un jardin personnel sans que
 * personne ne l'ait demandé. La fonction compte combien restent
 * derrière ; le message le répète plutôt que de le taire.
 */
export async function reprendreLaboratoire(formData: FormData) {
  const espaceSource = String(formData.get("espace_source") ?? "").trim();
  if (espaceSource === "") {
    await flash("error", "Aucun espace de départ n'a été indiqué.");
    return;
  }

  const perimetre = await perimetreBioLab();
  if (!perimetre.peutGerer) {
    // La base refuserait aussi — `transferer_biolab_vers_entreprise`
    // vérifie `biolab.manage`. Ce message-ci existe pour que le refus
    // soit lisible plutôt que technique.
    await flash(
      "error",
      "Reprendre un laboratoire demande le droit « gestion BioLab », que votre rôle ne porte pas.",
    );
    return;
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("transferer_biolab_vers_entreprise", {
    p_organization_id: perimetre.organisation.organizationId,
    p_espace_source: espaceSource,
  });

  if (error) {
    await flash("error", `La reprise n'a pas eu lieu : ${error.message}`);
    return;
  }

  const resume = (data ?? {}) as Record<string, unknown>;
  const lignes = Number(resume.lignes_deplacees ?? 0);
  const meres = Number(resume.plantes_meres_restees ?? 0);

  const phrase =
    lignes === 0
      ? "Rien n'a été déplacé : cet espace ne contenait aucune donnée de laboratoire."
      : `${lignes} ligne${lignes > 1 ? "s" : ""} de laboratoire ${lignes > 1 ? "ont" : "a"} rejoint ${perimetre.organisation.name}.` +
        (meres > 0
          ? ` ${meres} plante${meres > 1 ? "s" : ""} mère${meres > 1 ? "s" : ""} ${meres > 1 ? "sont restées" : "est restée"} dans votre jardin personnel : elles n'appartiennent pas au laboratoire, et les déplacer viderait ce jardin.`
          : "");

  await flash(lignes === 0 ? "info" : "success", phrase);
  revalidatePath("/biolab");
}
