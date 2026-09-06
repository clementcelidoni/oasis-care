import type { CleAgentModele, Permission } from "../types.ts";

/**
 * §11Y — LE VOCABULAIRE COMMUN AUX FICHIERS D'AGENTS.
 *
 * ══════════════════════════════════════════════════════════════════
 * POURQUOI CE DOSSIER EXISTE : UN FICHIER PAR AGENT
 * ══════════════════════════════════════════════════════════════════
 *
 * Les quatre premiers agents vivaient dans UN SEUL objet littéral, au
 * milieu de `definitions.ts`. C'était juste tant qu'ils étaient quatre
 * et qu'une seule personne les écrivait. Ils sont dix, et plusieurs
 * personnes les écrivent EN MÊME TEMPS : un objet littéral unique
 * garantit que le dernier à enregistrer écrase les autres, ou que
 * chaque fusion se joue au corps à corps sur la même accolade.
 *
 * Le découpage n'est donc pas une préférence de rangement. C'est la
 * condition pour que dix agents puissent être écrits en parallèle sans
 * qu'aucun ne dépende d'un fichier que les neuf autres modifient.
 *
 * ─── LA RÈGLE QUI EN DÉCOULE, ET QUI TIENT TOUT ───
 *
 * `index.ts` compose. Il ne se remplit plus. Après ce chantier, un
 * constructeur d'agent ne touche QUE `agents/<son agent>.ts` — sa
 * définition, ses limites, ses mots-clés d'aiguillage. Tout le reste
 * — la liste, le type, la graphie SQL, les instructions, le routage —
 * se déduit de son fichier sans que personne n'ait à l'inscrire
 * quelque part d'autre.
 *
 * Les deux exceptions sont NOMMÉES, et elles le sont ici pour que
 * personne ne les découvre en fusionnant :
 *
 *   • `runtime/context.ts` (`PLANS`) — les sources pré-lues d'un agent
 *     restent centralisées A DESSEIN : c'est la liste unique de tout ce
 *     qui SORT de l'entreprise à chaque appel, et son intérêt est
 *     précisément qu'on puisse la relire d'un seul regard. L'éclater en
 *     dix fichiers rendrait cette relecture impossible. Un agent qui a
 *     besoin d'un plan y ajoute UNE clé, et cette clé doit être relue.
 *
 *   • `runtime/tools.ts` — le catalogue d'outils, pour la même raison.
 *
 * ══════════════════════════════════════════════════════════════════
 * §11Z — LES QUATORZE, EN TROIS CATÉGORIES ET NON PLUS DEUX
 * ══════════════════════════════════════════════════════════════════
 *
 * La spec p. 5 nomme quatorze agents ; `AGENTS_MODELE`
 * (`lib/ai/model/types.ts`) leur donne à tous un niveau de modèle, ce
 * qui est juste — un niveau se décide avant l'agent.
 *
 * §11Y en avait construit dix et déclaré quatre « sans données ». Le
 * dirigeant a tranché contre cet avis et demandé les quatre derniers.
 * Ils sont livrés, mais PAS DE LA MÊME MANIÈRE, et la différence n'est
 * pas un détail de rangement : elle est la raison pour laquelle deux
 * catégories ne suffisaient plus.
 *
 *   • TREIZE SONT DES RÉPONDEURS. `sales`, `market` et `risk`
 *     rejoignent les dix : un fichier, une mission, des limites, une
 *     fonction SQL derrière (0088), une place dans l'aiguillage. Ils
 *     sont dans `AGENTS_CONSTRUITS`.
 *
 *   • UN N'EST PAS UN RÉPONDEUR, ET NE DOIT PAS LE DEVENIR.
 *     `classification` est l'étape de pré-traitement (spec p. 31) :
 *     elle tourne AVANT la conversation, désigne l'agent à qui la
 *     question s'adresse, et s'efface. Lui donner une mission, des
 *     mots-clés et des droits en ferait un quatorzième répondeur sur
 *     les treize autres — exactement ce que son propre fichier
 *     s'interdit. Elle est donc dans `AGENTS_NON_REPONDANTS`
 *     (`agents/nonRepondants.ts`), pas ici.
 *
 *   • ZÉRO EST « SANS DONNÉES ». `AGENTS_SANS_DONNEES` existe toujours
 *     et est VIDE : le mécanisme reste écrit pour le prochain agent que
 *     la spec nommerait sans matière derrière, mais aucun des quatorze
 *     n'est aujourd'hui dans ce cas.
 *
 * LA RÈGLE QUI TIENT LES TROIS : chacun des quatorze est dans EXACTEMENT
 * UNE des trois listes, et `agents/index.test.ts` le vérifie. C'est ce
 * qui empêche qu'un agent existe à moitié — accepté par la base et
 * introuvable dans le code, ou l'inverse.
 */

/**
 * LES TREIZE AGENTS RÉPONDEURS QUI ONT UN FICHIER, DANS L'ORDRE DE LA
 * SPEC p. 5.
 *
 * C'est la SEULE liste des répondeurs. Le type, la garde
 * `estAgentConstruit`, la lecture des réglages (`runtime/supabase.ts`),
 * le schéma de la route (`/api/oasis-ai/demander`) et la moitié
 * « répondeurs » de la contrainte SQL (0088, `ai_is_supported_agent`)
 * en découlent tous.
 *
 * Y figurer ne veut pas dire « fini » : plusieurs sont encore des
 * gabarits, et le disent eux-mêmes par `aCompleter`. Y figurer veut
 * dire « il y a de la matière derrière, et la base accepte son nom ».
 *
 * LE QUATORZIÈME — `classification` — N'Y EST PAS, ET C'EST VOULU. Voir
 * `agents/nonRepondants.ts` : il consomme des jetons sans jamais
 * répondre, donc la base doit connaître son nom pour que sa dépense
 * soit plafonnable, sans que le code lui donne une mission.
 */
