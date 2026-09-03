"use server";

import { revalidatePath } from "next/cache";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { requireOrganization } from "@/lib/auth/organization";
import { flash } from "@/lib/ui/flash";
import { routeurModeles } from "@/lib/ai/model/router";
import { CHOIX_PRODUIT, estChoixSurcharge } from "./carte.ts";
import { lireMontantEuros, type LectureMontant } from "./montants.ts";
import {
  LIBELLES_AGENT,
  LIBELLES_NIVEAU,
  MOTIF_MINIMUM,
  cleCatalogueDeLaCleSql,
  estCleAgentSql,
} from "./types.ts";

/**
 * §11V — LES ÉCRITURES DE L'ADMINISTRATION IA ET DES RETOURS.
 *
 * Trois gestes, et un principe commun : L'ORGANISATION VIENT DE LA
 * SESSION, jamais d'un champ caché. `requireOrganization()` à chaque
 * fois. Un `organizationId` posté serait la chose évidente à écrire et
 * la chose évidente à trafiquer.
 *
 * Le droit, lui, est vérifié DEUX FOIS et ce n'est pas de la
 * redondance : la politique RLS de 0076 est la barrière réelle
 * (`organization.manageUsers` pour `ai_cost_limits` et
 * `ai_model_overrides`), le contrôle en TypeScript sert seulement à
 * rendre un message français plutôt qu'un refus Postgres. Retirer le
 * contrôle TypeScript dégraderait le message ; retirer la politique
 * ouvrirait la porte.
 */

const CHEMIN_CONFIG = "/parametres/ia";
const CHEMIN_COUTS = "/parametres/ia/couts";
const CHEMIN_DECISIONS = "/oasis-ai/decisions";

// ==================================================================
// 1. Déplacer un agent d'un niveau (spec p. 26)
// ==================================================================

/**
 * Écrit — ou retire — la surcharge de modèle d'un agent.
 *
 * ─── POURQUOI LE MOTIF EST OBLIGATOIRE POUR POSER, ET PAS POUR LEVER ───
 *
 * La migration 0076 le dit à propos de la colonne `reason` : « Une
 * surcharge sans motif, relue six mois plus tard, ne se lève jamais :
 * personne n'ose défaire ce qu'il ne comprend pas. » On prend
 * l'argument au sérieux, mais dans un seul sens. Exiger une
 * justification pour REVENIR au réglage du produit ajouterait un
 * obstacle sur le geste de secours — celui qu'on fait à sept heures du
 * matin quand un modèle répond mal. Poser une dérogation se motive ;
 * la retirer, non.
 *
 * ─── POURQUOI UN NIVEAU EN ENTRÉE ET UN IDENTIFIANT EN BASE ───
 *
 * L'écran raisonne en niveaux, parce que c'est le vocabulaire du
 * produit. `ai_model_overrides.model` attend un identifiant, parce que
 * SQL ne connaît aucun niveau. La traduction se fait ICI, en un seul
 * endroit, avec les identifiants du routeur — donc en tenant compte des
 * variables `OASIS_MODEL_*` du jour. Écrire l'identifiant a une
 * conséquence assumée, expliquée dans `carte.ts` : la surcharge FIGE ce
 * nom, et l'écran surveille qu'il reste aligné.
 */
export async function enregistrerSurchargeModele(formData: FormData) {
  const organization = await requireOrganization();

  if (!organization.permissions.includes("organization.manageUsers")) {
    await flash("error", "Seul un administrateur peut changer l'aiguillage des modèles.");
    return;
  }

  const agent = String(formData.get("agent") ?? "");
  const choix = String(formData.get("niveau") ?? "");
  const motifBrut = String(formData.get("motif") ?? "").trim();

  if (!estCleAgentSql(agent)) {
    // Les dix autres agents du catalogue ne sont pas surchargeables en
    // base (contrainte `ai_is_supported_agent`, 0072). L'écran ne leur
    // propose pas de sélecteur ; si la requête arrive quand même, on le
    // dit plutôt que de laisser Postgres répondre par un `check`.
    await flash(
      "error",
      "Cet agent ne se surcharge pas en base : son niveau se change par variable d'environnement.",
    );
    return;
  }

  if (!estChoixSurcharge(choix)) {
    await flash("error", "Niveau inconnu.");
    return;
  }

  const libelle = LIBELLES_AGENT[cleCatalogueDeLaCleSql(agent)];
  const supabase = await createClient();

  // ---- Revenir au réglage du produit -------------------------------
  if (choix === CHOIX_PRODUIT) {
    const { error } = await supabase
      .from("ai_model_overrides")
      .delete()
      .eq("organization_id", organization.organizationId)
      .eq("agent", agent);

    if (error) {
      await flash("error", messageLisible(error.message));
      return;
    }

    await flash("success", `${libelle} suit de nouveau le réglage du produit.`);
    revalidatePath(CHEMIN_CONFIG);
    return;
  }

  if (motifBrut.length < MOTIF_MINIMUM) {
    await flash(
      "error",
      `Indiquez pourquoi ${libelle} déroge au réglage du produit : une dérogation sans motif ne se lève jamais.`,
    );
    return;
  }

  const modele = routeurModeles().modelePourNiveau(choix);
  const user = await getCurrentUser();

  const { error } = await supabase.from("ai_model_overrides").upsert(
    {
      organization_id: organization.organizationId,
      agent,
      model: modele,
      reason: motifBrut,
      updated_at: new Date().toISOString(),
      // La colonne n'a pas de déclencheur qui l'impose : sans cette
      // ligne, une dérogation n'aurait pas d'auteur. `created_at` n'est
      // volontairement pas envoyé — l'`on conflict do update` de
      // PostgREST ne touche que les colonnes fournies, et la date de
      // première pose doit survivre à une modification.
      updated_by: user?.id ?? null,
    },
    { onConflict: "organization_id,agent" },
  );

  if (error) {
    await flash("error", messageLisible(error.message));
    return;
  }

  // Le libellé français, pas la valeur du sélecteur. « advanced » est la
  // graphie interne des trois niveaux ; l'écran écrit « Avancé » partout
  // ailleurs, et un message de confirmation qui emploie un autre mot que
  // celui de la page laisse croire qu'il parle d'autre chose.
  await flash(
    "success",
    `${libelle} est désormais aiguillé sur le niveau « ${LIBELLES_NIVEAU[choix].toLowerCase()} ».`,
  );
  revalidatePath(CHEMIN_CONFIG);
}

