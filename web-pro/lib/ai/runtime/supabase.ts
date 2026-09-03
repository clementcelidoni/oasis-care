import { createClient } from "@/lib/supabase/server";
import { fournisseurIA, routeurModeles } from "@/lib/ai/model";
import { appliquerSurcharges, type SurchargesEffectives } from "@/lib/ai/admin/routage";
import { estCleAgentSql, type CleAgentSql } from "@/lib/ai/admin/types";
import {
  OasisActionEngine,
  type PortActionEngine,
  type PortServicesMetier,
} from "./actionEngine.ts";
import { OasisAgentsRuntime } from "./agents.ts";
import { lireReglagesAgents, type PortReglagesAgents } from "./autonomy.ts";
import { AGENTS_PREMIERE_ITERATION } from "./definitions.ts";
import { configurerTracing } from "./tracingSdk.ts";
import { AgentContextBuilder, type PortLectureSource } from "./context.ts";
import {
  AICostControlService,
  debutDuMoisParis,
  lireBudget,
  type LigneRepartition,
  type PortCout,
} from "./cost.ts";
import { OasisAgentRunner } from "./run.ts";
import { JournalUsage, type PortJournalUsage } from "./usage.ts";
import { centimes, compteur, type IdentiteAppel, type NiveauRisque } from "./types.ts";

/**
 * §11V — LES ADAPTATEURS. Le seul fichier du dossier qui parle à Supabase.
 *
 * ─── POURQUOI ILS SONT SÉPARÉS DU RESTE ───
 *
 * Tout le reste de `lib/ai/runtime/` est éprouvable sans base et sans
 * réseau, parce que chaque service reçoit un PORT. Ce fichier est le
 * seul à connaître `createClient`, et c'est aussi le seul que les tests
 * n'importent pas. La conséquence pratique : `npm test` n'ouvre aucune
 * connexion, ne lit aucun secret, et éprouve quand même l'escalade, le
 * repli, la décision de cache et le respect des plafonds.
 *
 * ─── CE MODULE EST STRICTEMENT CÔTÉ SERVEUR ───
 *
 * Il n'y a pas de directive `server-only` parce que le paquet du même
 * nom n'est pas installé dans ce projet ; la barrière effective est
 * celle de `lib/supabase/server`, qui lit `next/headers` — un import
 * que Next refuse dans un composant client. L'erreur arrive donc à la
 * compilation, pas dans le navigateur.
 *
 * ─── CHAQUE APPEL PORTE LE JETON DE L'UTILISATEUR ───
 *
 * `createClient()` de `lib/supabase/server` construit un client à
 * partir des cookies de la session. Toutes les fonctions appelées ici
 * sont `security invoker` (0073, 0076) sauf `ai_record_usage_event`,
 * qui est `security definer` mais vérifie elle-même
 * `is_organization_member`. L'agent ne voit donc jamais plus que la
 * personne qui lui parle : ce n'est pas une promesse de prompt, c'est
 * Postgres qui refuse.
 */

// ==================================================================
// 1. La lecture des sources — pour `AgentContextBuilder`
// ==================================================================

export const lectureSourceSupabase: PortLectureSource = async ({ rpc, arguments: args }) => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(rpc, args);

  if (error) {
    return { ok: false, message: messageLisible(error.message) };
  }
  // `data` peut valoir `null` : c'est une réponse, pas une erreur.
  return { ok: true, donnees: data };
};

export function constructeurContexte(): AgentContextBuilder {
  return new AgentContextBuilder(lectureSourceSupabase);
}

// ==================================================================
// 2. Le contrôle de coût
// ==================================================================

/**
 * La borne de lecture du grand livre pour le ratio.
 *
 * PostgREST ne sait pas grouper ; on ramène les lignes du mois et on
 * agrège ici. Deux mille lignes suffisent très largement à une PME, et
 * au-delà le résultat est marqué INCOMPLET plutôt que présenté comme
 * exact — un ratio calculé sur les deux mille premières lignes d'un
 * mois qui en compte huit mille ferait arbitrer à l'aveugle.
 */
export const LIGNES_RATIO_MAX = 2_000;

