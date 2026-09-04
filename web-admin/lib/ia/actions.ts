"use server";

import { revalidatePath } from "next/cache";

import { can, requireAdmin } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";

import { lireMontantEuros } from "./montants.ts";
import { lireEtatRouteur } from "./modeles.ts";
import { planifierChangements, raconter } from "./plan.ts";
import { lirePlafonds, lireSurcharges } from "./source.ts";

/**
 * ==================================================================
 * LES TROIS ÉCRITURES DU CONTROL CENTER SUR L'IA
 * ==================================================================
 *
 * Elles ne touchent AUCUNE table directement, et c'est la migration
 * 0080 qui l'impose : depuis elle, `ai_model_overrides` et
 * `ai_cost_limits` n'ont plus AUCUNE politique d'écriture — pour
 * personne, administrateur de plateforme compris — et `authenticated` a
 * perdu ses droits `insert/update/delete`. Le seul chemin est quatre
 * fonctions `security definer` :
 *
 *   admin_set_ai_model_override(org, agent, model, motif)
 *   admin_clear_ai_model_override(org, agent, motif)
 *   admin_set_ai_cost_limits(org, jour, mois, par_agent, motif)
 *   admin_clear_ai_cost_limits(org, motif)
 *
 * Chacune exige `platform_admin_can(…)`, refuse un motif vide, relève
 * l'ancienne valeur, écrit la nouvelle, et rend l'identifiant de la
 * ligne de journal. La trace n'est pas un effet de bord : c'est la
 * VALEUR DE RETOUR. Si `record_admin_event()` refuse, l'écriture est
 * annulée avec elle — il n'existe pas d'état « changé mais non tracé ».
 *
 * Ce fichier n'a donc rien à journaliser lui-même, et ne doit surtout
 * pas essayer : une seconde ligne de journal écrite depuis TypeScript
 * pourrait manquer là où la première ne peut pas.
 *
 * ------------------------------------------------------------------
 * TROIS BARRIÈRES, ET AUCUNE NE SUPPOSE QUE LES AUTRES ONT TENU
 * ------------------------------------------------------------------
 *   1. `requireAdmin()` : identité vérifiée auprès du serveur Auth,
 *      fiche `platform_admins`, second facteur si la politique l'exige.
 *      Une Server Action ne passe PAS par le layout : sans cet appel,
 *      elle serait la seule porte du Control Center laissée ouverte.
 *   2. `can(admin, …)` ici, qui rend un message plutôt qu'une
 *      redirection — dans un formulaire, une redirection perd la saisie
 *      et n'explique rien.
 *   3. `platform_admin_can(…)` dans la fonction SQL, qui est la seule
 *      barrière qu'aucun remaniement de ce fichier ne peut déplacer.
 *
 * ------------------------------------------------------------------
 * ON NE FAIT PAS CONFIANCE À L'ÉTAT PORTÉ PAR LE FORMULAIRE
 * ------------------------------------------------------------------
 * `enregistrerModeles` RELIT les surcharges en base avant de comparer,
 * au lieu de croire des champs cachés « valeur précédente ». Deux
 * raisons, et la seconde est la vraie : un onglet resté ouvert une
 * heure porterait un état périmé et écraserait le travail d'un
 * collègue ; et une valeur précédente reçue du navigateur est une
 * valeur que le navigateur peut choisir.
 */

export type EtatFormulaire = {
  statut: "vierge" | "ok" | "erreur";
  /** Ce qu'on affiche à côté du bouton. `null` à l'état vierge. */
  message: string | null;
};

export const ETAT_VIERGE: EtatFormulaire = { statut: "vierge", message: null };

/**
 * Traduit le refus d'une fonction de 0080.
 *
 * Les messages de 0080 sont écrits en français et disent exactement ce
 * qui a été refusé et pourquoi : on les affiche TELS QUELS plutôt que
 * de les remplacer par une phrase de notre cru. Le code SQLSTATE ne
 * sert qu'à choisir la mise en contexte.
 */
