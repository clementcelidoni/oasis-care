import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { routeurModeles } from "@/lib/ai/model/router";
import { centimes, compteur, MOTIFS_PANNE, type MotifPanne } from "@/lib/ai/runtime/types";
import { debutDuMoisParis } from "@/lib/ai/runtime/cost";
import { construireCarte, type CarteAgents, type SurchargeOrganisation } from "./carte.ts";
import { agregerAppels, type AppelIA, type TableauCouts } from "./agregation.ts";
import { estCleAgentSql } from "./types.ts";

/**
 * §11V — LES LECTURES DE L'ADMINISTRATION IA.
 *
 * Le seul fichier de `lib/ai/admin` qui parle à Supabase. Tout le reste
 * du dossier est pur, donc éprouvé sans base et sans jeton — même
 * découpage que `lib/ai/runtime`, pour la même raison.
 *
 * ══════════════════════════════════════════════════════════════════
 * TROIS ÉTATS, PAS DEUX — ET LE TROISIÈME EST LE PLUS IMPORTANT ICI
 * ══════════════════════════════════════════════════════════════════
 *
 * La migration 0076 n'est PAS appliquée en production au moment où ces
 * écrans sont écrits : `ai_usage_events`, `ai_cost_limits`,
 * `ai_model_overrides` et `ai_recommendation_feedback` n'existent pas
 * encore. C'est normal — dans ce dépôt, l'utilisateur lance ses
 * migrations lui-même.
 *
 * Mais cela impose une distinction que ces écrans ne peuvent pas se
 * permettre de rater :
 *
 *   absente     La table n'existe pas. On ne sait RIEN.
 *   vide        La table existe et ne contient rien. On sait qu'il n'y
 *               a eu aucune dépense, aucune surcharge, aucun avis.
 *   lue         On a les lignes.
 *
 * Un tableau de bord qui afficherait « 0,00 € dépensés aujourd'hui »
 * parce que la table n'existe pas serait la pire des sorties : c'est un
 * chiffre rassurant, faux, et impossible à distinguer d'un vrai zéro.
 * Chaque lecture rend donc son état, et les écrans écrivent des phrases
 * différentes pour les trois.
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
function classer(error: { code?: string; message: string }): {
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
        "(grand livre des coûts, plafonds, surcharges de modèle, avis) reste à appliquer.",
    };
  }

  if (code === "42501" || message.includes("row-level security")) {
    return {
      etat: "refusee",
      message:
        "Votre rôle ne permet pas cette lecture. Il faut le droit d'administrer l'entreprise.",
    };
  }

  return { etat: "erreur", message };
}

// ------------------------------------------------------------------
// 1. La carte agent → modèle (spec p. 26)
// ------------------------------------------------------------------

/**
 * La carte des agents, surcharges d'entreprise comprises.
 *
 * LA CARTE EST TOUJOURS RENDUE, MÊME SI LA TABLE MANQUE. C'est une
 * différence importante avec les autres lectures : l'aiguillage
 * agent → niveau → modèle vient du CODE (routeur + configuration), pas
 * de la base. Il est donc réel et exact même sans 0076 ; seule la
 * colonne « surcharge de cette entreprise » est alors inconnue, et
 * l'écran le dit sur cette colonne-là plutôt que de se vider.
 */
export async function lireCarteAgents(organizationId: string): Promise<Lecture<CarteAgents>> {
  const etat = routeurModeles().etat();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("ai_model_overrides")
    .select("agent, model, reason, updated_at")
    .eq("organization_id", organizationId);

  if (error) {
    const { etat: statut, message } = classer(error);
    return { etat: statut, message, donnees: construireCarte(etat, []) };
  }

  const surcharges: SurchargeOrganisation[] = [];
  for (const ligne of data ?? []) {
    const row = ligne as { agent: unknown; model: unknown; reason: unknown; updated_at: unknown };
    // Une clé d'agent inconnue est ignorée, pas fatale : c'est une
    // donnée écrite par la base, et une carte qui refuse de s'afficher
    // parce qu'une ligne parasite traîne serait un mauvais échange.
    if (!estCleAgentSql(row.agent) || typeof row.model !== "string") continue;
    surcharges.push({
      agent: row.agent,
      modele: row.model,
      motif: typeof row.reason === "string" && row.reason.trim() !== "" ? row.reason : null,
      posLe: typeof row.updated_at === "string" ? row.updated_at : null,
    });
  }

  return { etat: "lue", message: null, donnees: construireCarte(etat, surcharges) };
}

// ------------------------------------------------------------------
// 2. Le tableau de bord des coûts (spec p. 18-19)
// ------------------------------------------------------------------