export const portCoutSupabase: PortCout = {
  async budget(organizationId, agent) {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("ai_cost_budget_remaining", {
      p_organization_id: organizationId,
      p_agent: agent,
    });

    if (error) {
      // UN BUDGET ILLISIBLE N'EST PAS UN BUDGET SANS LIMITE, et ce
      // n'est pas non plus un budget épuisé. On lève : `run.ts`
      // remontera l'erreur plutôt que de laisser passer un appel qui
      // aurait peut-être dû être refusé, ou de refuser un appel qui
      // aurait dû passer.
      throw new Error(`Budget IA illisible : ${messageLisible(error.message)}`);
    }

    // La fonction rend une TABLE d'une seule ligne — et rend toujours
    // une ligne, même sans plafond posé (le `union all` de 0076).
    const ligne = Array.isArray(data) ? data[0] : data;
    return lireBudget(ligne);
  },

  async lireCache({ organizationId, agent, cle, modele, empreinte }) {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("ai_cache_lookup", {
      p_organization_id: organizationId,
      p_agent: agent,
      p_cache_key: cle,
      p_model: modele,
      p_source_fingerprint: empreinte,
    });

    if (error) {
      // Un cache en panne ne doit pas empêcher de répondre : on
      // repaiera l'appel. On le dit quand même sur la console, parce
      // qu'un cache silencieusement mort double la facture.
      console.error(`cache IA (lecture) : ${error.message}`);
      return null;
    }
    return data ?? null;
  },

  async ecrireCache({
    organizationId,
    agent,
    cle,
    modele,
    empreinte,
    resultat,
    ttlSecondes,
    sources,
    dateArreteDonnees,
  }) {
    const supabase = await createClient();
    const { error } = await supabase.rpc("ai_cache_store", {
      p_organization_id: organizationId,
      p_agent: agent,
      p_cache_key: cle,
      p_model: modele,
      p_source_fingerprint: empreinte,
      p_result: resultat,
      p_ttl_seconds: ttlSecondes,
      p_data_sources: sources,
      p_data_snapshot_timestamp: dateArreteDonnees,
    });
    if (error) throw new Error(messageLisible(error.message));
  },

  async repartition(organizationId) {
    const supabase = await createClient();

    const { data, error } = await supabase
      .from("ai_usage_events")
      .select("model, estimated_cost_cents")
      .eq("organization_id", organizationId)
      .gte("created_at", debutDuMoisParis().toISOString())
      .limit(LIGNES_RATIO_MAX);

    if (error) {
      console.error(`ratio d'usage IA : ${error.message}`);
      return { lignes: [], complet: false };
    }

    const lignes = data ?? [];
    const parModele = new Map<string, { appels: number; coutCents: number | null }>();
    for (const ligne of lignes) {
      const modele = String((ligne as { model: unknown }).model);
      const cout = centimes((ligne as { estimated_cost_cents: unknown }).estimated_cost_cents);
      const courant = parModele.get(modele) ?? { appels: 0, coutCents: 0 };
      parModele.set(modele, {
        appels: courant.appels + 1,
        // `null` contamine le total du modèle : un appel non tarifé
        // rend la somme inconnue, pas plus petite.
        coutCents: courant.coutCents === null || cout === null ? null : courant.coutCents + cout,
      });
    }

    const sorties: LigneRepartition[] = [...parModele.entries()].map(([modele, agg]) => ({
      modele,
      appels: agg.appels,
      coutCents: agg.coutCents,
    }));

    return { lignes: sorties, complet: lignes.length < LIGNES_RATIO_MAX };
  },
};

export function controleCout(): AICostControlService {
  return new AICostControlService(portCoutSupabase);
}

// ==================================================================
// 3. Le journal d'usage
// ==================================================================

export const journalUsageSupabase: PortJournalUsage = async (evenement) => {
  const supabase = await createClient();
  const { error } = await supabase.rpc("ai_record_usage_event", {
    p_organization_id: evenement.organizationId,
    p_agent: evenement.agent,
    p_model: evenement.modele,
    p_input_tokens: compteur(evenement.jetonsEntree),
    p_output_tokens: compteur(evenement.jetonsSortie),
    p_duration_ms: compteur(evenement.dureeMs),
    p_success: evenement.succes,
    p_tool_calls: compteur(evenement.appelsOutils),
    // Jamais 0 pour « inconnu » : la colonne est nullable exprès.
    p_estimated_cost_cents: evenement.coutEstimeCents,
    p_cost_basis: evenement.baseTarif,
    p_failure_reason: evenement.motifPanne,
    p_fallback_from_model: evenement.modeleReplieDepuis,
    p_decision_id: evenement.decisionId,
  });
  if (error) throw new Error(messageLisible(error.message));
};

export function journalUsage(): JournalUsage {
  return new JournalUsage(journalUsageSupabase);
}

// ==================================================================
// 4. Le runner complet
// ==================================================================

