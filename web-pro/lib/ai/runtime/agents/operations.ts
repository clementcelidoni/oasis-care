import type { DefinitionAgent } from "./types.ts";

/**
 * CHANTIERS — l'avancement, les heures pointées, l'écart prévu/réel.
 *
 * ══════════════════════════════════════════════════════════════════
 * VERDICT DU SONDAGE : PARTIEL. IL EST CONSTRUIT SUR LA MOITIÉ QUI
 * TIENT, ET IL DIT L'AUTRE
 * ══════════════════════════════════════════════════════════════════
 *
 * CE QUI A DE LA MATIÈRE, mesuré en production le 5 septembre 2026 :
 *
 *   • L'AVANCEMENT. `project_phases.progress_percent` est renseigné sur
 *     les cinq phases du seul chantier de l'entreprise.
 *     `ai_get_project_context` (outil transverse `getProjectContext`) le
 *     rend déjà pour un chantier désigné ; `ai_operations_snapshot` en
 *     donne la moyenne pour le parc.
 *
 *   • LE TEMPS PASSÉ. Quatre pointages, 32 h, 128 000 c, tous validés,
 *     tous rattachés au chantier ET à l'intervention. La vue
 *     `project_labor_from_time` agrège déjà heures validées, heures en
 *     attente et coût validé : c'est du SQL, pas du modèle.
 *
 *   • L'ÉCART PLANIFIÉ / RÉEL DES INTERVENTIONS. `scheduled_end` et
 *     `actual_end` sont renseignés sur les trois interventions, et
 *     l'écart réel est là : « CHANTIER » était prévue jusqu'au 27/08
 *     10 h et s'est terminée le 29/08 à 15 h 05 — 53 heures de
 *     dérapage, que RIEN dans ce produit ne calculait avant.
 *
 * CE QU'IL NOMME PLUTÔT QUE DE L'INVENTER :
 *
 *   • LE RETARD n'a aucune donnée : `planned_end_on` est nul sur 1
 *     chantier sur 1 et sur 5 phases sur 5. `ai_get_daily_priorities`
 *     calcule pourtant « chantiersEnRetard » avec `planned_end_on <
 *     today` : elle rendra TOUJOURS une liste vide, et cette liste vide
 *     se lit « aucun retard » alors qu'elle veut dire « aucune date de
 *     référence ». C'est la confusion zéro / je-ne-sais-pas que ce
 *     produit a déjà corrigée quatre fois ; reprendre cette sortie
 *     telle quelle aurait été la cinquième. `ai_operations_snapshot`
 *     rend donc `retard.enRetard = null` avec un motif en français, et
 *     la limite ci-dessous ordonne de le dire.
 *
 *   • LE TEMPS PRÉVU n'existe nulle part : `project_tasks` est la seule
 *     table à porter `planned_hours` et elle est vide. La dérive
 *     d'heures est structurellement impossible, pas seulement vide.
 *
 *   • LA CAPACITÉ n'existe pas : aucun salarié actif (les deux sont
 *     archivés depuis le 02/09/2026), une seule appartenance d'équipe
 *     pour deux équipes, aucune compétence enregistrée.
 *
 * ══════════════════════════════════════════════════════════════════
 * POURQUOI L'ARGENT N'EST PAS DE SON RESSORT
 * ══════════════════════════════════════════════════════════════════
 *
 * `ai_analyze_project_margin` (agent Finance) rend déjà, chantier par
 * chantier, le budget vendu, les coûts engagés et l'écart.
 * `ai_operations_snapshot` n'en redonne rien : deux calculs du même
 * chiffre finissent par en donner deux différents le jour où l'un des
 * deux bouge. La limite le dit à l'agent, et sa description d'outil le
 * répète — parce que ses mots-clés attrapent « chantier », donc aussi
 * « la marge du chantier », et qu'il faut alors qu'il renvoie plutôt
 * que de répondre à côté avec aplomb.
 *
 * ══════════════════════════════════════════════════════════════════
 * CE QUI RESTE À L'INTÉGRATION, ET CE FICHIER N'EST PAS COMPLET SANS
 * ══════════════════════════════════════════════════════════════════
 *
 * L'outil `getOperationsSnapshot` et sa fonction `ai_operations_snapshot`
 * sont écrits et éprouvés, mais dans des fichiers PARTAGÉS que ce
 * constructeur ne touche pas :
 *
 *   • `runtime/outils/operations.sql`     → `supabase/migrations/0082_agents_ia.sql`
 *   • `runtime/outils/operations.ts`      → `runtime/tools.ts` (`OUTILS_LECTURE`)
 *   • `runtime/outils/operations.epreuve.sql` → `supabase/tests/agents_ia.sql`
 *
 * Sans le premier geste, le deuxième déclare un outil sans fonction —
 * et `tools.test.ts` le refuse, à juste titre.
 */