/**
 * Le nombre de lignes du grand livre ramenées pour agréger un mois.
 *
 * Cinq mille appels dans le mois, c'est déjà un usage nourri pour une
 * PME du paysage. Au-delà, le tableau se déclare INCOMPLET plutôt que
 * de présenter un échantillon comme un total — même règle que
 * `LIGNES_RATIO_MAX` dans `runtime/supabase.ts`, avec une borne plus
 * haute parce qu'ici on ventile et pas seulement on compte.
 */
export const LIGNES_COUT_MAX = 5_000;

const COLONNES_USAGE =
  "agent, model, estimated_cost_cents, input_tokens, output_tokens, " +
  "duration_ms, success, failure_reason, decision_id, user_id, created_at";

export async function lireTableauCouts(
  organizationId: string,
  maintenant: Date = new Date(),
): Promise<Lecture<TableauCouts>> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("ai_usage_events")
    .select(COLONNES_USAGE)
    .eq("organization_id", organizationId)
    .gte("created_at", debutDuMoisParis(maintenant).toISOString())
    .order("created_at", { ascending: false })
    .limit(LIGNES_COUT_MAX);

  if (error) {
    const { etat, message } = classer(error);
    return { etat, message, donnees: agregerAppels([], { maintenant }) };
  }

  const lignes = (data ?? []).map(lireAppel);

  return {
    etat: "lue",
    message: null,
    donnees: agregerAppels(lignes, {
      maintenant,
      complet: lignes.length < LIGNES_COUT_MAX,
    }),
  };
}

function lireAppel(ligne: unknown): AppelIA {
  const r = ligne as Record<string, unknown>;
  const motif = r.failure_reason;
  return {
    agent: String(r.agent ?? ""),
    modele: String(r.model ?? ""),
    // `centimes` rend `null` pour NULL. Surtout pas `?? 0` : la colonne
    // est nullable exprès (0076, règle 2), et un zéro ferait passer un
    // appel non tarifé pour un appel gratuit.
    coutCents: centimes(r.estimated_cost_cents),
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
 * Le titre des décisions les plus coûteuses.
 *
 * Une ventilation « par décision » qui n'afficherait que des UUID ne
 * servirait à rien : on regarde ce tableau pour savoir QUELLE analyse
 * coûte cher, pas pour collectionner des identifiants. Les titres sont
 * lus en une requête, bornée aux lignes réellement affichées.
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
// 3. Les plafonds (spec p. 19)
// ------------------------------------------------------------------

export type Plafonds = {
  /** `null` = aucun plafond. JAMAIS confondu avec zéro (0076). */
  jourCents: number | null;
  moisCents: number | null;
  agentCents: number | null;
  /** Vrai si une ligne existe. Sans ligne, aucun plafond n'a été choisi. */
  posee: boolean;
  modifieLe: string | null;
};

export const AUCUN_PLAFOND: Plafonds = Object.freeze({
  jourCents: null,
  moisCents: null,
  agentCents: null,
  posee: false,
  modifieLe: null,
});

export async function lirePlafonds(organizationId: string): Promise<Lecture<Plafonds>> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("ai_cost_limits")
    .select(
      "daily_organization_limit_cents, monthly_organization_limit_cents, " +
        "per_agent_limit_cents, updated_at",
    )
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (error) {
    const { etat, message } = classer(error);
    return { etat, message, donnees: AUCUN_PLAFOND };
  }

  if (data === null) return { etat: "lue", message: null, donnees: AUCUN_PLAFOND };

  // Passage par `unknown` : sans table générée, PostgREST type la ligne
  // comme une union qui inclut son propre type d'erreur, et TypeScript
  // refuse la conversion directe. On lit ensuite champ par champ, comme
  // partout ailleurs dans ce dossier.
  const r = data as unknown as Record<string, unknown>;
  return {
    etat: "lue",
    message: null,
    donnees: {
      jourCents: centimes(r.daily_organization_limit_cents),
      moisCents: centimes(r.monthly_organization_limit_cents),
      agentCents: centimes(r.per_agent_limit_cents),
      posee: true,
      modifieLe: typeof r.updated_at === "string" ? r.updated_at : null,
    },
  };
}

// ------------------------------------------------------------------
// 4. Les avis sur les recommandations (spec p. 25)
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
 * Rend une Map VIDE quand la table n'existe pas encore : sur le centre
 * de décision, l'absence d'avis et l'absence de table produisent le
 * même écran (aucun pouce coloré), et il n'y a rien d'utile à dire à un
 * conducteur de travaux sur l'état des migrations. L'écran
 * d'administration, lui, le dit.
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
 * C'est la seule des cinq mesures du benchmark de modèles (accuracy,
 * cost, latency, tool-use, user-rating) qu'aucune mesure automatique ne
 * remplace — la migration 0076 le dit dans le commentaire de la table.
 * D'où sa place sur l'écran d'administration, à côté du coût et de la
 * latence, et pas seulement au fond d'une carte de décision.
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
