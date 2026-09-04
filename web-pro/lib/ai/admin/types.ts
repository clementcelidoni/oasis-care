// Imports RELATIFS et non `@/lib/ai/model` : la barrière d'export du
// routeur réexporte `provider.ts`, donc `@openai/agents` et ses 66 Mo.
// Un test de `node --test` qui ne veut que la table des agents n'a pas
// à charger le SDK — et ne résout pas l'alias `@/` de toute façon.
import { normaliserCleAgent, type CleAgentModele } from "../model/types.ts";
import type { MotifPanne } from "../runtime/types.ts";

/**
 * §11V / §11X — LE VOCABULAIRE DE LA CONSOMMATION IA, CÔTÉ CLIENT.
 *
 * ══════════════════════════════════════════════════════════════════
 * PLUS AUCUN NOM DE MODÈLE NE S'ÉCRIT DANS OASIS CARE PRO
 * ══════════════════════════════════════════════════════════════════
 *
 * L'en-tête précédent de ce fichier disait l'inverse : « ce dossier est
 * le seul endroit du produit où un nom de modèle s'affiche », au nom de
 * la page 26 qui demandait un écran d'administration technique. Cette
 * page existe toujours — elle a simplement changé d'application.
 *
 * Le choix des modèles, les dérogations par entreprise, les tarifs de
 * jetons et les plafonds de dépense sont des décisions de L'ÉDITEUR :
 * c'est lui qui reçoit la facture du fournisseur. Les laisser côté
 * client revenait à confier le volant et le frein à celui qui ne paie
 * pas l'essence — et la migration 0080 a fermé ce chemin en base : plus
 * aucune politique d'écriture sur `ai_model_overrides` ni sur
 * `ai_cost_limits`, quatre fonctions `security definer` réservées aux
 * administrateurs de plateforme à la place.
 *
 * Ce dossier ne sert donc plus qu'à UNE chose : dire au client ce
 * qu'il consomme. Trois règles en découlent, et elles sont vérifiées
 * par `types.test.ts` :
 *
 *   1. Aucun identifiant de modèle, nulle part — ni en dur, ni lu, ni
 *      affiché. La lecture du grand livre (`lecture.ts`) ne demande
 *      même plus la colonne `model` : ce qu'on ne lit pas ne peut pas
 *      fuir dans une propriété React.
 *
 *   2. Aucun montant en euros. Ce que le grand livre chiffre, c'est le
 *      coût d'ACHAT de l'éditeur chez son fournisseur, pas le prix payé
 *      par le client. L'afficher livrerait la marge, et surtout ferait
 *      croire à une facture. Le client compte des questions, des
 *      appels et des jetons ; l'éditeur compte des euros, dans le
 *      Control Center.
 *
 *   3. L'agent porte son nom métier (« Facturation »), partout, y
 *      compris dans la ventilation de la consommation.
 *
 * ══════════════════════════════════════════════════════════════════
 * POURQUOI QUATRE AGENTS SEULEMENT ONT UNE CLÉ SQL
 * ══════════════════════════════════════════════════════════════════
 *
 * `ai_is_supported_agent` (0072) n'accepte que `executive`, `finance`,
 * `billing`, `quote_pricing` dans `ai_model_overrides`. Ce n'est plus
 * une contrainte d'écran — le client n'écrit plus rien — mais elle
 * reste la clé du ROUTAGE : `routage.ts` s'en sert pour reconnaître un
 * agent surchargé par l'éditeur, et `runtime/supabase.ts` pour lire la
 * carte à chaque requête. Ces deux-là survivent au déménagement : le
 * moteur reste ici, seule l'interface de réglage est partie.
 */

// ------------------------------------------------------------------
// Les quatre agents que la base accepte de surcharger
// ------------------------------------------------------------------

/**
 * Les agents de `ai_is_supported_agent` (0072), dans la graphie SQL.
 *
 * Recopiés ici parce que le TypeScript ne peut pas lire une contrainte
 * `check` ; un test relit la migration et échoue si les deux listes
 * divergent, ce qui est la seule façon de ne pas découvrir l'écart au
 * moment où le moteur ignore une surcharge posée par l'éditeur.
 */
export const AGENTS_SQL = ["executive", "finance", "billing", "quote_pricing"] as const;