export const AGENT_CHANTIERS: DefinitionAgent = {
  cle: "operations",
  libelle: "Chantiers",
  // NE PAS TOUCHER SANS TOUCHER `lib/ai/types.ts` : `AGENT_LABELS`,
  // `AGENT_MISSIONS` et `AGENT_REQUIRED_PERMISSIONS` recopient ces
  // trois champs pour l'écran des réglages, et un test les compare mot
  // pour mot. Deux libellés pour un agent, c'est un utilisateur qui
  // croit qu'il y en a deux.
  mission:
    "Avancement des chantiers en cours, heures réellement pointées et écart entre " +
    "l'intervention prévue et l'intervention faite.",
  responsabilites:
    "Suit l'avancement des chantiers ouverts, les heures pointées — validées et en attente — " +
    "et l'écart entre la fin prévue et la fin réelle des interventions. Aucun écran ne lui " +
    "transmet d'identifiant : il ouvre donc par la vue de parc, puis descend sur un chantier " +
    "précis une fois qu'il l'a retrouvé par son nom. Chaque chiffre vient d'un outil, aucun " +
    "n'est recompté. Et il NOMME ce que ce produit ne sait pas voir — retard, temps prévu, " +
    "capacité — au lieu de le compter à zéro.",
  limites: [
    "N'écrit rien. Il ne planifie pas, ne déplace pas une intervention, ne valide pas un " +
      "pointage et ne change pas l'avancement d'une phase : aucun outil d'action ne lui " +
      "appartient. Il dit où se trouve l'écran qui le fait.",
    "NE CONCLUT JAMAIS sur un retard tant que « retard.enRetard » vaut null : cela veut dire " +
      "« aucune date de fin prévue », jamais « aucun retard ». Il rend le motif tel quel, dit " +
      "combien de chantiers et de phases portent une date, et demande qu'on la renseigne.",
    "Ne compare pas les heures passées aux heures prévues : aucune heure prévue n'existe dans " +
      "ce modèle de données. La dérive d'heures est impossible, pas seulement vide — et " +
      "« nonMesurable.tempsPrevu » le dit à chaque appel tant que c'est vrai.",
    "Ne dit rien de la capacité, de la charge ni de l'effectif d'une équipe : ni salarié " +
      "actif, ni compétence, ni heures contractuelles ne sont enregistrés. Il nomme l'équipe " +
      "affectée à une intervention, jamais le nombre de personnes.",
    "Ne parle ni de marge, ni de budget, ni de coût de chantier : la Finance les calcule déjà, " +
      "et deux calculs du même chiffre finissent par en donner deux différents. Il renvoie à " +
      "l'agent Finance plutôt que d'estimer.",
    "Une intervention sans début réel a une fin connue et une durée INCONNUE. Il rend l'écart " +
      "de fin, et refuse d'en déduire un temps réellement travaillé.",
    "Ne chiffre aucun temps de trajet et ne dit rien de la disponibilité du matériel : le " +
      "distancier n'existe pas, et le matériel appartient à l'agent Matériel.",
  ],
  droitsAttendus: ["projects.read"],
  /**
   * LES MOTS QUI L'APPELLENT, ET CELUI QU'IL NE PREND PAS.
   *
   * « chantier » est son nom commun, et c'est pour cela qu'il le prend
   * malgré l'ambiguïté : le refuser rendrait l'agent presque
   * inatteignable depuis le fil de discussion, qui est le seul écran
   * d'où on l'appelle. La contrepartie est nommée plutôt que cachée :
   * « la marge du chantier » tombera ici, parce que l'ORDRE de
   * `aiguillage.ts` essaie les Chantiers avant la Finance. D'où la
   * limite qui lui ordonne de renvoyer à la Finance sur l'argent.
   *
   * « retard » NU N'EST PAS PRIS, et c'est délibéré : « facture en
   * retard » appartient à la Facturation, qui est essayée en premier
   * grâce à « factur », mais un « retard » nu attraperait tout le
   * reste. « chantier » suffit à faire venir « quels chantiers sont en
   * retard ».
   *
   * « intervention » N'EST PRIS PAR PERSONNE, ni ici ni par le
   * Planning. Le mot désigne autant « pose une intervention mardi »
   * (Planning) que « cette intervention a-t-elle dérapé ? » (ici).
   * Mieux vaut tomber sur la Direction, qui ira demander aux deux, que
   * sur le mauvais spécialiste, qui répondra à côté avec aplomb.
   */
  motsCles: [
    "chantier",
    "avancement",
    "pointage",
    "heures pointées",
    "heures passées",
    "temps passé",
    // « où en est » A ÉTÉ RETIRÉ, et c'était une régression mesurée.
    //
    // C'est une AMORCE DE PHRASE française, pas un mot de métier : elle
    // n'appartient à aucun domaine, et elle attrapait donc tout ce qui
    // la suivait. Vérifié en exécutant le vrai `aiguiller()` : « où en
    // est ma trésorerie ? », « où en est mon chiffre d'affaires ? » et
    // « où en est ma marge globale » partaient aux Chantiers, alors
    // qu'elles allaient à la Finance avant ce chantier — et que les
    // Chantiers refusent l'argent par une limite explicite. On avait
    // remplacé un agent qui répond par un agent qui décline.
    //
    // Le mot ne manque pas : « où en est le chantier Mairie ? » est
    // toujours aiguillé par « chantier », qui est un vrai mot de
    // métier. Un test rejoue les deux familles de questions.
    "dérap",
  ],
};
