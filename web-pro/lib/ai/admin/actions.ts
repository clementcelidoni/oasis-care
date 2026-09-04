"use server";

import { revalidatePath } from "next/cache";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { requireOrganization } from "@/lib/auth/organization";
import { flash } from "@/lib/ui/flash";

/**
 * §11V / §11X — LE SEUL GESTE D'ÉCRITURE QUI RESTE AU CLIENT ICI :
 * DONNER SON AVIS.
 *
 * ══════════════════════════════════════════════════════════════════
 * DEUX ÉCRITURES SONT PARTIES, ET ELLES NE SONT PAS DÉPLACÉES : ELLES
 * SONT SUPPRIMÉES
 * ══════════════════════════════════════════════════════════════════
 *
 * Ce fichier portait `enregistrerSurchargeModele` (choisir le modèle
 * d'un agent) et `enregistrerPlafondsIA` (fixer les trois plafonds de
 * dépense). Les deux écrivaient dans `ai_model_overrides` et
 * `ai_cost_limits` sous l'identité du gestionnaire de l'entreprise
 * cliente, avec pour seule barrière la permission
 * `organization.manageUsers`.
 *
 * C'était un plafond dont la partie plafonnée tenait la manette : le
 * même écran permettait de basculer les agents sur le modèle le plus
 * cher ET de relever, vider ou supprimer la limite censée l'en
 * empêcher — alors que la facture du fournisseur arrive chez l'éditeur.
 *
 * La migration 0080 a fermé ce chemin EN BASE : plus aucune politique
 * d'écriture sur ces deux tables, plus aucun droit `insert/update/
 * delete` pour `authenticated`, et quatre fonctions `security definer`
 * réservées aux administrateurs de plateforme à la place. Les deux
 * Server Actions ne seraient donc plus refusées poliment : elles
 * échoueraient sur un « permission denied for table ai_cost_limits »
 * que personne ne comprendrait. Un bouton qui promet une action
 * devenue impossible est pire qu'un bouton absent — d'où leur retrait,
 * et celui des deux écrans qui les appelaient.
 *
 * Le réglage lui-même n'a pas disparu du produit : il se fait
 * désormais depuis le Control Center, l'application de l'éditeur.
 *
 * ══════════════════════════════════════════════════════════════════
 * CE QUI RESTE, ET POURQUOI IL RESTE
 * ══════════════════════════════════════════════════════════════════
 *
 * Un pouce 👍 / 👎 sur une recommandation engage le jugement d'un
 * salarié sur SON assistant. C'est une donnée du client, écrite par le
 * client, sur son propre travail. Rien à voir avec le choix d'un
 * moteur.
 *
 * Le principe qui gouvernait déjà ce fichier ne change pas :
 * L'ORGANISATION VIENT DE LA SESSION, jamais d'un champ caché.
 * `requireOrganization()` à chaque fois. Un `organizationId` posté
 * serait la chose évidente à écrire et la chose évidente à trafiquer.
 */

// §11W : le centre de décision a fusionné dans l'écran « Aujourd'hui ».
// Seule la CIBLE du rafraîchissement change ici — laisser l'ancien
// chemin aurait fait d'un pouce 👍/👎 un clic sans effet visible, la
// page portant la carte n'étant plus jamais invalidée.
const CHEMIN_DECISIONS = "/oasis-ai";

/**
 * 👍 utile · 👎 inutile · et éventuellement « Pourquoi ? ».
 *
 * ─── POURQUOI DEUX ÉCRITURES ET PAS UN `upsert` ───
 *
 * L'unicité « un avis par personne et par décision » est portée par un
 * index PARTIEL (`where user_id is not null`, 0076). PostgREST ne sait
 * pas viser un index partiel comme arbitre d'un `on conflict` : le
 * `upsert` échouerait, ou pire, viserait un autre index. On lit, puis
 * on écrit — et si deux onglets cliquent en même temps, la violation
 * d'unicité est rattrapée en modification. Deux allers-retours pour un
 * clic sur un pouce, c'est parfaitement acceptable.
 *
 * ─── L'AUTEUR N'EST PAS ENVOYÉ ───
 *
 * `ai_recommendation_feedback_stamp` (0076) impose `user_id :=
 * auth.uid()` avant l'écriture, et la politique RLS le revérifie
 * ensuite. Poster un `user_id` serait inutile au mieux, et au pire
 * donnerait l'illusion qu'on peut choisir l'auteur d'un avis.
 */
