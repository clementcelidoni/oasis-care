import { getActiveOrganization } from "@/lib/auth/organization";
import { getCurrentUser } from "@/lib/supabase/server";
import { createClient } from "@/lib/supabase/server";
import type { IdentiteAppel } from "@/lib/ai/runtime";

/**
 * §11V — CE QUE TOUT APPEL D'AGENT DOIT PORTER (spec p. 21-22).
 *
 * ══════════════════════════════════════════════════════════════════
 * « Chaque appel agent possède : organizationId, workspaceId, userId,
 *   permissions. Organisation A ne peut jamais interroger Organisation B. »
 * ══════════════════════════════════════════════════════════════════
 *
 * Les quatre viennent de la SESSION, et d'elle seule. Aucun des trois
 * Route Handlers ne lit `organizationId` dans le corps de la requête —
 * pas même pour le comparer : un champ qu'on lit est un champ qu'on
 * finit par utiliser. La fonction Edge, elle, l'acceptait dans le corps
 * et le validait ensuite ; ici, il n'y a rien à valider parce qu'il n'y
 * a rien à recevoir.
 *
 * ─── ET LA BARRIÈRE RESTE POSTGRES ───
 *
 * Ceci n'est pas la sécurité multi-tenant : la sécurité, c'est la RLS
 * et `ai_guard`, et elles s'appliquent sous le jeton de l'utilisateur
 * porté par `createClient()`. Ceci est ce qui évite qu'un appel parte
 * du bon côté et revienne vide sans que personne comprenne pourquoi.
 */

export type Acces =
  | { ok: true; identite: IdentiteAppel; nomOrganisation: string }
  | { ok: false; statut: 401 | 403; message: string };

export async function lireIdentite(): Promise<Acces> {
  const utilisateur = await getCurrentUser();
  if (!utilisateur) {
    return { ok: false, statut: 401, message: "Session expirée. Reconnectez-vous." };
  }

  const organisation = await getActiveOrganization();
  if (!organisation) {
    // 403 et non 401 : la personne est bien connectée. La renvoyer vers
    // la connexion la ferait tourner en rond, comme le dit déjà
    // `requireOrganization`.
    return {
      ok: false,
      statut: 403,
      message: "Aucune entreprise active sur ce compte.",
    };
  }

  return {
    ok: true,
    nomOrganisation: organisation.name,
    identite: {
      organizationId: organisation.organizationId,
      workspaceId: organisation.workspaceId,
      userId: utilisateur.id,
      permissions: organisation.permissions,
    },
  };
}

/**
 * UNE DÉCISION DE CETTE ENTREPRISE, OU RIEN.
 *
 * ══════════════════════════════════════════════════════════════════
 * POURQUOI UN IDENTIFIANT NON VÉRIFIÉ FAISAIT DISPARAÎTRE LE BUDGET
 * ══════════════════════════════════════════════════════════════════
 *
 * `decisionId` arrive du client — l'écran d'une décision le passe pour
 * obtenir le « coût / décision » de la page 18. Il traverse ensuite
 * tout le runtime jusqu'à `ai_record_usage_event`, et `ai_usage_events`
 * porte une clé étrangère COMPOSITE `(decision_id, organization_id)` :
 * un identifiant qui n'existe pas dans l'entreprise fait LEVER
 * l'insertion. Or `JournalUsage.inscrire` avale cette exception pour ne
 * pas perdre une réponse déjà payée.
 *
 * Conséquence, avant ce contrôle : il suffisait d'ajouter un UUID au
 * hasard dans le corps de la requête pour qu'AUCUNE ligne du grand
 * livre ne soit écrite — ni l'appel initial, ni l'escalade, ni le
 * repli, ni le refus budgétaire, tous porteurs du même identifiant. La
 * dépense restait à zéro, `ai_cost_budget_remaining` ne voyait rien, et
 * les trois plafonds de la page 19 ne se déclenchaient jamais.
 *
 * Le cas se produit aussi SANS malveillance : un écran resté ouvert qui
 * renvoie l'identifiant d'une décision supprimée entre-temps perdait
 * silencieusement toutes ses lignes de coût.
 *
 * La RLS suffit à faire la vérification — la décision d'une autre
 * entreprise n'est tout simplement pas visible. Rend `null` quand
 * l'identifiant est absent, et refuse quand il est présent mais
 * introuvable : on ne le remplace pas par `null` en silence, parce que
 * l'appelant croirait avoir rattaché sa dépense.
 *
 * Une DEUXIÈME barrière existe en base (0076) : `ai_record_usage_event`
 * ne rattache que ce qui existe, et perd le LIEN plutôt que la DÉPENSE.
 * Les deux sont nécessaires : celle-ci dit à l'appelant qu'il se
 * trompe, celle-là protège le grand livre de tous les autres appelants.
 */
