import { createClient } from "@/lib/supabase/server";
import {
  BORNES_REJEU,
  COUCHE_VIDE,
  QUEUE_ILLISIBLE,
  lireCouche,
  lireQueue,
  type ActionPreparee,
  type FilResume,
  type MessageFil,
  type QueueFil,
  type RoleMessage,
} from "./types.ts";

/**
 * §11W — LIRE UN FIL. RIEN QUE LIRE.
 *
 * ══════════════════════════════════════════════════════════════════
 * LE CLOISONNEMENT N'EST PAS ICI, ET C'EST VOULU
 * ══════════════════════════════════════════════════════════════════
 *
 * Aucune de ces fonctions ne filtre sur `user_id`. Ce n'est pas un
 * oubli : la RLS de 0079 tient les deux bouts — `user_id = auth.uid()`
 * ET `has_permission(organization_id, 'projects.read')`, sur les
 * colonnes de LA LIGNE, et la clé étrangère composite
 * `(conversation_id, organization_id, user_id)` garantit qu'un message
 * et son fil ont la même entreprise et le même propriétaire.
 *
 * Un filtre écrit ici en plus ne protégerait rien de neuf et
 * donnerait l'illusion que c'est LUI qui protège — l'illusion exacte
 * qui a coûté trois trous à ce produit avant 0062. On filtre quand
 * même sur `organization_id` dans la liste, mais pour une raison
 * différente et assumée : le même compte peut travailler pour deux
 * entreprises, et la liste doit montrer celle qui est active.
 *
 * ══════════════════════════════════════════════════════════════════
 * UNE LECTURE QUI ÉCHOUE NE REND PAS UNE LISTE VIDE
 * ══════════════════════════════════════════════════════════════════
 *
 * Elle rend `failed`. « Vous n'avez aucune conversation » et « je n'ai
 * pas pu lire vos conversations » ne sont pas la même phrase, et la
 * seconde ne doit jamais se déguiser en la première — c'est la règle
 * que tout ce dossier applique déjà au briefing du matin.
 */

export type ListeDeFils = {
  fils: FilResume[];
  failed: boolean;
  /**
   * La migration 0079 n'est pas passée sur cette base.
   *
   * DISTINCT D'UNE PANNE ORDINAIRE, et c'est utile : « réessayez dans
   * un instant » sur une base où la table n'existe pas est un conseil
   * qui ne marchera jamais. Le tant que 0079 n'est pas appliquée, ces
   * écrans doivent dire ce qui manque, à qui saura le lire.
   */
  migrationManquante: boolean;
};

/**
 * Postgres ne connaît pas la table, ou PostgREST ne la connaît pas
 * encore. Les deux veulent dire la même chose ici : 0079 n'est pas
 * passée, ou le cache de schéma n'a pas été rechargé.
 */
function estMigrationManquante(message: string): boolean {
  return message.includes("does not exist") || message.includes("schema cache");
}

/** Au-delà, un rail n'est plus une liste : c'est une archive à parcourir. */
export const FILS_AU_RAIL_MAX = 60;

export async function listerFils(organizationId: string): Promise<ListeDeFils> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("ai_conversations")
    .select("id, title, last_message_at, created_at")
    .eq("organization_id", organizationId)
    // `nulls first` en base ; ici, PostgREST met les nuls en tête d'un
    // tri descendant, ce qui place le fil ouvert à l'instant tout en
    // haut — exactement là où l'utilisateur vient de cliquer.
    .order("last_message_at", { ascending: false, nullsFirst: true })
    .order("created_at", { ascending: false })
    .limit(FILS_AU_RAIL_MAX);

  if (error) {
    console.error("conversations Oasis :", error.message);
    return {
      fils: [],
      failed: true,
      migrationManquante: estMigrationManquante(error.message),
    };
  }

  return {
    fils: (data ?? []).map((ligne) => ({
      id: String(ligne.id),
      titre: typeof ligne.title === "string" && ligne.title.trim() !== "" ? ligne.title : null,
      dernierMessageLe:
        typeof ligne.last_message_at === "string" ? ligne.last_message_at : null,
      ouvertLe: String(ligne.created_at),
    })),
    failed: false,
    migrationManquante: false,
  };
}

