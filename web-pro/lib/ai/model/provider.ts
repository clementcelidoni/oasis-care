import { OpenAIProvider as FournisseurOpenAISDK, Runner } from "@openai/agents";
import type {
  Agent,
  AgentInputItem,
  Model,
  ModelProvider,
  NonStreamRunOptions,
  RunResult,
} from "@openai/agents";
import type { SourceEnvironnement } from "./configuration.ts";
import { VARIABLE_CLE_OPENAI, lireCleOpenAI } from "./credentials.ts";

export { VARIABLE_CLE_OPENAI, lireCleOpenAI };

/**
 * §11V — AIProvider et son implémentation OpenAI (spec p. 22-23).
 *
 * ══════════════════════════════════════════════════════════════════
 * POURQUOI UNE INTERFACE, ET POURQUOI RIEN DE PLUS
 * ══════════════════════════════════════════════════════════════════
 *
 * La spec p. 22 demande une interface générique `AIProvider` avec
 * `getModel(...)` et `run(...)`, puis ajoute, à propos d'un éventuel
 * `AnthropicProvider` : « NE PAS les développer maintenant sauf
 * nécessité ». Cette consigne est suivie à la lettre. Ce fichier
 * contient UNE interface et UNE implémentation. Écrire aujourd'hui un
 * second fournisseur que personne n'appelle produirait du code non
 * testé, non déployé, et faux dans six mois — le contraire d'une
 * préparation.
 *
 * Ce qui prépare réellement le changement de fournisseur n'est pas une
 * classe vide : c'est que le reste du code ne connaisse QUE cette
 * interface, et que l'abstraction choisie soit celle du SDK lui-même.
 * `AIProvider` étend `ModelProvider` de l'Agents SDK (spec p. 23 :
 * « s'appuyer sur les abstractions Model / ModelProvider »). Un
 * fournisseur Anthropic se brancherait donc en implémentant `Model` —
 * le `Runner`, les outils, les handoffs et les approbations ne
 * bougeraient pas d'une ligne.
 *
 * ══════════════════════════════════════════════════════════════════
 * LA CLÉ : CÔTÉ SERVEUR, ET NULLE PART AILLEURS (spec p. 21)
 * ══════════════════════════════════════════════════════════════════
 *
 * `OPENAI_API_KEY` est lu dans `process.env` SANS préfixe
 * `NEXT_PUBLIC_`. C'est ce qui garantit que Next.js ne l'inclura jamais
 * dans un paquet destiné au navigateur — tout ce qui est préfixé
 * `NEXT_PUBLIC_` part chez chaque visiteur, le reste jamais.
 *
 * Deux conséquences dans ce fichier :
 *
 *   • `estConfigure()` rend un booléen, jamais la clé, jamais un
 *     fragment de clé. Une méthode « quelle clé utilises-tu ? » finirait
 *     dans un journal, puis dans une capture d'écran.
 *
 *   • rien n'est construit à l'import. Le client OpenAI naît au premier
 *     appel réel. Un module importé par erreur depuis un composant
 *     client ne tenterait donc même pas de lire un secret.
 */

/**
 * Le type d'agent que le SDK sait exécuter.
 *
 * `Agent<any, any>` est la signature du SDK lui-même (`run.d.ts`) et il
 * n'existe pas d'équivalent en `unknown` : le paramètre de contexte est
 * consommé ET produit, donc `unknown` casse toute implémentation
 * concrète. Recopier la signature du SDK est ici plus honnête que la
 * contourner.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- signature imposée par @openai/agents
export type AgentExecutable = Agent<any, any>;

/**
 * L'interface générique de la spec p. 22.
 *
 * Elle étend `ModelProvider` : tout ce qui accepte un `ModelProvider` du
 * SDK — un `Runner`, `setDefaultModelProvider` — accepte donc un
 * `AIProvider` sans adaptateur.
 */
export interface AIProvider extends ModelProvider {
  /** Le nom du fournisseur, pour les traces et l'écran d'administration. */
  readonly identifiant: string;

  /**
   * Vrai quand ce fournisseur a de quoi appeler l'API.
   *
   * Ne dit RIEN de la clé elle-même : ni sa valeur, ni sa longueur, ni
   * son préfixe.
   */
  estConfigure(): boolean;

  /** Un modèle par son identifiant. Lève si le fournisseur n'est pas configuré. */
  getModel(nomModele?: string): Promise<Model>;

  /** Exécute un agent jusqu'à sa réponse finale. */
  run<TAgent extends AgentExecutable, TContext = undefined>(
    agent: TAgent,
    entree: string | AgentInputItem[],
    options?: NonStreamRunOptions<TContext, TAgent>,
  ): Promise<RunResult<TContext, TAgent>>;
}

