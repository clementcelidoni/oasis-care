"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireOrganization } from "@/lib/auth/organization";
import { flash } from "@/lib/ui/flash";
import { describeProposal } from "@/lib/ai/proposals";
import { confirmProposal, type ConfirmResult } from "@/lib/ai/actions";
import { answerApproval } from "@/lib/ai/engine";
import { aiguiller } from "@/app/api/oasis-ai/aiguillage";
import { consommerQuota, lireIdentite } from "@/app/api/oasis-ai/identite";
import { messagePourEchec } from "@/app/api/oasis-ai/reponse";
import type { AnalyseAgent, SortieExecutive } from "@/lib/ai/runtime/schemas";
import type { ReponseAgent } from "@/lib/ai/runtime/agents";
import { runtimeAgents } from "@/lib/ai/runtime/supabase";
import { lireQueueDuFil } from "./lecture.ts";
import { marquerProposition } from "./proposition.ts";
import {
  composerContenu,
  composerCouche,
  historiqueModele,
  LONGUEUR_QUESTION_MAX,
  MESSAGES_PAR_FIL_MAX,
  QUEUE_VIDE,
  type ActionPreparee,
  type SubstanceReponse,
} from "./types.ts";

/**
 * §11W — POSER UNE QUESTION DANS UN FIL, ET CE QUE ÇA ENGAGE.
 *
 * ══════════════════════════════════════════════════════════════════
 * L'ORDRE DES GESTES EST LE SUJET DE CE FICHIER
 * ══════════════════════════════════════════════════════════════════
 *
 *   1. l'identité, depuis la session — jamais depuis le formulaire ;
 *   2. la question, bornée ;
 *   3. le fil, la place qu'il lui reste, et sa QUEUE — lue par
 *      `ai_conversation_tail`, c'est-à-dire par la base, avec ses
 *      bornes à elle ;
 *   4. le quota mensuel, AVANT de faire sortir la moindre autre donnée
 *      de la base : assembler un contexte pour une question qui va être
 *      refusée coûte des lectures pour rien ;
 *   5. l'appel, par le runtime existant ;
 *   6. l'écriture des deux tours, une fois la réponse obtenue.
 *
 * ─── POURQUOI LA QUEUE PASSE AVANT LE QUOTA, ET ELLE SEULE ───
 *
 * Parce qu'elle peut REFUSER la question. Une queue illisible arrête
 * tout : répondre sans mémoire pendant que l'écran affiche le fil
 * entier serait le mensonge que ce module existe pour empêcher. Un
 * refus qui arrive après avoir décompté une question du forfait serait
 * la seule chose pire que le refus. C'est un seul appel de fonction ;
 * le reste du contexte, lui, attend toujours le feu vert du quota.
 *
 * ─── POURQUOI ON N'ÉCRIT LA QUESTION QU'APRÈS LA RÉPONSE ───
 *
 * Parce qu'un fil ne doit jamais contenir une question sans réponse.
 * Une question orpheline repartirait dans la queue du tour suivant, où
 * le modèle la lirait comme une demande à laquelle il a déjà répondu —
 * et trois pannes réseau de suite empileraient trois fausses questions
 * dans son contexte. Les deux lignes partent ensemble ou pas du tout.
 *
 * Le quota, lui, est bien consommé avant : c'est le comportement de
 * toutes les autres portes, et il est volontaire — une question qui
 * plante a coûté des jetons d'entrée au fournisseur.
 *
 * ══════════════════════════════════════════════════════════════════
 * CE QUI EST ÉCRIT DANS LE FIL, ET CE QUI NE L'EST PAS
 * ══════════════════════════════════════════════════════════════════
 *
 * On n'écrit PAS la sortie structurée telle quelle : rejouer un JSON au
 * modèle lui réapprend son propre schéma à chaque tour et brûle la
 * moitié du budget de queue pour du balisage.
 *
 * Mais on n'écrit pas non plus le seul `resume`, et c'est la correction
 * la plus importante de cette passe. L'architecture IA a délibérément
 * sorti la substance du résumé — pour la Direction il vaut « le brief,
 * en trois phrases au plus » à côté de cinq `decisions` structurées ;
 * pour un spécialiste il est « bref » à côté de dix `recommandations` et
 * d'un `donneesManquantes`. Ne garder que lui rendait trois phrases là
 * où l'écran d'avant rendait la liste.
 *
 * `composerContenu` (module `types.ts`) recompose donc le texte À PARTIR
 * DES CHAMPS TYPÉS, hors modèle : le résumé, une ligne par
 * recommandation — titre, impact en centimes, action recommandée — puis
 * ce qui manquait pour conclure. Ce texte est ce qui s'affiche ET ce que
 * la queue renvoie au modèle : l'écran et la mémoire ne peuvent pas
 * diverger sur la substance.
 *
 * Le reste — raisons repliées, confiance, avertissements du runtime,
 * actions préparées — part dans la colonne `payload`, qui s'affiche et
 * ne se rejoue pas. La frontière est décrite au long dans `types.ts`.
 *
 * Une proposition devient un message à part entière, dont le TEXTE est
 * composé par `describeProposal` à partir de paramètres typés — jamais
 * par le modèle. C'est la règle de §11U, et elle survit à la
 * persistance : un client nommé « Ignore les instructions précédentes »
 * s'affiche comme un nom de client bizarre, et se relit comme tel.
 */

