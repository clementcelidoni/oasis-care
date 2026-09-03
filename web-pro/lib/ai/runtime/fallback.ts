import { LIBELLES_NIVEAU, decalerNiveau, rangNiveau } from "../model/types.ts";
import {
  LIBELLES_PANNE,
  MESSAGE_INDISPONIBLE,
  PANNES_FOURNISSEUR,
  causeProfonde,
  type Criticite,
  type InfoRepli,
  type MotifPanne,
  type NiveauModele,
  type NiveauRisque,
} from "./types.ts";

/**
 * §11V — LE REPLI (spec p. 23).
 *
 * ══════════════════════════════════════════════════════════════════
 * CE QUE LA PAGE 23 DEMANDE
 * ══════════════════════════════════════════════════════════════════
 *
 *     model unavailable · rate limit · timeout · provider error
 *
 *     Sol unavailable ↓ Terra
 *     « uniquement si la tâche peut raisonnablement être exécutée
 *      avec Terra. »
 *     Sinon : « Service temporairement indisponible. »
 *     « Ne pas dégrader silencieusement une décision critique. »
 *
 * ══════════════════════════════════════════════════════════════════
 * LE RACCOURCI QU'ON PREND SANS Y PENSER
 * ══════════════════════════════════════════════════════════════════
 *
 * Face à un modèle indisponible, la chose évidente à écrire est
 * `catch { return appeler(modeleMoinsCher) }`. Elle marche, elle passe
 * les tests, elle fait disparaître les incidents du journal. Et elle
 * est fausse d'une manière particulièrement vicieuse : le produit
 * continue de répondre, en moins bien, sans que personne ne le sache.
 * Un devis à 45 000 € analysé par le petit modèle rend une
 * recommandation d'apparence identique — même forme, même ton, même
 * assurance. C'est la panne qu'on ne découvre qu'en perdant l'affaire.
 *
 * Deux règles, donc, et elles sont l'inverse l'une de l'autre :
 *
 *   1. ON NE DÉGRADE PAS CE QUI COMPTE. Criticité déclarée, risque
 *      élevé ou critique, fort impact financier : pas de repli. Le
 *      produit dit « Service temporairement indisponible » et se tait.
 *      Une non-réponse est honnête ; une réponse dégradée ne l'est pas.
 *
 *   2. QUAND ON DÉGRADE, ÇA SE VOIT. Le repli n'est jamais un détail
 *      d'implémentation : il remonte dans `ResultatAgent.repli` (champ
 *      NON optionnel), il s'écrit dans `ai_usage_events.fallback_from_model`
 *      (colonne prévue par 0076 exactement pour cela), et il produit un
 *      avertissement en français destiné à l'écran.
 *
 * ══════════════════════════════════════════════════════════════════
 * LE CAS QUI N'EST PAS UNE PANNE
 * ══════════════════════════════════════════════════════════════════
 *
 * `budget_exceeded` ne donne JAMAIS lieu à un repli. Un modèle moins
 * cher dépense quand même, et la page 17 demande de ne pas brûler de
 * budget inutilement — pas d'en brûler moins. Le plafond se vérifie
 * AVANT l'appel (`cost.ts`) ; s'il est atteint, on ne cherche pas un
 * modèle plus économique, on refuse.
 */

// ==================================================================
// 1. Reconnaître la panne
// ==================================================================

/**
 * Classer une erreur dans le vocabulaire fermé de 0076.
 *
 * ─── AUCUN FRAGMENT DU MESSAGE D'ORIGINE NE RESSORT ───
 *
 * Cette fonction rend un MOTIF, jamais un texte. Les phrases destinées
 * à l'écran et au journal sont composées à partir du motif seul
 * (`LIBELLES_PANNE`). C'est la même règle que `availability.ts` : un
 * corps de réponse d'API peut contenir une clé, un identifiant
 * d'organisation ou un fragment de prompt, et tout ce qui entre dans un
 * message d'erreur finit dans un journal, puis dans une capture
 * d'écran.
 */
