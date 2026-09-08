"use server";

import { revalidatePath } from "next/cache";

import { requireOrganization } from "@/lib/auth/organization";
import { createClient } from "@/lib/supabase/server";
import { flash } from "@/lib/ui/flash";

/**
 * §PORTE ANONYME — OUVRIR ET FERMER LE LIEN D'UN DEVIS.
 *
 * ══════════════════════════════════════════════════════════════════
 * CE FICHIER EXISTE PARCE QUE LA PORTE N'AVAIT PAS DE POIGNÉE
 * ══════════════════════════════════════════════════════════════════
 *
 * 0089 § 8.e a posé `partager_devis()` et `revoquer_partage_devis()`,
 * et l'audit a mesuré qu'aucune des deux n'avait d'appelant : le
 * paysagiste n'avait donc AUCUN moyen de créer un lien. La porte
 * existait en base, personne ne pouvait l'ouvrir.
 *
 * ══════════════════════════════════════════════════════════════════
 * CE QUE CES ACTIONS NE FONT PAS, ET POURQUOI
 * ══════════════════════════════════════════════════════════════════
 *
 * ELLES N'ENVOIENT RIEN. Créer un lien n'écrit à personne : le
 * paysagiste copie l'adresse et la colle où il veut. « NE PAS envoyer
 * automatiquement » reste la règle, et un bouton « Partager » qui
 * expédierait un courriel la contredirait.
 *
 * ELLES NE DÉCIDENT AUCUNE DATE. L'échéance vient du devis
 * (`valid_until`), et la base la RELIT à chaque ouverture — raccourcir
 * la validité ferme la porte le jour même. Les trente jours ne sont
 * qu'un PLAFOND, pour les devis sans date de validité.
 *
 * ELLES NE REVÉRIFIENT AUCUN DROIT. `partager_devis` exige
 * `quotes.edit` — le droit de MODIFIER, pas seulement de lire, parce
 * qu'ouvrir une porte publique est un geste d'écriture. Le redire ici
 * dupliquerait une règle qui a déjà son seul endroit, et les deux
 * copies finiraient par diverger.
 *
 * ELLES N'ÉCRIVENT PAS AU JOURNAL D'AUDIT, et c'est délibéré.
 * `document_share_links` porte déjà `created_by`, `created_at`,
 * `revoked_by`, `revoked_at` et `revoked_reason` : le fait est donc
 * daté et signé, à l'endroit où il a du sens, et il survit à la
 * révocation du lien. Une ligne d'audit générique en plus dirait la
 * même chose moins bien — et il faudrait pour cela élargir un type
 * partagé par tout le produit.
 *
 * ET LE JETON N'APPARAÎT DANS AUCUNE TRACE. C'est la clé de la porte :
 * la recopier dans une table que des collègues consultent en ferait une
 * clé partagée.
 */

function texte(formData: FormData, cle: string): string | null {
  const valeur = String(formData.get(cle) ?? "").trim();
  return valeur === "" ? null : valeur;
}

export async function partagerDevis(formData: FormData) {
  // L'organisation est résolue côté serveur, jamais lue dans le
  // formulaire : un champ caché la nommant serait la chose évidente à
  // écrire et la chose évidente à trafiquer.
  await requireOrganization();

  const quoteId = texte(formData, "quote_id");
  if (quoteId === null) return;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("partager_devis", { p_quote_id: quoteId });

  if (error) {
    // LE MESSAGE DE LA BASE EST DÉJÀ ÉCRIT POUR UN PAYSAGISTE — « Ce
    // devis a expiré le … : prolongez sa validité avant de le
    // partager. » Le remplacer par « une erreur est survenue »
    // supprimerait la seule phrase qui dit quoi faire.
    await flash("error", error.message);
    return;
  }

  const ligne = Array.isArray(data) ? data[0] : data;

  revalidatePath(`/devis/${quoteId}`);
  await flash(
    "success",
    ligne?.message ??
      "Le lien est ouvert. Il ouvre ce devis, et rien d'autre : ni votre compte, ni vos autres documents.",
  );
}

export async function revoquerPartageDevis(formData: FormData) {
  await requireOrganization();

  const quoteId = texte(formData, "quote_id");
  if (quoteId === null) return;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("revoquer_partage_devis", {
    p_quote_id: quoteId,
    p_motif: texte(formData, "motif"),
  });

  if (error) {
    await flash("error", error.message);
    return;
  }

  revalidatePath(`/devis/${quoteId}`);
  await flash(
    "info",
    (data ?? 0) > 0
      ? "Le lien est fermé. Quiconque l'avait reçu ne peut plus ouvrir le devis."
      : "Aucun lien n'était ouvert pour ce devis.",
  );
}
