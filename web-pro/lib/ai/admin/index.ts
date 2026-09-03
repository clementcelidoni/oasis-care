/**
 * §11V — LA PORTE D'ENTRÉE DE L'ADMINISTRATION IA.
 *
 * Deux surfaces vivent derrière ce dossier :
 *
 *   • `/parametres/ia` — la page « AI Configuration » de la spec p. 26 :
 *     la carte agent → modèle, modifiable, et le contrôle de
 *     disponibilité des trois identifiants ; puis, sous
 *     `/parametres/ia/couts`, le tableau de bord des coûts de la
 *     p. 18-19 et les plafonds de la p. 19.
 *
 *   • les retours 👍 / 👎 de la p. 25, posés sur les recommandations du
 *     centre de décision.
 *
 * DEUX MODULES NE SONT PAS RÉEXPORTÉS ICI, pour la même raison qu'en
 * `lib/ai/runtime` :
 *
 *   `./lecture.ts` — il importe `@/lib/supabase/server`, donc
 *                    `next/headers`. Le réexporter ferait entrer la
 *                    session Next dans tout module qui ne veut qu'un
 *                    type.
 *
 *   `./actions.ts` — il porte `"use server"`. Réexporter une Server
 *                    Action à travers une barrière la rend joignable
 *                    depuis n'importe quel import du module ; les
 *                    écrans les importent par leur chemin, ce qui rend
 *                    visible qui appelle quoi.
 */

export {
  AGENTS_PAGE_26,
  AGENTS_SQL,
  LIBELLES_AGENT,
  LIBELLES_AGENT_HORS_CATALOGUE,
  LIBELLES_NIVEAU,
  MISSIONS_AGENT,
  MOTIF_MINIMUM,
  NIVEAUX_ATTENDUS_PAGE_26,
  NIVEAU_LIVRE,
  TEINTES_NIVEAU,
  USAGES_NIVEAU,
  agentsHorsPage26,
  cleCatalogueDeLaCleSql,
  cleSqlDeLAgent,
  estCleAgentSql,
  nomAgentDuJournal,
  type CleAgentSql,
} from "./types.ts";

export {
  CHOIX_PRODUIT,
  choixCourant,
  construireCarte,
  estChoixSurcharge,
  type CarteAgents,
  type ChoixSurcharge,
  type LigneCarte,
  type SourceModele,
  type SurchargeOrganisation,
} from "./carte.ts";

export {
  DEPENSE_VIDE,
  PLAFOND_MAX_CENTIMES,
  ajouterAppel,
  estMinorant,
  lireMontantEuros,
  moyenneCents,
  type Depense,
  type LectureMontant,
} from "./montants.ts";

export {
  agregerAppels,
  debutDuJourParis,
  type AppelIA,
  type LignePanne,
  type LigneVentilation,
  type TableauCouts,
} from "./agregation.ts";

export {
  appliquerSurcharges,
  type SurchargesEffectives,
} from "./routage.ts";
