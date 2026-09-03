import { Usage } from "@openai/agents";
import type { Model, ModelProvider, ModelRequest, ModelResponse } from "@openai/agents";
import { AGENTS_PREMIERE_ITERATION, DEFINITIONS, type AgentConstruit } from "../runtime/definitions.ts";
import type { Tour } from "./types.ts";

/**
 * §11V — LE FOURNISSEUR SIMULÉ DE LA SUITE D'ÉVALUATIONS.
 *
 * ══════════════════════════════════════════════════════════════════
 * CE N'EST PAS UN BOUCHON, C'EST UN TÉMOIN
 * ══════════════════════════════════════════════════════════════════
 *
 * Un bouchon rendrait une réponse et n'apprendrait rien. Celui-ci
 * reçoit la VRAIE `ModelRequest` — celle que l'API d'OpenAI recevrait —
 * et l'enregistre. C'est de cet enregistrement que sortent la moitié
 * des contrôles de la page 32, et ce sont ceux qu'aucune relecture de
 * code ne donne :
 *
 *   • QUELS OUTILS ONT ÉTÉ OFFERTS à cet agent-là, sur ce tour-là. Le
 *     critère TOOLS se joue à l'offre autant qu'au refus.
 *   • QUEL IDENTIFIANT DE MODÈLE a été demandé au fournisseur. Le
 *     critère MODEL ROUTER ne se vérifie nulle part ailleurs sans
 *     recopier un nom de modèle — ce que la page 4 interdit.
 *   • CE QUE LE MODÈLE A VU en entrée : la question de l'utilisateur et
 *     les données, séparées et étiquetées.
 *
 * ══════════════════════════════════════════════════════════════════
 * POURQUOI L'AGENT SE RECONNAÎT À SON INSTRUCTION
 * ══════════════════════════════════════════════════════════════════
 *
 * Un brief de direction fait tourner deux agents — la Direction, puis
 * le spécialiste qu'elle interroge — et le fournisseur ne reçoit qu'un
 * identifiant de modèle, souvent le même. Compter les appels pour les
 * distinguer marcherait aujourd'hui et casserait au premier tour
 * d'outil supplémentaire. Le modèle lit donc « TON RÔLE — … » dans
 * l'instruction que `instructionsPour` compose, et joue le script de
 * CET agent-là : c'est exact quel que soit l'entrelacement des appels.
 *
 * La contrepartie est assumée : si le format de l'instruction change,
 * ce fichier lève bruyamment au lieu de rendre un script arbitraire.
 * Une évaluation qui se trompe d'agent en silence noterait le mauvais.
 */

/** Les jetons que le modèle simulé déclare par tour. Un chiffre rond, et vérifiable. */
export const JETONS_ENTREE_PAR_TOUR = 1_200;
export const JETONS_SORTIE_PAR_TOUR = 300;

/** Ce que le modèle a vu, pour un agent donné. */
export type VuParAgent = {
  /** Les noms d'outils offerts, un tableau par tour. */
  outils: string[][];
  instructions: string[];
  entrees: unknown[];
  appels: number;
};

const VU_VIDE: VuParAgent = Object.freeze({ outils: [], instructions: [], entrees: [], appels: 0 });

export type Scripts = Partial<Record<AgentConstruit, readonly Tour[]>>;

export class ModeleSimule implements Model {
  readonly #scripts: Scripts;
  readonly #vu = new Map<AgentConstruit, VuParAgent>();

  constructor(scripts: Scripts) {
    this.#scripts = scripts;
  }

  /** Ce que cet agent a vu, ou un relevé vide s'il n'a jamais été appelé. */
  pour(agent: AgentConstruit): VuParAgent {
    return this.#vu.get(agent) ?? VU_VIDE;
  }

