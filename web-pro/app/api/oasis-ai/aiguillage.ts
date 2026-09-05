import { DEFINITIONS, type AgentConstruit } from "@/lib/ai/runtime";
import type { ComplexiteTache } from "@/lib/ai/model";

/**
 * §11V, §11Y — À QUEL AGENT UNE QUESTION S'ADRESSE.
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
 * L'ORDRE DANS LEQUEL LES AGENTS SONT ESSAYÉS — ET RIEN D'AUTRE.
 *
 * ══════════════════════════════════════════════════════════════════
 * LES MOTS-CLÉS NE SONT PLUS ÉCRITS ICI. C'EST §11Y
 * ══════════════════════════════════════════════════════════════════
 *
 * Ils vivent dans le fichier de chaque agent (`runtime/agents/*.ts`),
 * et cette liste ne dit plus que l'ORDRE. La raison est la même que
 * celle qui a fait éclater `definitions.ts` : dix agents qui ajoutent
 * chacun sa règle au même tableau, ce sont dix conflits sur le même
 * tableau, et celui qui fusionne en dernier arbitre sans le savoir.
 *
 * L'ordre, lui, reste ICI parce qu'il n'appartient à AUCUN agent : il
 * est un arbitrage ENTRE eux, et aucun ne peut le décider seul. C'est
 * précisément la question « qui gagne quand deux mots tombent dans la
 * même phrase », et elle se tranche à un seul endroit.
 *
 * ─── CE QUE L'ORDRE DÉCIDE, CONCRÈTEMENT ───
 *
 * « facturer un devis signé » contient « factur » et « devis » : la
 * facturation gagne, et c'est bien elle qu'on interroge. « facture en
 * retard » ne doit jamais partir aux Chantiers sous prétexte que le
 * mot « retard » y ressemble — d'où la facturation en tête, et d'où
 * l'interdiction, dans les fichiers d'agents, d'y écrire un mot nu
 * comme « retard ».
 *
 * La Direction reste EN DERNIER : ses mots sont les plus généraux du
 * lot (« la situation », « aujourd'hui »), et ils ne doivent gagner
 * contre aucun mot précis.
 *
 * ─── LES GABARITS N'ONT PAS DE MOTS, ET C'EST VOULU ───
 *
 * Six des dix agents sont encore des gabarits : leur `motsCles` est
 * absent, donc `reglesActives()` ne produit aucune règle pour eux et
 * une question libre ne les atteint jamais. On ne fait pas répondre un
 * agent avant qu'il ait quelque chose à dire. Le jour où l'un d'eux est
 * fini, son auteur écrit ses mots dans SON fichier, et l'aiguillage
 * s'allume sans que personne touche à celui-ci.
 */
const ORDRE: readonly AgentConstruit[] = Object.freeze([
  // Les précis d'abord, du plus spécifique au plus général.
  "billing",
  "quotePricing",

  // ─── LA FINANCE EST REMONTÉE ICI, ET C'EST UNE CORRECTION ───
  //
  // Elle fermait la marche juste avant la Direction, ce qui allait de
  // soi tant que six des dix agents étaient muets. Dès que les
  // Chantiers, la Pépinière et le Matériel ont reçu leurs mots, l'ordre
  // s'est retourné contre lui-même : « quelle rentabilité sur ce
  // chantier ? » partait aux Chantiers sur le mot « chantier », et
  // « mes dépenses de pépinière » à la Pépinière sur le mot
  // « pépinière ». Mesuré en exécutant le vrai `aiguiller()`, pas
  // déduit.
  //
  // LE CRITÈRE N'EST PAS « QUI EST LE PLUS PRÉCIS » MAIS « QUI A LA
  // SOURCE ». Aucun autre agent n'agrège d'argent : les Chantiers
  // portent une limite qui dit « ni marge ni budget, ils appartiennent
  // à la Finance », la Pépinière une autre qui dit « ne connaît aucun
  // prix d'achat », le Matériel une troisième qui refuse tout coût
  // d'usage. Les laisser gagner sur un mot d'argent, c'est remplacer un
  // agent qui répond par un agent qui décline poliment — et faire payer
  // l'appel de modèle pour ce refus.
  //
  // Et « la marge du chantier Dupont » a bien une réponse côté Finance :
  // `analyzeProjectMargin`, un outil par chantier qu'elle est seule à
  // posséder. Ce n'était donc pas un arbitrage entre deux bonnes
  // réponses, c'était le choix de la mauvaise.
  //
  // La Facturation et le Chiffrage restent AVANT elle : « facture »,
  // « impayé » et « devis » sont plus précis que « marge », et leurs
  // agents ont, eux aussi, la source correspondante.
  "finance",

  "procurement",
  "nursery",
  "fleet",
  "planning",
  "operations",
  "customer",
  // La Direction ferme la marche : voir l'en-tête.
  "executive",
]);

/**
 * Les règles réellement actives, construites depuis les définitions.
 *
 * Recalculée à chaque appel plutôt que mémorisée : `DEFINITIONS` est
 * figé au démarrage, le coût est celui de dix lectures de propriété, et
 * un cache ici ne servirait qu'à faire diverger les tests du produit.
 */
function reglesActives(): readonly Regle[] {
  const regles: Regle[] = [];
  for (const agent of ORDRE) {
    const mots = DEFINITIONS[agent].motsCles;
    if (mots === undefined || mots.length === 0) continue;
    regles.push({ agent, motsCles: mots });
  }
  return regles;
}

/**
 * Normalisation : minuscules, accents retirés.
 *
 * Les accents sont retirés des DEUX côtés — de la question et des
 * mots-clés — sans quoi « trésorerie » tapé sans accent ne
 * correspondrait à rien. Les fichiers d'agents portent volontairement les
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

  for (const regle of reglesActives()) {
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