export type CleAgentSql = (typeof AGENTS_SQL)[number];

/**
 * La clé SQL d'un agent du catalogue, ou `null` s'il n'en a pas.
 *
 * `null` n'est pas un cas d'erreur : c'est le cas ordinaire de dix
 * agents sur quatorze. Il veut dire « celui-ci ne se surcharge pas en
 * base », et `appliquerSurcharges` en tire un passage sans effet.
 */
export function cleSqlDeLAgent(cle: CleAgentModele): CleAgentSql | null {
  switch (cle) {
    case "executive":
      return "executive";
    case "finance":
      return "finance";
    case "billing":
      return "billing";
    case "quotePricing":
      return "quote_pricing";
    default:
      return null;
  }
}

/** L'inverse : la clé du catalogue derrière une clé SQL. */
export function cleCatalogueDeLaCleSql(agent: CleAgentSql): CleAgentModele {
  return agent === "quote_pricing" ? "quotePricing" : agent;
}

export function estCleAgentSql(valeur: unknown): valeur is CleAgentSql {
  return typeof valeur === "string" && (AGENTS_SQL as readonly string[]).includes(valeur);
}

// ------------------------------------------------------------------
// Les mots français
// ------------------------------------------------------------------

/**
 * Le nom métier d'un agent.
 *
 * `lib/ai/types.ts` en porte déjà quatre (`AGENT_LABELS`) ; les dix
 * autres n'existent nulle part puisque ces agents ne sont pas encore
 * écrits. On ne modifie pas `AGENT_LABELS` — il sert les écrans métier
 * et ne doit annoncer que ce qui existe — et un test vérifie que les
 * quatre communs disent bien la même chose des deux côtés.
 */
export const LIBELLES_AGENT: Readonly<Record<CleAgentModele, string>> = Object.freeze({
  executive: "Direction",
  finance: "Finance",
  billing: "Facturation",
  quotePricing: "Devis & prix",
  sales: "Commerce",
  operations: "Chantiers",
  planning: "Planning",
  procurement: "Achats",
  nursery: "Pépinière",
  fleet: "Matériel",
  customer: "Clients",
  market: "Marché",
  risk: "Risques",
  classification: "Classement",
});

/**
 * LES CONSOMMATEURS QUI NE SONT PAS DES AGENTS DU CATALOGUE.
 *
 * `ai_usage_events.agent` est la seule colonne d'agent libre de la
 * Phase 11V (0076), et c'est délibéré : une consommation doit pouvoir
 * être imputée même quand celui qui l'engage n'est pas l'un des
 * quatorze. Deux cas existent aujourd'hui, et ils sont l'essentiel du
 * grand livre en pratique :
 *
 *   • `edge-assistant` — la fonction Edge `oasis-pro-ai`, celle que
 *     l'écran de conversation appelle ;
 *   • `classification` — le pré-traitement en volume (p. 29), qui a une
 *     clé de modèle mais aucune existence dans `ai_action_catalog`.
 *
 * Sans cette table, la ventilation « par agent » afficherait la clé
 * technique brute à un dirigeant.
 */
export const LIBELLES_AGENT_HORS_CATALOGUE: Readonly<Record<string, string>> = Object.freeze({
  "edge-assistant": "Assistant (conversation)",
});

/** Le nom lisible d'un consommateur du grand livre, quel qu'il soit. */
export function nomAgentDuJournal(cle: string): string {
  if (estCleAgentSql(cle)) return LIBELLES_AGENT[cleCatalogueDeLaCleSql(cle)];
  const normalisee = normaliserCleAgent(cle);
  if (normalisee !== null) return LIBELLES_AGENT[normalisee];
  return LIBELLES_AGENT_HORS_CATALOGUE[cle] ?? cle;
}

// ------------------------------------------------------------------
// Pourquoi un appel n'a pas abouti — dit au client
// ------------------------------------------------------------------