export async function verifierDecision(
  organizationId: string,
  decisionId: string | null | undefined,
): Promise<{ ok: true; decisionId: string | null } | { ok: false; message: string }> {
  if (decisionId == null) return { ok: true, decisionId: null };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ai_decisions")
    .select("id")
    .eq("id", decisionId)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (error) {
    return {
      ok: false,
      message: "La décision à laquelle rattacher cette question n'a pas pu être relue.",
    };
  }
  if (!data) {
    return {
      ok: false,
      message:
        "Cette décision n'existe pas (ou plus) dans votre entreprise. Rechargez l'écran : " +
        "la question n'a pas été posée, pour ne pas ranger sa dépense sous un dossier inexistant.",
    };
  }

  return { ok: true, decisionId: String(data.id) };
}

/**
 * Le plafond mensuel de questions, tel qu'il existe déjà.
 *
 * ─── POURQUOI ON LE GARDE ALORS QUE 0076 APPORTE DES PLAFONDS EN EUROS ───
 *
 * Les deux ne mesurent pas la même chose et ne protègent pas de la même
 * chose. `consume_pro_ai_quota` est un compteur de REQUÊTES par
 * entreprise et par mois : il borne l'usage d'un abonnement, il est
 * atomique, et il existe en production aujourd'hui. `ai_cost_limits`
 * (0076) borne une DÉPENSE, en centimes, et n'est pas encore posé — ses
 * trois plafonds sont nullables et aucune ligne n'est semée. Retirer le
 * premier parce que le second arrive laisserait, entre les deux, une
 * fenêtre sans aucune limite du tout.
 *
 * Le quota est consommé AVANT l'appel au modèle et n'est pas rendu si
 * l'appel échoue. C'est le comportement de la fonction Edge, et il est
 * volontaire : une question qui plante coûte quand même des jetons
 * d'entrée.
 */
export const QUESTIONS_PAR_MOIS = 500;

export type Quota = { autorise: boolean; restant: number | null; message?: string };

export async function consommerQuota(organizationId: string): Promise<Quota> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("consume_pro_ai_quota", {
    p_organization_id: organizationId,
    p_limit: QUESTIONS_PAR_MOIS,
  });

  if (error) {
    // La fonction vérifie elle-même l'appartenance : une erreur ici
    // veut dire « organisation inaccessible », pas « quota inconnu ».
    return { autorise: false, restant: null, message: "Entreprise inaccessible." };
  }

  const ligne = Array.isArray(data) ? data[0] : data;
  const restantBrut = (ligne as { remaining?: unknown } | null)?.remaining;
  // PAS DE `?? 0`. Un reste illisible est inconnu, pas épuisé : afficher
  // « 0 question restante » à quelqu'un qui vient d'être autorisé serait
  // faux, et il n'oserait plus poser la suivante.
  const restant = typeof restantBrut === "number" ? restantBrut : null;

  if ((ligne as { allowed?: unknown } | null)?.allowed === false) {
    return {
      autorise: false,
      restant,
      message: `Plafond mensuel d'assistant atteint (${QUESTIONS_PAR_MOIS} questions). Il se remet à zéro le 1er du mois.`,
    };
  }

  return { autorise: true, restant };
}