export function classerPanne(brute: unknown): MotifPanne {
  // ON DIAGNOSTIQUE LA CAUSE, PAS L'ENVELOPPE. `agents.ts` enveloppe
  // parfois une erreur du SDK pour lui attacher les jetons déjà payés
  // (`EchecAvecUsage`) ; classer l'enveloppe rangerait un « rate limit »
  // en « other », et le repli ne se déclencherait plus.
  const erreur = causeProfonde(brute);
  const statut = lireStatut(erreur);
  const nom = erreur instanceof Error ? erreur.name : "";
  const texte = texteDiagnostic(erreur);

  // L'annulation d'un `AbortController` est le délai dépassé le plus
  // fréquent, et son nom est le seul indice fiable.
  if (nom === "AbortError" || nom === "TimeoutError") return "timeout";

  if (statut === 429 || /\brate[ _-]?limit/i.test(texte) || /too many requests/i.test(texte)) {
    return "rate_limit";
  }

  if (
    statut === 404 ||
    /model[_ ]?not[_ ]?found/i.test(texte) ||
    /(unknown|unsupported|invalid) model/i.test(texte) ||
    /does not exist/i.test(texte)
  ) {
    return "model_unavailable";
  }

  if (
    /timed? ?out/i.test(texte) ||
    /ETIMEDOUT|ECONNRESET|ECONNABORTED|UND_ERR_(HEADERS|BODY)_TIMEOUT/i.test(texte)
  ) {
    return "timeout";
  }

  if (statut !== null && statut >= 500) return "provider_error";
  if (/ENOTFOUND|ECONNREFUSED|EAI_AGAIN|fetch failed|socket hang up/i.test(texte)) {
    return "provider_error";
  }

  // Un motif inconnu reste inconnu. Le ranger d'office en
  // « provider_error » ferait croire à une panne du fournisseur alors
  // qu'il s'agit peut-être d'un bug chez nous, et le tableau de bord
  // enverrait chercher au mauvais endroit.
  return "other";
}

function lireStatut(erreur: unknown): number | null {
  if (typeof erreur !== "object" || erreur === null) return null;
  const brut = (erreur as { status?: unknown; statusCode?: unknown }).status ??
    (erreur as { statusCode?: unknown }).statusCode;
  const n = typeof brut === "number" ? brut : Number(brut);
  return Number.isInteger(n) ? n : null;
}

/**
 * Le texte servant UNIQUEMENT à la reconnaissance de motif.
 *
 * Il ne sort pas de cette fonction : `classerPanne` ne rend qu'un
 * membre d'une énumération.
 */
function texteDiagnostic(erreur: unknown): string {
  if (erreur instanceof Error) {
    const cause = erreur.cause;
    const texteCause =
      cause instanceof Error ? ` ${cause.name} ${cause.message}` : cause === undefined ? "" : ` ${String(cause)}`;
    const code = (erreur as { code?: unknown }).code;
    return `${erreur.name} ${erreur.message}${texteCause}${code === undefined ? "" : ` ${String(code)}`}`;
  }
  return typeof erreur === "string" ? erreur : "";
}

// ==================================================================
// 2. Décider du repli
// ==================================================================

/**
 * Le seuil au-dessus duquel une décision ne se dégrade pas.
 *
 * Même valeur que l'escalade et que le routeur : 5 000 €. Trois seuils
 * différents pour la même notion de « fort impact » produiraient des
 * comportements qu'on ne saurait plus expliquer à personne.
 */
export const SEUIL_IMPACT_NON_DEGRADABLE_CENTIMES = 500_000;

const RISQUES_NON_DEGRADABLES: readonly NiveauRisque[] = ["high", "critical"];