/**
 * LES MÊMES SIX MOTIFS QUE `LIBELLES_PANNE`, ÉCRITS POUR LE CLIENT.
 *
 * `lib/ai/runtime/types.ts` en porte déjà une table, et elle est juste
 * — pour l'exploitant. Deux de ses six formulations ne peuvent pas être
 * reprises telles quelles ici :
 *
 *   `budget_exceeded` y est « Plafond de dépense IA atteint ». Le
 *   plafond en question est celui que L'ÉDITEUR fixe sur SA dépense
 *   (0080) ; le client ne le règle pas, ne le voit pas, et n'a pas à
 *   apprendre qu'il existe une somme d'argent derrière. Mais il doit
 *   savoir que son IA s'est arrêtée, sinon il croit à une panne et
 *   appelle le support pour un fonctionnement normal. D'où « Limite
 *   d'usage atteinte », qui est vrai, actionnable — attendre, ou
 *   demander un relèvement — et muet sur le montant.
 *
 *   `model_unavailable` nomme le modèle. Le client n'a jamais choisi de
 *   modèle et n'en connaît aucun ; pour lui c'est Oasis AI qui n'a pas
 *   répondu.
 *
 * Les quatre autres sont recopiés à l'identique : un délai dépassé est
 * un délai dépassé pour tout le monde.
 */
export const LIBELLES_PANNE_CLIENT: Readonly<Record<MotifPanne, string>> = Object.freeze({
  model_unavailable: "Oasis AI momentanément indisponible",
  rate_limit: "Trop de demandes en même temps",
  timeout: "Délai dépassé",
  provider_error: "Erreur technique",
  budget_exceeded: "Limite d'usage atteinte",
  other: "Erreur non identifiée",
});

/** Le libellé d'un motif de refus, y compris quand la base n'en a rangé aucun. */
export function libellePanneClient(motif: MotifPanne | "inconnu"): string {
  return motif === "inconnu" ? "Motif non enregistré" : LIBELLES_PANNE_CLIENT[motif];
}

/**
 * ==================================================================
 * CE VOCABULAIRE N'EST PAS ENCORE CELUI DU MOTEUR — À REPRENDRE
 * ==================================================================
 *
 * Ces libellés habillent l'ÉCRAN. Le message que le client reçoit
 * réellement quand son IA s'arrête vient, lui, du moteur, et il dit
 * aujourd'hui trois choses qu'il ne devrait pas :
 *
 *   • `lib/ai/runtime/cost.ts` — « Cet appel dépasserait le plafond de
 *     dépense IA … (il reste 12,40 €) ». Ce montant est le budget
 *     d'ACHAT de l'éditeur chez son fournisseur, affiché à celui qui ne
 *     le paie pas. C'est exactement la fuite que la migration 0080 a
 *     été écrite pour fermer, et elle sort par le corps de la réponse
 *     HTTP (`app/api/oasis-ai/demander/route.ts`) comme par l'écran de
 *     conversation (`lib/ai/conversations/actions.ts`).
 *
 *   • `lib/ai/runtime/cost.ts` et `lib/ai/runtime/fallback.ts` —
 *     « Un administrateur peut le relever dans les réglages. » C'est
 *     devenu FAUX le jour où 0080 a retiré aux clients toute politique
 *     d'écriture sur `ai_cost_limits` : aucun administrateur
 *     d'entreprise cliente ne le peut plus, et l'écran de réglages en
 *     question a été supprimé par le même chantier. Le produit envoie
 *     donc l'utilisateur vers un geste impossible sur une page qui
 *     n'existe pas.
 *
 *   • `lib/ai/runtime/cost.ts` range « Renseignez les variables
 *     OASIS_AI_TARIF_… » dans `avertissements`, que la route renvoie
 *     tel quel au navigateur du client : ce sont les variables
 *     d'environnement du serveur de l'ÉDITEUR.
 *
 * LA FORMULATION DE REMPLACEMENT EST CELLE D'AU-DESSUS :
 * « Limite d'usage atteinte — cette limite est posée par Oasis Care,
 * elle ne se règle pas depuis Oasis Care Pro », sans montant, sans nom
 * de plafond, sans « demandez à votre administrateur ». Le montant en
 * euros et l'avertissement sur les tarifs appartiennent au journal
 * serveur et au Control Center, jamais au corps de la réponse.
 *
 * Ce n'est pas écrit ici par commodité : `lib/ai/runtime/` appartient à
 * un autre chantier, qui écrivait dedans au moment où ces lignes ont
 * été posées. La note reste dans le code plutôt que dans un compte
 * rendu, pour qu'elle soit trouvée par celui qui touchera ce fichier.
 */