function messageDeLErreur(
  operation: string,
  error: { message: string; code?: string },
): string {
  switch (error.code) {
    case "42501":
      return `${operation} : la base a refusé. ${error.message}`;
    case "23514":
      return error.message;
    case "23503":
      return `${operation} : ${error.message}`;
    case "P0002":
      return error.message;
    case "PGRST202":
    case "42883":
      return (
        `${operation} : la fonction n'existe pas dans la base. La migration ` +
        "0080_ia_reglages_editeur.sql n'est probablement pas appliquée — ou le cache de " +
        "schéma de PostgREST n'a pas encore été rechargé."
      );
    default:
      return `${operation} : ${error.message} (${error.code ?? "sans code"}).`;
  }
}

function lireMotif(formData: FormData): string | null {
  const brut = formData.get("motif");
  if (typeof brut !== "string") return null;
  const motif = brut.trim();
  return motif.length === 0 ? null : motif;
}

function lireIdentifiantOrganisation(formData: FormData): string | null {
  const brut = formData.get("organizationId");
  if (typeof brut !== "string") return null;
  const valeur = brut.trim();
  // Un uuid, ou rien. Le contrôle sert à ne pas envoyer une chaîne
  // arbitraire dans un paramètre `uuid` : PostgREST répondrait par une
  // erreur de conversion illisible plutôt que par « entreprise
  // inconnue ».
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(valeur)
    ? valeur
    : null;
}

// ------------------------------------------------------------------
// 1. Les modèles d'une entreprise
// ------------------------------------------------------------------

/**
 * Applique, pour une entreprise, les changements de niveau des quatre
 * agents surchargeables.
 *
 * UN SEUL MOTIF POUR PLUSIEURS AGENTS, et plusieurs lignes de journal :
 * c'est le geste réel — « on descend cette entreprise d'un cran pendant
 * l'incident » —, et demander quatre fois la même phrase produirait
 * quatre motifs recopiés à la va-vite. La granularité de la trace, elle,
 * reste celle de la base : un acte par agent, avec son avant et son
 * après.
 *
 * SEULS LES AGENTS QUI CHANGENT SONT ÉCRITS. Réécrire une valeur
 * identique ferait une ligne de journal qui n'apprend rien, et
 * déplacerait `updated_at` — donc effacerait la date du vrai dernier
 * changement, qui est souvent l'information qu'on cherche.
 *
 * ------------------------------------------------------------------
 * DEUX PASSES, ET C'EST LA CORRECTION D'UN DÉFAUT RÉEL
 * ------------------------------------------------------------------
 * Chaque agent part dans SA propre fonction SQL, donc dans SA propre
 * transaction : ce qui est écrit est écrit, et rien ne le défait. La
 * version précédente lisait, validait et écrivait dans une seule
 * boucle, et sortait au premier ennui. Deux états faux en découlaient,
 * tous deux silencieux :
 *
 *   • un champ illisible au troisième agent rendait « Aucun changement
 *     n'a été enregistré », alors que les deux premiers étaient déjà
 *     écrits ET journalisés (une Server Action est une URL : on peut
 *     lui poster un formulaire incomplet sans passer par l'écran) ;
 *   • un refus de la base au troisième agent ne nommait que celui-là,
 *     n'appelait pas `revalidatePath`, et redessinait donc la page sur
 *     l'aiguillage d'AVANT. L'opérateur concluait que rien n'avait
 *     bougé pendant que le modèle le plus cher tournait déjà chez le
 *     client — exactement l'état silencieux contre lequel 0080 existe.
 *     Ce n'est pas théorique : `admin_clear_ai_model_override` lève
 *     P0002 dès que la lecture du début est périmée, ce qu'un autre
 *     administrateur ou un onglet resté ouvert suffit à produire.
 *
 * Donc : on lit et on valide les QUATRE champs d'abord — un seul
 * illisible et rien n'est écrit —, puis on écrit, puis on rend compte
 * des deux listes. Une écriture partielle reste possible (rien, en
 * dehors d'une fonction SQL unique, ne peut l'empêcher), mais elle est
 * DITE.
 */