  /** Le nombre total de réponses produites. Sert au contrôle COST. */
  get appelsTotaux(): number {
    let total = 0;
    for (const vu of this.#vu.values()) total += vu.appels;
    return total;
  }

  async getResponse(request: ModelRequest): Promise<ModelResponse> {
    const instructions = request.systemInstructions ?? "";
    const agent = this.#agentDe(instructions);

    const vu = this.#vu.get(agent) ?? { outils: [], instructions: [], entrees: [], appels: 0 };
    vu.outils.push((request.tools ?? []).map((outil) => outil.name));
    vu.instructions.push(instructions);
    vu.entrees.push(request.input);
    const rang = vu.appels;
    vu.appels += 1;
    this.#vu.set(agent, vu);

    const tour = (this.#scripts[agent] ?? [])[rang];
    if (tour === undefined) {
      throw new Error(
        `Évaluation : le script de « ${agent} » n'a pas prévu le tour n° ${rang + 1}. ` +
          "Le runtime a demandé un tour de plus que ce que le cas décrit.",
      );
    }
    if (tour.type === "panne") throw tour.erreur;

    const usage = new Usage({
      requests: 1,
      inputTokens: JETONS_ENTREE_PAR_TOUR,
      outputTokens: JETONS_SORTIE_PAR_TOUR,
      totalTokens: JETONS_ENTREE_PAR_TOUR + JETONS_SORTIE_PAR_TOUR,
    });

    if (tour.type === "outil") {
      return {
        usage,
        output: [
          {
            type: "function_call",
            callId: `eval-${agent}-${rang}`,
            name: tour.nom,
            arguments: JSON.stringify(tour.arguments ?? {}),
            status: "completed",
          },
        ],
      };
    }

    return {
      usage,
      output: [
        {
          type: "message",
          role: "assistant",
          status: "completed",
          content: [{ type: "output_text", text: JSON.stringify(tour.sortie) }],
        },
      ],
    };
  }

  #agentDe(instructions: string): AgentConstruit {
    for (const agent of AGENTS_PREMIERE_ITERATION) {
      if (instructions.includes(`TON RÔLE — ${DEFINITIONS[agent].libelle}.`)) return agent;
    }
    throw new Error(
      "Évaluation : instruction sans rôle identifiable. Le format de `instructionsPour` a changé ; " +
        "cette suite doit être relue avant d'être crue.",
    );
  }

  getStreamedResponse(): AsyncIterable<never> {
    // Le runtime n'emploie jamais le mode flux : la sortie est
    // structurée et lue d'un bloc. Si cela changeait, l'évaluation doit
    // échouer bruyamment plutôt que noter un flux vide.
    throw new Error("Évaluation : le runtime ne doit pas demander de réponse en flux.");
  }
}

/** Un fournisseur qui rend toujours le même modèle. */
export function fournisseurDe(modele: Model): ModelProvider {
  return { getModel: () => Promise.resolve(modele) };
}

/**
 * Le fournisseur qui NOTE l'identifiant demandé, quel que soit celui
 * qu'il enveloppe.
 *
 * C'EST LUI QUI PORTE LE CRITÈRE « MODEL ROUTER » de la page 32. Le
 * routeur rend un identifiant ; la seule façon de vérifier qu'il est
 * bien arrivé jusqu'au fournisseur — et donc que rien entre les deux ne
 * l'a remplacé par un nom codé en dur — est de le lire ici, au dernier
 * moment. Il enveloppe indifféremment le modèle simulé et le
 * fournisseur OpenAI : le contrôle de routage est donc identique dans
 * les deux modes, ce qui est exactement ce qu'on veut d'un contrôle.
 *
 * La comparaison se fait ensuite contre
 * `routeur.modelePourNiveau(niveauAttendu)` : aucun nom de modèle n'est
 * écrit dans cette suite, parce que le seul fichier du dépôt web qui a
 * le droit de les connaître est `lib/ai/model/router.ts` (p. 4).
 */
export class FournisseurObserve implements ModelProvider {
  readonly #delegue: ModelProvider;
  readonly #demandes: string[] = [];

  constructor(delegue: ModelProvider) {
    this.#delegue = delegue;
  }

  /** Les identifiants demandés, dans l'ordre. */
  get demandes(): readonly string[] {
    return this.#demandes;
  }

  async getModel(nomModele?: string): Promise<Model> {
    // Un modèle demandé SANS nom serait un agent construit sans passer
    // par le routeur. On le note tel quel plutôt que de lui inventer un
    // défaut : le contrôle échouera en le nommant, ce qui est la seule
    // façon utile d'échouer.
    this.#demandes.push(nomModele ?? "(aucun identifiant demandé)");
    return this.#delegue.getModel(nomModele);
  }
}
