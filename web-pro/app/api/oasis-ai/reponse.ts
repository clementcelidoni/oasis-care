import { MESSAGE_INDISPONIBLE, type ResultatAgent } from "@/lib/ai/runtime";
import type { ReponseAgent } from "@/lib/ai/runtime/agents";
import { describeProposal } from "@/lib/ai/proposals";

/**
 * §11V — CE QUI SORT DES ROUTE HANDLERS, ET CE QUI N'EN SORT PAS.
 *
 * ══════════════════════════════════════════════════════════════════
 * L'UTILISATEUR NE VOIT PAS « GPT-5.6 TERRA » (spec p. 27)
 * ══════════════════════════════════════════════════════════════════
 *
 * « L'utilisateur final ne voit PAS GPT-5.6 Terra partout. Il voit
 * simplement : Oasis AI. Le choix du modèle est interne. »
 *
 * Cette fonction est l'endroit où cette phrase devient vraie ou fausse,
 * parce que c'est le dernier endroit où l'identifiant du modèle existe.
 * Elle rend donc un NIVEAU (`economy`, `standard`, `advanced`) et
 * jamais un identifiant. Le niveau reste utile — il explique pourquoi
 * une réponse a coûté plus cher, et il alimente l'écran
 * d'administration — mais il ne nomme aucun produit d'aucun
 * fournisseur.
 *
 * Le corollaire tient tout seul : le jour où l'identifiant du niveau
 * standard devient autre chose, aucun écran ne change, aucun test de
 * bout en bout ne casse, et personne n'a de capture d'écran à refaire.
 *
 * (Ce commentaire ne NOMME pas cet identifiant, et ce n'est pas de la
 * coquetterie : `router.test.ts` relit `lib/` et `app/` et refuse tout
 * fichier hors du routeur où les trois noms sont écrits. Les citer même
 * en prose ferait de ce fichier un endroit de plus à corriger le jour
 * où ils changent — précisément ce que le test défend.)
 *
 * ══════════════════════════════════════════════════════════════════
 * CE QUI NE SORT PAS NON PLUS
 * ══════════════════════════════════════════════════════════════════
 *
 * Ni le contexte envoyé au modèle, ni les données lues, ni l'empreinte
 * des sources. La réponse porte les CONCLUSIONS et les SOURCES par leur
 * nom — pas leur contenu. Un écran qui voudrait montrer les chiffres
 * les demande aux mêmes fonctions SQL, sous les droits de celui qui
 * regarde ; les faire transiter par la réponse de l'IA les ferait
 * échapper à ce contrôle.
 */

export type SortieRoute = {
  agent: string;
  /** `deterministe`, `cache` ou `modele`. Dit si Oasis a réellement réfléchi. */
  origine: string;
  /** Le NIVEAU employé, jamais l'identifiant du modèle. */
  niveau: string | null;
  /** La sortie structurée de l'agent. */
  resultat: unknown;
  outilsUtilises: readonly string[];
  actions: readonly unknown[];
  propositions: readonly unknown[];
  /** Un appel par spécialiste consulté, avec son niveau et son coût. */
  delegations: readonly {
    agent: string;
    niveau: string | null;
    origine: string | null;
    coutEstimeCents: number | null;
  }[];
  /** Le coût estimé, en centimes entiers, ou `null` si un niveau n'est pas tarifé. */
  coutEstimeCents: number | null;
  /** Spec p. 21 : sur quelles données la réponse est fondée. */
  dateArreteDonnees: string | null;
  /** Repli, cache tiède, droits manquants, journal en panne. */
  avertissements: readonly string[];
  /** Le nombre de questions restantes ce mois-ci, ou `null` si inconnu. */
  questionsRestantes: number | null;
};

export function composerSortie(
  reponse: ReponseAgent,
  questionsRestantes: number | null,
): SortieRoute {
  const execution = reponse.execution;

  return {
    agent: reponse.agent,
    origine: execution.ok ? execution.origine : "aucune",
    niveau: execution.ok ? (execution.tentative?.niveau ?? null) : null,
    resultat: reponse.sortie,
    outilsUtilises: reponse.outilsUtilises,
    actions: reponse.actions.map(actionPublique),
    propositions: reponse.propositions.map((proposition) => {
      const resume = describeProposal(proposition);
      return {
        kind: proposition.kind,
        args: proposition.args,
        // Composé À PARTIR DES PARAMÈTRES, jamais de la prose du
        // modèle. C'est ce qui fait qu'une donnée empoisonnée ne peut
        // pas réécrire l'étiquette du bouton — la règle de §11U, qu'on
        // ne change pas en migrant.
        recapitulatif: resume,
      };
    }),
    delegations: reponse.delegations.map((d) => ({
      agent: d.agent,
      niveau: d.execution.ok ? (d.execution.tentative?.niveau ?? null) : null,
      origine: d.execution.ok ? d.execution.origine : null,
      coutEstimeCents: d.execution.coutEstimeCents,
    })),
    coutEstimeCents: totalAvecDelegations(reponse),
    dateArreteDonnees: execution.ok ? execution.dateArreteDonnees : null,
    avertissements: [...execution.avertissements, ...reponse.avertissements],
    questionsRestantes,
  };
}