export async function enregistrerModeles(
  _precedent: EtatFormulaire,
  formData: FormData,
): Promise<EtatFormulaire> {
  const admin = await requireAdmin();
  if (!can(admin, "ai.models.write")) {
    return {
      statut: "erreur",
      message: `Le rôle « ${admin.role} » ne porte pas la permission ai.models.write : choisir le modèle d'un agent lui est fermé.`,
    };
  }

  const organizationId = lireIdentifiantOrganisation(formData);
  if (organizationId === null) {
    return { statut: "erreur", message: "Entreprise absente ou mal formée dans le formulaire." };
  }

  const motif = lireMotif(formData);
  if (motif === null) {
    return {
      statut: "erreur",
      message:
        "Motif obligatoire : changer de modèle change la facture de l'éditeur, cela se justifie.",
    };
  }

  // ---- PREMIÈRE PASSE : lire et valider les quatre champs -----------
  // Aucune écriture ici. Un seul champ illisible et on sort sans avoir
  // rien écrit — ce qui rend enfin vraie la phrase « aucun changement
  // n'a été enregistré ». La décision elle-même est dans `plan.ts`,
  // sans base ni Next autour, pour qu'elle soit éprouvable.
  const etatRouteur = lireEtatRouteur();
  const existantes = await lireSurcharges(organizationId);
  const plan = planifierChangements(etatRouteur, existantes, (nom) => formData.get(nom));

  if (plan.statut === "erreur") {
    return { statut: "erreur", message: plan.message };
  }
  if (plan.changements.length === 0) {
    return raconter([], []);
  }

  // ---- SECONDE PASSE : écrire, et retenir ce qui a abouti -----------
  // On ne sort PLUS à la première erreur. Chaque appel est sa propre
  // transaction : sortir laisserait les précédents écrits, journalisés,
  // et tus.
  const supabase = await createClient();
  const faits: string[] = [];
  const echecs: string[] = [];

  for (const changement of plan.changements) {
    if (changement.geste === "lever") {
      const { error } = await supabase.rpc("admin_clear_ai_model_override", {
        p_organization_id: organizationId,
        p_agent: changement.cleSql,
        p_reason: motif,
      });
      if (error) {
        echecs.push(messageDeLErreur(`Lever la surcharge de « ${changement.agent} »`, error));
      } else {
        faits.push(`${changement.agent} suit de nouveau le produit`);
      }
      continue;
    }

    const { error } = await supabase.rpc("admin_set_ai_model_override", {
      p_organization_id: organizationId,
      p_agent: changement.cleSql,
      p_model: changement.modele,
      p_reason: motif,
    });
    if (error) {
      echecs.push(messageDeLErreur(`Imposer le modèle de « ${changement.agent} »`, error));
    } else {
      faits.push(`${changement.agent} → ${changement.niveau} (${changement.modele})`);
    }
  }

  // AVANT DE RENDRE QUOI QUE CE SOIT. Si une seule écriture a abouti,
  // la page doit être redessinée sur l'état réel — sinon l'écran
  // afficherait l'aiguillage d'avant à côté d'un message d'erreur, et
  // l'opérateur en conclurait que rien n'a bougé.
  if (faits.length > 0) {
    revalidatePath("/ia");
    revalidatePath(`/ia/organisations/${organizationId}`);
  }

  return raconter(faits, echecs);
}

// ------------------------------------------------------------------
// 2. Les plafonds d'une entreprise
// ------------------------------------------------------------------

/**
 * Pose les TROIS plafonds d'un coup.
 *
 * La fonction SQL a cette sémantique, et l'écran doit l'épouser
 * exactement : un champ vide vaut NULL, c'est-à-dire « aucune limite »,
 * et non « ne change pas celui-là ». Un troisième sens du vide rendrait
 * le formulaire indéchiffrable.
 *
 * ZÉRO N'EST PAS VIDE. Zéro est un plafond à zéro — l'IA coupée pour
 * cette entreprise. C'est un réglage légitime, et `lireMontantEuros`
 * existe pour qu'une frappe malheureuse ne le produise jamais par
 * accident : une saisie illisible est REFUSÉE, elle ne devient pas zéro.
 */
