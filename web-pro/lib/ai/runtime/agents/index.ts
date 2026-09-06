import { AGENTS_CONSTRUITS, type AgentConstruit, type DefinitionAgent } from "./types.ts";

import { AGENT_DIRECTION } from "./executive.ts";
import { AGENT_FINANCE } from "./finance.ts";
import { AGENT_FACTURATION } from "./billing.ts";
import { AGENT_DEVIS_ET_PRIX } from "./quotePricing.ts";
import { AGENT_CHANTIERS } from "./operations.ts";
import { AGENT_PLANNING } from "./planning.ts";
import { AGENT_ACHATS } from "./procurement.ts";
import { AGENT_PEPINIERE } from "./nursery.ts";
import { AGENT_MATERIEL } from "./fleet.ts";
import { AGENT_CLIENTS } from "./customer.ts";
// §11Z — LES TROIS RÉPONDEURS DE 0088.
import { AGENT_VENTES } from "./sales.ts";
import { AGENT_HISTORIQUE_INTERNE } from "./market.ts";
import { AGENT_RISQUES } from "./risk.ts";

/**
 * §11Y / §11Z — LA COMPOSITION DES TREIZE AGENTS RÉPONDEURS.
 *
 * ══════════════════════════════════════════════════════════════════
 * CE FICHIER NE BOUGE PLUS, ET C'EST TOUT SON INTÉRÊT
 * ══════════════════════════════════════════════════════════════════
 *
 * Il importe les dix, il les assemble, il s'arrête là. Après ce
 * chantier, celui qui finit un agent ne touche QUE `agents/<le
 * sien>.ts` : sa définition, ses limites, ses mots-clés, le retrait de
 * son `aCompleter`. Rien à inscrire ici, rien à inscrire dans un type,
 * rien à inscrire dans une liste ailleurs.
 *
 * C'est la condition pour que plusieurs personnes écrivent leurs
 * agents EN MÊME TEMPS. Le fichier unique qu'ils partageaient — un
 * objet littéral de dix entrées au milieu de `definitions.ts` — leur
 * garantissait un conflit sur la même accolade à chaque fusion.
 *
 * Les deux seuls fichiers partagés qui restent sont NOMMÉS dans
 * `types.ts`, et ils le sont à dessein : `runtime/tools.ts` (le
 * catalogue d'outils) et `runtime/context.ts` (`PLANS`, la liste unique
 * de tout ce qui sort de l'entreprise à chaque appel). Les éclater en
 * dix rendrait impossible la relecture d'un seul regard, qui est
 * précisément ce à quoi ils servent.
 *
 * ══════════════════════════════════════════════════════════════════
 * POURQUOI UN TABLEAU PUIS UNE CARTE, ET PAS UN OBJET ÉCRIT À LA MAIN
 * ══════════════════════════════════════════════════════════════════
 *
 * La carte est CONSTRUITE à partir du tableau, et chaque définition y
 * entre sous SA PROPRE clé (`definition.cle`), jamais sous une clé
 * recopiée à côté. Une recopie autoriserait le seul défaut que ce
 * découpage pourrait introduire : le fichier de la Pépinière rangé
 * sous « fleet » par une ligne mal dupliquée, et un agent Matériel qui
 * parlerait de stock. Le test vérifie en plus que les dix clés
 * attendues sont là et qu'aucune ne manque à l'appel.
 *
 * ══════════════════════════════════════════════════════════════════
 * UNE AMBIGUÏTÉ DE CHEMIN, NOMMÉE PARCE QU'ELLE VA SE PRÉSENTER
 * ══════════════════════════════════════════════════════════════════
 *
 * `runtime/agents.ts` (le RUNTIME des agents, qui tire le SDK) et
 * `runtime/agents/` (ce dossier, les DÉFINITIONS) portent le même nom à
 * l'extension près. Deux fichiers écrivent déjà
 * `@/lib/ai/runtime/agents` sans extension — `app/api/oasis-ai/reponse.ts`
 * et `lib/ai/conversations/actions.ts` — et ils visent le RUNTIME.
 *
 * Ils continuent de l'atteindre : TypeScript, le bundler de Next et le
 * crochet d'alias des tests essaient tous `agents.ts` AVANT
 * `agents/index.ts`. Ce n'est donc pas cassé, et le rebaptême de l'un
 * des deux n'entre pas dans ce chantier.
 *
 * Mais la règle à suivre ici est simple, et elle évite d'avoir à s'en
 * souvenir : depuis `runtime/`, on importe ce dossier en écrivant
 * `./agents/index.ts` — chemin complet, sans ambiguïté possible.
 */

/**
 * Les treize répondeurs, dans l'ordre de la spec p. 5.
 *
 * LE QUATORZIÈME N'EST PAS ICI, ET IL NE FAUT PAS L'Y METTRE.
 * `classification` n'est pas un `DefinitionAgent` : il n'a ni mission,
 * ni limites conversationnelles, ni droits attendus, et lui en donner
 * le rendrait joignable — donc concurrent des treize. Il est déclaré
 * dans `nonRepondants.ts`, avec la raison pour laquelle la base
 * connaît quand même son nom.
 */
