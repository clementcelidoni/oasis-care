/**
 * §11V — LA PORTE D'ENTRÉE DU ROUTAGE DE MODÈLES.
 *
 * Le reste de l'application importe `@/lib/ai/model` et rien d'autre de
 * ce dossier. C'est ce qui rend vraie la promesse de la spec p. 4 :
 * aucun agent ne connaît un nom de modèle, parce qu'aucun agent
 * n'atteint le fichier qui les contient.
 *
 * Deux façons de demander un modèle, et elles répondent à deux
 * questions différentes :
 *
 *   routeurModeles().getModelForAgent("finance")
 *       « Quel modèle pour cet agent, en général ? »
 *
 *   routeurModeles().resolve({ agent: "billing", complexity: "complex",
 *                              financialImpact: 3_845_000 })
 *       « Quel modèle pour CETTE tâche-là ? » — et la réponse arrive
 *       avec ses raisons, en français, prêtes pour la trace.
 *
 * Le fournisseur, lui, ne se demande qu'au moment d'exécuter :
 *
 *   fournisseurIA().run(agent, question)
 *
 * CE MODULE EST CÔTÉ SERVEUR. Il réexporte `provider.ts`, qui charge
 * `@openai/agents`. Un écran qui n'a besoin que du diagnostic de
 * disponibilité gagne à importer `@/lib/ai/model/availability`
 * directement : il évite ainsi de tirer le SDK entier pour afficher
 * trois lignes.
 */

export {
  AGENTS_MODELE,
  NIVEAUX_MODELE,
  decalerNiveau,
  estNiveauModele,
  niveauMax,
  niveauMin,
  normaliserCleAgent,
  rangNiveau,
  type CleAgentModele,
  type ComplexiteTache,
  type ContexteRoutage,
  type DecisionRoutage,
  type EtatBudget,
  type NiveauModele,
  type NiveauRisque,
} from "./types.ts";

export {
  AIModelConfiguration,
  NIVEAUX_PAR_AGENT_PAR_DEFAUT,
  NIVEAU_AGENT_INCONNU,
  lireConfiguration,
  variableEnvironnementAgent,
  type AnomalieConfiguration,
  type SourceEnvironnement,
} from "./configuration.ts";

export {
  AIModelRouter,
  SEUIL_CONTEXTE_AVANCE_CARACTERES,
  SEUIL_CONTEXTE_STANDARD_CARACTERES,
  SEUIL_IMPACT_AVANCE_CENTIMES,
  SEUIL_IMPACT_STANDARD_CENTIMES,
  SEUIL_OUTILS_AVANCE,
  SEUIL_OUTILS_STANDARD,
  VARIABLES_ENVIRONNEMENT_MODELE,
  reinitialiserRouteurModeles,
  routeurModeles,
  type EtatRouteur,
  type OptionsRouteur,
} from "./router.ts";

export { VARIABLE_CLE_OPENAI, lireCleOpenAI } from "./credentials.ts";

export {
  OpenAIProvider,
  VARIABLE_TRACING,
  fournisseurIA,
  reinitialiserFournisseurIA,
  type AIProvider,
  type AgentExecutable,
  type OptionsFournisseurOpenAI,
} from "./provider.ts";

export {
  verifierDisponibiliteModeles,
  type EtatModele,
  type OptionsVerification,
  type RapportDisponibilite,
  type VerificationModele,
} from "./availability.ts";