export type OptionsFournisseurOpenAI = {
  /** La clé. Par défaut : `OPENAI_API_KEY` de l'environnement. */
  cle?: string;
  /** Une base d'API différente (passerelle interne, environnement de test). */
  baseURL?: string;
  /** L'environnement où lire la clé. Par défaut `process.env`. */
  env?: SourceEnvironnement;
  /**
   * Le tracing de l'Agents SDK. Par défaut DÉSACTIVÉ — voir plus bas.
   */
  tracingDisabled?: boolean;
};

/**
 * L'interrupteur du tracing.
 *
 * ─── POURQUOI LE TRACING EST ÉTEINT PAR DÉFAUT ───
 *
 * La spec p. 24 demande de l'activer côté serveur, et p. 24 encore :
 * « NE PAS mettre de secrets ni données personnelles inutiles dans les
 * traces ». Or le tracing du SDK envoie, par défaut, les entrées et
 * sorties de chaque appel à un service tiers — c'est-à-dire, ici, des
 * montants de devis, des noms de clients et des adresses de chantier.
 * Décider cela à la place du propriétaire des données, en le codant en
 * dur, serait une faute. L'étape 17 de la spec p. 31 construira le
 * tracing pour de bon, avec le filtrage que la page 24 exige ; d'ici
 * là, ce socle laisse l'interrupteur accessible et fermé.
 */
export const VARIABLE_TRACING = "OASIS_AI_TRACING";

/**
 * Le fournisseur OpenAI (spec p. 22 : « OpenAI devient OpenAIProvider »).
 *
 * Enveloppe le `OpenAIProvider` du SDK plutôt que de le remplacer : le
 * SDK sait déjà gérer les Responses API, le cache de modèles et les
 * sockets. Ce que cette classe ajoute est ce que le SDK ne peut pas
 * savoir — d'où vient la clé, ce qu'on fait quand elle manque, et le
 * fait que rien ne doit être construit tant que personne n'appelle.
 */
export class OpenAIProvider implements AIProvider {
  readonly identifiant = "openai";

  readonly #cle: string | undefined;
  readonly #baseURL: string | undefined;
  readonly #tracingDisabled: boolean;

  #sdk: FournisseurOpenAISDK | null = null;
  #runner: Runner | null = null;

  constructor(options: OptionsFournisseurOpenAI = {}) {
    const env = options.env ?? process.env;
    this.#cle = options.cle ?? lireCleOpenAI(env);
    this.#baseURL = options.baseURL;
    this.#tracingDisabled = options.tracingDisabled ?? env[VARIABLE_TRACING] !== "on";
  }

  estConfigure(): boolean {
    return this.#cle !== undefined;
  }

  async getModel(nomModele?: string): Promise<Model> {
    return this.#fournisseurSDK().getModel(nomModele);
  }

  async run<TAgent extends AgentExecutable, TContext = undefined>(
    agent: TAgent,
    entree: string | AgentInputItem[],
    options?: NonStreamRunOptions<TContext, TAgent>,
  ): Promise<RunResult<TContext, TAgent>> {
    return this.#executeur().run(agent, entree, options);
  }

  /** Ferme ce que le SDK garde ouvert (sockets, modèles en cache). */
  async fermer(): Promise<void> {
    const sdk = this.#sdk;
    this.#sdk = null;
    this.#runner = null;
    if (sdk !== null) await sdk.close();
  }

  /**
   * Le fournisseur du SDK, construit au premier besoin.
   *
   * Le message d'erreur nomme la variable manquante. Sans cela, le SDK
   * dit « Missing credentials » en anglais, sans dire où la poser, et la
   * personne qui déploie cherche une demi-heure.
   */
  #fournisseurSDK(): FournisseurOpenAISDK {
    if (this.#cle === undefined) {
      throw new Error(
        `Aucune clé OpenAI côté serveur : posez ${VARIABLE_CLE_OPENAI} dans l'environnement du serveur Next.js (jamais avec un préfixe NEXT_PUBLIC_, qui l'enverrait au navigateur).`,
      );
    }
    this.#sdk ??= new FournisseurOpenAISDK({
      apiKey: this.#cle,
      ...(this.#baseURL === undefined ? {} : { baseURL: this.#baseURL }),
    });
    return this.#sdk;
  }

  #executeur(): Runner {
    this.#runner ??= new Runner({
      modelProvider: this.#fournisseurSDK(),
      tracingDisabled: this.#tracingDisabled,
    });
    return this.#runner;
  }
}

// ------------------------------------------------------------------
// L'instance partagée
// ------------------------------------------------------------------

let fournisseurMemorise: OpenAIProvider | null = null;

/**
 * Le fournisseur du processus. Construit au premier appel, pour la même
 * raison que le routeur : `process.env` n'est pas garanti peuplé à
 * l'import d'un module.
 */
export function fournisseurIA(): AIProvider {
  fournisseurMemorise ??= new OpenAIProvider();
  return fournisseurMemorise;
}

/** Oublie l'instance partagée. Pour les tests, et pour eux seuls. */
export function reinitialiserFournisseurIA(): void {
  fournisseurMemorise = null;
}