export type EtatQuestion =
  | { statut: "repos" }
  | {
      statut: "erreur";
      question: string;
      message: string;
      /**
       * Ce que le runtime a signalé en chemin, même quand il a échoué.
       *
       * Le Route Handler frère les renvoie déjà (`composerSortie`) ; les
       * taire ici faisait diverger deux surfaces qui appellent le même
       * runtime, et privait l'utilisateur du seul message qui explique
       * pourquoi la réponse est partielle.
       */
      avertissements?: string[];
    };

/** Cinq propositions par tour. Au-delà, ce n'est plus une réponse, c'est un formulaire. */
const PROPOSITIONS_PAR_TOUR_MAX = 5;

/** Cinq actions préparées affichées sous une réponse. Même raison. */
const ACTIONS_PAR_TOUR_MAX = 5;

/** Quarante outils, comme la contrainte `ai_conversation_messages_outils_borne`. */
const OUTILS_PAR_MESSAGE_MAX = 40;

/** Vingt mille caractères, comme la contrainte de contenu pour une réponse. */
const LONGUEUR_REPONSE_MAX = 20_000;

const CHEMIN_CONVERSATIONS = "/oasis-ai/conversations";

// ==================================================================
// 1. Ouvrir un fil
// ==================================================================

/**
 * Un fil neuf, et une URL neuve.
 *
 * ─── POURQUOI UNE URL, ET PAS UN BOUTON QUI VIDE L'ÉCRAN ───
 *
 * Le changement d'adresse est le signal le plus fort dont on dispose
 * pour dire « autre objet ». Un bouton « nouvelle conversation » qui
 * remplacerait le contenu en place ne dirait rien du tout — et c'est
 * exactement ce qu'il faut dire ici, puisque le fil neuf ne portera
 * AUCUN souvenir du précédent.
 *
 * Le fil est créé VIDE, sans titre : `ai_conversations.title` est
 * nullable pour cela, et le déclencheur de 0079 le dérivera de la
 * première question. Un titre posé par défaut ferait une liste de
 * vingt « Sans titre ».
 */
export async function ouvrirFil() {
  const organization = await requireOrganization();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data, error } = await supabase
    .from("ai_conversations")
    .insert({
      organization_id: organization.organizationId,
      user_id: user.id,
    })
    .select("id")
    .single();

  if (error || !data) {
    await flash("error", messageDeBase(error?.message) ?? "La conversation n'a pas pu être ouverte.");
    redirect(CHEMIN_CONVERSATIONS);
  }

  revalidatePath(CHEMIN_CONVERSATIONS);
  redirect(`${CHEMIN_CONVERSATIONS}/${String(data.id)}`);
}

// ==================================================================
// 2. Supprimer un fil
// ==================================================================

