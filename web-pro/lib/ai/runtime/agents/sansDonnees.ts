import type { CleAgentModele } from "../types.ts";

/**
 * §11Y / §11Z — LE MÉCANISME DE DÉCLARATION D'UN AGENT SANS MATIÈRE.
 *
 * ══════════════════════════════════════════════════════════════════
 * CETTE LISTE EST VIDE AUJOURD'HUI, ET C'EST UN RÉSULTAT
 * ══════════════════════════════════════════════════════════════════
 *
 * §11Y y déclarait quatre agents — `sales`, `market`, `risk`,
 * `classification` — avec, pour chacun, le motif mesuré de son absence
 * et ce qu'il faudrait livrer d'abord. C'était une bonne déclaration :
 * elle disait « pas encore, et voici pourquoi » là où le silence aurait
 * laissé croire à un oubli.
 *
 * Le dirigeant a tranché contre cet avis et demandé les quatre. Ils
 * sont construits (§11Z), donc les quatre entrées sont RETIRÉES : une
 * déclaration d'indisponibilité pour un agent qui répond serait un
 * mensonge, et de tous les mensonges c'est le plus difficile à
 * découvrir, puisqu'il ne casse rien.
 *
 * Les trois répondeurs sont dans `AGENTS_CONSTRUITS` (`types.ts`) ;
 * `classification`, qui dépense sans répondre, est dans
 * `AGENTS_NON_REPONDANTS` (`nonRepondants.ts`) — la troisième catégorie
 * que son entrée en base a rendue nécessaire.
 *
 * ══════════════════════════════════════════════════════════════════
 * POURQUOI LE FICHIER RESTE, PLUTÔT QUE D'ÊTRE SUPPRIMÉ
 * ══════════════════════════════════════════════════════════════════
 *
 * Pour deux raisons, et aucune n'est la nostalgie.
 *
 *   1. LA RÈGLE VAUT ENCORE POUR LE PROCHAIN. Elle n'a pas été démentie
 *      par ce chantier : UN AGENT SANS DONNÉES EST UNE FAÇADE, ET UNE
 *      FAÇADE EST PIRE QUE RIEN — elle rend une phrase polie que
 *      personne ne peut contredire, et elle consomme un appel de modèle
 *      pour la produire. Ce que §11Z a démontré, c'est qu'on peut
 *      parfois construire un agent sur des tables presque vides À
 *      CONDITION qu'il dise franchement ce qu'il ne sait pas — pas que
 *      la façade soit devenue acceptable. Le prochain agent que la spec
 *      nommera sans matière derrière se déclarera ici.
 *
 *   2. L'INVARIANT QU'ELLE PORTE RESTE ARMÉ. `index.test.ts` exige
 *      qu'aucune entrée de cette liste ne soit acceptée par
 *      `ai_is_supported_agent`. Sur une liste vide l'assertion passe
 *      sans rien vérifier — mais elle attrapera la première
 *      contradiction du jour où quelqu'un déclarera un agent
 *      indisponible tout en ouvrant son nom en base « pendant qu'il y
 *      est ». C'est exactement la contradiction que `classification` a
 *      produite en §11Z, et qui a coûté une catégorie entière à
 *      démêler.
 *
 * Le type et la garde ci-dessous sont donc conservés tels quels : ce
 * n'est pas du code mort, c'est un mécanisme au repos.
 */

export type AgentSansDonnees = {
  cle: CleAgentModele;
  /** Son nom français, pour l'écran. Le même que `LIBELLES_AGENT`. */
  libelle: string;
  /**
   * POURQUOI IL N'EST PAS CONSTRUIT — mesuré, pas supposé.
   *
   * En une phrase que le dirigeant peut lire. Le détail long vit dans
   * les commentaires du sondage, pas dans une propriété affichée.
   */
  motif: string;
  /**
   * CE QU'IL FAUDRAIT LIVRER D'ABORD, dans l'ordre.
   *
   * C'est la partie utile de la déclaration : « pas encore » sans
   * condition de levée est un refus définitif déguisé en délai.
   */
  aLivrerDabord: readonly string[];
};

/**
 * LES AGENTS DÉCLARÉS SANS MATIÈRE. AUCUN, AUJOURD'HUI.
 *
 * Vide n'est pas « rien à dire » : c'est « les quatorze de la spec ont
 * tous trouvé leur camp ». Treize répondent (`AGENTS_CONSTRUITS`), un
 * dépense sans répondre (`AGENTS_NON_REPONDANTS`), zéro est une façade.
 */
export const AGENTS_SANS_DONNEES: readonly AgentSansDonnees[] = Object.freeze([]);

/** Vrai si cet agent est déclaré sans données (donc jamais construit). */
export function estAgentSansDonnees(valeur: unknown): boolean {
  return (
    typeof valeur === "string" && AGENTS_SANS_DONNEES.some((entree) => entree.cle === valeur)
  );
}