/**
 * LES SURCHARGES DE MODÈLE D'UNE ENTREPRISE (`ai_model_overrides`, 0076).
 *
 * ══════════════════════════════════════════════════════════════════
 * SANS CETTE LECTURE, LE SÉLECTEUR DE `/parametres/ia` NE FAIT RIEN
 * ══════════════════════════════════════════════════════════════════
 *
 * Le critère de la page 34 — « je dois pouvoir remplacer demain Finance
 * Terra → Sol depuis une configuration centrale » — a deux étages : la
 * table TypeScript et les variables d'environnement gouvernent le
 * PRODUIT, cette table-ci gouverne UNE ENTREPRISE. Tant que personne ne
 * la lisait au moment d'exécuter, l'écran rangeait une ligne que rien
 * ne consultait.
 *
 * Rend une carte VIDE quand la lecture échoue, et le dit : la carte du
 * produit reste alors en vigueur, ce qui est le bon défaut — une
 * surcharge illisible ne doit pas empêcher les agents de travailler.
 * Mais elle ne doit pas non plus disparaître en silence, d'où
 * l'avertissement remonté jusqu'à la réponse.
 */
export async function lireSurchargesModeles(organizationId: string): Promise<{
  surcharges: SurchargesEffectives;
  avertissement: string | null;
}> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ai_model_overrides")
    .select("agent, model")
    .eq("organization_id", organizationId);

  if (error) {
    console.error(`surcharges de modèle IA illisibles : ${error.message}`);
    return {
      surcharges: new Map(),
      avertissement:
        "Les modèles choisis par votre entreprise n'ont pas pu être lus : Oasis a travaillé " +
        "avec l'aiguillage par défaut du produit.",
    };
  }

  const surcharges = new Map<CleAgentSql, string>();
  for (const ligne of data ?? []) {
    const row = ligne as { agent: unknown; model: unknown };
    // Une clé inconnue est ignorée, pas fatale : c'est la même
    // tolérance que l'écran d'administration, et pour la même raison.
    if (!estCleAgentSql(row.agent) || typeof row.model !== "string") continue;
    const modele = row.model.trim();
    if (modele.length > 0) surcharges.set(row.agent, modele);
  }

  return { surcharges, avertissement: null };
}

/**
 * L'orchestrateur câblé sur la base, sur le routeur du processus et sur
 * les surcharges de l'entreprise.
 *
 * C'est ce que les étapes 9 à 12 appellent. Une nouvelle instance à
 * chaque appel : `createClient()` lit les cookies de la requête en
 * cours, et un runner mémorisé entre deux requêtes servirait la session
 * de quelqu'un d'autre.
 *
 * `modelePourNiveau` n'est PAS décoré (voir `appliquerSurcharges`) : le
 * repli descend d'un cran sur le modèle du produit, pas sur une
 * surcharge posée pour un autre agent.
 */
export function runnerAgents(surcharges: SurchargesEffectives = new Map()): OasisAgentRunner {
  const routeur = routeurModeles();
  return new OasisAgentRunner({
    routeur: appliquerSurcharges(routeur, surcharges, routeur.modelesConfigures()),
    cout: controleCout(),
    journal: journalUsage(),
  });
}

// ==================================================================
// 5. Les réglages d'autonomie (`ai_agent_settings`, 0072)
// ==================================================================

export const reglagesAgentsSupabase: PortReglagesAgents = async (organizationId) => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ai_agent_settings")
    .select("agent, enabled, autonomy_level")
    .eq("organization_id", organizationId);

  // ON LÈVE. `lireReglagesAgents` attrape, retombe au niveau 1 — où
  // rien ne s'écrit — et le SIGNALE. Rendre un tableau vide ici ferait
  // la même chose en silence, et une entreprise réglée au niveau 3 dont
  // les agents cessent d'agir chercherait longtemps.
  if (error) throw new Error(messageLisible(error.message));
  return data ?? [];
};

// ==================================================================
// 6. L'Action Engine
// ==================================================================

