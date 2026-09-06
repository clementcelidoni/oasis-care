import type { CleAgentModele } from "../types.ts";

/**
 * §11Z — LES CONSOMMATEURS QUI NE RÉPONDENT À PERSONNE.
 *
 * ══════════════════════════════════════════════════════════════════
 * POURQUOI UNE TROISIÈME LISTE, ALORS QUE DEUX SUFFISAIENT
 * ══════════════════════════════════════════════════════════════════
 *
 * §11Y tenait les quatorze agents de la spec p. 5 dans deux listes
 * exclusives : `AGENTS_CONSTRUITS` (il a un fichier, la base accepte
 * son nom) et `AGENTS_SANS_DONNEES` (il n'a rien derrière, la base
 * refuse son nom). Les deux listes étaient tenues ensemble par un
 * invariant simple et juste : un agent est dans l'une OU dans l'autre,
 * jamais dans les deux, jamais dans aucune.
 *
 * §11Z a fait entrer `classification` dans la migration 0088, et cet
 * invariant est devenu MATHÉMATIQUEMENT INSATISFIABLE. La démonstration
 * tient en trois lignes, et elle vaut la peine d'être écrite parce que
 * c'est le genre de contradiction qu'on « répare » en désarmant un test
 * plutôt qu'en tranchant :
 *
 *   • `classification` ne peut PAS entrer dans `AGENTS_CONSTRUITS` :
 *     ce n'est pas un `DefinitionAgent`. Il n'a ni mission, ni limites
 *     conversationnelles, ni droits attendus, ni mots-clés — et son
 *     propre fichier (`agents/classification.ts`) s'interdit d'en
 *     avoir, parce qu'un mot-clé le rendrait joignable, donc capable de
 *     répondre, donc concurrent des treize autres.
 *
 *   • Il ne peut PAS rester dans `AGENTS_SANS_DONNEES` : cette liste
 *     porte la promesse « la base refuse son nom », et un test la
 *     défend. Or 0088 accepte désormais son nom.
 *
 *   • Il ne peut PAS être nulle part : l'invariant exige que les
 *     quatorze soient quelque part, et cet invariant est ce qui empêche
 *     un agent d'exister à moitié.
 *
 * ══════════════════════════════════════════════════════════════════
 * CE QUE LA TROISIÈME CATÉGORIE DIT, ET POURQUOI C'EST UTILE
 * ══════════════════════════════════════════════════════════════════
 *
 * « Il dépense, il ne répond pas. »
 *
 * Ce n'est pas une case de rangement inventée pour faire passer un
 * test : c'est la description exacte de ce qui se passait déjà, et que
 * personne ne pouvait écrire. Le routeur de modèles attribue depuis
 * toujours un niveau à `classification` (`lib/ai/model/configuration.ts`,
 * niveau « economy »), et `runtime/preprocessing.ts` dépense sous ce
 * nom à chaque classement en lots. Pendant ce temps la base REFUSAIT ce
 * nom dans `ai_model_overrides` : on ne pouvait ni épingler son modèle,
 * ni plafonner sa dépense.
 *
 * C'est là, et nulle part ailleurs, que 0088 apporte quelque chose à
 * `classification` : pas une capacité de plus, un CONTRÔLE de plus sur
 * une dépense qui existait déjà. Un agent qu'on facture et qu'on ne
 * peut pas régler est précisément le genre de ligne qui se découvre sur
 * une facture.
 *
 * ══════════════════════════════════════════════════════════════════
 * LA GARDE QUE CETTE LISTE PORTE, ET QUI EST SON VRAI INTÉRÊT
 * ══════════════════════════════════════════════════════════════════
 *
 * Y figurer n'est pas un laissez-passer : c'est une INTERDICTION
 * écrite. Un agent non répondant n'a pas le droit d'avoir de mots-clés
 * d'aiguillage, pas le droit d'avoir un plan de contexte, pas le droit
 * d'avoir un outil au registre — et `agents/index.test.ts` vérifie les
 * trois. Sans cette liste, le jour où quelqu'un ajouterait un mot-clé à
 * `classification` « pendant qu'il y est », rien ne l'arrêterait : il
 * deviendrait le quatorzième répondeur, sur le dos des treize autres,
 * et le seul symptôme serait une réponse un peu creuse.
 */

export type AgentNonRepondant = {
  cle: CleAgentModele;
  /** Son nom français, pour l'écran. Le même que `LIBELLES_AGENT`. */
  libelle: string;
  /** Ce qu'il fait réellement, en une phrase. */
  role: string;
  /**
   * POURQUOI LA BASE ACCEPTE SON NOM ALORS QU'IL NE RÉPOND PAS.
   *
   * La question se posera, et la réponse est la seule justification
   * valable : il dépense. Sans elle, la ligne dans
   * `ai_is_supported_agent` ressemblerait à un oubli de ménage.
   */
  pourquoiEnBase: string;
  /**
   * OÙ IL DÉPENSE RÉELLEMENT, fichier par fichier.
   *
   * Mesurable, donc contestable. Une dépense qu'on ne peut pas situer
   * est une dépense qu'on ne peut pas réduire.
   */
  depenseDans: readonly string[];
};

export const AGENTS_NON_REPONDANTS: readonly AgentNonRepondant[] = Object.freeze([
  {
    cle: "classification",
    libelle: "Classement et aiguillage",
    role:
      "Désigne l'agent à qui une question s'adresse, et attribue une catégorie aux éléments " +
      "dont le type n'est pas déjà connu. Il ne lit aucune table métier, ne produit aucun " +
      "chiffre et ne répond à aucune question : il tourne AVANT la conversation, pas dedans.",
    pourquoiEnBase:
      "Parce qu'il dépense. Le routeur lui attribue le niveau le moins cher depuis la Phase " +
      "11V et `preprocessing.ts` consomme sous son nom, mais `ai_model_overrides` refusait ce " +
      "nom : sa dépense était facturée et ni plafonnable ni épinglable. 0088 ouvre le nom pour " +
      "cette seule raison — un contrôle sur une dépense existante, pas une capacité nouvelle.",
    depenseDans: [
      // L'aiguillage d'une question libre : un appel de modèle
      // seulement si aucune règle de mots-clés ne tranche.
      "app/api/oasis-ai/aiguillage.ts",
      // Le classement en lots : règles déterministes d'abord, modèle
      // pour le reste seulement. Sur les tables d'aujourd'hui la règle
      // traite tout et le modèle n'est jamais appelé.
      "lib/ai/runtime/preprocessing.ts",
    ],
  },
]);

/**
 * Vrai si cet agent consomme des jetons sans jamais répondre.
 *
 * Employé par `index.test.ts` pour la garde des trois catégories, et
 * par la lecture de la migration : un nom accepté par
 * `ai_is_supported_agent` est soit un répondeur, soit l'un de ceux-ci.
 */
export function estAgentNonRepondant(valeur: unknown): boolean {
  return (
    typeof valeur === "string" && AGENTS_NON_REPONDANTS.some((entree) => entree.cle === valeur)
  );
}
