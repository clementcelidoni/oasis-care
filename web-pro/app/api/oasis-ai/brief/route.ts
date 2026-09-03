import { construireCleCache } from "@/lib/ai/runtime";
import { runtimeAgents } from "@/lib/ai/runtime/supabase";
import { consommerQuota, lireIdentite } from "../identite";
import { composerSortie, messagePourEchec, statutPour } from "../reponse";

/**
 * §11V — LE BRIEF DE DIRECTION (spec p. 9 et 29).
 *
 * ══════════════════════════════════════════════════════════════════
 *   Finance → Terra · Facturation → Terra · Devis → Terra
 *   ↓ sorties structurées ↓
 *   Executive Agent → Sol → Top 5 décisions
 * ══════════════════════════════════════════════════════════════════
 *
 * C'est le scénario de la page 29, et c'est le seul endroit du produit
 * où la Direction travaille pour ce qu'elle est : un agrégateur. Elle
 * n'a aucune source primaire (p. 8) ; elle interroge les spécialistes
 * par « agents as tools » (p. 10) et classe ce qu'ils rendent.
 *
 * ══════════════════════════════════════════════════════════════════
 * POURQUOI CETTE ROUTE-CI MET EN CACHE, ET PAS `/demander`
 * ══════════════════════════════════════════════════════════════════
 *
 * La page 19 demande de « ne pas recalculer l'analyse du même devis
 * toutes les 10 secondes ». Une conversation ne relève pas de ce cas :
 * deux personnes qui posent la même question à dix minutes d'écart
 * attendent deux réponses, et une question reformulée d'un mot produit
 * de toute façon une clé différente. `/demander` passe donc `cache:
 * null`.
 *
 * Un brief, lui, est LA MÊME QUESTION, posée par tout le monde, toute
 * la journée, sur les mêmes données. Il coûte jusqu'à QUATRE appels de
 * modèle — la Direction, plus chacun des trois spécialistes qu'elle
 * juge utile d'interroger —, ce qui en fait de loin la réponse la plus
 * chère du produit. C'est exactement ce que `ai_result_cache` (0076)
 * existe pour éviter.
 *
 * ─── ET POURQUOI ON PEUT ÊTRE GÉNÉREUX SUR LA DURÉE ───
 *
 * Parce que la durée n'est PAS ce qui protège de la péremption.
 * `ai_cache_lookup` exige l'EMPREINTE des données sources pour servir
 * une entrée : une facture émise entre-temps change l'empreinte, et
 * l'entrée n'est pas rendue — même parfaitement fraîche.
 *
 * ATTENTION : cette phrase n'a été vraie qu'à partir du moment où
 * l'empreinte du brief a couvert les SPÉCIALISTES. Le contenu du brief
 * n'est pas produit par les sources de la Direction — elle n'en a que
 * deux — mais par les agents qu'elle interroge, et une trésorerie qui
 * bouge ne changeait rien à son empreinte. Voir
 * `#empreinteAvecDelegations` dans `lib/ai/runtime/agents.ts` : les
 * contextes des trois spécialistes sont construits AVANT la consultation
 * du cache, et l'empreinte de l'entrée les couvre tous.
 *
 * La durée ne gouverne donc que le cas inverse, celui où rien n'a bougé,
 * et quinze minutes y sont un compromis sans risque : on ne peut pas
 * « oublier d'invalider », on peut seulement recalculer trop souvent.
 */

export const runtime = "nodejs";

/**
 * Aucun cache de framework, jamais.
 *
 * Le cache qui a le droit d'exister est celui de 0076 : par
 * organisation, par agent, par modèle et par empreinte des données. Une
 * réponse mise en cache par Next montrerait la trésorerie de l'un à
 * l'autre.
 */
export const dynamic = "force-dynamic";

/** Quinze minutes. Voir l'en-tête : c'est l'empreinte qui protège, pas la durée. */
export const TTL_BRIEF_SECONDES = 900;

/**
 * La question posée à la Direction.
 *
 * Elle est ÉCRITE ICI et ne vient jamais du client. Un brief dont le
 * texte serait choisi par l'appelant ne serait plus un brief : ce
 * serait `/demander`, avec une clé de cache partagée entre des
 * questions différentes — c'est-à-dire la réponse de l'un servie à
 * l'autre.
 */
export const QUESTION_BRIEF =
  "Que dois-je faire aujourd'hui ? Interroge les spécialistes nécessaires et classe les " +
  "décisions les plus urgentes, la plus urgente d'abord.";

export async function POST() {
  // ---- 1. L'identité, depuis la session et rien d'autre -------------
  const acces = await lireIdentite();
  if (!acces.ok) {
    return Response.json({ erreur: acces.message }, { status: acces.statut });
  }

  // ---- 2. Le quota mensuel -------------------------------------------
  //
  // AVANT l'appel, comme dans `/demander`. Un brief consomme UNE
  // question de l'abonnement, même s'il fait travailler quatre agents :
  // c'est un geste de l'utilisateur, pas quatre.
  const quota = await consommerQuota(acces.identite.organizationId);
  if (!quota.autorise) {
    return Response.json(
      { erreur: quota.message ?? "Plafond atteint.", questionsRestantes: quota.restant },
      { status: quota.message === "Entreprise inaccessible." ? 403 : 429 },
    );
  }

  try {
    const runtimeIA = await runtimeAgents(acces.identite);

    const reponse = await runtimeIA.executer({
      agent: "executive",
      question: QUESTION_BRIEF,
      // Le brief engage la journée de quelqu'un, mais il ne propose
      // aucune action et n'engage aucun argent : une réponse rendue par
      // le modèle standard plutôt que par l'avancé y est moins fine,
      // pas fausse. « ordinaire » autorise donc le repli de la p. 23
      // plutôt que d'afficher « service indisponible » sur l'écran
      // d'accueil un matin de panne.
      criticite: "ordinaire",
      cache: { cle: construireCleCache(["brief", "direction"]), ttlSecondes: TTL_BRIEF_SECONDES },
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

    return Response.json(composerSortie(reponse, quota.restant), { status: 200 });
  } catch (erreur) {
    return Response.json({ erreur: messagePourEchec(erreur) }, { status: 503 });
  }
}