export const portActionEngineSupabase: PortActionEngine = {
  async catalogue(actionType) {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("ai_action_catalog")
      .select("action_type, agent, label, default_risk_level, required_permission, is_write, carries_amount")
      .eq("action_type", actionType)
      .maybeSingle();

    if (error) throw new Error(messageLisible(error.message));
    if (!data) return null;

    return {
      actionType: String(data.action_type),
      agent: String(data.agent),
      label: String(data.label),
      // Une valeur illisible vaut `critical`, PAS `low`. La colonne a
      // `default 'high'` en base et une contrainte ; si malgré tout on
      // lit autre chose, c'est que quelque chose ne va pas — et le
      // niveau le plus fermé est le seul défaut défendable pour une
      // valeur qui décide si une facture part toute seule.
      risqueParDefaut: lireRisque(data.default_risk_level),
      permissionRequise: String(data.required_permission),
      ecrit: data.is_write !== false,
      // Idem : `true` par défaut. Une action dont on ne sait pas si
      // elle engage de l'argent doit être traitée comme si elle en
      // engageait — c'est aussi ce que fait `ai_may_autoexecute`.
      engageDeLArgent: data.carries_amount !== false,
    };
  },

  async enregistrer(appel) {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("ai_actions")
      .insert({
        organization_id: appel.organizationId,
        action_type: appel.actionType,
        agent: appel.agent,
        decision_id: appel.decisionId,
        target_entity_type: appel.cibleType,
        target_entity_id: appel.cibleId,
        parameters: appel.parametres,
        risk_level: appel.risque,
        requires_confirmation: appel.confirmationRequise,
        created_by_ai: true,
        created_by: appel.userId,
        status: "proposed",
      })
      .select("id")
      .single();

    if (error || !data?.id) {
      throw new Error(messageLisible(error?.message ?? "L'action n'a pas été enregistrée."));
    }
    return String(data.id);
  },

  async demanderApprobation({ actionId, risque, expiration }) {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("ai_request_approval", {
      p_action_id: actionId,
      p_risk: risque,
      p_expires_in: expiration,
    });
    if (error) throw new Error(messageLisible(error.message));
    if (typeof data !== "string") {
      throw new Error("La demande de validation n'a pas rendu d'identifiant.");
    }
    return data;
  },

  async autoriseAutopilote(appel) {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("ai_may_autoexecute", {
      p_organization_id: appel.organizationId,
      p_agent: appel.agent,
      p_action_type: appel.actionType,
      p_amount_cents: appel.montantCents,
      p_target_entity_type: appel.cibleType,
      p_target_entity_id: appel.cibleId,
    });

    // FERMÉ SUR ERREUR, comme la fonction SQL elle-même. Et `=== true`
    // et non `!!data` : PostgREST peut rendre `null`, et `null` n'est
    // pas un oui.
    if (error) {
      console.error(`autopilote IA : vérification impossible (${error.message}).`);
      return false;
    }
    return data === true;
  },

  async cloturer({ organizationId, actionId, ok, resultat }) {
    const supabase = await createClient();
    const maintenant = new Date().toISOString();
    const { error } = await supabase
      .from("ai_actions")
      .update(
        ok
          ? { status: "executed", executed_at: maintenant, result: resultat, updated_at: maintenant }
          : { status: "failed", result: resultat, updated_at: maintenant },
      )
      .eq("id", actionId)
      .eq("organization_id", organizationId);
    if (error) throw new Error(messageLisible(error.message));
  },

  async journaliser(appel) {
    const supabase = await createClient();
    const { error } = await supabase.rpc("ai_record_agent_event", {
      p_organization_id: appel.organizationId,
      p_agent: appel.agent,
      p_action: appel.evenement,
      p_entity_type: "ai_action",
      p_entity_id: appel.actionId,
      p_data_used: null,
      p_parameters: appel.parametres,
      p_confirmation: appel.confirmation,
      p_result: appel.resultat,
    });
    if (error) throw new Error(messageLisible(error.message));
  },
};

/**
 * LES SERVICES MÉTIER — et pourquoi la liste est VIDE.
 *
 * ══════════════════════════════════════════════════════════════════
 * CE N'EST PAS UN OUBLI, C'EST UN REFUS DE DUPLIQUER
 * ══════════════════════════════════════════════════════════════════
 *
 * Le seul type d'action que ce produit sait exécuter est
 * `createInvoiceDraft`, et son exécuteur EXISTE déjà : c'est
 * `createInvoiceDrafts` de `lib/ai/engine.ts`, appelé par
 * `answerApproval` après le clic humain. Il relit
 * `ai_billing_candidates`, ne facture que les dossiers « prêts »,
 * distingue « aucun montant connu » de « zéro », et rend un compte
 * rendu. Le recopier ici produirait deux exécuteurs pour la même
 * action, et le jour où l'un des deux corrigera un cas limite, l'autre
 * facturera encore de travers.
 *
 * ─── CE QUE CETTE LISTE VIDE COÛTE EXACTEMENT ───
 *
 * L'autopilote (niveau d'autonomie 4) ne part JAMAIS depuis ce runtime :
 * `OasisActionEngine` n'interroge même pas `ai_may_autoexecute` pour une
 * action sans exécuteur, et toute action passe par une demande
 * d'approbation humaine. Ce n'est pas une régression — la fonction Edge
 * `oasis-pro-ai` reste en place avec son propre chemin d'autopilote,
 * et rien n'est retiré à personne. C'est une capacité que cette
 * surface-ci n'a pas encore.
 *
 * ─── COMMENT L'OUVRIR, LE JOUR VENU ───
 *
 * Sortir `createInvoiceDrafts` de `lib/ai/engine.ts` vers un module
 * partagé — `lib/ai/services/invoices.ts` par exemple —, puis le
 * nommer ici. Un seul exécuteur, deux appelants. Le port existe
 * précisément pour que ce jour-là ne demande qu'un objet littéral.
 */