export type FilComplet = {
  fil: FilResume;
  messages: MessageFil[];
  /** Ce que le modèle relira au prochain tour, et le drapeau qui va avec. */
  queue: QueueFil;
  failed: boolean;
  /**
   * L'ÉTAT VIVANT des actions préparées dans ce fil, par `actionId`.
   *
   * Le message garde une PHOTO de l'action (libellé, montant, résumé
   * composé hors modèle) : c'est de l'histoire, et l'histoire ne bouge
   * pas. Mais « faut-il encore un bouton ? » se lit ailleurs, dans
   * `ai_action_approvals`, parce que la réponse change après coup — un
   * clic, une expiration à vingt-quatre heures. Afficher la photo comme
   * si elle disait l'état actuel montrerait « Valider » sur une
   * approbation exécutée hier.
   */
  approbations: Map<string, EtatApprobation>;
};

export type EtatApprobation = {
  approvalId: string;
  /** `pending`, `approved`, `rejected`, `expired` — tel que la base le dit. */
  statut: string;
  expireLe: string | null;
};

/**
 * Un fil, ses messages, et la queue qui repartira.
 *
 * LA QUEUE EST LUE ICI, À L'AFFICHAGE, PAR LA MÊME FONCTION QUE CELLE
 * QUI SERVIRA À POSER LA QUESTION SUIVANTE. C'est ce qui rend le filet
 * « Oasis relit à partir d'ici » exact plutôt que décoratif : l'écran ne
 * calcule pas sa propre idée de la coupe, il demande à la base celle
 * qu'elle appliquera.
 *
 * Rend `null` quand le fil n'existe pas, ou qu'il n'est pas le vôtre —
 * les deux se ressemblent exprès. Un identifiant inconnu et le fil d'un
 * collègue donnent la même réponse : rien à voir ici.
 */
export async function lireFil(
  organizationId: string,
  conversationId: string,
): Promise<FilComplet | null> {
  const supabase = await createClient();

  const { data: entete, error: erreurEntete } = await supabase
    .from("ai_conversations")
    .select("id, title, last_message_at, created_at")
    .eq("id", conversationId)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (erreurEntete) {
    console.error("conversation Oasis :", erreurEntete.message);
    return null;
  }
  if (!entete) return null;

  const fil: FilResume = {
    id: String(entete.id),
    titre: typeof entete.title === "string" && entete.title.trim() !== "" ? entete.title : null,
    dernierMessageLe: typeof entete.last_message_at === "string" ? entete.last_message_at : null,
    ouvertLe: String(entete.created_at),
  };

  const [{ data: lignes, error: erreurMessages }, queue] = await Promise.all([
    supabase
      .from("ai_conversation_messages")
      .select(
        "id, role, content, model, tools_used, proposal, proposal_status, payload, created_at",
      )
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true }),
    lireQueueDuFil(conversationId),
  ]);

  if (erreurMessages) {
    console.error("messages Oasis :", erreurMessages.message);
    return {
      fil,
      messages: [],
      queue: QUEUE_ILLISIBLE,
      failed: true,
      approbations: new Map(),
    };
  }

  const messages: MessageFil[] = [];
  for (const ligne of lignes ?? []) {
    const role = ligne.role;
    if (role !== "user" && role !== "assistant") continue;
    messages.push({
      id: String(ligne.id),
      role: role as RoleMessage,
      contenu: String(ligne.content),
      ecritLe: String(ligne.created_at),
      // `null` reste `null` : « on ne sait pas quels outils » n'est pas
      // « aucun outil », et l'écran doit se taire plutôt qu'affirmer.
      outils: Array.isArray(ligne.tools_used) ? (ligne.tools_used as string[]) : null,
      modele: typeof ligne.model === "string" ? ligne.model : null,
      // Brut : le `kind` est confronté à la liste figée du code par
      // `lireProposition`, jamais accepté tel quel.
      proposition: ligne.proposal ?? null,
      statutProposition:
        typeof ligne.proposal_status === "string" ? ligne.proposal_status : null,
      couche: role === "assistant" ? lireCouche(ligne.payload) : COUCHE_VIDE,
    });
  }

  const approbations = await lireApprobations(
    organizationId,
    messages.flatMap((message) => message.couche.actions),
  );

  return { fil, messages, queue, failed: false, approbations };
}