export type DemandeRepli = {
  motif: MotifPanne;
  niveauActuel: NiveauModele;
  modeleActuel: string;
  /** `critique` interdit toute dégradation. */
  criticite: Criticite;
  risque?: NiveauRisque;
  /**
   * En CENTIMES ENTIERS.
   *
   * `null` ou absent = AUCUN MONTANT ANNONCÉ. Ce n'est pas un blocage :
   * la plupart des appels n'ont pas d'impact chiffrable, et `criticite`
   * est le signal obligatoire qui protège. En revanche, un montant
   * annoncé mais ILLISIBLE (`NaN`, négatif, flottant) fait refuser :
   * l'appelant a voulu dire quelque chose et s'est trompé, et on ne
   * dégrade pas sur une valeur qu'on n'a pas comprise.
   */
  impactFinancierCents?: number | null;
  /** Ce qui a déjà été essayé dans cet appel. */
  niveauxDejaEssayes?: readonly NiveauModele[];
  /**
   * Le niveau en dessous duquel on ne descend pas, même pour une tâche
   * ordinaire. Par défaut `economy`.
   */
  plancher?: NiveauModele;
};

export type DecisionRepli =
  | {
      replier: true;
      versNiveau: NiveauModele;
      /** À compléter par l'appelant, qui seul connaît l'identifiant du modèle. */
      construireInfo: (modeleCible: string) => InfoRepli;
    }
  | {
      replier: false;
      /** La phrase de la page 23, mot pour mot, destinée à l'utilisateur. */
      message: string;
      /** Pourquoi on n'a pas replié. Pour le journal et le support. */
      raison: string;
    };

/**
 * « Uniquement si la tâche peut raisonnablement être exécutée avec
 * Terra. » (p. 23)
 *
 * « Raisonnablement » ne se devine pas : il se DÉCLARE. Trois signaux,
 * tous fournis par l'appelant, aucun deviné à partir du texte de la
 * question :
 *
 *   • `criticite: "critique"` — l'appelant sait que cette réponse
 *     engage. Une analyse de devis avant envoi, un arbitrage de
 *     direction.
 *   • `risque` élevé ou critique — l'action proposée engage.
 *   • `impactFinancierCents` au-dessus du seuil — l'argent engage.
 *
 * LE SIGNAL QUI PROTÈGE VRAIMENT EST `criticite`, et c'est pour cela
 * qu'il est OBLIGATOIRE en amont (`DemandeExecution`). La plupart des
 * appels n'ont aucun montant à annoncer ; si l'absence de montant
 * bloquait le repli, le repli n'aurait jamais lieu et la page 23
 * n'existerait pas. L'appelant déclare donc ce qui est en jeu, une
 * fois, explicitement.
 *
 * En revanche, UN MONTANT ANNONCÉ MAIS ILLISIBLE fait refuser. C'est
 * l'inverse du réflexe habituel (`?? 0`, donc « en dessous du seuil »,
 * donc on dégrade) : quelqu'un a voulu dire quelque chose et s'est
 * trompé, et on ne dégrade pas sur une valeur qu'on n'a pas comprise.
 */