export const AGENTS_CONSTRUITS = [
  "executive",
  "finance",
  "billing",
  "quotePricing",
  "sales",
  "operations",
  "planning",
  "procurement",
  "nursery",
  "fleet",
  "customer",
  "market",
  "risk",
] as const satisfies readonly CleAgentModele[];

export type AgentConstruit = (typeof AGENTS_CONSTRUITS)[number];

export function estAgentConstruit(valeur: unknown): valeur is AgentConstruit {
  return typeof valeur === "string" && (AGENTS_CONSTRUITS as readonly string[]).includes(valeur);
}

/**
 * La graphie de la base pour un agent.
 *
 * LE PIÈGE EST RÉEL ET IL A DÉJÀ COÛTÉ : la spec écrit `quotePricing`,
 * la base écrit `quote_pricing` (0072). Une action enregistrée sous la
 * mauvaise graphie est refusée par la contrainte `check
 * (ai_is_supported_agent(agent))` — après avoir payé l'appel de modèle.
 *
 * Les six clés ajoutées en 0082 n'ont, elles, qu'une seule graphie :
 * `operations`, `planning`, `procurement`, `nursery`, `fleet`,
 * `customer` s'écrivent pareil des deux côtés. C'est une chance, pas
 * une règle — la table reste donc explicite plutôt que calculée, et un
 * test relit les migrations pour vérifier que chaque valeur y est.
 */
export const CLE_BASE = {
  executive: "executive",
  finance: "finance",
  billing: "billing",
  quotePricing: "quote_pricing",
  operations: "operations",
  planning: "planning",
  procurement: "procurement",
  nursery: "nursery",
  fleet: "fleet",
  customer: "customer",
  // §11Z — LES TROIS DE 0088 ONT, ELLES AUSSI, UNE SEULE GRAPHIE.
  // Vérifié dans la migration et non supposé : 0088 écrit 'sales',
  // 'market' et 'risk' exactement comme le TypeScript. La table reste
  // explicite pour la même raison qu'en §11Y — une règle « camel →
  // tiret bas » marcherait par accident sur douze des treize et
  // cacherait `quotePricing`, le seul qui compte.
  sales: "sales",
  market: "market",
  risk: "risk",
  // `as const satisfies` et non `: Record<AgentConstruit, string>` :
  // `satisfies` vérifie que les dix clés y sont TOUTES (un agent oublié
  // ne compile pas), et `as const` garde la valeur littérale plutôt que
  // de l'élargir en `string`. C'est ce qui permet à un écran indexé par
  // la graphie SQL — `AGENT_LABELS`, `AGENT_MISSIONS` — d'accepter
  // `CLE_BASE[agent]` sans conversion, donc sans l'endroit où une
  // conversion mentirait.
} as const satisfies Record<AgentConstruit, string>;

export type DefinitionAgent = {
  cle: AgentConstruit;
  libelle: string;
  /** Ce qu'il surveille, en une phrase. Sert aussi de `handoffDescription`. */
  mission: string;
  /** Ses responsabilités, telles que la fonction Edge les écrivait. */
  responsabilites: string;
  /** Ce qu'il NE fait pas. Recopié de la fonction Edge, mot pour mot. */
  limites: readonly string[];
  /** Ce que ses fonctions exigent de l'appelant (lu dans les `ai_guard` de 0073). */
  droitsAttendus: readonly Permission[];
  /**
   * LES MOTS QUI L'APPELLENT DANS UNE QUESTION LIBRE.
   *
   * Ils vivent ICI et non dans `app/api/oasis-ai/aiguillage.ts` pour la
   * raison qui a fait ce dossier : dix agents qui ajoutent chacun leur
   * règle au même tableau, c'est dix conflits sur le même tableau.
   * L'aiguilleur garde ce qui lui appartient vraiment — l'ORDRE dans
   * lequel les agents sont essayés, qui est un arbitrage entre eux et
   * qu'aucun d'eux ne peut décider seul.
   *
   * Un mot ambigu ne s'écrit pas. « prix » appartient autant au
   * chiffrage qu'à la facturation : mieux vaut tomber sur la Direction,
   * qui ira demander aux deux, que sur le mauvais spécialiste, qui
   * répondra à côté avec aplomb. Un test refuse qu'un même mot soit
   * revendiqué par deux agents.
   *
   * Vide (ou absent) = l'agent n'est jamais atteint par une question
   * libre. C'est l'état juste d'un gabarit : on ne le fait pas répondre
   * avant qu'il ait quelque chose à dire.
   */
  motsCles?: readonly string[];
  /**
   * VRAI TANT QUE CE FICHIER EST UN GABARIT.
   *
   * Le drapeau est porté par le fichier de l'agent, et par lui seul :
   * celui qui finit l'agent le retire sans toucher à rien d'autre, donc
   * sans croiser le travail des neuf autres.
   *
   * Il ne bride RIEN à l'exécution — un gabarit qu'on appelle
   * explicitement répond, et il répondra pauvrement, ce qui est
   * l'information utile. Il sert à ce que l'écran des réglages dise
   * « en construction » au lieu de laisser croire à un agent prêt, et à
   * ce qu'un test puisse compter ce qui reste à faire.
   */
  aCompleter?: boolean;
};
