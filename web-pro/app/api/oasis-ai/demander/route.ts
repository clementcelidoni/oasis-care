import { z } from "zod";
import { AGENTS_JOIGNABLES } from "@/lib/ai/runtime";
import { runtimeAgents } from "@/lib/ai/runtime/supabase";
import { aiguiller } from "../aiguillage";
import { consommerQuota, lireIdentite, verifierDecision } from "../identite";
import { composerSortie, messagePourEchec, statutPour } from "../reponse";

/**
 * §11V — POSER UNE QUESTION À UN AGENT.
 *
 * ══════════════════════════════════════════════════════════════════
 * POURQUOI UN ROUTE HANDLER, ET POURQUOI DANS LE SERVEUR NEXT.JS
 * ══════════════════════════════════════════════════════════════════
 *
 * Le runtime des agents tourne ici parce que `@openai/agents` vise
 * Node : `@openai/agents-core` livre des shims pour « workerd » et
 * « browser », aucun pour Deno, et `openai` charge `net`, `tls` et
 * `worker_threads`. La décision est actée ; `next.config.ts` la porte
 * dans `serverExternalPackages`.
 *
 * Un Route Handler plutôt qu'une Server Action, pour la même raison que
 * la recherche globale (§20) : un `fetch` accepte un `AbortSignal`. Une
 * question d'agent dure plusieurs secondes ; l'utilisateur doit pouvoir
 * la quitter, et l'écran suivant ne doit pas attendre la fin de la
 * précédente.
 *
 * ── LE RUNTIME EST CELUI DE NODE ─────────────────────────────────
 *
 * Déclaré, pas supposé. `nodejs` est le défaut des Route Handlers,
 * mais un défaut peut changer, et la conséquence d'un basculement
 * silencieux vers le runtime Edge serait un `Module not found: net` au
 * premier appel réel — pas au build.
 *
 * ══════════════════════════════════════════════════════════════════
 * CE QUE CE HANDLER NE FAIT PAS
 * ══════════════════════════════════════════════════════════════════
 *
 *   • il n'exécute AUCUNE action métier. Les écritures proposées
 *     deviennent des lignes d'`ai_actions` et des demandes
 *     d'approbation ; le clic humain passe par `answerApproval`, la
 *     Server Action qui existe déjà ;
 *
 *   • il ne remplace pas la fonction Edge `oasis-pro-ai`, qui reste en
 *     place et sert d'autres appelants que ce dépôt. On ne débranche
 *     pas une surface qui marche le jour où on en met une autre en
 *     ligne. Aucun écran de ce dépôt ne lui pose plus de question
 *     depuis §11W, mais `confirmerActionsOasis` continue d'émettre son
 *     mode « confirm ».
 *
 * ══════════════════════════════════════════════════════════════════
 * §11W — CE HANDLER N'EST TOUJOURS PAS LE CHEMIN DES CONVERSATIONS
 * ══════════════════════════════════════════════════════════════════
 *
 * Et c'est une distinction à tenir. §11W a bien fait passer les
 * questions de l'utilisateur par le RUNTIME (`runtimeAgents`) — plus
 * par la fonction Edge — mais par une Server Action,
 * `lib/ai/conversations/actions.ts`, et non par cette route.
 *
 * La raison est la mémoire : une conversation doit lire la queue du fil
 * en base, appeler le modèle, PUIS écrire les deux tours ensemble, le
 * tout dans une seule opération dont l'écran ressort rafraîchi. Une
 * Server Action fait cela avec `revalidatePath` ; un `fetch` vers une
 * route demanderait à l'appelant de réordonner les écritures, c'est-à-
 * dire de pouvoir se tromper d'ordre.
 *
 * Cette route reste le chemin des appelants qui ont besoin d'un
 * `AbortSignal` — une question qu'on doit pouvoir quitter — et n'a,
 * elle, aucune notion de fil.
 */

export const runtime = "nodejs";

/**
 * Aucun cache, jamais.
 *
 * Une réponse d'agent dépend de la session, des droits et des données
 * de l'entreprise. Une seule réponse mise en cache par le framework
 * montrerait la trésorerie de l'un à l'autre. Le cache qui a le droit
 * d'exister est celui de 0076 : par organisation, par agent, par modèle
 * et par empreinte des données sources.
 */
export const dynamic = "force-dynamic";

/** Deux mille caractères, comme la fonction Edge. Au-delà, ce n'est plus une question. */
export const LONGUEUR_QUESTION_MAX = 2_000;