export async function donnerAvisRecommandation(formData: FormData) {
  const organization = await requireOrganization();

  const decisionId = String(formData.get("decisionId") ?? "");
  const avis = String(formData.get("avis") ?? "");
  const pourquoi = String(formData.get("pourquoi") ?? "").trim();

  if (decisionId === "" || !["utile", "inutile", "retirer"].includes(avis)) return;

  const user = await getCurrentUser();
  if (!user) return;

  const supabase = await createClient();

  if (avis === "retirer") {
    const { error } = await supabase
      .from("ai_recommendation_feedback")
      .delete()
      .eq("decision_id", decisionId)
      .eq("user_id", user.id);

    if (error) {
      await flash("error", messageLisible(error.message));
      return;
    }
    await flash("success", "Votre avis a été retiré.");
    revalidatePath(CHEMIN_DECISIONS);
    return;
  }

  const utile = avis === "utile";
  const champs = {
    helpful: utile,
    // Chaîne vide → NULL : « pas de commentaire » est une absence, pas
    // un commentaire vide. Le déclencheur de 0076 nettoie et tronque.
    reason: pourquoi === "" ? null : pourquoi,
  };

  const { data: modifiees, error: erreurUpdate } = await supabase
    .from("ai_recommendation_feedback")
    .update(champs)
    .eq("decision_id", decisionId)
    .eq("user_id", user.id)
    .select("id");

  if (erreurUpdate) {
    await flash("error", messageLisible(erreurUpdate.message));
    return;
  }

  if ((modifiees ?? []).length === 0) {
    const { error: erreurInsert } = await supabase.from("ai_recommendation_feedback").insert({
      organization_id: organization.organizationId,
      decision_id: decisionId,
      ...champs,
    });

    // 23505 : quelqu'un — un autre onglet — a inséré entre notre lecture
    // et notre écriture. Son avis est le nôtre, à la formulation près :
    // on écrase avec ce qui vient d'être cliqué.
    if (erreurInsert && erreurInsert.code === "23505") {
      const { error: erreurReprise } = await supabase
        .from("ai_recommendation_feedback")
        .update(champs)
        .eq("decision_id", decisionId)
        .eq("user_id", user.id);
      if (erreurReprise) {
        await flash("error", messageLisible(erreurReprise.message));
        return;
      }
    } else if (erreurInsert) {
      await flash("error", messageLisible(erreurInsert.message));
      return;
    }
  }

  await flash(
    "success",
    utile
      ? "Merci — cette recommandation est notée comme utile."
      : "Merci — c'est noté, cette recommandation n'a pas aidé.",
  );
  revalidatePath(CHEMIN_DECISIONS);
}

// ==================================================================
// Messages
// ==================================================================

/**
 * Le message de Postgres, ou une phrase à sa place.
 *
 * Même doctrine que `friendly()` (`lib/ai/engine.ts`) et
 * `messageLisible()` (`lib/ai/runtime/supabase.ts`) : les migrations
 * écrivent leurs refus en français pour qu'ils remontent tels quels ;
 * seules les erreurs de plomberie sont réécrites.
 */
function messageLisible(message: string): string {
  if (!message) return "L'enregistrement n'a pas abouti.";
  if (message.includes("row-level security")) {
    return "Votre rôle ne permet pas cette écriture. Demandez le droit correspondant à un administrateur.";
  }
  if (message.includes("does not exist") || message.includes("schema cache")) {
    return "Cette partie d'Oasis n'est pas encore installée sur cette base : la migration 0076 reste à appliquer.";
  }
  return message;
}