/**
 * L'ÉTAT ACTUEL DES ACTIONS CITÉES PAR LE FIL.
 *
 * ─── POURQUOI CETTE LECTURE EXISTE ───
 *
 * Parce que sans elle, une action préparée depuis une conversation
 * n'avait AUCUN bouton dans la conversation. Le moteur d'actions
 * enregistrait `ai_actions` + `ai_action_approvals` avec une expiration
 * à vingt-quatre heures, le modèle concluait par « confirmez », et le
 * seul bouton vivait sur l'autre onglet, sous un panneau que rien
 * n'annonçait depuis le fil. §11U avait explicitement corrigé ce
 * défaut ; le changement de moteur l'avait réintroduit.
 *
 * ─── LE FILTRE SUR L'ORGANISATION N'EST PAS DÉCORATIF ───
 *
 * Les identifiants d'action viennent d'une colonne `jsonb` libre, donc
 * d'un endroit que la clé étrangère composite ne garde pas. C'est
 * exactement la configuration de 0062 : on lirait l'autre bout de la
 * ligne sans vérifier à qui il appartient. La RLS d'`ai_action_approvals`
 * le couvre déjà ; ce filtre-ci est la ceinture.
 */
async function lireApprobations(
  organizationId: string,
  actions: readonly ActionPreparee[],
): Promise<Map<string, EtatApprobation>> {
  const etats = new Map<string, EtatApprobation>();
  const actionIds = [...new Set(actions.map((action) => action.actionId))];
  if (actionIds.length === 0) return etats;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ai_action_approvals")
    .select("id, action_id, status, expires_at")
    .eq("organization_id", organizationId)
    .in("action_id", actionIds);

  if (error) {
    // On ne devine pas. Sans état lisible, l'écran affichera « état
    // inconnu » plutôt qu'un bouton qui pourrait ne plus rien valider.
    console.error("approbations du fil :", error.message);
    return etats;
  }

  for (const ligne of data ?? []) {
    etats.set(String(ligne.action_id), {
      approvalId: String(ligne.id),
      statut: String(ligne.status),
      expireLe: typeof ligne.expires_at === "string" ? ligne.expires_at : null,
    });
  }
  return etats;
}

/**
 * LA QUEUE, TELLE QUE LA BASE LA CALCULE — jamais telle que l'écran
 * l'imaginerait.
 *
 * Les deux bornes voyagent en paramètres, et la fonction SQL les
 * reborne de son côté (40 messages, 12 000 caractères au plus). Ce
 * n'est pas de la méfiance envers cet appelant : c'est que la borne
 * appartient au produit, pas au code qui appelle, et qu'un futur
 * appelant pressé ne doit pas pouvoir l'ouvrir en grand.
 *
 * UN ÉCHEC REND UNE QUEUE MARQUÉE « ILLISIBLE », JAMAIS UNE DEMI-QUEUE
 * — et jamais non plus une queue vide silencieuse.
 *
 * La première version rendait `QUEUE_VIDE`, en écrivant que « le fil
 * s'affiche alors sans mémoire, c'est visible ». Ça ne l'était pas :
 * `failed` ne couvrait que la requête des messages, le filet de coupe
 * ne se dessine que si `tronque` vaut vrai, et l'en-tête continuait
 * d'affirmer « Oasis relit cette conversation ». Le fil s'affichait
 * entier pendant que la question suivante partait avec `historique: []`
 * — la divergence exacte que ce module déclare impossible, obtenue par
 * une panne. Le drapeau la rend visible, et `poserQuestion` refuse
 * plutôt que d'appeler le modèle sans mémoire en le taisant.
 */
export async function lireQueueDuFil(conversationId: string): Promise<QueueFil> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("ai_conversation_tail", {
    p_conversation_id: conversationId,
    p_messages_max: BORNES_REJEU.messages,
    p_caracteres_max: BORNES_REJEU.caracteres,
  });

  if (error) {
    console.error("queue de conversation :", error.message);
    return QUEUE_ILLISIBLE;
  }
  return lireQueue(data);
}