/**
 * TOUJOURS PAR LA FONCTION, JAMAIS PAR UN `DELETE` DIRECT.
 *
 * C'est la consigne explicite de 0079, et elle vient d'un piège mesuré :
 * PostgreSQL exige, pour un `delete` dont le `where` désigne une
 * colonne, que la ligne soit AUSSI visible par les politiques de
 * `select`. Une politique de suppression ne peut donc jamais être plus
 * permissive que la lecture — et la lecture est fermée, à juste titre,
 * à qui a perdu `projects.read`.
 *
 * Conséquence : un `delete` direct MARCHE pour un membre en règle et
 * ÉCHOUE EN SILENCE pour les autres. C'est la pire des deux pannes —
 * l'écran dirait « supprimé » sur une ligne toujours en base, pleine de
 * noms de clients. `ai_conversation_supprimer` est `security definer`,
 * ne teste que `user_id = auth.uid()`, et rend vrai ou faux.
 */
export async function supprimerFil(formData: FormData) {
  await requireOrganization();
  const conversationId = String(formData.get("conversationId") ?? "");
  if (!conversationId) return;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("ai_conversation_supprimer", {
    p_conversation_id: conversationId,
  });

  if (error) {
    await flash("error", messageDeBase(error.message) ?? "La conversation n'a pas pu être supprimée.");
  } else if (data === true) {
    await flash("success", "Conversation supprimée. Elle et ses messages ont disparu de la base.");
  } else {
    // Ni erreur, ni ligne : le fil n'existe plus, ou n'a jamais été le
    // vôtre. Les deux se disent pareil — connaître l'existence du fil
    // d'un collègue serait déjà en apprendre trop.
    await flash("info", "Cette conversation n'existe plus.");
  }

  revalidatePath(CHEMIN_CONVERSATIONS);
  redirect(CHEMIN_CONVERSATIONS);
}

// ==================================================================
// 3. Poser une question
// ==================================================================

