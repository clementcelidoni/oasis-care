import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { compteur, type MotifPanne, MOTIFS_PANNE } from "@/lib/ai/runtime/types";
import { debutDuMoisParis } from "@/lib/ai/runtime/cost";
import {
  COLONNES_USAGE,
  agregerConsommation,
  type AppelIA,
  type Consommation,
} from "./consommation.ts";

/**
 * §11X — LES LECTURES DE LA CONSOMMATION IA.
 *
 * Le grand livre des appels (0076) et les avis (0076). Avec
 * `quota.ts`, les deux seuls fichiers de `lib/ai/admin` qui parlent à
 * Supabase ; tout le reste du dossier est pur, donc éprouvé sans base et
 * sans jeton — même découpage que `lib/ai/runtime`, pour la même raison.
 *
 * Le forfait de questions vit à part (`quota.ts`) et n'est pas réexporté
 * ici : il vient d'une autre table (0058), d'un autre mécanisme, et
 * surtout il oblige à importer un module de l'API de l'assistant. Ce
 * fichier-ci est importé par les écrans de décision d'Oasis AI, qui
 * n'ont aucune raison de traîner cette dépendance derrière eux.
 *
 * ══════════════════════════════════════════════════════════════════
 * CE QUE CE FICHIER NE LIT PLUS, ET CE N'EST PAS UN OUBLI
 * ══════════════════════════════════════════════════════════════════
 *
 * Il lisait `ai_model_overrides` (la carte agent → modèle) et
 * `ai_cost_limits` (les trois plafonds en euros). Ces deux tables
 * restent lisibles par un membre — la migration 0080 a délibérément
 * conservé leur politique « Members read », sans quoi le moteur
 * lui-même ne verrait plus la surcharge ni le plafond que l'éditeur lui
 * impose. Mais les LIRE POUR LES AFFICHER n'a plus de sens ici : le
 * client ne les décide plus, et le nom du modèle comme le montant du
 * plafond appartiennent à l'éditeur.
 *
 * De même, `COLONNES_USAGE` ne demande plus `model`,
 * `estimated_cost_cents`, `cost_basis` ni `fallback_from_model`. Une
 * colonne qu'on ne demande pas ne peut pas ressortir par distraction
 * dans une propriété de composant.
 *
 * ══════════════════════════════════════════════════════════════════
 * TROIS ÉTATS, PAS DEUX — ET LE TROISIÈME EST LE PLUS IMPORTANT ICI
 * ══════════════════════════════════════════════════════════════════
 *
 *   absente     La table n'existe pas. On ne sait RIEN.
 *   vide        La table existe et ne contient rien. On sait qu'il n'y
 *               a eu aucun appel, aucun avis.
 *   lue         On a les lignes.
 *
 * Un écran qui afficherait « 0 appel ce mois-ci » parce que la table
 * n'existe pas serait la pire des sorties : un chiffre rassurant, faux,
 * et impossible à distinguer d'un vrai zéro. Chaque lecture rend donc
 * son état, et l'écran écrit des phrases différentes pour les trois.
 */

// ------------------------------------------------------------------
// L'état d'une lecture
// ------------------------------------------------------------------

export type EtatLecture = "lue" | "absente" | "refusee" | "erreur";

export type Lecture<T> = {
  etat: EtatLecture;
  /** Une phrase française, affichable telle quelle. `null` si tout va bien. */
  message: string | null;
  donnees: T;
};

/**
 * Classer une erreur PostgREST.
 *
 * `PGRST205` et « schema cache » signalent une table que PostgREST ne
 * connaît pas : la migration n'est pas passée. `42P01` est le
 * `undefined_table` de PostgreSQL, qui remonte pour une fonction.
 * Tout le reste est traité comme une panne — surtout pas comme un vide.
 */
export function classer(error: { code?: string; message: string }): {
  etat: Exclude<EtatLecture, "lue">;
  message: string;
} {
  const code = error.code ?? "";
  const message = error.message ?? "";

  if (code === "PGRST205" || code === "42P01" || message.includes("schema cache")) {
    return {
      etat: "absente",
      message:
        "Cette partie d'Oasis n'est pas encore installée sur cette base : la migration 0076 " +
        "(grand livre des appels, avis) reste à appliquer.",
    };
  }

  if (code === "42501" || message.includes("row-level security")) {
    return {
      etat: "refusee",
      message: "Votre rôle ne permet pas cette lecture.",
    };
  }

  return { etat: "erreur", message };
}

