import { tool } from "@openai/agents";
import type { FunctionTool } from "@openai/agents";
import { OasisAIToolRegistry, registreOutils, type OutilOasis } from "./tools.ts";
import type { CleAgentModele, IdentiteAppel } from "./types.ts";

/**
 * §11V — LE PONT ENTRE LE REGISTRE ET L'AGENTS SDK.
 *
 * Séparé de `tools.ts` À DESSEIN : le registre est une déclaration
 * pure, éprouvable par `node --test` sans charger les 66 Mo du SDK.
 * Ce fichier-ci est le seul du dossier `runtime/` qui importe
 * `@openai/agents`, et aucun test ne l'importe.
 *
 * ══════════════════════════════════════════════════════════════════
 * CE QUE LE PONT AJOUTE, ET QUI N'EST PAS DÉCORATIF
 * ══════════════════════════════════════════════════════════════════
 *
 *   1. L'ORGANISATION EST INJECTÉE ICI, dans une fermeture. Elle vient
 *      de `IdentiteAppel`, c'est-à-dire de la session. Le modèle ne
 *      la voit pas, ne la nomme pas, ne peut pas la remplacer.
 *
 *   2. LA PERMISSION EST REVÉRIFIÉE À L'EXÉCUTION. Le registre a déjà
 *      filtré les outils offerts au modèle, mais un outil offert par
 *      erreur ne doit pas devenir un outil exécuté. Ce n'est pas la
 *      barrière — `ai_guard` et la RLS le sont — c'est la deuxième
 *      serrure, et elle rend une phrase lisible plutôt qu'un refus SQL.
 *
 *   3. LES ÉCRITURES N'ÉCRIVENT PAS. Les familles `proposition` et
 *      `moteur` portent `needsApproval: true` : l'Agents SDK
 *      INTERROMPT le tour avant d'exécuter (mécanisme human-in-the-loop
 *      de la page 14), et l'appelant enregistre alors une action et une
 *      demande d'approbation (0072). Rien ne part sans réponse humaine.
 */

/** Ce que le pont sait faire, une fois l'outil validé. */
export type PortsExecutionOutils = {
  /**
   * Exécuter une LECTURE : `rpc` + arguments, l'organisation déjà posée.
   * Rend la valeur telle que Postgres l'a produite.
   */
  lire(appel: { rpc: string; arguments: Record<string, unknown> }): Promise<unknown>;
  /**
   * Déposer une PROPOSITION ou une demande d'action.
   *
   * N'écrit AUCUNE donnée métier : elle enregistre une intention
   * (`ai_actions` + `ai_action_approvals`) ou rend un récapitulatif à
   * afficher. Le nom dit ce qu'elle fait ; « écrire » n'apparaît nulle
   * part parce que ce n'est pas ce qui se passe.
   */
  deposer(appel: {
    outil: OutilOasis;
    arguments: Record<string, unknown>;
  }): Promise<Record<string, unknown>>;
};

export type OptionsPont = {
  registre?: OasisAIToolRegistry;
};

/**
 * Les outils d'un agent, prêts pour le SDK.
 *
 * Le filtre par agent ET par permission vient du registre
 * (`pourAgent`) : c'est la moitié « outils » de la minimisation de la
 * page 20.
 */
export function outilsSdkPourAgent(
  agent: CleAgentModele,
  identite: IdentiteAppel,
  ports: PortsExecutionOutils,
  options: OptionsPont = {},
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- signature imposée par @openai/agents
): FunctionTool<any, any, any>[] {
  const registre = options.registre ?? registreOutils();
  return registre
    .pourAgent(agent, identite.permissions)
    .map((outil) => construireOutilSdk(outil, identite, ports));
}

export function construireOutilSdk(
  outil: OutilOasis,
  identite: IdentiteAppel,
  ports: PortsExecutionOutils,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- signature imposée par @openai/agents
): FunctionTool<any, any, any> {
  return tool({
    name: outil.nom,
    description: outil.description,
    // Le schéma du registre, tel quel : une seconde définition ici
    // dériverait de la première au premier changement.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- le SDK exige un ZodObject concret
    parameters: outil.parametres as any,
    // Human-in-the-loop de la page 14, branché sur le catalogue plutôt
    // que sur une décision prise ici.
    needsApproval: outil.confirmationRequise,
    execute: async (entree: unknown) => {
      const args =
        typeof entree === "object" && entree !== null && !Array.isArray(entree)
          ? (entree as Record<string, unknown>)
          : {};

      // ---- Deuxième serrure : la permission ------------------------
      if (outil.permission !== null && !identite.permissions.includes(outil.permission)) {
        return {
          erreur: "droitManquant",
          message: `Cette action demande le droit « ${outil.permission} », que ce compte n'a pas.`,
        };
      }

      // ---- L'organisation vient de la session ----------------------
      //
      // Un `p_organization_id` glissé par le modèle dans ses arguments
      // serait ÉCRASÉ ici — l'injection passe en dernier dans le
      // littéral. Ce n'est pas la barrière (les fonctions vérifient
      // l'appartenance), mais on ne laisse pas la tentative partir.
      const arguments_ = outil.injecteOrganisation
        ? { ...args, p_organization_id: identite.organizationId }
        : args;

      if (outil.famille === "lecture") {
        if (outil.rpc === undefined) {
          throw new Error(`Outil de lecture « ${outil.nom} » sans fonction associée.`);
        }
        return (await ports.lire({ rpc: outil.rpc, arguments: arguments_ })) ?? null;
      }

      return ports.deposer({ outil, arguments: arguments_ });
    },
  });
}
