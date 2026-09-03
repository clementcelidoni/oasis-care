/**
 * §11V — LA PORTE D'ENTRÉE DE LA PLOMBERIE DES AGENTS.
 *
 * Les étapes 9 à 12 de la spec (les quatre agents) importent
 * `@/lib/ai/runtime` et n'ont besoin de rien d'autre pour :
 *
 *   • assembler leur contexte minimal  → `AgentContextBuilder`
 *   • connaître leurs outils            → `registreOutils`
 *   • appeler un modèle                 → `OasisAgentRunner`
 *
 * QUATRE MODULES NE SONT PAS RÉEXPORTÉS ICI, ET C'EST DÉLIBÉRÉ :
 *
 *   `./supabase.ts`  — les adaptateurs. Il importe `@/lib/supabase/server`,
 *                      donc `next/headers`. Le réexporter ferait entrer
 *                      la session Next dans tout module qui ne veut
 *                      qu'un type.
 *
 *   `./toolsSdk.ts`  — le pont vers `@openai/agents`. Le réexporter
 *                      tirerait 66 Mo de dépendances dans un écran qui
 *                      voudrait seulement afficher la liste des outils.
 *
 *   `./agents.ts`    — le runtime des agents (étapes 9 à 12). Il tire le
 *                      SDK ET `@/lib/ai/proposals`.
 *
 *   `./tracingSdk.ts` — le branchement du tracing au SDK (étape 17).
 *
 * Les quatre s'importent par leur chemin, depuis un fichier serveur.
 * La POLITIQUE de tracing, elle, est dans `tracing.ts` et se réexporte
 * ci-dessous : l'écran d'administration de la page 26 doit pouvoir dire
 * ce que le tracing fait sans charger 66 Mo pour l'afficher.
 */

export {
  CONFIANCES,
  DECLENCHEURS_ESCALADE,
  LIBELLES_PANNE,
  MESSAGE_INDISPONIBLE,
  MOTIFS_PANNE,
  PANNES_FOURNISSEUR,
  centimes,
  compteur,
  estConfiance,
  estDonneesInsuffisantes,
  lireConfiance,
  nombreLisible,
  type Confiance,
  type Criticite,
  type DeclencheurEscalade,
  type EtapeEscalade,
  type IdentiteAppel,
  type InfoRepli,
  type MotifPanne,
  type OrigineReponse,
  type ResultatAgent,
  type SortieModele,
  type TentativeModele,
} from "./types.ts";

export {
  AGENTS_AVEC_PLAN,
  AgentContextBuilder,
  CLES_INTERDITES,
  ELEMENTS_MAX_DEFAUT,
  LONGUEUR_TEXTE_MAX,
  PROFONDEUR_MAX,
  elaguer,
  empreinteDe,
  outilsPourContexte,
  serialiserStable,
  type AgentContext,
  type CibleContexte,
  type DemandeContexte,
  type OptionsBuilder,
  type PortLectureSource,
  type SourceLue,
} from "./context.ts";

export {
  CONSIGNE_FRONTIERE_DETERMINISTE,
  GRANDEURS_DETERMINISTES,
  GRANDEURS_SANS_SERVICE,
  OUTILS_SPEC_SANS_SERVICE,
  OasisAIToolRegistry,
  registreOutils,
  reinitialiserRegistreOutils,
  type FamilleOutil,
  type GrandeurDeterministe,
  type OutilOasis,
  type SourcePermission,
} from "./tools.ts";

export {
  MAX_ESCALADES,
  ModelEscalationService,
  SEUIL_IMPACT_ESCALADE_CENTIMES,
  reinitialiserServiceEscalade,
  serviceEscalade,
  tauxEscalade,
  type DecisionEscalade,
  type DemandeEscalade,
} from "./escalation.ts";

export {
  SEUIL_IMPACT_NON_DEGRADABLE_CENTIMES,
  avertissementRepli,
  classerPanne,
  deciderRepli,
  type DecisionRepli,
  type DemandeRepli,
} from "./fallback.ts";