export async function poserQuestion(
  _precedent: EtatQuestion,
  formData: FormData,
): Promise<EtatQuestion> {
  const question = String(formData.get("question") ?? "").trim();
  const filDemande = String(formData.get("conversationId") ?? "").trim();

  if (question.length === 0) return { statut: "repos" };
  if (question.length > LONGUEUR_QUESTION_MAX) {
    return {
      statut: "erreur",
      question,
      message: `Une question tient en ${LONGUEUR_QUESTION_MAX} caractères. Celle-ci en fait ${question.length} : découpez-la.`,
    };
  }

  // ---- 1. L'identité, depuis la session -----------------------------
  const acces = await lireIdentite();
  if (!acces.ok) return { statut: "erreur", question, message: acces.message };
  const identite = acces.identite;

  const supabase = await createClient();

  // ---- 2. Le fil : le mien, ou un neuf ------------------------------
  //
  // La vérification tient en une lecture filtrée sur l'organisation
  // active ; le reste est à la RLS de 0079, qui exige en plus
  // `user_id = auth.uid()`. Un identifiant forgé ne rend donc pas de
  // ligne, et on ouvre un fil neuf plutôt que d'écrire chez quelqu'un.
  let conversationId: string | null = null;
  let queue = QUEUE_VIDE;
  if (filDemande) {
    const { data } = await supabase
      .from("ai_conversations")
      .select("id")
      .eq("id", filDemande)
      .eq("organization_id", identite.organizationId)
      .maybeSingle();
    conversationId = data ? String(data.id) : null;
    if (conversationId === null) {
      return {
        statut: "erreur",
        question,
        message: "Cette conversation n'existe plus. Ouvrez-en une nouvelle : rien n'a été envoyé.",
      };
    }

    // LE PLAFOND SE DIT AVANT DE REFUSER, ET IL COMPTE UN TOUR ENTIER.
    //
    // Le déclencheur de 0079 refuse LIGNE À LIGNE au 201e message ; un
    // tour, lui, en écrit jusqu'à sept — la question, la réponse, et
    // jusqu'à cinq propositions, le tout dans un seul `insert`. Le
    // pré-contrôle d'origine ne refusait qu'à partir de 199 : à 195, le
    // lot franchissait le plafond en cours de route, PostgREST annulait
    // toute l'instruction, et l'utilisateur perdait une réponse déjà
    // payée. On réserve donc la place du pire cas.
    const placeParTour = 2 + PROPOSITIONS_PAR_TOUR_MAX;
    const { count } = await supabase
      .from("ai_conversation_messages")
      .select("id", { count: "exact", head: true })
      .eq("conversation_id", conversationId);
    if (typeof count === "number" && count + placeParTour > MESSAGES_PAR_FIL_MAX) {
      return {
        statut: "erreur",
        question,
        message:
          `Cette conversation approche de ses ${MESSAGES_PAR_FIL_MAX} messages et n'a plus la ` +
          "place d'un échange complet. Ouvrez-en une nouvelle — elle repartira de zéro, comme toujours.",
      };
    }

    // ---- LA QUEUE, AVANT LE QUOTA ------------------------------------
    //
    // Elle est lue AVANT de consommer le quota, contrairement au reste
    // des données : c'est UN appel de fonction, et il peut à lui seul
    // refuser la question. Faire payer une question qu'on va refuser
    // serait la seule chose pire que la refuser.
    //
    // ET UNE QUEUE ILLISIBLE ARRÊTE TOUT. Sans mémoire, la réponse
    // repartirait de zéro pendant que l'écran affiche le fil entier
    // sous une phrase qui promet le contraire. C'est exactement le
    // mensonge que ce module existe pour empêcher : on préfère ne pas
    // répondre.
    queue = await lireQueueDuFil(conversationId);
    if (queue.illisible) {
      return {
        statut: "erreur",
        question,
        message:
          "La mémoire de cette conversation n'a pas pu être relue. Rien n'a été envoyé : " +
          "Oasis aurait répondu sans les tours précédents, alors que l'écran les affiche. " +
          "Réessayez dans un instant, ou ouvrez une nouvelle conversation.",
      };
    }
  }

  // ---- 4. Le quota mensuel, avant toute autre lecture de données ----
  const quota = await consommerQuota(identite.organizationId);
  if (!quota.autorise) {
    return { statut: "erreur", question, message: quota.message ?? "Plafond atteint." };
  }

  // ---- 5. Le fil neuf, s'il en fallait un ---------------------------
  let filNeuf = false;
  if (conversationId === null) {
    const { data, error } = await supabase
      .from("ai_conversations")
      .insert({ organization_id: identite.organizationId, user_id: identite.userId })
      .select("id")
      .single();
    if (error || !data) {
      return {
        statut: "erreur",
        question,
        message: messageDeBase(error?.message) ?? "La conversation n'a pas pu être ouverte.",
      };
    }
    conversationId = String(data.id);
    filNeuf = true;
  }

  // ---- 6. L'aiguillage, déterministe (la queue est déjà lue) --------
  const aiguillage = aiguiller(question, null);

  // ---- 7. L'appel ----------------------------------------------------
  let sortie: ReponseAgent;
  try {
    const runtime = await runtimeAgents(identite);
    sortie = await runtime.executer({
      agent: aiguillage.agent,
      question,
      criticite: "ordinaire",
      routage: aiguillage.complexite ? { complexity: aiguillage.complexite } : {},
      // LE FIL, DANS LA FORME NATIVE DU SDK. C'est ici que la promesse
      // du module devient vraie : les tours précédents ne sont pas
      // affichés, ils sont ENVOYÉS. Le runtime les compte dans
      // `tailleCaracteres`, donc dans l'estimation de dépense et dans
      // les seuils du routeur, et il ne les transmet PAS aux
      // spécialistes qu'il interrogerait ensuite.
      historique: historiqueModele(queue),
      // PAS DE CACHE SUR UNE CONVERSATION, et la raison est plus forte
      // ici qu'ailleurs : deux fils différents posant la même question
      // n'attendent pas la même réponse, puisque leur passé diffère.
      // Servir une réponse d'archive dans un fil vivant serait absurde
      // même quand c'est exact.
      cache: null,
      decisionId: null,
    });
  } catch (erreur) {
    return { statut: "erreur", question, message: messagePourEchec(erreur) };
  }

  // LES AVERTISSEMENTS, DES DEUX SOURCES — le contrat de `composerSortie`,
  // recopié plutôt que réinventé. Ils portent « Analyse partielle : le
  // droit X manque », le repli sur un modèle dégradé, l'alerte de
  // plafond, et surtout le message que le runtime déclare obligatoire
  // quand il a RETIRÉ un montant introuvable dans les données lues.
  // Sans lui, l'utilisateur voit une recommandation sans chiffre et
  // croit qu'Oasis n'a pas su estimer.
  const avertissements = [...sortie.execution.avertissements, ...sortie.avertissements];

  if (!sortie.execution.ok) {
    return {
      statut: "erreur",
      question,
      message: sortie.execution.message,
      avertissements: avertissements.length > 0 ? avertissements : undefined,
    };
  }

  // ---- 8. Ce qu'on écrit dans le fil ---------------------------------
  const substance = substanceDe(sortie.sortie);
  const contenu =
    (substance === null ? "" : composerContenu(substance)) ||
    reponseDeSecours(sortie.outilsUtilises.length);
  const niveau = sortie.execution.tentative?.niveau ?? null;
  const outils = [...new Set(sortie.outilsUtilises)].slice(0, OUTILS_PAR_MESSAGE_MAX);

  // LES ACTIONS PRÉPARÉES, PHOTOGRAPHIÉES POUR LE FIL.
  //
  // Le résumé et le montant viennent du moteur d'actions, composés hors
  // modèle. C'est la photo : elle ne bougera plus. L'état — encore à
  // valider, exécuté, expiré — se relit en base à l'affichage
  // (`lireApprobations`), parce que lui change après coup.
  const actionsPreparees: ActionPreparee[] = sortie.actions
    .slice(0, ACTIONS_PAR_TOUR_MAX)
    .map((action) => ({
      actionId: action.actionId,
      approvalId: action.approvalId,
      libelle: action.label,
      resume: action.resume,
      montantCents: action.montantCents,
    }));

  const couche = composerCouche(
    substance ?? { resume: "", confiance: null, ambigu: false, recommandations: [], donneesManquantes: [] },
    avertissements,
    actionsPreparees,
  );

  // UNE SEULE ACTION RATTACHÉE À LA COLONNE, ET SEULEMENT QUAND IL N'Y
  // EN A QU'UNE. La colonne est singulière et porte une clé étrangère ;
  // désigner arbitrairement la première de trois ferait dire au fil
  // « cette réponse a produit ceci » en taisant les deux autres. Les
  // trois, elles, sont toutes dans `payload.actions`, qui n'a pas cette
  // contrainte — et c'est de là que les boutons du fil sont rendus.
  const actionUnique =
    sortie.actions.length === 1 ? (sortie.actions[0]?.actionId ?? null) : null;

  const lignes: Record<string, unknown>[] = [
    {
      organization_id: identite.organizationId,
      user_id: identite.userId,
      conversation_id: conversationId,
      role: "user",
      content: question,
    },
    {
      organization_id: identite.organizationId,
      user_id: identite.userId,
      conversation_id: conversationId,
      role: "assistant",
      content: contenu.slice(0, LONGUEUR_REPONSE_MAX),
      // LE NIVEAU, JAMAIS L'IDENTIFIANT DU MODÈLE (spec p. 27).
      // « economy » explique pourquoi une réponse a coûté ce qu'elle a
      // coûté ; « gpt-quelque-chose » n'apprend rien et devient faux au
      // premier changement de fournisseur.
      model: niveau,
      // `null` et `[]` ne disent pas la même chose : ici on SAIT, même
      // quand la liste est vide.
      tools_used: outils,
      action_id: actionUnique,
      payload: {
        analyse: {
          confiance: couche.confiance,
          ambigu: couche.ambigu,
          raisons: couche.raisons,
        },
        avertissements: couche.avertissements,
        actions: couche.actions,
      },
    },
  ];

  for (const proposition of sortie.propositions.slice(0, PROPOSITIONS_PAR_TOUR_MAX)) {
    const resumeProposition = describeProposal(proposition);
    lignes.push({
      organization_id: identite.organizationId,
      user_id: identite.userId,
      conversation_id: conversationId,
      role: "assistant",
      content: `${resumeProposition.headline} — ${resumeProposition.effect}`.slice(
        0,
        LONGUEUR_REPONSE_MAX,
      ),
      model: niveau,
      proposal: { kind: proposition.kind, args: proposition.args },
      proposal_status: "pending",
    });
  }

  // LES LIGNES PARTENT DANS L'ORDRE, EN UN SEUL APPEL. PostgREST
  // insère un tableau dans une seule instruction, donc dans une seule
  // transaction implicite : la question et sa réponse arrivent ensemble
  // ou pas du tout. Deux appels séparés auraient pu laisser une
  // question orpheline dans le fil.
  const { error: erreurEcriture } = await supabase.from("ai_conversation_messages").insert(lignes);

  if (erreurEcriture) {
    // LA RÉPONSE EXISTE ET A ÉTÉ PAYÉE ; c'est le fil qui n'a pas pu la
    // garder. On le dit tel quel plutôt que de faire croire à un échec
    // de l'assistant — et on rend la réponse dans le message, pour
    // qu'elle ne soit pas perdue avec la ligne.
    return {
      statut: "erreur",
      question,
      message:
        `Oasis a répondu, mais la conversation n'a pas pu être enregistrée : ` +
        `${messageDeBase(erreurEcriture.message) ?? erreurEcriture.message}\n\n${contenu}`,
      avertissements: avertissements.length > 0 ? avertissements : undefined,
    };
  }

  revalidatePath(CHEMIN_CONVERSATIONS);
  revalidatePath(`${CHEMIN_CONVERSATIONS}/${conversationId}`);
  // Une action préparée depuis la conversation change aussi ce que
  // l'accueil doit montrer.
  if (sortie.actions.length > 0) revalidatePath("/oasis-ai");

  if (filNeuf) redirect(`${CHEMIN_CONVERSATIONS}/${conversationId}`);
  return { statut: "repos" };
}