const CorpsSchema = z.object({
  question: z.string().min(1).max(LONGUEUR_QUESTION_MAX),
  /**
   * L'écran sait parfois de quoi il parle. Quand il le sait, il le dit.
   *
   * LA LISTE EST CELLE DES AGENTS JOIGNABLES, PAS DES AGENTS DÉCLARÉS,
   * et la nuance est une faille refermée. Un agent imposé ici gagne
   * TOUJOURS : `aiguiller()` rend « Agent imposé par l'appelant » sans
   * rien vérifier. Tant que ce champ acceptait les dix clés, un gabarit
   * — un agent explicitement déclaré non construit, sans mot-clé, que
   * l'aiguilleur ne rend jamais — restait atteignable par un simple
   * champ de requête. On payait alors un raisonnement complet pour un
   * agent sans source.
   *
   * `AGENTS_JOIGNABLES` est dérivé du drapeau `aCompleter` que chaque
   * fichier d'agent porte : le jour où un gabarit est achevé, il entre
   * ici tout seul, et le jour où l'on remet le drapeau, il en sort.
   */
  agent: z.enum(AGENTS_JOIGNABLES).nullish(),
  quoteId: z.string().uuid().nullish(),
  projectId: z.string().uuid().nullish(),
  customerId: z.string().uuid().nullish(),
  gardenId: z.string().uuid().nullish(),
  decisionId: z.string().uuid().nullish(),
  /**
   * Ce que coûte une réponse dégradée.
   *
   * DÉFAUT « ordinaire », ET C'EST UNE DÉCISION DE CETTE ROUTE, PAS DU
   * RUNTIME. `DemandeExecution.criticite` reste sans défaut là-bas,
   * exprès : un défaut au fond de la plomberie ferait dégrader
   * silencieusement toutes les décisions dont personne n'a pensé à
   * déclarer l'enjeu. Ici, en revanche, on sait de quoi il s'agit — une
   * question posée dans une conversation. Une réponse rendue par le
   * modèle standard plutôt que par l'avancé y est moins bonne ; refuser
   * de répondre serait pire. L'appelant qui sait le contraire le dit.
   */
  criticite: z.enum(["ordinaire", "critique"]).nullish(),
});

export async function POST(request: Request) {
  // ---- 1. L'identité, depuis la session et rien d'autre -------------
  const acces = await lireIdentite();
  if (!acces.ok) {
    return Response.json({ erreur: acces.message }, { status: acces.statut });
  }

  // ---- 2. Le corps --------------------------------------------------
  let corps: z.infer<typeof CorpsSchema>;
  try {
    corps = CorpsSchema.parse(await request.json());
  } catch {
    return Response.json(
      {
        erreur: `Requête invalide. Attendu : une question de 1 à ${LONGUEUR_QUESTION_MAX} caractères.`,
      },
      { status: 400 },
    );
  }

  const question = corps.question.trim();
  if (question.length === 0) {
    return Response.json({ erreur: "Question vide." }, { status: 400 });
  }

  // ---- 3. Le rattachement à une décision, s'il y en a un -------------
  //
  // AVANT le quota, parce qu'une requête malformée ne doit pas consommer
  // une question de l'abonnement. Voir `verifierDecision` : sans ce
  // contrôle, un identifiant inventé faisait disparaître du grand livre
  // TOUTES les lignes de coût de l'appel — et avec elles les plafonds.
  const decision = await verifierDecision(acces.identite.organizationId, corps.decisionId);
  if (!decision.ok) {
    return Response.json({ erreur: decision.message }, { status: 400 });
  }

  // ---- 4. Le quota mensuel ------------------------------------------
  //
  // AVANT l'appel au modèle, et avant même de construire le contexte :
  // assembler un contexte fait sortir des données de la base pour rien
  // si la question va être refusée.
  const quota = await consommerQuota(acces.identite.organizationId);
  if (!quota.autorise) {
    return Response.json(
      { erreur: quota.message ?? "Plafond atteint.", questionsRestantes: quota.restant },
      { status: quota.message === "Entreprise inaccessible." ? 403 : 429 },
    );
  }

  // ---- 5. L'aiguillage, déterministe --------------------------------
  const aiguillage = aiguiller(question, corps.agent ?? null);

  // ---- 6. L'exécution ------------------------------------------------
  try {
    const runtimeIA = await runtimeAgents(acces.identite);

    const reponse = await runtimeIA.executer({
      agent: aiguillage.agent,
      question,
      cible: {
        quoteId: corps.quoteId ?? null,
        projectId: corps.projectId ?? null,
        customerId: corps.customerId ?? null,
        gardenId: corps.gardenId ?? null,
      },
      criticite: corps.criticite ?? "ordinaire",
      routage: aiguillage.complexite ? { complexity: aiguillage.complexite } : {},
      // PAS DE CACHE SUR UNE CONVERSATION. Deux personnes qui posent la
      // même question à dix minutes d'intervalle attendent deux
      // réponses ; et une question reformulée d'un mot produirait une
      // clé différente de toute façon. Le cache de 0076 sert les
      // analyses répétées d'un MÊME OBJET — voir `/api/oasis-ai/brief`,
      // qui s'en sert, et `construireCleCache`, qui compose sa clé.
      cache: null,
      decisionId: decision.decisionId,
    });

    if (!reponse.execution.ok) {
      return Response.json(
        {
          erreur: reponse.execution.message,
          motif: reponse.execution.motif,
          avertissements: reponse.execution.avertissements,
          questionsRestantes: quota.restant,
        },
        { status: statutPour(reponse.execution) },
      );
    }

    return Response.json(
      { ...composerSortie(reponse, quota.restant), aiguillage: aiguillage.raison },
      { status: 200 },
    );
  } catch (erreur) {
    // `messagePourEchec` journalise le détail côté serveur et ne rend
    // qu'une phrase — sauf pour « migration en attente », qui est notre
    // propre message et qui dit quoi faire.
    return Response.json({ erreur: messagePourEchec(erreur) }, { status: 503 });
  }
}