export const servicesMetierSupabase: PortServicesMetier = {
  executeurs: [],
  async executer({ actionType }) {
    return {
      ok: false,
      message:
        `Oasis n'exécute pas « ${actionType} » depuis ce chemin : l'action a été enregistrée ` +
        "et attend une validation humaine.",
    };
  },
};

export function moteurActions(): OasisActionEngine {
  // UNE INSTANCE PAR REQUÊTE. Le moteur compte les actions de LA
  // réponse en cours (`ACTIONS_MAX_PAR_REPONSE`) ; une instance
  // mémorisée entre deux requêtes ferait refuser la vingt-et-unième
  // action de la journée.
  return new OasisActionEngine(portActionEngineSupabase, servicesMetierSupabase);
}

// ==================================================================
// 7. Le runtime complet
// ==================================================================

/**
 * La lecture brute d'une source, pour les outils du SDK.
 *
 * `AgentContextBuilder` reçoit un port qui rend `{ok, …}` : il a besoin
 * de DISTINGUER une source en échec d'une source vide, pour le dire à
 * l'agent. Le pont d'outils, lui, rend la valeur au modèle : un échec
 * y devient un objet `{erreur, message}` que le modèle lit et
 * répercute. Deux besoins, deux formes, une seule requête derrière.
 */
export async function lireSourceBrute(appel: {
  rpc: string;
  arguments: Record<string, unknown>;
}): Promise<unknown> {
  const resultat = await lectureSourceSupabase(appel);
  if (!resultat.ok) return { erreur: "lectureImpossible", message: resultat.message };
  return resultat.donnees ?? null;
}

/**
 * Le runtime des agents, câblé sur la base, le routeur et le fournisseur.
 *
 * `configurerTracing()` est appelée ici et pas à l'import : le tracing
 * est un réglage global du SDK, il doit être posé une fois, et
 * l'appeler depuis un module qu'un composant client pourrait importer
 * par erreur ferait charger le SDK dans le navigateur.
 */
export async function runtimeAgents(identite: IdentiteAppel): Promise<OasisAgentsRuntime> {
  configurerTracing();

  const [reglages, modeles] = await Promise.all([
    lireReglagesAgents(identite.organizationId, AGENTS_PREMIERE_ITERATION, reglagesAgentsSupabase),
    lireSurchargesModeles(identite.organizationId),
  ]);

  return new OasisAgentsRuntime({
    identite,
    constructeur: constructeurContexte(),
    runner: runnerAgents(modeles.surcharges),
    moteurActions: moteurActions(),
    reglages,
    fournisseur: fournisseurIA(),
    lire: lireSourceBrute,
    avertissementsInitiaux: modeles.avertissement === null ? [] : [modeles.avertissement],
  });
}

// ==================================================================
// Messages
// ==================================================================

/**
 * Le niveau de risque lu en base, ou le plus fermé.
 *
 * `critical` par défaut. C'est le seul champ de ce fichier où un défaut
 * permissif aurait une conséquence irréversible : un `low` obtenu par
 * accident sur une valeur illisible ouvrirait le chemin de
 * l'auto-exécution.
 */
function lireRisque(valeur: unknown): NiveauRisque {
  return valeur === "low" || valeur === "medium" || valeur === "high" || valeur === "critical"
    ? valeur
    : "critical";
}

/**
 * Le message de Postgres, ou une phrase à sa place.
 *
 * Les migrations 0069, 0072, 0073 et 0076 écrivent leurs refus en
 * français précisément pour qu'ils remontent tels quels. Seules les
 * erreurs de plomberie sont réécrites — voir `friendly()` de
 * `lib/ai/engine.ts`, dont ceci est le pendant.
 */
function messageLisible(message: string): string {
  if (!message) return "L'appel n'a pas abouti.";
  if (message.includes("row-level security")) {
    return "Votre rôle ne permet pas cette lecture. Demandez le droit correspondant à un administrateur.";
  }
  if (message.includes("does not exist") || message.includes("schema cache")) {
    return "Cette partie d'Oasis n'est pas encore installée sur cette base (migration en attente).";
  }
  return message;
}