export {
  AICostControlService,
  BASE_TARIF_ENVIRONNEMENT,
  BUDGET_SANS_LIMITE,
  RATIO_CIBLE,
  VARIABLES_TARIF,
  construireCleCache,
  debutDuMoisParis,
  decalageParisMs,
  estimerCoutCents,
  lireBudget,
  lireGrilleTarifaire,
  repartirParNiveau,
  sommerCouts,
  verifierPlafonds,
  type BudgetIA,
  type GrilleTarifaire,
  type LigneRepartition,
  type PortCout,
  type Repartition,
  type Tarif,
  type VerdictBudget,
} from "./cost.ts";

export { JournalUsage, type EvenementUsage, type PortJournalUsage } from "./usage.ts";

export {
  MAX_TENTATIVES,
  OasisAgentRunner,
  lireSortieModele,
  plafondRoutage,
  type DemandeExecution,
  type Executeur,
  type PortRoutage,
  type PortsRuntime,
  type SignauxRoutage,
} from "./run.ts";

export {
  CATEGORIES_DECISION,
  DECISIONS_EXECUTIVE_MAX,
  DecisionRecommendationSchema,
  AnalyseAgentSchema,
  LONGUEUR_RESUME_MAX,
  LONGUEUR_TITRE_MAX,
  ORIGINES_DONNEE,
  PropositionActionSchema,
  RAISONS_MAX,
  RECOMMANDATIONS_MAX,
  SortieExecutiveSchema,
  bornerPriorite,
  normaliserAnalyse,
  normaliserBrief,
  normaliserProposition,
  normaliserRecommandation,
  relireAnalyse,
  relireBrief,
  type AnalyseAgent,
  type CategorieDecision,
  type DecisionRecommendation,
  type OrigineDonnee,
  type PropositionAction,
  type SortieExecutive,
  type SortieNormalisee,
} from "./schemas.ts";

export {
  CLES_AUTONOMIE,
  LIBELLES_AUTONOMIE,
  NIVEAUX_AUTONOMIE,
  REGLAGE_PAR_DEFAUT,
  estNiveauAutonomie,
  lireNiveauAutonomie,
  lireReglagesAgents,
  motifRefusAction,
  peutAgirSeul,
  peutExecuterApresAccord,
  peutPreparerUneAction,
  peutRecommander,
  type NiveauAutonomie,
  type PortReglagesAgents,
  type ReglageAgent,
} from "./autonomy.ts";

export {
  AGENTS_PREMIERE_ITERATION,
  CLE_BASE,
  CONSIGNE_DIRECTION,
  DEFINITIONS,
  SOCLE_INSTRUCTIONS,
  consigneContexte,
  estAgentConstruit,
  instructionsPour,
  sourcesDe,
  type AgentConstruit,
  type DefinitionAgent,
} from "./definitions.ts";

export {
  ACTIONS_MAX_PAR_REPONSE,
  EXPIRATION_APPROBATION,
  OasisActionEngine,
  RISQUE_ELEVE_AU_DELA_DE_CENTS,
  detient,
  exigeConfirmationHumaine,
  risqueEffectif,
  risqueMax,
  type ActionEnregistree,
  type ControlePrealable,
  type DemandeAction,
  type EntreeCatalogue,
  type MotifRefusAction,
  type PortActionEngine,
  type PortServicesMetier,
  type RefusAction,
  type ResultatAction,
  type ResultatServiceMetier,
} from "./actionEngine.ts";

export {
  CHAMPS_SPAN_AUTORISES,
  MODES_TRACING,
  VARIABLE_DONNEES_TRACING,
  VARIABLE_MODE_TRACING,
  dureeSpanMs,
  etatTracing,
  identifiantCorrelation,
  lireModeTracing,
  metadonneesTrace,
  parametresTrace,
  resumerApprobation,
  resumerSpan,
  type AnomalieTracing,
  type EtatTracing,
  type MetadonneesTrace,
  type ModeTracing,
  type ParametresTrace,
  type SpanLu,
} from "./tracing.ts";

export {
  AGENT_CLASSIFICATION,
  ServicePreTraitement,
  TAILLE_LOT,
  contexteDeLot,
  decouper,
  type ClassementElement,
  type DemandePreTraitement,
  type ElementAClasser,
  type RegleClassement,
  type ResultatPreTraitement,
  type SortieLot,
} from "./preprocessing.ts";
