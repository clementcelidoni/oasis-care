import { z } from "zod";
import type { OutilOasis } from "../tools.ts";

/**
 * §11Y — L'OUTIL PROPRE À L'AGENT CHANTIERS.
 *
 * ══════════════════════════════════════════════════════════════════
 * POURQUOI CE FICHIER EXISTE, ET POURQUOI IL N'EST PAS DANS `tools.ts`
 * ══════════════════════════════════════════════════════════════════
 *
 * `runtime/tools.ts` est le catalogue, et il est PARTAGÉ : six agents
 * sont écrits en même temps, et deux mains dans le même tableau, c'est
 * un des deux travaux perdu à la fusion. La règle du chantier est donc
 * qu'un constructeur écrit son outil CHEZ LUI, et que l'intégration le
 * verse au catalogue.
 *
 * Ce fichier est cette forme-là : l'entrée est complète, typée
 * `OutilOasis`, et prête à être collée dans `OUTILS_LECTURE`. Elle
 * n'est PAS enregistrée au registre tant que l'intégration ne l'a pas
 * fait, et c'est délibéré : `tools.test.ts` échouerait, à juste titre,
 * sur un outil dont la fonction SQL n'est encore dans aucune migration.
 *
 * ══════════════════════════════════════════════════════════════════
 * LES TROIS GESTES D'INTÉGRATION, ET ILS VONT ENSEMBLE
 * ══════════════════════════════════════════════════════════════════
 *
 *   1. `supabase/migrations/0082_agents_ia.sql` reçoit le corps de
 *      `outils/operations.sql`, tel quel.
 *   2. `runtime/tools.ts` reçoit `OUTIL_OPERATIONS_SNAPSHOT` dans
 *      `OUTILS_LECTURE`.
 *   3. `supabase/tests/agents_ia.sql` reçoit `outils/operations.epreuve.sql`.
 *
 * DANS LE MÊME COMMIT. Le geste 2 sans le geste 1 déclare un outil dont
 * la fonction n'existe pas — le défaut que l'en-tête de `tools.ts`
 * décrit comme le plus silencieux du lot, et que `tools.test.ts`
 * attrape précisément pour cette raison.
 *
 * ══════════════════════════════════════════════════════════════════
 * CE QUE CET OUTIL AJOUTE À CE QUI EXISTE DÉJÀ
 * ══════════════════════════════════════════════════════════════════
 *
 * L'agent Chantiers a déjà trois outils transverses : `searchEntities`,
 * `getProjectContext` et `getClientContext`. Ils répondent tous à la
 * question « ce chantier-là », et aucun ne répond à « mes chantiers ».
 *
 * Or le fil de discussion (`/oasis-ai/conversations`) ne transmet
 * AUCUN identifiant : il envoie une phrase. L'agent part donc aveugle,
 * et sans cet outil il ne peut ouvrir la conversation que par un
 * `searchEntities` sur un nom que l'utilisateur n'a pas forcément
 * donné. C'est le trou que `getOperationsSnapshot` bouche, et il ne
 * bouche que celui-là : dès qu'un chantier est désigné,
 * `getProjectContext` reste la bonne source.
 */
export const OUTIL_OPERATIONS_SNAPSHOT: OutilOasis = {
  nom: "getOperationsSnapshot",
  famille: "lecture",
  agent: "operations",
  rpc: "ai_operations_snapshot",
  // L'organisation vient de la SESSION. Le schéma ci-dessous ne la
  // nomme pas, et il ne peut donc pas la laisser choisir au modèle.
  injecteOrganisation: true,
  permission: "projects.read",
  // « aiGuard » et non « rls », et c'est exact plutôt que coutumier :
  // `ai_operations_snapshot` ouvre sur `perform public.ai_guard(...,
  // 'projects.read')`, qui LÈVE. Le refus ne vient donc pas d'une
  // ligne filtrée par la RLS mais d'une exception nommée — et un droit
  // manquant ne produit jamais une vue partielle, qui serait une
  // réponse fausse et non une réponse incomplète.
  permissionSource: "aiGuard",
  risque: "low",
  confirmationRequise: false,
  // La seule grandeur déterministe qu'il apporte : des heures pointées,
  // et un écart en heures entre la fin prévue et la fin réelle. Ni
  // marge, ni prix, ni total : voir l'en-tête de `operations.sql`.
  fournit: ["heures"],
  maxElements: 50,
  description:
    "Vue d'ensemble des chantiers OUVERTS : avancement moyen des phases, heures pointées " +
    "validées et en attente. Rend aussi, sur une fenêtre de dates, l'écart en heures entre la " +
    "fin prévue et la fin réelle de chaque intervention, et la liste des pointages qui " +
    "attendent une validation (ceux-là ne sont PAS bornés par la fenêtre). " +
    "LE BLOC « retard » EST À LIRE AVANT DE CONCLURE : « enRetard » vaut null quand aucun " +
    "chantier ouvert ne porte de date de fin prévue, et « motif » dit pourquoi — une liste vide " +
    "voudrait dire « aucune référence », jamais « aucun retard ». " +
    "Le bloc « nonMesurable » nomme ce que ce produit ne sait pas voir : heures prévues, " +
    "capacité des équipes, matériel, temps de trajet, argent. N'en déduis rien. " +
    "Ni marge ni budget ne sont rendus : ils appartiennent à l'agent Finance.",
  parametres: z.object({
    // `.nullable()` et non `.optional()` : le mode strict des sorties
    // structurées exige que toutes les clés soient présentes.
    p_from: z
      .string()
      .nullable()
      .describe("Début de la fenêtre d'interventions, AAAA-MM-JJ. Null = il y a 30 jours."),
    p_to: z
      .string()
      .nullable()
      .describe("Fin de la fenêtre d'interventions, AAAA-MM-JJ. Null = dans 30 jours. 366 jours au plus."),
  }),
};