// ------------------------------------------------------------------
// 1. Le grand livre des appels (0076), sans les euros
// ------------------------------------------------------------------

/**
 * Le nombre de lignes du grand livre ramenées pour agréger un mois.
 *
 * Cinq mille appels dans le mois, c'est déjà un usage nourri pour une
 * PME du paysage. Au-delà, le tableau se déclare INCOMPLET plutôt que
 * de présenter un échantillon comme un total.
 */
export const LIGNES_USAGE_MAX = 5_000;

export async function lireConsommation(
  organizationId: string,
  maintenant: Date = new Date(),
): Promise<Lecture<Consommation>> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("ai_usage_events")
    .select(COLONNES_USAGE)
    .eq("organization_id", organizationId)
    .gte("created_at", debutDuMoisParis(maintenant).toISOString())
    .order("created_at", { ascending: false })
    .limit(LIGNES_USAGE_MAX);

  if (error) {
    const { etat, message } = classer(error);
    return { etat, message, donnees: agregerConsommation([], { maintenant }) };
  }

  const lignes = (data ?? []).map(lireAppel);

  return {
    etat: "lue",
    message: null,
    donnees: agregerConsommation(lignes, {
      maintenant,
      complet: lignes.length < LIGNES_USAGE_MAX,
    }),
  };
}

function lireAppel(ligne: unknown): AppelIA {
  const r = ligne as Record<string, unknown>;
  const motif = r.failure_reason;
  return {
    agent: String(r.agent ?? ""),
    jetonsEntree: compteur(r.input_tokens),
    jetonsSortie: compteur(r.output_tokens),
    dureeMs: compteur(r.duration_ms),
    succes: r.success === true,
    motifPanne:
      typeof motif === "string" && (MOTIFS_PANNE as readonly string[]).includes(motif)
        ? (motif as MotifPanne)
        : null,
    decisionId: typeof r.decision_id === "string" ? r.decision_id : null,
    utilisateurId: typeof r.user_id === "string" ? r.user_id : null,
    quand: String(r.created_at ?? ""),
  };
}

/**
 * Le titre des décisions les plus sollicitées.
 *
 * Une ventilation « par décision » qui n'afficherait que des UUID ne
 * servirait à rien : on regarde ce tableau pour savoir QUELLE analyse a
 * mobilisé Oasis, pas pour collectionner des identifiants. Les titres
 * sont lus en une requête, bornée aux lignes réellement affichées.
 */
export async function lireTitresDecisions(
  organizationId: string,
  decisionIds: readonly string[],
): Promise<Map<string, string>> {
  const titres = new Map<string, string>();
  if (decisionIds.length === 0) return titres;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ai_decisions")
    .select("id, title")
    .eq("organization_id", organizationId)
    .in("id", [...decisionIds]);

  if (error || !data) return titres;

  for (const ligne of data) {
    const r = ligne as Record<string, unknown>;
    if (typeof r.id === "string" && typeof r.title === "string") titres.set(r.id, r.title);
  }
  return titres;
}

/**
 * Le nom des personnes derrière des identifiants de compte.
 *
 * Même raison, et la même jointure que l'écran des paramètres : un nom
 * de salarié vit dans `employees`, pas dans `auth.users`. Un compte sans
 * fiche salarié — le comptable, un accès temporaire — n'a pas de nom, et
 * la ventilation le dira plutôt que d'afficher son UUID.
 */
export async function lireNomsUtilisateurs(
  organizationId: string,
  userIds: readonly string[],
): Promise<Map<string, string>> {
  const noms = new Map<string, string>();
  const vrais = userIds.filter((id) => id !== "");
  if (vrais.length === 0) return noms;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("employees")
    .select("user_id, first_name, last_name")
    .eq("organization_id", organizationId)
    .in("user_id", vrais);

  if (error || !data) return noms;

  for (const ligne of data) {
    const r = ligne as Record<string, unknown>;
    if (typeof r.user_id !== "string") continue;
    const nom = [r.first_name, r.last_name].filter((x) => typeof x === "string" && x !== "").join(" ");
    if (nom !== "") noms.set(r.user_id, nom);
  }
  return noms;
}

