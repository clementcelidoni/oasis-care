import { z } from "zod";
import type { OutilOasis } from "../tools.ts";

/**
 * §11Y — L'OUTIL PROPRE À L'AGENT PLANNING.
 *
 * ══════════════════════════════════════════════════════════════════
 * POURQUOI CE FICHIER EXISTE, ET POURQUOI IL N'EST PAS DANS `tools.ts`
 * ══════════════════════════════════════════════════════════════════
 *
 * Le catalogue est PARTAGÉ, six agents s'écrivent en même temps, et
 * deux mains dans le même tableau font un des deux travaux perdu à la
 * fusion. Le constructeur écrit son outil chez lui ; l'intégration le
 * verse au catalogue.
 *
 * ══════════════════════════════════════════════════════════════════
 * LES QUATRE GESTES D'INTÉGRATION, ET ILS VONT ENSEMBLE
 * ══════════════════════════════════════════════════════════════════
 *
 *   1. `supabase/migrations/0082_agents_ia.sql` reçoit le corps de
 *      `outils/planning.sql`, tel quel.
 *   2. `runtime/tools.ts` reçoit `OUTIL_PLANNING_SUMMARY` dans
 *      `OUTILS_LECTURE`.
 *   3. `runtime/tools.ts`, `OUTILS_SPEC_SANS_SERVICE` : l'entrée
 *      `getPlanningSummary` passe de « absent » à « couvert », avec la
 *      nouvelle explication. SANS CE GESTE, `tools.test.ts` ÉCHOUE —
 *      « les outils déclarés absents ne sont effectivement pas au
 *      registre » — et il a raison : déclaré absent ET présent, l'un
 *      des deux ment.
 *   4. `supabase/tests/agents_ia.sql` reçoit `outils/planning.epreuve.sql`.
 *
 * ══════════════════════════════════════════════════════════════════
 * POURQUOI CET OUTIL, ALORS QUE LES INTERVENTIONS SE LISENT UNE À UNE
 * ══════════════════════════════════════════════════════════════════
 *
 * `OUTILS_SPEC_SANS_SERVICE` avait raison de le déclarer absent tant
 * que l'agent n'existait pas, et sa phrase dit exactement pourquoi il
 * faut l'écrire maintenant : « agréger côté modèle reviendrait à lui
 * faire compter des heures ». Les heures sont l'une des huit grandeurs
 * de la frontière déterministe (p. 11-12). Sans fonction de synthèse,
 * l'agent Planning n'a que deux options, et les deux sont interdites :
 * additionner lui-même des durées, ou se taire sur la seule question
 * qu'on lui pose.
 *
 * ══════════════════════════════════════════════════════════════════
 * LE MOT QUE CE FICHIER N'ÉCRIT PAS : « heuresTravaillées »
 * ══════════════════════════════════════════════════════════════════
 *
 * La fonction rend `heuresConnues`, et le nom fait la moitié du
 * travail. `scheduled_end - scheduled_start` est une AMPLITUDE : le
 * chantier réel de ce produit fait 70 heures d'amplitude pour 8 heures
 * pointées par jour. Un modèle qui lirait « heuresTravaillées »
 * additionnerait des amplitudes sans se poser de question, et
 * annoncerait le triple de la vérité — le bug exact que
 * `lib/field/types.ts` (`chargeDuJour`) a déjà corrigé à l'écran.
 */
export const OUTIL_PLANNING_SUMMARY: OutilOasis = {
  nom: "getPlanningSummary",
  famille: "lecture",
  agent: "planning",
  rpc: "ai_planning_summary",
  // L'organisation vient de la SESSION : le schéma ne la nomme pas.
  injecteOrganisation: true,
  permission: "projects.read",
  // « aiGuard » : `ai_planning_summary` ouvre sur `perform
  // public.ai_guard(..., 'projects.read')`, qui lève. Le refus est une
  // exception nommée, pas une ligne filtrée en silence.
  permissionSource: "aiGuard",
  risque: "low",
  confirmationRequise: false,
  // Des heures POSÉES, calculées par le SQL selon la règle de
  // `chargeDuJour`. C'est précisément ce que le modèle ne doit pas
  // calculer lui-même.
  fournit: ["heures"],
  maxElements: 50,
  description:
    "Ce qui est POSÉ au planning, jour par jour et équipe par équipe, sur une fenêtre de 7 " +
    "jours par défaut (31 au plus). Rend aussi les interventions qui se chevauchent sur une " +
    "même équipe, celles qui n'ont pas d'équipe, celles qui n'ont pas de date de début, et les " +
    "notes de journée. " +
    "« heuresConnues » N'EST PAS UNE AMPLITUDE : une intervention qui court sur plusieurs jours " +
    "vaut null sur chacun de ses jours, jamais zéro et jamais ses heures calendaires. Un total " +
    "accompagné de « incomplet: true » est un MINORANT, et tu dois le dire. " +
    "LE BLOC « nonMesurable » EST UN REFUS, PAS UNE NOTE : ce produit n'a ni congés, ni " +
    "absences, ni jours fériés, ni disponibilité, ni heures contractuelles, ni distancier. " +
    "« Rien n'est posé jeudi » ne veut pas dire « l'équipe est libre jeudi » — ne fais jamais " +
    "cette conversion.",
  parametres: z.object({
    p_from: z
      .string()
      .nullable()
      .describe("Premier jour de la fenêtre, AAAA-MM-JJ. Null = aujourd'hui, heure de Paris."),
    p_days: z
      .number()
      .int()
      .nullable()
      .describe("Nombre de jours, 1 à 31. Null = 7. Une valeur hors bornes est ramenée dedans."),
  }),
};
