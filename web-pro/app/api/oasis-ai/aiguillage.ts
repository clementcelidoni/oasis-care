import type { AgentConstruit } from "@/lib/ai/runtime";
import type { ComplexiteTache } from "@/lib/ai/model";

/**
 * §11V — À QUEL AGENT UNE QUESTION S'ADRESSE.
 *
 * ══════════════════════════════════════════════════════════════════
 * AUCUN MODÈLE N'EST APPELÉ POUR CHOISIR L'AGENT
 * ══════════════════════════════════════════════════════════════════
 *
 * C'est la règle « outils déterministes avant IA » (p. 11-12) appliquée
 * à l'aiguillage lui-même. Un aiguilleur de langage naturel coûterait
 * un appel de modèle SUR CHAQUE QUESTION, avant même de commencer à
 * répondre — donc une ligne au journal, une dépense au budget, et une
 * latence, pour une décision que quinze mots-clés tranchent presque
 * toujours.
 *
 * ══════════════════════════════════════════════════════════════════
 * CE QUI SE PASSE QUAND LES MOTS-CLÉS NE TRANCHENT PAS
 * ══════════════════════════════════════════════════════════════════
 *
 * On envoie à la DIRECTION, qui est le seul agent capable d'interroger
 * les autres : une question qu'on n'a pas comprise ne doit pas être
 * confiée à un spécialiste qui n'aura pas les bonnes sources et
 * répondra « je ne vois rien » avec assurance.
 *
 * MAIS on l'envoie avec `complexity: "simple"`, ce qui DÉCALE la
 * Direction d'un cran vers le bas — `advanced` devient `standard`
 * (`router.ts`). Le raisonnement : on ne paie pas le modèle le plus
 * cher pour découvrir ce qu'on nous demande. Et si la question était
 * réellement difficile, l'escalade s'en charge — `escalation.ts` monte
 * sur ambiguïté déclarée, risque élevé ou impact ≥ 5 000 €. On paie
 * donc cher quand on sait que c'est cher, jamais par précaution.
 *
 * Sans ce décalage, toute question mal formulée partirait sur le modèle
 * avancé, et le ratio visé par la page 17 — « ~5 % Sol » — serait faux
 * dès la première semaine.
 */

/** Le résultat de l'aiguillage. */
export type Aiguillage = {
  agent: AgentConstruit;
  /** `undefined` = laisser le routeur appliquer le niveau configuré de l'agent. */
  complexite: ComplexiteTache | undefined;
  /** Ce qui a décidé, en français, pour la trace et pour l'écran. */
  raison: string;
};

type Regle = {
  agent: AgentConstruit;
  /** Les mots qui désignent cet agent SANS ambiguïté. */
  motsCles: readonly string[];
};

/**
 * LES RÈGLES, DANS L'ORDRE OÙ ELLES SONT ESSAYÉES.
 *
 * Elles sont volontairement courtes et sans finesse. Un mot ambigu —
 * « prix », qui appartient autant au chiffrage qu'à la facturation —
 * n'est PAS dans la liste : il vaut mieux tomber sur la Direction, qui
 * ira demander aux deux, que sur le mauvais spécialiste, qui répondra à
 * côté avec aplomb.
 *
 * L'ordre compte pour les questions qui portent plusieurs mots :
 * « facturer un devis signé » contient « factur » et « devis », et
 * c'est la facturation qui gagne — c'est bien elle qu'on interroge.
 */
const REGLES: readonly Regle[] = Object.freeze([
  {
    agent: "billing",
    motsCles: [
      "factur",
      "à facturer",
      "impay",
      "encaiss",
      "relance de paiement",
      "avoir",
      "brouillon de facture",
    ],
  },
  {
    agent: "quotePricing",
    motsCles: ["devis", "chiffrage", "chiffrer", "taux de marque", "grille tarifaire", "sous-tarif"],
  },
  {
    agent: "finance",
    motsCles: [
      "chiffre d'affaires",
      "chiffre d affaires",
      "marge",
      "tresorerie",
      "trésorerie",
      "créance",
      "creance",
      "rentabilit",
      "dépense",
      "depense",
      "objectif",
      "budget",
    ],
  },
  {
    agent: "executive",
    motsCles: [
      "que dois-je faire",
      "priorit",
      "brief",
      "aujourd'hui",
      "aujourd hui",
      "situation",
      "résum",
      "resum",
      "quoi de neuf",
      "urgent",
    ],
  },
]);

/**
 * Normalisation : minuscules, accents retirés.
 *
 * Les accents sont retirés des DEUX côtés — de la question et des
 * mots-clés — sans quoi « trésorerie » tapé sans accent ne
 * correspondrait à rien. La liste ci-dessus porte volontairement les
 * deux graphies là où l'usage hésite, mais la normalisation est ce qui
 * rend cela sûr plutôt qu'exhaustif.
 */
export function normaliser(texte: string): string {
  return texte
    .toLowerCase()
    .normalize("NFD")
    .replace(DIACRITIQUES, "");
}

/**
 * Les diacritiques combinantes que `NFD` isole (U+0300 à U+036F).
 *
 * Écrites en points de code, et pas en classe littérale : la classe
 * littérale équivalente contient des caractères combinants nus, qui se
 * collent au crochet précédent dans tous les éditeurs et rendent la
 * ligne illisible — donc invérifiable à la relecture.
 */
const DIACRITIQUES = new RegExp(
  `[${String.fromCharCode(0x300)}-${String.fromCharCode(0x36f)}]`,
  "g",
);

/**
 * L'agent à qui poser la question.
 *
 * `agentDemande` gagne toujours : quand l'écran sait de quoi il parle —
 * la page d'un devis, l'écran de facturation — il n'y a rien à deviner.
 */
export function aiguiller(question: string, agentDemande?: AgentConstruit | null): Aiguillage {
  if (agentDemande) {
    return {
      agent: agentDemande,
      complexite: undefined,
      raison: `Agent imposé par l'appelant : ${agentDemande}.`,
    };
  }

  const normalisee = normaliser(question);

  for (const regle of REGLES) {
    for (const mot of regle.motsCles) {
      if (normalisee.includes(normaliser(mot))) {
        return {
          agent: regle.agent,
          complexite: undefined,
          raison: `Aiguillé vers « ${regle.agent} » sur le mot « ${mot} ».`,
        };
      }
    }
  }

  return {
    agent: "executive",
    // Voir l'en-tête : on ne paie pas le modèle le plus cher pour
    // découvrir ce qu'on nous demande. L'escalade montera si la
    // Direction déclare l'ambiguïté ou si l'enjeu est réel.
    complexite: "simple",
    raison:
      "Aucun mot-clé décisif : la question part à la Direction, d'un cran en dessous de son " +
      "niveau habituel. Elle escaladera si elle déclare la situation ambiguë.",
  };
}