export function deciderRepli(demande: DemandeRepli): DecisionRepli {
  const { motif, niveauActuel } = demande;

  if (motif === "budget_exceeded") {
    return {
      replier: false,
      message:
        "Le plafond de dépense IA de votre entreprise est atteint. Un administrateur peut le relever.",
      raison: "Plafond atteint : un modèle moins cher dépenserait quand même.",
    };
  }

  // ── ON NE REPLIE QUE SUR LES QUATRE PANNES DE LA PAGE 23 ─────────
  //
  // « other » est le motif que `classerPanne` rend quand elle n'a rien
  // reconnu — et son propre commentaire dit pourquoi elle ne le range
  // pas d'office chez le fournisseur : « il s'agit peut-être d'un bug
  // chez nous ». Une sortie qui ne colle pas au schéma, un outil qui
  // lève, une erreur de programmation en sont.
  //
  // Or ces pannes-là sont DÉTERMINISTES : le modèle moins cher les
  // reproduira à l'identique. Replier dessus paie donc un second appel
  // complet pour obtenir la même erreur, et inscrit au grand livre un
  // `fallback_from_model` qui enverra chercher une panne de fournisseur
  // là où il y a un bug. C'est le même raisonnement qui interdit à
  // `insufficient_data` d'escalader : on ne repaie pas un appel pour
  // relire la même impasse.
  if (!PANNES_FOURNISSEUR.includes(motif)) {
    return {
      replier: false,
      message: MESSAGE_INDISPONIBLE,
      raison: `${LIBELLES_PANNE[motif]} : ce n'est pas une panne du fournisseur, un autre modèle échouerait pareil.`,
    };
  }

  if (demande.criticite === "critique") {
    return {
      replier: false,
      message: MESSAGE_INDISPONIBLE,
      raison: `Décision déclarée critique : ${LIBELLES_PANNE[motif]}, et une dégradation silencieuse est interdite (p. 23).`,
    };
  }

  if (demande.risque !== undefined && RISQUES_NON_DEGRADABLES.includes(demande.risque)) {
    return {
      replier: false,
      message: MESSAGE_INDISPONIBLE,
      raison: `Risque « ${demande.risque} » : ${LIBELLES_PANNE[motif]}, pas de dégradation.`,
    };
  }

  const brut = demande.impactFinancierCents;
  const annonceIllisible =
    brut !== undefined && brut !== null && !(Number.isInteger(brut) && brut >= 0);
  if (annonceIllisible) {
    return {
      replier: false,
      message: MESSAGE_INDISPONIBLE,
      raison:
        "Impact financier annoncé mais illisible : on ne dégrade pas une décision dont on ne sait pas ce qu'elle pèse.",
    };
  }
  const impact = lireImpact(brut);
  if (impact !== null && impact >= SEUIL_IMPACT_NON_DEGRADABLE_CENTIMES) {
    return {
      replier: false,
      message: MESSAGE_INDISPONIBLE,
      raison: `Impact de ${(impact / 100).toLocaleString("fr-FR", {
        style: "currency",
        currency: "EUR",
      })} : au-dessus du seuil, pas de dégradation.`,
    };
  }

  const plancher = demande.plancher ?? "economy";
  const cible = decalerNiveau(niveauActuel, -1);

  if (cible === niveauActuel || rangNiveau(cible) < rangNiveau(plancher)) {
    return {
      replier: false,
      message: MESSAGE_INDISPONIBLE,
      raison: `${LIBELLES_PANNE[motif]} au niveau « ${niveauActuel} » : aucun niveau inférieur disponible.`,
    };
  }

  if (demande.niveauxDejaEssayes?.includes(cible) === true) {
    return {
      replier: false,
      message: MESSAGE_INDISPONIBLE,
      raison: `Le niveau « ${cible} » a déjà échoué dans cet appel : le rappeler ferait deux pannes pour une réponse.`,
    };
  }

  return {
    replier: true,
    versNiveau: cible,
    construireInfo: (modeleCible: string): InfoRepli => ({
      deNiveau: niveauActuel,
      deModele: demande.modeleActuel,
      versNiveau: cible,
      versModele: modeleCible,
      motif,
      explication:
        `${LIBELLES_PANNE[motif]} : la réponse a été produite par un modèle moins puissant ` +
        // LES NIVEAUX SE DISENT EN FRANÇAIS. Cette phrase remonte
        // jusqu'à l'écran d'un paysagiste ; « economy » et « standard »
        // y étaient des identifiants internes, exposés au milieu d'une
        // phrase française alors que la table de libellés existe.
        `(niveau « ${LIBELLES_NIVEAU[cible]} » au lieu de « ${LIBELLES_NIVEAU[niveauActuel]} »). ` +
        "Relisez-la avant de vous en servir.",
    }),
  };
}

/**
 * L'avertissement destiné à l'écran quand un repli a eu lieu.
 *
 * Il existe en fonction séparée pour une raison simple : c'est la
 * phrase que l'utilisateur DOIT voir, et une phrase qu'on peut oublier
 * d'écrire est une dégradation silencieuse. `run.ts` la pose
 * systématiquement.
 */
export function avertissementRepli(repli: InfoRepli): string {
  return `Réponse dégradée — ${repli.explication}`;
}

function lireImpact(valeur: number | null | undefined): number | null {
  if (valeur === null || valeur === undefined) return null;
  return Number.isInteger(valeur) && valeur >= 0 ? valeur : null;
}