/**
 * Une action, telle que l'écran a le droit de la voir.
 *
 * `parameters` n'en fait PAS partie. Ils contiennent des identifiants
 * d'entités et parfois des montants ; l'écran n'a besoin que de savoir
 * quoi afficher sur le bouton et quel identifiant d'approbation
 * consommer. Le récapitulatif détaillé, lui, se relit en base par
 * `getConversationApprovals`, sous les droits de celui qui regarde.
 */
function actionPublique(action: {
  actionId: string;
  approvalId: string | null;
  actionType: string;
  label: string;
  agent: string;
  risque: string;
  confirmationRequise: boolean;
  statut: string;
  resume: string;
  montantCents: number | null;
}) {
  return {
    actionId: action.actionId,
    approvalId: action.approvalId,
    actionType: action.actionType,
    label: action.label,
    agent: action.agent,
    risque: action.risque,
    confirmationRequise: action.confirmationRequise,
    statut: action.statut,
    resume: action.resume,
    montantCents: action.montantCents,
  };
}

/**
 * Le coût de la question ENTIÈRE, délégations comprises.
 *
 * Un brief de direction qui interroge trois spécialistes coûte quatre
 * appels. N'annoncer que celui de la Direction ferait afficher le quart
 * de la dépense, et le tableau de bord des coûts (p. 18) ne
 * correspondrait pas à ce que l'écran vient de dire.
 *
 * `null` CONTAMINE : si un seul appel n'est pas tarifé, le total est
 * inconnu, pas plus petit. Même règle qu'`ai_cost_budget_remaining`.
 */
export function totalAvecDelegations(reponse: ReponseAgent): number | null {
  const couts = [
    reponse.execution.coutEstimeCents,
    ...reponse.delegations.map((d) => d.execution.coutEstimeCents),
  ];
  let total = 0;
  for (const cout of couts) {
    if (cout === null) return null;
    total += cout;
  }
  return total;
}

/**
 * L'échec, mis en mots.
 *
 * ─── LE STATUT HTTP DIT DE QUI EST LA FAUTE ───
 *
 *   403 — un droit manque. C'est réparable par un administrateur.
 *   429 — un plafond, de requêtes ou de dépense. Réparable par le temps
 *         ou par un réglage.
 *   503 — le fournisseur. Réparable par personne, sauf en réessayant.
 *   500 — nous.
 *
 * Un 500 uniforme ferait chercher une panne là où il y a un réglage.
 */
export function statutPour(execution: Extract<ResultatAgent, { ok: false }>): number {
  switch (execution.motif) {
    case "droits_manquants":
      return 403;
    case "budget_exceeded":
      return 429;
    case "rate_limit":
      return 429;
    case "model_unavailable":
    case "timeout":
    case "provider_error":
      return 503;
    default:
      return 500;
  }
}

/**
 * Le message d'un échec technique inattendu.
 *
 * ─── AUCUN DÉTAIL NE SORT ───
 *
 * Le message d'origine part dans le journal du serveur et s'arrête là.
 * Une erreur de fournisseur peut porter un fragment de requête, un
 * identifiant d'organisation, parfois une clé tronquée ; tout ce qui
 * entre dans une réponse HTTP finit dans une console de navigateur,
 * puis dans une capture d'écran.
 *
 * L'exception est nommée : « migration en attente ». Ce message-là est
 * écrit par nous (`messageLisible` de `runtime/supabase.ts`), il ne
 * contient rien de l'erreur d'origine, et il est le seul qui dise à la
 * personne qui déploie ce qu'elle doit faire.
 */
export function messagePourEchec(erreur: unknown): string {
  const detail = erreur instanceof Error ? erreur.message : String(erreur);
  console.error(`[oasis-ai] appel d'agent interrompu : ${detail}`);

  if (detail.includes("migration en attente")) {
    return (
      "Le suivi des coûts IA n'est pas encore installé sur cette base : la migration 0076 " +
      "n'a pas été appliquée. Oasis refuse d'appeler un modèle sans savoir compter la dépense."
    );
  }
  return MESSAGE_INDISPONIBLE;
}