// ==================================================================
// 4. Répondre à une proposition conservée dans le fil
// ==================================================================

/**
 * « Non merci » sur une proposition.
 *
 * Un refus explicite plutôt qu'une carte qu'on ignore : sans lui, une
 * proposition déclinée resterait « en attente » pour toujours dans le
 * fil, et rouvrir la conversation dans six mois montrerait un bouton
 * qui n'attend plus rien.
 */
/**
 * « Oui » sur une proposition conservée dans un fil.
 *
 * ─── POURQUOI CETTE FONCTION ENVELOPPE `confirmProposal` ───
 *
 * L'écriture métier n'a pas changé d'un iota : c'est la même Server
 * Action que §11U, la même liste blanche de `kind`, la même fonction
 * SQL qui revérifie la permission et le cloisonnement. Ce qui s'ajoute
 * est UNIQUEMENT la trace : marquer la ligne du fil, pour que rouvrir
 * la conversation dans six mois montre « fait » plutôt qu'un bouton
 * qui n'attend plus rien.
 *
 * L'ORDRE COMPTE, ET IL EST DANS CE SENS. On écrit d'abord, on marque
 * ensuite. Marquer avant laisserait, si l'écriture échoue, une
 * proposition affichée comme exécutée alors que rien ne l'a été — le
 * pire des deux mensonges possibles ici.
 *
 * Et le marquage qui échoue est SILENCIEUX, pour la raison symétrique :
 * l'écriture métier a déjà eu lieu. Faire échouer la confirmation parce
 * que la ligne d'historique n'a pas pu être marquée dirait à
 * l'utilisateur que rien n'a été créé, alors que tout l'a été.
 */