// ==================================================================
// 2. Les plafonds de dépense (spec p. 19)
// ==================================================================

/**
 * Écrit les trois plafonds — ou les retire.
 *
 * ─── TOUT OU RIEN ───
 *
 * Une saisie illisible sur un seul des trois champs annule l'ensemble
 * de l'enregistrement. Écrire deux plafonds sur trois laisserait un
 * budget à moitié configuré, avec un message d'erreur qui ne dirait pas
 * lesquels ont pris — et l'administrateur repartirait en croyant avoir
 * tout réglé.
 *
 * ─── VIDE, ZÉRO, ILLISIBLE ───
 *
 * Les trois sont distincts, et c'est tout l'objet de `lireMontantEuros`
 * (voir `montants.ts`) : un champ vide retire le plafond, un zéro
 * délibéré coupe l'IA, une frappe incompréhensible ne écrit rien.
 */
export async function enregistrerPlafondsIA(formData: FormData) {
  const organization = await requireOrganization();

  if (!organization.permissions.includes("organization.manageUsers")) {
    await flash("error", "Seul un administrateur peut fixer les plafonds de dépense IA.");
    return;
  }

  const champs: { nom: string; libelle: string; lecture: LectureMontant }[] = [
    { nom: "jour", libelle: "plafond journalier", lecture: lireMontantEuros(String(formData.get("jour") ?? "")) },
    { nom: "mois", libelle: "plafond mensuel", lecture: lireMontantEuros(String(formData.get("mois") ?? "")) },
    { nom: "agent", libelle: "plafond mensuel par agent", lecture: lireMontantEuros(String(formData.get("agent") ?? "")) },
  ];

  const illisible = champs.find((c) => c.lecture.etat === "illisible");
  if (illisible && illisible.lecture.etat === "illisible") {
    await flash(
      "error",
      `« ${illisible.lecture.saisie} » n'est pas un montant lisible pour le ${illisible.libelle}. ${illisible.lecture.raison} Rien n'a été enregistré.`,
    );
    return;
  }

  const cents = (nom: string): number | null => {
    const champ = champs.find((c) => c.nom === nom);
    return champ && champ.lecture.etat === "montant" ? champ.lecture.cents : null;
  };

  const user = await getCurrentUser();
  const supabase = await createClient();

  const { error } = await supabase.from("ai_cost_limits").upsert(
    {
      organization_id: organization.organizationId,
      daily_organization_limit_cents: cents("jour"),
      monthly_organization_limit_cents: cents("mois"),
      per_agent_limit_cents: cents("agent"),
      updated_at: new Date().toISOString(),
      updated_by: user?.id ?? null,
    },
    { onConflict: "organization_id" },
  );

  if (error) {
    await flash("error", messageLisible(error.message));
    return;
  }

  const poses = champs.filter((c) => c.lecture.etat === "montant").length;
  const aZero = champs.some((c) => c.lecture.etat === "montant" && c.lecture.cents === 0);

  await flash(
    aZero ? "info" : "success",
    aZero
      ? "Plafonds enregistrés. Un plafond à zéro coupe l'IA : les appels concernés seront refusés."
      : poses === 0
        ? "Plafonds retirés : plus aucune limite de dépense IA."
        : `${poses} plafond${poses > 1 ? "s" : ""} enregistré${poses > 1 ? "s" : ""}.`,
  );
  revalidatePath(CHEMIN_COUTS);
}

// ==================================================================
// 3. Les retours utilisateur (spec p. 25)
// ==================================================================

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
  if (message.includes("ai_is_supported_agent")) {
    return "La base n'accepte pas encore de surcharge pour cet agent.";
  }
  return message;
}