export async function enregistrerPlafonds(
  _precedent: EtatFormulaire,
  formData: FormData,
): Promise<EtatFormulaire> {
  const admin = await requireAdmin();
  if (!can(admin, "ai.costLimits.write")) {
    return {
      statut: "erreur",
      message: `Le rôle « ${admin.role} » ne porte pas la permission ai.costLimits.write : poser ou lever un plafond de dépense lui est fermé.`,
    };
  }

  const organizationId = lireIdentifiantOrganisation(formData);
  if (organizationId === null) {
    return { statut: "erreur", message: "Entreprise absente ou mal formée dans le formulaire." };
  }

  const motif = lireMotif(formData);
  if (motif === null) {
    return {
      statut: "erreur",
      message:
        "Motif obligatoire : un plafond posé ou levé sans raison est un plafond que personne n'ose plus toucher.",
    };
  }

  const champs = [
    { nom: "jour", libelle: "Plafond du jour" },
    { nom: "mois", libelle: "Plafond du mois" },
    { nom: "parAgent", libelle: "Plafond mensuel par agent" },
  ] as const;

  const cents: (number | null)[] = [];
  for (const champ of champs) {
    const brut = formData.get(champ.nom);
    const lecture = lireMontantEuros(typeof brut === "string" ? brut : null);
    if (lecture.etat === "illisible") {
      return { statut: "erreur", message: `${champ.libelle} — ${lecture.raison}` };
    }
    cents.push(lecture.etat === "aucune" ? null : lecture.cents);
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_ai_cost_limits", {
    p_organization_id: organizationId,
    p_daily_cents: cents[0],
    p_monthly_cents: cents[1],
    p_per_agent_cents: cents[2],
    p_reason: motif,
  });

  if (error) {
    return { statut: "erreur", message: messageDeLErreur("Poser les plafonds", error) };
  }

  revalidatePath("/ia/plafonds");
  revalidatePath(`/ia/organisations/${organizationId}`);

  const aucun = cents.every((valeur) => valeur === null);
  return {
    statut: "ok",
    message: aucun
      ? "Enregistré et journalisé. ATTENTION : les trois champs sont vides, donc cette entreprise n'est plus bornée par aucun plafond."
      : "Plafonds enregistrés et journalisés.",
  };
}

/**
 * Retire la ligne de plafonds.
 *
 * Le geste le plus dangereux du lot : après lui, l'entreprise dépense
 * sans borne. Il reste possible — il faut pouvoir défaire — mais il est
 * nominatif, motivé, daté, et l'écran le fait confirmer.
 *
 * À DISTINGUER DE « TROIS CHAMPS VIDES », qui produit le même effet mais
 * pas la même trace : `aiCostLimit.cleared` dit « la ligne a disparu »,
 * `aiCostLimit.set` avec trois nuls dit « quelqu'un a délibérément
 * enregistré aucune limite ». Le journal doit pouvoir les raconter
 * séparément.
 */
export async function retirerPlafonds(
  _precedent: EtatFormulaire,
  formData: FormData,
): Promise<EtatFormulaire> {
  const admin = await requireAdmin();
  if (!can(admin, "ai.costLimits.write")) {
    return {
      statut: "erreur",
      message: `Le rôle « ${admin.role} » ne porte pas la permission ai.costLimits.write.`,
    };
  }

  const organizationId = lireIdentifiantOrganisation(formData);
  if (organizationId === null) {
    return { statut: "erreur", message: "Entreprise absente ou mal formée dans le formulaire." };
  }

  const motif = lireMotif(formData);
  if (motif === null) {
    return {
      statut: "erreur",
      message:
        "Motif obligatoire : retirer tout plafond, c'est accepter une dépense sans borne — la raison doit être écrite.",
    };
  }

  // On relit l'état avant d'appeler, uniquement pour pouvoir dire à
  // l'écran ce qui vient de disparaître. La fonction SQL, elle, refuse
  // déjà de « retirer » ce qui n'existe pas (P0002) : il n'y a pas de
  // succès silencieux à couvrir ici.
  const avant = await lirePlafonds(organizationId);

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_clear_ai_cost_limits", {
    p_organization_id: organizationId,
    p_reason: motif,
  });

  if (error) {
    return { statut: "erreur", message: messageDeLErreur("Retirer les plafonds", error) };
  }

  revalidatePath("/ia/plafonds");
  revalidatePath(`/ia/organisations/${organizationId}`);

  return {
    statut: "ok",
    message:
      avant.length > 0
        ? "Plafonds retirés et journalisés. Cette entreprise dépense désormais sans borne."
        : "Plafonds retirés et journalisés.",
  };
}