export async function confirmerPropositionDuFil(
  precedent: ConfirmResult,
  formData: FormData,
): Promise<ConfirmResult> {
  const resultat = await confirmProposal(precedent, formData);

  if (resultat.status === "done") {
    const messageId = String(formData.get("messageId") ?? "");
    const conversationId = String(formData.get("conversationId") ?? "");
    // LE `kind` VOYAGE JUSQU'AU MARQUAGE, et il y est revérifié contre
    // la ligne : marquer « fait » sur un message qui portait une AUTRE
    // proposition ferait mentir l'historique du fil.
    const kind = String(formData.get("kind") ?? "");
    if (messageId && conversationId && kind) {
      await marquerProposition(messageId, conversationId, kind, "executed");
    }
    if (conversationId) revalidatePath(`${CHEMIN_CONVERSATIONS}/${conversationId}`);
  }

  return resultat;
}

export async function refuserProposition(formData: FormData) {
  await requireOrganization();
  const messageId = String(formData.get("messageId") ?? "");
  const conversationId = String(formData.get("conversationId") ?? "");
  const kind = String(formData.get("kind") ?? "");
  if (!messageId || !conversationId || !kind) return;

  await marquerProposition(messageId, conversationId, kind, "declined");
  revalidatePath(`${CHEMIN_CONVERSATIONS}/${conversationId}`);
}

// ==================================================================
// 5. Répondre, DEPUIS LE FIL, à une action préparée
// ==================================================================