// ------------------------------------------------------------------
// 2. Les avis sur les recommandations (spec p. 25)
// ------------------------------------------------------------------

export type MonAvis = {
  utile: boolean;
  pourquoi: string | null;
};

/**
 * Mon avis sur chacune de ces décisions.
 *
 * MON avis, pas celui de l'équipe : la carte de décision affiche un
 * pouce déjà coloré si je me suis prononcé, et ce pouce doit être le
 * mien. `ai_recommendation_feedback` est lisible par tous les membres
 * ayant `projects.read` — filtrer sur `auth.uid()` est donc une
 * décision d'affichage, pas une protection.
 *
 * Rend une Map VIDE quand la table n'existe pas encore : sur l'écran des
 * décisions, l'absence d'avis et l'absence de table produisent le même
 * écran (aucun pouce coloré), et il n'y a rien d'utile à dire à un
 * conducteur de travaux sur l'état des migrations. L'écran de
 * consommation, lui, le dit.
 */
export async function lireMesAvis(
  organizationId: string,
  decisionIds: readonly string[],
): Promise<Map<string, MonAvis>> {
  const avis = new Map<string, MonAvis>();
  if (decisionIds.length === 0) return avis;

  const user = await getCurrentUser();
  if (!user) return avis;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ai_recommendation_feedback")
    .select("decision_id, helpful, reason")
    .eq("organization_id", organizationId)
    .eq("user_id", user.id)
    .in("decision_id", [...decisionIds]);

  if (error || !data) return avis;

  for (const ligne of data) {
    const r = ligne as Record<string, unknown>;
    if (typeof r.decision_id !== "string") continue;
    avis.set(r.decision_id, {
      utile: r.helpful === true,
      pourquoi: typeof r.reason === "string" && r.reason.trim() !== "" ? r.reason : null,
    });
  }

  return avis;
}

export type StatistiquesAvis = {
  utiles: number;
  inutiles: number;
  /** Les motifs donnés, les plus récents d'abord. Au plus `MOTIFS_AFFICHES`. */
  motifs: { pourquoi: string; utile: boolean; quand: string }[];
  /** La part d'avis positifs, en pourcentage, ou `null` si aucun avis. */
  satisfactionPct: number | null;
};

export const MOTIFS_AFFICHES = 12;

/**
 * Le « user-rating » de la page 25.
 *
 * C'est la seule des cinq mesures du benchmark de modèles (justesse,
 * coût, latence, usage des outils, avis) qu'aucune mesure automatique ne
 * remplace. L'éditeur en a besoin sur tout le parc — c'est la colonne
 * qui départage deux modèles à coût égal — et le client en a besoin
 * chez lui, parce que c'est la qualité de SON assistant. Les deux
 * lectures sont légitimes et ne se remplacent pas ; celle-ci est celle
 * du client, bornée à son organisation par la RLS.
 */
export async function lireStatistiquesAvis(
  organizationId: string,
): Promise<Lecture<StatistiquesAvis>> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("ai_recommendation_feedback")
    .select("helpful, reason, created_at")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(500);

  const vide: StatistiquesAvis = { utiles: 0, inutiles: 0, motifs: [], satisfactionPct: null };

  if (error) {
    const { etat, message } = classer(error);
    return { etat, message, donnees: vide };
  }

  let utiles = 0;
  let inutiles = 0;
  const motifs: StatistiquesAvis["motifs"] = [];

  for (const ligne of data ?? []) {
    const r = ligne as Record<string, unknown>;
    const utile = r.helpful === true;
    if (utile) utiles += 1;
    else inutiles += 1;

    if (typeof r.reason === "string" && r.reason.trim() !== "" && motifs.length < MOTIFS_AFFICHES) {
      motifs.push({ pourquoi: r.reason, utile, quand: String(r.created_at ?? "") });
    }
  }

  const total = utiles + inutiles;
  return {
    etat: "lue",
    message: null,
    donnees: {
      utiles,
      inutiles,
      motifs,
      // `null` et non 0 : « personne ne s'est prononcé » n'est pas
      // « personne n'est satisfait ».
      satisfactionPct: total === 0 ? null : Math.round((utiles / total) * 1000) / 10,
    },
  };
}