const TOUS: readonly DefinitionAgent[] = Object.freeze([
  AGENT_DIRECTION,
  AGENT_FINANCE,
  AGENT_FACTURATION,
  AGENT_DEVIS_ET_PRIX,
  AGENT_VENTES,
  AGENT_CHANTIERS,
  AGENT_PLANNING,
  AGENT_ACHATS,
  AGENT_PEPINIERE,
  AGENT_MATERIEL,
  AGENT_CLIENTS,
  AGENT_HISTORIQUE_INTERNE,
  AGENT_RISQUES,
]);

function composer(): Readonly<Record<AgentConstruit, DefinitionAgent>> {
  const carte = {} as Record<AgentConstruit, DefinitionAgent>;

  for (const definition of TOUS) {
    // Sous SA clé, pas sous une clé recopiée. Voir l'en-tête.
    carte[definition.cle] = definition;
  }

  // UN AGENT DE LA LISTE SANS FICHIER EST UNE PANNE DE DÉMARRAGE, PAS
  // UNE DONNÉE MANQUANTE. `DEFINITIONS[agent]` serait `undefined`, et
  // `instructionsPour` lirait `.libelle` dessus : le message d'erreur
  // parlerait d'une propriété, six appels plus loin, sans nommer
  // l'agent. On préfère refuser ici, une fois, en le nommant.
  for (const cle of AGENTS_CONSTRUITS) {
    if (carte[cle] === undefined) {
      throw new Error(
        `Agent « ${cle} » déclaré dans AGENTS_CONSTRUITS mais aucun fichier ne le définit : ` +
          "ajoutez-le à l'import et au tableau de `agents/index.ts`.",
      );
    }
  }

  return Object.freeze(carte);
}

/**
 * LES TREIZE DÉFINITIONS.
 *
 * `droitsAttendus` n'est pas « les droits de l'agent » : un agent n'en
 * a aucun (il agit avec ceux de l'utilisateur). C'est ce que ses
 * fonctions SQL exigent de l'appelant. Un droit qui manque ne fait pas
 * échouer l'agent — il rétrécit ce qu'il peut dire, et l'instruction
 * lui ordonne de le dire.
 */
export const DEFINITIONS = composer();

/**
 * Les agents dont le fichier est encore un gabarit.
 *
 * Déduit du drapeau que chaque fichier porte, jamais recopié : une
 * seconde liste serait une seconde vérité, et c'est toujours la
 * seconde qui ment. L'écran de réglages s'en sert pour dire « en
 * construction » plutôt que de laisser croire à un agent prêt.
 */
export const AGENTS_A_COMPLETER: readonly AgentConstruit[] = Object.freeze(
  TOUS.filter((d) => d.aCompleter === true).map((d) => d.cle),
);

/**
 * LES AGENTS QU'UN APPELANT A LE DROIT D'IMPOSER.
 *
 * ══════════════════════════════════════════════════════════════════
 * POURQUOI CETTE LISTE EXISTE, ET CE QU'ELLE A REFERMÉ
 * ══════════════════════════════════════════════════════════════════
 *
 * Un gabarit n'a pas de mots-clés, donc l'aiguilleur ne le rend jamais.
 * On pouvait croire l'affaire close : elle ne l'était pas. La route
 * `/api/oasis-ai/demander` accepte un champ `agent`, et cet agent-là
 * GAGNE TOUJOURS — « Agent imposé par l'appelant » court-circuite
 * l'aiguillage entier. Tant que le schéma de la route acceptait les dix
 * clés, l'interrupteur « éteint » d'un gabarit était contournable par
 * un seul champ de requête.
 *
 * Le périmètre s'était même ÉLARGI sans qu'on le veuille : avant §11Y
 * la route n'acceptait que les quatre premiers agents, parce que la
 * liste des agents construits n'en comptait que quatre. La faire passer
 * à dix a ouvert les six autres par effet de bord.
 *
 * Ce que cela coûterait : un raisonnement complet payé pour un agent
 * sans source — et, pour les Achats, la mise en main du modèle de leur
 * outil d'écriture (`createPurchaseOrderDraft`) alors que l'agent est
 * déclaré non construit.
 *
 * La liste est DÉRIVÉE du même drapeau que le badge « En construction »
 * de l'écran des réglages. Un agent redevient donc inatteignable par
 * TOUS les chemins d'un seul geste — le retrait de son `aCompleter` — et
 * il n'y a aucune seconde liste à tenir à jour.
 */
export const AGENTS_JOIGNABLES: readonly [AgentConstruit, ...AgentConstruit[]] = Object.freeze(
  TOUS.filter((d) => d.aCompleter !== true).map((d) => d.cle),
) as unknown as readonly [AgentConstruit, ...AgentConstruit[]];

export {
  AGENTS_CONSTRUITS,
  CLE_BASE,
  estAgentConstruit,
  type AgentConstruit,
  type DefinitionAgent,
} from "./types.ts";

export {
  AGENTS_SANS_DONNEES,
  estAgentSansDonnees,
  type AgentSansDonnees,
} from "./sansDonnees.ts";

// §11Z — LA TROISIÈME CATÉGORIE. Un agent que la base accepte, qui
// dépense des jetons, et qui ne répond à personne. Voir
// `nonRepondants.ts` pour la démonstration de sa nécessité : sans
// elle, `classification` ne pouvait satisfaire aucune des deux
// listes existantes, et la suite de tests restait rouge quoi qu'on en
// fasse.
export {
  AGENTS_NON_REPONDANTS,
  estAgentNonRepondant,
  type AgentNonRepondant,
} from "./nonRepondants.ts";