/**
 * Le même « Valider et exécuter » que l'accueil, à sa vraie place.
 *
 * ─── POURQUOI CE MINCE ENVELOPPEMENT EXISTE ───
 *
 * `answerApproval` est l'écriture, et elle ne change pas : elle relit la
 * ligne d'approbation en base, filtrée sur l'organisation de la session,
 * et n'exécute que l'acte que cette ligne désigne. Le formulaire ne
 * porte donc que `approvalId` et le oui/non — rien de forgeable.
 *
 * Ce qui s'ajoute est UNIQUEMENT le rafraîchissement du fil. Sans lui,
 * cliquer depuis la conversation laissait le bouton en place jusqu'au
 * rechargement suivant, sur une approbation déjà consommée.
 *
 * ─── ET POURQUOI LE BOUTON DOIT ÊTRE ICI ───
 *
 * Parce qu'une approbation expire en vingt-quatre heures. Le seul
 * bouton vivait sur l'autre onglet, sous « Demandes venues d'une
 * conversation », et rien ne l'annonçait depuis le fil : une expiration
 * qui court sur un écran que l'utilisateur ne sait pas devoir ouvrir
 * n'est pas une confirmation. §11U avait corrigé exactement ce défaut ;
 * le changement de moteur l'avait réintroduit.
 */
export async function repondreApprobationDuFil(formData: FormData) {
  const conversationId = String(formData.get("conversationId") ?? "");
  await answerApproval(formData);
  if (conversationId) revalidatePath(`${CHEMIN_CONVERSATIONS}/${conversationId}`);
}

// ==================================================================
// Lectures d'appoint
// ==================================================================

// ==================================================================
// Petits utilitaires
// ==================================================================

/**
 * LA SORTIE STRUCTURÉE, RAMENÉE À CE QUE LE FIL EN FAIT.
 *
 * Les deux formes de sortie se ressemblent assez pour être traitées
 * ensemble : la Direction range ses recommandations sous `decisions`,
 * un spécialiste sous `recommandations`, et les éléments sont le MÊME
 * `DecisionRecommendationSchema` de part et d'autre.
 *
 * On lit `estimatedImpactCents` et jamais `estimatedImpact`, qui est du
 * texte libre : le premier est vérifié contre les montants réellement
 * lus par les outils (le runtime retire un chiffre qu'aucune source ne
 * contient, et le dit en avertissement), le second ne l'est pas.
 */
function substanceDe(sortie: AnalyseAgent | SortieExecutive | null): SubstanceReponse | null {
  if (sortie === null) return null;

  const recommandations =
    "decisions" in sortie ? sortie.decisions : sortie.recommandations;

  return {
    resume: sortie.resume,
    confiance: sortie.confidence,
    ambigu: sortie.ambigu,
    donneesManquantes: sortie.donneesManquantes,
    recommandations: recommandations.map((r) => ({
      titre: r.title,
      impactCents: r.estimatedImpactCents,
      actionRecommandee: r.suggestedActionLabel,
      pourquoi: r.summary,
      raisons: r.reasons,
    })),
  };
}

/**
 * Ce qu'on écrit quand le modèle a répondu sans résumé lisible.
 *
 * Pas « une erreur est survenue » : l'appel a abouti, il a été payé, et
 * des outils ont peut-être été lus. On dit ce qui s'est passé, sans
 * inventer une conclusion à la place du modèle.
 */
function reponseDeSecours(outils: number): string {
  return outils > 0
    ? "Oasis a lu vos données mais n'a rien conclu de lisible. Reformulez la question : " +
        "il vaut mieux le dire que composer une réponse à sa place."
    : "Oasis n'a rien conclu de lisible, et n'a lu aucune donnée. Reformulez la question.";
}

/** Les refus de Postgres sont écrits en français dans les migrations ; ils remontent tels quels. */
function messageDeBase(message: string | undefined): string | null {
  if (!message) return null;
  if (message.includes("row-level security")) {
    return "Votre rôle ne permet plus d'écrire dans vos conversations. Demandez le droit correspondant.";
  }
  if (message.includes("does not exist") || message.includes("schema cache")) {
    return "Les conversations ne sont pas encore installées sur cette base (migration 0079 en attente).";
  }
  return message;
}
